import type {
  Args,
  EngineInterface,
  Frozen,
  Next,
  ToolCallResult,
  TurnCompleteReason,
} from 'claude-code'

import type { KanbanCard } from '../types'
import { watchTool, watchTurnEnd, watchTurnStart } from './activity'
import {
  updateActivity,
  updateBoard,
  updateQueue,
  updateReconcile,
  updateSync,
} from './atoms'
import { EMPTY_TURN, errorMessage, isKanbanFile, isPendingId } from './model'
import { S } from './strings'

// At the end of a turn that worked on a card and left it in Claude with nothing
// said, Claude is asked once what became of it; a turn that changed files and
// touched no card is noted to the person once a session. Only watched here: no
// hook below changes a tool call or a turn. The hooks wrap the activity
// watchers, because an event takes only one hook without a matcher.

type ToolInput = Frozen<Args<'tool.call'>>

// The tools that name a card by number; the first three are the ones activity.ts follows.
const CARD_TOOLS = [
  'mcp__kanban__kanban_show',
  'mcp__kanban__kanban_handoff',
  'mcp__kanban__kanban_move',
  'mcp__kanban__kanban_ask',
]
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']
// The most reconcile prompts kept while they wait for their turn to start.
const MAX_WAITING = 20

/** The `reconcile` setting: on unless it says false. */
export const reconcileOn = (value: unknown): boolean => value !== false

/** Runs bookkeeping nothing waits on; a failure goes to the log, not into the call. */
async function observe($: EngineInterface, work: Promise<unknown>) {
  try {
    await work
  } catch (error) {
    $.ui.log(S.reconcileFailed(errorMessage(error)), { to: 'debug' })
  }
}

// Whether a successful call of a card tool leaves its card with something said:
// a handoff, a question, or a move away from Claude. A move into Claude says nothing.
function isSettling(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'mcp__kanban__kanban_show') return false
  if (tool === 'mcp__kanban__kanban_move') return input.to !== 'claude'

  return true
}

async function recordTool(
  $: EngineInterface,
  e: ToolInput,
  ran: ToolCallResult,
): Promise<void> {
  const input: Record<string, unknown> = { ...e }
  if (EDIT_TOOLS.includes(e.tool)) {
    if (ran.deny !== undefined || ran.isError === true) return

    const file = input.file_path ?? input.notebook_path
    if (isKanbanFile(file)) return

    await updateReconcile($, state => ({
      ...state,
      turn: { ...state.turn, hasEdits: true },
    }))

    return
  }
  if (!CARD_TOOLS.includes(e.tool)) return

  const board = await updateBoard($, one => one)
  const card = board.cards.find(
    one => one.number === input.card && !isPendingId(one.id),
  )
  if (card === undefined) return

  // A call that was refused still shows the card was on Claude's mind; it says nothing of it.
  const isSettled = ran.deny === undefined && isSettling(e.tool, input)
  await updateReconcile($, state => ({
    ...state,
    turn: {
      ...state.turn,
      cards: {
        ...state.turn.cards,
        [card.id]: state.turn.cards[card.id] === true || isSettled,
      },
    },
  }))
}

/** Watches a tool call as the activity does, and notes the cards it names and the files it changes for the running turn. Never alters the call. */
export async function reconcileToolCall(
  $: EngineInterface,
  e: ToolInput,
  next: Next<'tool.call'>,
  isOn: boolean,
) {
  const ran = await watchTool($, e, next)
  if (isOn) await observe($, recordTool($, e, ran))

  return ran
}

async function begin($: EngineInterface, text: string): Promise<void> {
  // The activity watcher has run: the card the turn's prompt was about is its live card.
  const { live } = await updateActivity($, state => state)
  await updateReconcile($, state => {
    const at = state.waiting.findIndex(prompt => text.includes(prompt))

    return {
      ...state,
      turn: {
        isReconcile: at >= 0,
        hasEdits: false,
        cards: live.cardId === '' ? {} : { [live.cardId]: false },
      },
      waiting: state.waiting.filter((_, index) => index !== at),
    }
  })
}

/**
 * Watches a turn begin as the activity does: the card its prompt was about is
 * the first of the turn's cards, and a turn that a reconcile prompt started is
 * marked.
 */
export async function reconcileTurnStart(
  $: EngineInterface,
  e: Frozen<Args<'turn.start'>>,
  next: Next<'turn.start'>,
  isOn: boolean,
) {
  const started = await watchTurnStart($, e, next)
  if (isOn && e.agentId === undefined) await observe($, begin($, e.text))

  return started
}

// Whether a prompt that starts work is on its way: a card whose move into Claude
// is yet to be confirmed sends it then. The queue starts a waiting card the
// moment a slot is free, so a card still waiting has no room and is no wait.
async function isWorkDue($: EngineInterface): Promise<boolean> {
  const sync = await updateSync($, one => one)

  return Object.values(sync).some(entry => entry.onConfirm !== undefined)
}

// A round of a card is the activity's: a new one starts when the card is worked on afresh.
async function askAbout(
  $: EngineInterface,
  cards: readonly KanbanCard[],
): Promise<void> {
  const { cards: activity } = await updateActivity($, state => state)
  const roundsOf = (card: KanbanCard) => activity[card.id]?.rounds.length ?? 0
  const asked = { cards: [] as KanbanCard[] }
  await updateReconcile($, state => {
    asked.cards = cards.filter(card => state.sent[card.id] !== roundsOf(card))

    return {
      ...state,
      sent: {
        ...state.sent,
        ...Object.fromEntries(
          asked.cards.map(card => [card.id, roundsOf(card)]),
        ),
      },
      waiting: [
        ...state.waiting,
        ...asked.cards.map(card => S.reconcilePrompt(card.number)),
      ].slice(-MAX_WAITING),
    }
  })
  // Not awaited: the prompt runs as a turn of its own once this one has ended.
  for (const card of asked.cards) {
    $.prompt
      .submit({ text: S.reconcilePrompt(card.number) })
      .catch((error: unknown) => $.ui.log(S.promptFailed(errorMessage(error))))
  }
}

async function noteUntracked($: EngineInterface): Promise<void> {
  const seen = { isFirst: false }
  await updateReconcile($, state => {
    seen.isFirst = !state.isNudged

    return state.isNudged ? state : { ...state, isNudged: true }
  })
  if (seen.isFirst) $.ui.toast(S.untrackedWork)
}

async function finish(
  $: EngineInterface,
  reason: TurnCompleteReason,
): Promise<void> {
  const seen = { turn: EMPTY_TURN }
  await updateReconcile($, state => {
    seen.turn = state.turn

    return { ...state, turn: EMPTY_TURN }
  })
  const { turn } = seen
  // A reconcile turn is never answered in kind, whatever it did or left.
  if (reason !== 'answer' || turn.isReconcile) return

  const board = await updateBoard($, one => one)
  if (board.fetchedAt === 0) return

  const queue = await updateQueue($, one => one)
  const unsettled = Object.keys(turn.cards)
    .filter(id => turn.cards[id] === false)
    .map(id => board.cards.find(card => card.id === id))
    .filter(
      (card): card is KanbanCard =>
        card?.column === 'claude' && queue.held[card.id] === undefined,
    )
  const isUntracked =
    turn.hasEdits &&
    Object.keys(turn.cards).length === 0 &&
    !board.cards.some(card => card.column === 'claude')
  if (unsettled.length === 0 && !isUntracked) return
  if (await isWorkDue($)) return

  if (isUntracked) await noteUntracked($)
  else await askAbout($, unsettled)
}

/**
 * Watches a turn end as the activity does. Of the main loop's, one that was
 * answered and not itself a reconcile prompt asks once about each card of the
 * turn still in Claude with no handoff, question or move (once a round, and not
 * while a prompt that starts work is due), or, with changed files and no card
 * at all, notes it to the person once a session. Never alters the turn.
 */
export async function reconcileTurnEnd(
  $: EngineInterface,
  e: Frozen<Args<'turn.complete'>>,
  next: Next<'turn.complete'>,
  isOn: boolean,
) {
  const done = await watchTurnEnd($, e, next)
  if (isOn && e.agentId === undefined) await observe($, finish($, e.reason))

  return done
}

import type {
  Args,
  EngineInterface,
  Frozen,
  Next,
  StreamNext,
} from 'claude-code'

import type { KanbanActivity, KanbanCardActivity, KanbanRound } from '../types'
import { targetText } from './activity-view'
import { updateActivity, updateBoard, updateQueue } from './atoms'
import { errorMessage } from './model'
import { S } from './strings'

// What Claude does on a card is only watched here: no hook below changes a
// tool call, a turn or a spawn, and a failure goes to the log, not into them.

type State = KanbanActivity
type CardState = KanbanCardActivity
type Usage = { input: number; output: number; cacheRead: number }

const STORE_SHAPE = 'activity-1'
const MAX_NOTES = 20
// The tools that name a card by number; touching one in Claude makes it the card.
const CARD_TOOLS = [
  'mcp__kanban__kanban_show',
  'mcp__kanban__kanban_handoff',
  'mcp__kanban__kanban_move',
]
// The tool input fields that say what a call is about, most telling first.
const TARGET_FIELDS = [
  'file_path',
  'notebook_path',
  'path',
  'command',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
]

// Prompts this plugin submitted for a card, until the turn each starts begins.
// Lost on a reload, which the tool a card is touched with makes up for.
const notes: { cardId: string; text: string }[] = []

/** Notes that `text`, a prompt about the card, is being submitted: the turn it starts is the card's. */
export function noteCardPrompt(cardId: string, text: string): void {
  notes.push({ cardId, text })
  if (notes.length > MAX_NOTES) notes.shift()
}

function takeNote(text: string): string {
  const found = notes.findIndex(note => text.includes(note.text))
  if (found < 0) return ''

  return notes.splice(found, 1)[0]?.cardId ?? ''
}

const blankCard = (cardId: string): CardState => ({
  cardId,
  rounds: [],
  lastAt: 0,
  lastAgent: '',
  tool: '',
  target: '',
  toolId: '',
  isToolRunning: false,
})

const newRound = (at: number): KanbanRound => ({
  startedAt: at,
  ms: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  agents: [S.mainAgent],
  isOpen: true,
})

function changeCard(
  state: State,
  cardId: string,
  change: (card: CardState) => CardState,
): State {
  const card = state.cards[cardId] ?? blankCard(cardId)

  return { ...state, cards: { ...state.cards, [cardId]: change(card) } }
}

function changeLast(
  card: CardState,
  change: (round: KanbanRound) => KanbanRound,
): CardState {
  const last = card.rounds.at(-1)

  return last === undefined
    ? card
    : { ...card, rounds: [...card.rounds.slice(0, -1), change(last)] }
}

const closeRounds = (card: CardState): CardState => ({
  ...card,
  rounds: card.rounds.map(round => ({ ...round, isOpen: false })),
})

// Counts the time since the last count to the card the running turn is on.
function flush(state: State, at: number): State {
  const { cardId, since, isRunning } = state.live
  const counted = { ...state, live: { ...state.live, since: at } }
  if (cardId === '' || !isRunning || at <= since) return counted

  return changeCard(counted, cardId, card =>
    changeLast(card, round => ({ ...round, ms: round.ms + (at - since) })),
  )
}

// A new round on the card: Claude is starting it afresh.
function beginRound(state: State, cardId: string, at: number): State {
  return changeCard(state, cardId, card => ({
    ...card,
    rounds: [...closeRounds(card).rounds, newRound(at)],
    lastAt: at,
    lastAgent: S.mainAgent,
  }))
}

/** The state when a main turn starts; `cardId` is the card its prompt was about, if any. */
function startTurn(state: State, at: number, cardId: string): State {
  const flushed = flush(state, at)
  const started: State = {
    ...flushed,
    live: { cardId, since: at, isRunning: true },
  }

  return cardId === '' ? started : beginRound(started, cardId, at)
}

/** The state when Claude, in a running turn, touches a card in Claude with a kanban tool. */
function touchCard(state: State, cardId: string, at: number): State {
  if (!state.live.isRunning || state.live.cardId === cardId) return state

  const flushed = flush(state, at)
  const before = flushed.live.cardId
  const moved: State = {
    ...flushed,
    live: { ...flushed.live, cardId },
    cards:
      before === '' || flushed.cards[before] === undefined
        ? flushed.cards
        : {
            ...flushed.cards,
            [before]: { ...flushed.cards[before], isToolRunning: false },
          },
  }

  return changeCard(moved, cardId, card => {
    const isOpen = card.rounds.at(-1)?.isOpen === true

    return {
      ...card,
      rounds: isOpen ? card.rounds : [...card.rounds, newRound(at)],
      lastAt: at,
    }
  })
}

/** The state when the main turn ends: its time is counted and no card is being worked on. */
function endTurn(state: State, at: number): State {
  const flushed = flush(state, at)
  const { cardId } = flushed.live
  const ended: State = {
    ...flushed,
    live: { cardId: '', since: at, isRunning: false },
  }

  return cardId === ''
    ? ended
    : changeCard(ended, cardId, card => ({
        ...card,
        lastAt: at,
        isToolRunning: false,
      }))
}

/** The state when a card leaves Claude: its round ends and the turn is on no card. */
function leaveCard(state: State, cardId: string, at: number): State {
  const isLive = state.live.cardId === cardId
  const flushed = isLive ? flush(state, at) : state
  const left: State = isLive
    ? { ...flushed, live: { ...flushed.live, cardId: '' } }
    : flushed
  if (left.cards[cardId] === undefined) return left

  return changeCard(left, cardId, card => ({
    ...closeRounds(card),
    lastAt: at,
    isToolRunning: false,
  }))
}

/** The state when `agent` starts a tool on the card. */
function startTool(
  state: State,
  cardId: string,
  tool: { agent: string; name: string; target: string; id: string },
  at: number,
): State {
  return changeCard(state, cardId, card => ({
    ...card,
    lastAt: at,
    lastAgent: tool.agent,
    tool: tool.name,
    target: tool.target,
    toolId: tool.id,
    isToolRunning: true,
  }))
}

/** The state when a tool ends; only the tool shown can end the running mark. */
function endTool(
  state: State,
  cardId: string,
  toolId: string,
  at: number,
): State {
  if (state.cards[cardId] === undefined) return state

  return changeCard(state, cardId, card => ({
    ...card,
    lastAt: at,
    isToolRunning: card.toolId === toolId ? false : card.isToolRunning,
  }))
}

/** The state after a model request on the card, while its round is open. */
function addUsage(
  state: State,
  cardId: string,
  usage: Usage,
  at: number,
): State {
  const card = state.cards[cardId]
  if (card?.rounds.at(-1)?.isOpen !== true) return state

  return changeCard(state, cardId, one => ({
    ...changeLast(one, round => ({
      ...round,
      input: round.input + usage.input,
      output: round.output + usage.output,
      cacheRead: round.cacheRead + usage.cacheRead,
    })),
    lastAt: at,
  }))
}

/** The state when a subagent is seen; the first sighting fixes the card it inherited. */
function noteAgent(
  state: State,
  agentId: string,
  name: string,
  cardId: string,
): State {
  if (state.agents[agentId] !== undefined) return state

  const seen: State = {
    ...state,
    agents: { ...state.agents, [agentId]: { name, cardId } },
  }
  if (cardId === '' || seen.cards[cardId] === undefined) return seen

  return changeCard(seen, cardId, card =>
    changeLast(card, round =>
      round.agents.includes(name)
        ? round
        : { ...round, agents: [...round.agents, name] },
    ),
  )
}

/** Runs bookkeeping nothing waits on; a failure goes to the log, not into the call. */
async function observe($: EngineInterface, work: Promise<unknown>) {
  try {
    await work
  } catch (error) {
    $.ui.log(S.activityFailed(errorMessage(error)), { to: 'debug' })
  }
}

// The latest state: a read here would be the moment the dispatch first read.
function current($: EngineInterface) {
  return updateActivity($, state => state)
}

const storeKey = (cwd: string, cardId: string) => `activity:${cwd}:${cardId}`

type Saved = { shape: string; cwd: string; card: CardState }

function isSaved(value: unknown, cwd: string): value is Saved {
  if (typeof value !== 'object' || value === null) return false
  const saved = value as Record<string, unknown>
  const card = saved.card as Record<string, unknown> | null

  return (
    saved.shape === STORE_SHAPE &&
    saved.cwd === cwd &&
    typeof card === 'object' &&
    card !== null &&
    typeof card.cardId === 'string' &&
    Array.isArray(card.rounds)
  )
}

/** Keeps a card's totals in the store, under this directory, so a new session has them. */
async function save($: EngineInterface, cardId: string): Promise<void> {
  const card = (await current($)).cards[cardId]
  if (card === undefined) return

  const cwd = await $.session.cwd()
  const saved: Saved = { shape: STORE_SHAPE, cwd, card }
  await $.store.set(storeKey(cwd, cardId), saved)
}

/** Loads the totals kept for this directory; a card seen this session keeps its live figures. */
export async function restoreActivity($: EngineInterface): Promise<void> {
  await observe($, restore($))
}

async function restore($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const prefix = `activity:${cwd}:`
  const found: CardState[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const value = await $.store.get(key)
    if (isSaved(value, cwd)) found.push(closeRounds(value.card))
  }
  if (found.length === 0) return

  await updateActivity($, state => ({
    ...state,
    cards: {
      ...Object.fromEntries(
        found.map(card => [
          card.cardId,
          { ...card, tool: '', target: '', toolId: '', isToolRunning: false },
        ]),
      ),
      ...state.cards,
    },
  }))
}

/** Counts a card's time up to now and ends its round, because the card left Claude. */
export async function noteCardLeft(
  $: EngineInterface,
  cardId: string,
): Promise<void> {
  await observe(
    $,
    (async () => {
      const at = await $.clock.now()
      await updateActivity($, state => leaveCard(state, cardId, at))
      await save($, cardId)
    })(),
  )
}

const toolName = (tool: string) =>
  tool.startsWith('mcp__') ? (tool.split('__').at(-1) ?? tool) : tool

// What a call is about, in a few words: a path under the directory, a command's first line.
function targetOf(input: Record<string, unknown>, cwd: string): string {
  if (typeof input.card === 'number') return `#${input.card}`

  for (const field of TARGET_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.trim() !== '') {
      const text = targetText(value)

      return text.startsWith(`${cwd}/`) ? text.slice(cwd.length + 1) : text
    }
  }

  return ''
}

const agentNameOf = (name: string | undefined, type: string) =>
  name !== undefined && name !== '' ? name : type

type Who = { name: string; cardId: string }

// The agent behind an event and the card it works for. Main works for the card
// of the running turn; a subagent for the one it inherited, which for one the
// spawn hook did not see is the card at the moment it is first met.
async function whoIs(
  $: EngineInterface,
  agentId: string | undefined,
): Promise<Who | undefined> {
  const state = await current($)
  if (agentId === undefined) {
    return {
      name: S.mainAgent,
      cardId: state.live.isRunning ? state.live.cardId : '',
    }
  }

  const known = state.agents[agentId]
  if (known !== undefined) return known

  const info = (await $.agent.list()).find(one => one.id === agentId)
  if (info === undefined) return undefined

  const name = agentNameOf(info.name, info.type)
  const next = await updateActivity($, one =>
    noteAgent(one, agentId, name, one.live.isRunning ? one.live.cardId : ''),
  )

  return next.agents[agentId]
}

type ToolInput = Frozen<Args<'tool.call'>>

async function recordToolStart($: EngineInterface, e: ToolInput) {
  const who = await whoIs($, e.agentId)
  if (who === undefined || who.cardId === '') return

  const at = await $.clock.now()
  const cwd = await $.session.cwd()
  const input: Record<string, unknown> = { ...e }
  const tool = {
    agent: who.name,
    name: toolName(e.tool),
    target: targetOf(input, cwd),
    id: e.tool_use_id ?? '',
  }
  await updateActivity($, state => startTool(state, who.cardId, tool, at))
}

async function recordToolEnd($: EngineInterface, e: ToolInput) {
  const who = await whoIs($, e.agentId)
  const at = await $.clock.now()
  if (who !== undefined && who.cardId !== '') {
    await updateActivity($, state =>
      endTool(state, who.cardId, e.tool_use_id ?? '', at),
    )
  }
  if (e.agentId !== undefined || !CARD_TOOLS.includes(e.tool)) return

  // Claude touched a card by number: it is the card now, if it is in Claude.
  const number = (e as Record<string, unknown>).card
  const board = await updateBoard($, one => one)
  const card = board.cards.find(one => one.number === number)
  if (card === undefined || card.column !== 'claude') return

  // A card waiting in the queue is not being worked on, whatever Claude looks at.
  const { held } = await updateQueue($, one => one)
  if (held[card.id] !== undefined) return

  const seen = { cardId: '' }
  await updateActivity($, state => {
    seen.cardId = state.live.cardId
    return touchCard(state, card.id, at)
  })
  if (seen.cardId !== '' && seen.cardId !== card.id) await save($, seen.cardId)
}

/** Watches a tool call: the card it runs for shows it while it runs. Never alters the call. */
export async function watchTool(
  $: EngineInterface,
  e: ToolInput,
  next: Next<'tool.call'>,
) {
  await observe($, recordToolStart($, e))
  try {
    return await next(e)
  } finally {
    await observe($, recordToolEnd($, e))
  }
}

/** Watches a spawn: the subagent inherits the card the spawning loop works for. */
export async function watchSpawn(
  $: EngineInterface,
  e: Frozen<Args<'agent.spawn'>>,
  next: Next<'agent.spawn'>,
) {
  const spawned = await next(e)
  if ('agentId' in spawned && spawned.agentId !== undefined) {
    const { agentId } = spawned
    await observe(
      $,
      (async () => {
        const parent = await whoIs($, e.parentAgentId)
        const name = agentNameOf(e.name, e.subagentType)
        await updateActivity($, state =>
          noteAgent(state, agentId, name, parent?.cardId ?? ''),
        )
      })(),
    )
  }

  return spawned
}

/** Watches a turn begin: one started by a kanban prompt belongs to its card. */
export async function watchTurnStart(
  $: EngineInterface,
  e: Frozen<Args<'turn.start'>>,
  next: Next<'turn.start'>,
) {
  const started = await next(e)
  if (e.agentId === undefined) {
    await observe(
      $,
      (async () => {
        const at = await $.clock.now()
        const cardId = takeNote(e.text)
        await updateActivity($, state => startTurn(state, at, cardId))
      })(),
    )
  }

  return started
}

/** Watches a model request: its tokens go to the card its loop works for, while the round is open. */
export async function* watchStep(
  $: EngineInterface,
  e: Frozen<Args<'turn.step'>>,
  next: StreamNext<'turn.step'>,
) {
  const response = yield* next(e)
  const { usage } = response
  if (usage !== null) {
    await observe(
      $,
      (async () => {
        const who = await whoIs($, e.agentId)
        if (who === undefined || who.cardId === '') return

        const at = await $.clock.now()
        const counted: Usage = {
          // Tokens written to the cache were fresh input; the ones read are kept apart.
          input: usage.input_tokens + usage.cache_creation_input_tokens,
          output: usage.output_tokens,
          cacheRead: usage.cache_read_input_tokens,
        }
        const after = await updateActivity($, state =>
          addUsage(state, who.cardId, counted, at),
        )
        // A turn saves at its end; a step outside one has no end to wait for.
        if (!after.live.isRunning) await save($, who.cardId)
      })(),
    )
  }

  return response
}

/** Watches a turn end: its time is counted and the totals are kept. */
export async function watchTurnEnd(
  $: EngineInterface,
  e: Frozen<Args<'turn.complete'>>,
  next: Next<'turn.complete'>,
) {
  const done = await next(e)
  if (e.agentId === undefined) {
    await observe(
      $,
      (async () => {
        const at = await $.clock.now()
        const seen = { cardId: '' }
        await updateActivity($, state => {
          seen.cardId = state.live.cardId
          return endTurn(state, at)
        })
        if (seen.cardId !== '') await save($, seen.cardId)
      })(),
    )
  }

  return done
}

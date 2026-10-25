import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendMode,
  KanbanCard,
  KanbanColumn,
  KanbanPrompt,
  KanbanQueue,
  KanbanSync,
} from '../types'
import { readBoard, updateBoard, updateQueue, updateSync } from './atoms'
import { sectionList } from './layout'
import { DEFAULT_CLAUDE_LIMIT, errorMessage } from './model'
import { S } from './strings'

// A card the person moves to Claude while Claude is at its limit waits here
// with the prompt it would have sent. Not the sync entry's `queued`, which is a
// move asked for while another is in flight.

type Sync = Readonly<Record<string, KanbanSync>>
type Held = KanbanQueue['held']

const QUEUE_SHAPE = 'queue-1'

/** What the board shows of the queue: Claude's load and the waiting cards, in the section's order. */
export type QueueView = {
  limit: number
  running: number
  waiting: readonly string[]
}

/** The `claudeLimit` setting as a limit: a whole number, 0 for none; anything else counts as the default. */
export function claudeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_CLAUDE_LIMIT
}

// A card has Claude's attention while it sits in Claude and is not waiting, or
// while its move out of Claude is yet to be confirmed (it may still snap back).
function holdsSlot(
  card: KanbanCard,
  entry: KanbanSync | undefined,
  held: Held,
): boolean {
  if (held[card.id] !== undefined) return false
  if (card.column === 'claude') return true

  return entry?.phase === 'pending' && entry.from === 'claude'
}

/** The queue as the board draws it. */
export function queueView(
  queue: KanbanQueue,
  cards: readonly KanbanCard[],
  sync: Sync,
): QueueView {
  return {
    limit: queue.limit,
    running: cards.filter(card => holdsSlot(card, sync[card.id], queue.held))
      .length,
    waiting: sectionList(cards, 'claude')
      .filter(card => queue.held[card.id] !== undefined)
      .map(card => card.id),
  }
}

/** A waiting card's place in the queue, from 1; undefined for a card that is not waiting. */
export function queuePlace(
  view: QueueView,
  cardId: string,
): number | undefined {
  const index = view.waiting.indexOf(cardId)

  return index < 0 ? undefined : index + 1
}

/** The count a section header shows: Claude's load against its limit, when it has one. */
export function headerCount(
  column: KanbanColumn,
  shown: number,
  total: number,
  view: QueueView,
): string {
  return column === 'claude' && view.limit > 0
    ? S.claudeCount(view.running, view.limit, view.waiting.length)
    : S.count(shown, total)
}

const queueKey = (cwd: string, mode: KanbanBackendMode) =>
  `queue:${cwd}:${mode}`

async function readSaved(
  $: EngineInterface,
  mode: KanbanBackendMode,
): Promise<Held> {
  try {
    const saved: unknown = await $.store.get(
      queueKey(await $.session.cwd(), mode),
    )
    if (typeof saved !== 'object' || saved === null) return {}

    const { shape, held } = saved as Record<string, unknown>
    if (shape !== QUEUE_SHAPE || typeof held !== 'object' || held === null)
      return {}

    const kept: Held = {}
    for (const [cardId, prompt] of Object.entries(held)) {
      if (prompt === 'work' || prompt === 'resume' || prompt === 'answer')
        kept[cardId] = prompt
    }

    return kept
  } catch (error) {
    $.ui.log(S.queueRestoreFailed(errorMessage(error)), { to: 'debug' })

    return {}
  }
}

// The newest queue is saved, so two saves landing out of order leave the later state.
async function saveHeld($: EngineInterface): Promise<void> {
  try {
    const { held } = await updateQueue($, queue => queue)
    const { mode } = await readBoard($)
    await $.store.set(queueKey(await $.session.cwd(), mode), {
      shape: QUEUE_SHAPE,
      held,
    })
  } catch (error) {
    $.ui.log(S.queueSaveFailed(errorMessage(error)), { to: 'debug' })
  }
}

/**
 * Called at session start: takes the limit from the setting and the waiting
 * cards from the store, kept per working directory and `backend` setting. They
 * start once a load shows the board.
 */
export async function applyQueue(
  $: EngineInterface,
  mode: KanbanBackendMode,
  limit: number,
): Promise<void> {
  const held = await readSaved($, mode)
  await updateQueue($, () => ({ limit, held }))
}

/**
 * Settles where a card the person just moved stands in the queue, resolving
 * whether its prompt is held back. A card moved out of Claude leaves the queue.
 * One moved in with a prompt joins the queue's end when Claude is at its limit,
 * or when cards already wait (they go first). `cards` is the board as that
 * move left it.
 */
export async function holdPrompt(
  $: EngineInterface,
  cardId: string,
  to: KanbanColumn,
  prompt: KanbanPrompt | undefined,
  cards: readonly KanbanCard[],
): Promise<boolean> {
  // A read here could be an older moment.
  const sync = await updateSync($, current => current)
  const seen = { isHeld: false, isChanged: false }
  await updateQueue($, queue => {
    const { [cardId]: was, ...others } = queue.held
    const isFull =
      queue.limit > 0 &&
      (Object.keys(others).length > 0 ||
        cards.filter(
          card => card.id !== cardId && holdsSlot(card, sync[card.id], others),
        ).length >= queue.limit)
    seen.isHeld = to === 'claude' && prompt !== undefined && isFull
    seen.isChanged = seen.isHeld || was !== undefined

    return {
      ...queue,
      held:
        seen.isHeld && prompt !== undefined
          ? { ...others, [cardId]: prompt }
          : others,
    }
  })
  if (seen.isChanged) await saveHeld($)

  return seen.isHeld
}

function promptFor(prompt: KanbanPrompt, card: KanbanCard): string {
  switch (prompt) {
    case 'work':
      return S.workPrompt(card.number, card.title)
    case 'resume':
      return S.resumePrompt(card.number)
    case 'answer':
      return S.answerPrompt(card.number)
  }
}

/** Asks Claude to take up a card: to work on it, to resume it after feedback, or to go on after an answer. */
export function submitPrompt(
  $: EngineInterface,
  card: KanbanCard,
  prompt: KanbanPrompt,
): void {
  $.prompt
    .submit({ text: promptFor(prompt, card) })
    .catch((error: unknown) => $.ui.log(S.promptFailed(errorMessage(error))))
}

type Started = { card: KanbanCard; prompt: KanbanPrompt }

// The waiting cards that fit under the limit, in the section's order, and who
// still waits. A waiting card no longer in Claude is dropped.
function release(
  queue: KanbanQueue,
  cards: readonly KanbanCard[],
  sync: Sync,
): { held: Held; started: Started[] } {
  const waiting = sectionList(cards, 'claude').filter(
    card => queue.held[card.id] !== undefined,
  )
  const taken = cards.filter(card =>
    holdsSlot(card, sync[card.id], queue.held),
  ).length
  const room =
    queue.limit === 0 ? waiting.length : Math.max(0, queue.limit - taken)

  const held: Held = {}
  const started: Started[] = []
  waiting.forEach((card, index) => {
    const prompt = queue.held[card.id]
    if (prompt === undefined) return

    if (index < room) started.push({ card, prompt })
    else held[card.id] = prompt
  })

  return { held, started }
}

// A card whose move into Claude is not yet confirmed gets its prompt from that
// confirmation, like any other; one already there is asked at once.
async function start(
  $: EngineInterface,
  card: KanbanCard,
  prompt: KanbanPrompt,
): Promise<void> {
  const seen = { isMoving: false }
  await updateSync($, sync => {
    const entry = sync[card.id]
    seen.isMoving = entry !== undefined && entry.phase !== 'ok'

    return entry === undefined || entry.phase === 'ok'
      ? sync
      : { ...sync, [card.id]: { ...entry, onConfirm: prompt } }
  })
  if (!seen.isMoving) submitPrompt($, card, prompt)
}

/**
 * Starts the waiting cards that fit under the limit now, top of the queue
 * first, one prompt each. Called when a slot may have freed: a move settled, a
 * load, the start of a session. With no loaded board it does nothing: the
 * cards it would go by may be old.
 */
export async function releaseQueued($: EngineInterface): Promise<void> {
  const before = await updateQueue($, queue => queue)
  if (Object.keys(before.held).length === 0) return

  // Reads in one dispatch are one moment; these are not.
  const board = await updateBoard($, current => current)
  if (board.fetchedAt === 0) return

  const sync = await updateSync($, current => current)
  const seen: { started: Started[]; isChanged: boolean } = {
    started: [],
    isChanged: false,
  }
  await updateQueue($, queue => {
    const next = release(queue, board.cards, sync)
    seen.started = next.started
    seen.isChanged =
      Object.keys(next.held).length !== Object.keys(queue.held).length

    return { ...queue, held: next.held }
  })
  if (seen.isChanged) await saveHeld($)

  for (const { card, prompt } of seen.started) await start($, card, prompt)
}

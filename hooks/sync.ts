import type { EngineInterface, Timer } from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanPrompt,
  KanbanSync,
} from '../types'
import { noteCardLeft } from './activity'
import { readBoard, readSync, updateSync, updateTick } from './atoms'
import { moveRemote } from './backend'
import {
  announceHandoff,
  ensureBackend,
  noteConfirmed,
  refresh,
  setBoard,
} from './board'
import { sectionList } from './layout'
import {
  MAX_ATTEMPTS,
  TICK_SHOWN_MS,
  errorMessage,
  isPendingId,
  maxOrder,
} from './model'
import { placeIn } from './order'
import { holdPrompt, releaseQueued, submitPrompt } from './queue'
import { S } from './strings'

export type MoveOptions = {
  /** A prompt for Claude to submit once the backend has confirmed the move. */
  onConfirm?: KanbanPrompt
  /** Tell the person the card is theirs once the backend has confirmed the move. */
  announce?: boolean
  /**
   * Where the card lands in its section: right after this card, or first when
   * null. Left out, a card moving to another section goes last and one in its
   * own section stays put.
   */
  after?: string | null
}

/** The options for a move the person makes: Backlog to Claude asks Claude to start work. */
export function moveOptions(from: KanbanColumn, to: KanbanColumn): MoveOptions {
  return from === 'backlog' && to === 'claude' ? { onConfirm: 'work' } : {}
}

const DEBOUNCE_MS = 300
const TICK_MS = 400

// Lost on a reload, which also drops the timers; resumePendingSyncs picks up
// from the sync atom, which is kept.
const inFlight = new Set<string>()
const debounce = new Map<string, Timer>()
let ticker: Timer | undefined

type Sync = Record<string, KanbanSync>

const without = (sync: Sync, cardId: string): Sync => {
  const { [cardId]: _gone, ...rest } = sync

  return rest
}

/** Runs work no one waits on; a failure goes to the transcript, not nowhere. */
function detach($: EngineInterface, work: Promise<unknown>): void {
  work.catch((error: unknown) => $.ui.log(S.syncFailed(errorMessage(error))))
}

const where = (after: string | null | undefined) =>
  after === undefined ? {} : { after }

/**
 * The entry after the person moves the card to `to` (after the card `after`,
 * when given), or none when the card is back where the backend has it. `from`
 * is the column the card was in on the board, which is the backend's only for
 * a card with no unsettled entry.
 */
function retarget(
  entry: KanbanSync | undefined,
  cardId: string,
  from: KanbanColumn,
  to: KanbanColumn,
  after: string | null | undefined,
  isInFlight: boolean,
  opts: MoveOptions | undefined,
): KanbanSync | undefined {
  const asked = {
    ...(opts?.onConfirm === undefined ? {} : { onConfirm: opts.onConfirm }),
    ...(opts?.announce === true ? { announce: true } : {}),
  }
  if (entry === undefined || entry.phase === 'ok')
    return {
      cardId,
      from,
      to,
      ...where(after),
      phase: 'pending',
      attempts: 0,
      ...asked,
    }

  const {
    error: _error,
    queued: _queued,
    queuedAfter: _queuedAfter,
    onConfirm,
    announce,
    ...rest
  } = entry
  // A reorder in the section the card is bound for keeps what its arrival
  // calls for; only leaving that section drops it.
  const isReorder = to === (entry.queued ?? entry.to)
  const confirm = {
    ...(isReorder && onConfirm !== undefined ? { onConfirm } : {}),
    ...(isReorder && announce === true ? { announce } : {}),
    ...asked,
  }
  // A call on its way finishes first; the move is sent after it.
  if (isInFlight) {
    const isAsked = to !== entry.to || after !== entry.after

    return {
      ...rest,
      ...(isAsked
        ? { queued: to, ...(after === undefined ? {} : { queuedAfter: after }) }
        : {}),
      ...confirm,
    }
  }

  const { after: _after, ...elsewhere } = rest

  return to === entry.from && after === undefined
    ? undefined
    : {
        ...elsewhere,
        to,
        ...where(after),
        phase: 'pending',
        attempts: 0,
        ...confirm,
      }
}

/**
 * Moves a card at once on the board, then, after a pause for further moves,
 * asks the backend to make it so. A refused move waits for a retry and, once
 * out of tries, puts the card back and says why. A prompt that Claude's limit
 * holds back waits in the queue instead (see queue.ts). With `opts.after` the card
 * is placed in its section, which may be the one it is in.
 */
export async function moveCard(
  $: EngineInterface,
  cardId: string,
  to: KanbanColumn,
  opts?: MoveOptions,
): Promise<void> {
  // A card still being made is not on the backend to be moved.
  if (isPendingId(cardId)) return

  // Done lists by update time: it keeps no order to place a card in.
  const after = to === 'done' ? undefined : opts?.after
  // The card is found inside the write: a read here could be an older moment.
  const seen: { from?: KanbanColumn; entry?: KanbanSync } = {}
  const moved = await setBoard($, board => {
    const card = board.cards.find(one => one.id === cardId)
    seen.from = undefined
    if (card === undefined) return board

    const placed =
      after === undefined ? undefined : placeIn(board.cards, cardId, to, after)
    // Nowhere new to go: its own section with no place asked, or the place it has.
    if (card.column === to && placed === undefined) return board

    seen.from = card.column
    const order = placed?.order ?? maxOrder(board.cards, to) + 1

    return {
      ...board,
      cards: board.cards.map(one => {
        if (one.id === cardId) return { ...one, column: to, order }
        const shifted = placed?.shifted[one.id]

        return shifted === undefined ? one : { ...one, order: shifted }
      }),
    }
  })
  const from = seen.from
  if (from === undefined) return
  if (from === 'claude' && to !== 'claude') await noteCardLeft($, cardId)

  // Claude at its limit holds the prompt back: the card waits in the queue.
  // A card placed within its own section stays where it stands in the queue.
  const isHeld =
    from !== to &&
    (await holdPrompt($, cardId, to, opts?.onConfirm, moved.cards))
  const { onConfirm: _held, ...unprompted } = opts ?? {}

  await updateSync($, sync => {
    seen.entry = retarget(
      sync[cardId],
      cardId,
      from,
      to,
      after,
      inFlight.has(cardId),
      isHeld ? unprompted : opts,
    )

    return seen.entry === undefined
      ? without(sync, cardId)
      : { ...sync, [cardId]: seen.entry }
  })
  // Cards already waiting go before this one.
  await releaseQueued($)

  debounce.get(cardId)?.cancel()
  debounce.delete(cardId)
  if (seen.entry === undefined) return

  debounce.set(
    cardId,
    $.clock.after(DEBOUNCE_MS, () => {
      debounce.delete(cardId)
      detach($, dispatch($, cardId))
    }),
  )
  ensureTicker($)
}

/** Sends a card's failed move again, at once. */
export async function retry($: EngineInterface, cardId: string): Promise<void> {
  const seen: { isFailed: boolean } = { isFailed: false }
  await updateSync($, sync => {
    const entry = sync[cardId]
    seen.isFailed = entry?.phase === 'failed'
    if (entry === undefined || entry.phase !== 'failed') return sync

    const { error: _error, ...rest } = entry

    return { ...sync, [cardId]: { ...rest, phase: 'pending' } }
  })
  if (!seen.isFailed) return

  ensureTicker($)
  detach($, dispatch($, cardId))
}

/** Sends every failed move again. */
export async function retryAll($: EngineInterface): Promise<void> {
  const sync = await readSync($)
  await Promise.all(
    Object.values(sync)
      .filter(entry => entry.phase === 'failed')
      .map(entry => retry($, entry.cardId)),
  )
}

/**
 * Picks up what a reload interrupted: moves still pending are sent again (a
 * move is the same when repeated), and a confirmed one still on show is timed out.
 */
export async function resumePendingSyncs($: EngineInterface): Promise<void> {
  const entries = Object.values(await readSync($))
  if (entries.length === 0) return

  const now = await $.clock.now()
  for (const entry of entries) {
    if (entry.phase === 'ok')
      expireLater($, entry.cardId, entry.settledAt ?? now, now)
  }
  ensureTicker($)
  await Promise.all(
    entries
      .filter(entry => entry.phase === 'pending')
      .map(entry => dispatch($, entry.cardId)),
  )
}

/** Starts the beat that pulses and fades the marks; it stops when none is showing. */
export function ensureTicker($: EngineInterface): void {
  if (ticker !== undefined) return

  ticker = $.clock.every(TICK_MS, () => detach($, tick($)))
}

const isShowing = (sync: Sync) =>
  Object.values(sync).some(
    entry => entry.phase === 'pending' || entry.phase === 'ok',
  )

async function tick($: EngineInterface): Promise<void> {
  if (isShowing(await readSync($))) {
    await updateTick($, count => count + 1)

    return
  }

  ticker?.cancel()
  ticker = undefined
  // A move in another dispatch may have landed after that read and found this
  // ticker still running, so it started none: look again, at the state as it is.
  if (isShowing(await updateSync($, sync => sync))) ensureTicker($)
}

/** Removes a confirmed card's mark once it has been shown long enough. */
export function expireLater(
  $: EngineInterface,
  cardId: string,
  settledAt: number,
  now: number,
): void {
  $.clock.after(Math.max(0, settledAt + TICK_SHOWN_MS - now), () =>
    detach(
      $,
      updateSync($, sync => {
        const entry = sync[cardId]

        return entry?.phase === 'ok' && entry.settledAt === settledAt
          ? without(sync, cardId)
          : sync
      }),
    ),
  )
}

/** Sends the card's move to the backend, one call at a time per card. */
async function dispatch($: EngineInterface, cardId: string): Promise<void> {
  if (inFlight.has(cardId)) return

  inFlight.add(cardId)
  let isMore = false
  try {
    isMore = await send($, cardId)
  } finally {
    inFlight.delete(cardId)
  }
  // A new dispatch, so it reads the state as it then stands.
  if (isMore) $.clock.after(0, () => detach($, dispatch($, cardId)))
}

// The card this move goes after, as the board has it now: null for first, the
// section's last when that card is gone, nothing when no place was asked. A card
// arriving in another section with no place asked goes last there on GitHub,
// where the project keeps the order a reload gives (a local card takes the next
// order on its own). A card still being made is not on the backend to go after.
function anchorOf(
  cards: readonly KanbanCard[],
  cardId: string,
  sent: KanbanSync,
  isGithub: boolean,
): KanbanCard | null | undefined {
  if (sent.after === null) return null

  const isArrival = isGithub && sent.from !== sent.to && sent.to !== 'done'
  if (sent.after === undefined && !isArrival) return undefined

  const others = sectionList(cards, sent.to).filter(
    one => one.id !== cardId && !isPendingId(one.id),
  )
  const last = others.at(-1) ?? null

  return sent.after === undefined
    ? last
    : (others.find(one => one.id === sent.after) ?? last)
}

// Resolves whether the person asked for another move while this one was out.
async function send($: EngineInterface, cardId: string): Promise<boolean> {
  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)

  const seen: { sent?: KanbanSync } = {}
  await updateSync($, sync => {
    const entry = sync[cardId]
    seen.sent = undefined
    if (entry === undefined || entry.phase !== 'pending') return sync
    if (card === undefined) return without(sync, cardId)

    seen.sent = { ...entry, attempts: entry.attempts + 1 }

    return { ...sync, [cardId]: seen.sent }
  })
  const sent = seen.sent
  if (sent === undefined || card === undefined) return false

  let patch: Partial<KanbanCard>
  try {
    const info = await ensureBackend($)
    patch = await moveRemote(
      $,
      info,
      { ...card, column: sent.from },
      sent.to,
      anchorOf(cards, card.id, sent, info.kind === 'github'),
    )
  } catch (error) {
    return settle($, card, sent, { reason: errorMessage(error) })
  }

  return settle($, card, sent, { patch })
}

type Outcome = { patch: Partial<KanbanCard> } | { reason: string }

// Records how the call came back; resolves whether another is due.
async function settle(
  $: EngineInterface,
  card: KanbanCard,
  sent: KanbanSync,
  outcome: Outcome,
): Promise<boolean> {
  // Before any await: a load that lands in between must already know.
  if ('patch' in outcome) noteConfirmed(card.id)
  const settledAt = await $.clock.now()
  const seen: {
    next: 'ok' | 'more' | 'failed' | 'undone' | 'gone'
    onConfirm?: KanbanSync['onConfirm']
    announce?: boolean
  } = { next: 'gone' }

  await updateSync($, sync => {
    const entry = sync[card.id]
    seen.next = 'gone'
    if (entry === undefined) return sync

    const {
      error: _error,
      queued,
      queuedAfter,
      onConfirm,
      announce,
      ...rest
    } = entry
    // The place of the move that was sent; what the person asked for since replaces it.
    const { after: _sent, ...unplaced } = rest
    const confirm = {
      ...(onConfirm === undefined ? {} : { onConfirm }),
      ...(announce === true ? { announce } : {}),
    }
    const target = queued ?? entry.to
    // The person asked for something else while the call was out.
    const isOverridden = queued !== undefined

    if ('patch' in outcome) {
      if (isOverridden) {
        seen.next = 'more'

        return {
          ...sync,
          [card.id]: {
            ...unplaced,
            ...confirm,
            from: sent.to,
            to: target,
            ...where(queuedAfter),
            phase: 'pending',
            attempts: 0,
          },
        }
      }
      seen.next = 'ok'
      seen.onConfirm = onConfirm
      seen.announce = announce

      return { ...sync, [card.id]: { ...rest, phase: 'ok', settledAt } }
    }

    if (isOverridden) {
      if (target === entry.from && queuedAfter === undefined) {
        return without(sync, card.id)
      }
      seen.next = 'more'

      return {
        ...sync,
        [card.id]: {
          ...unplaced,
          ...confirm,
          to: target,
          ...where(queuedAfter),
          phase: 'pending',
          attempts: 0,
        },
      }
    }
    if (sent.attempts >= MAX_ATTEMPTS) {
      seen.next = 'undone'

      return without(sync, card.id)
    }
    seen.next = 'failed'

    return {
      ...sync,
      [card.id]: { ...rest, phase: 'failed', error: outcome.reason },
    }
  })

  if ('patch' in outcome) {
    const { column: _column, order: _order, ...elsewhere } = outcome.patch
    // The board already shows the column the person chose; only while it
    // still shows the one this call set does the backend's order apply, and
    // not when the person has asked for another place in it since.
    const isCurrent = seen.next !== 'more'
    const settled = (one: KanbanCard): KanbanCard => {
      const merged = {
        ...one,
        ...(one.column === sent.to && isCurrent ? outcome.patch : elsewhere),
      }
      if (sent.to === 'human') return merged

      // Only a card in Human carries a tag; one leaving it must not keep it.
      const { tag: _tag, question: _question, ...untagged } = merged

      return untagged
    }
    await setBoard($, board => ({
      ...board,
      cards: board.cards.map(one => (one.id === card.id ? settled(one) : one)),
    }))
  }

  if (seen.next === 'ok') {
    expireLater($, card.id, settledAt, settledAt)
    if (seen.announce === true) announceHandoff($, card)
    if (seen.onConfirm !== undefined) submitPrompt($, card, seen.onConfirm)
  }

  if (seen.next === 'undone' && 'reason' in outcome) {
    await setBoard($, board => ({
      ...board,
      cards: board.cards.map(one =>
        one.id === card.id
          ? {
              ...one,
              column: sent.from,
              order: maxOrder(board.cards, sent.from) + 1,
            }
          : one,
      ),
    }))
    $.ui.toast(
      sent.from === sent.to
        ? S.reorderUndone(card, outcome.reason)
        : S.movedBack(card, sent.to, sent.from, outcome.reason),
    )
    // A load restores the card's place in the column it is back in.
    $.clock.after(0, () => detach($, refresh($)))
  }

  // A card that left Claude, or never got there, frees a slot for the queue.
  await releaseQueued($)

  return seen.next === 'more'
}

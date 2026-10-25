import type { EngineInterface, Timer } from 'claude-code'

import type { KanbanCard, KanbanColumn, KanbanSync } from '../types'
import { readBoard, readSync, updateSync, updateTick } from './atoms'
import { moveRemote } from './backend'
import { ensureBackend, refresh, setBoard } from './board'
import { MAX_ATTEMPTS, TICK_SHOWN_MS, errorMessage, maxOrder } from './model'
import { S } from './strings'

export type MoveOptions = {
  /** A prompt for Claude to submit once the backend has confirmed the move. */
  onConfirm?: 'work' | 'resume'
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

/**
 * The entry after the person moves the card to `to`, or none when the card is
 * back where the backend has it. `from` is the column the card was in on the
 * board, which is the backend's only for a card with no unsettled entry.
 */
function retarget(
  entry: KanbanSync | undefined,
  cardId: string,
  from: KanbanColumn,
  to: KanbanColumn,
  isInFlight: boolean,
  onConfirm: MoveOptions['onConfirm'],
): KanbanSync | undefined {
  const confirm = onConfirm === undefined ? {} : { onConfirm }
  if (entry === undefined || entry.phase === 'ok')
    return { cardId, from, to, phase: 'pending', attempts: 0, ...confirm }

  const { error: _error, queued: _queued, onConfirm: _prompt, ...rest } = entry
  // A call on its way finishes first; the move is sent after it.
  if (isInFlight)
    return { ...rest, ...(to === entry.to ? {} : { queued: to }), ...confirm }

  return to === entry.from
    ? undefined
    : { ...rest, to, phase: 'pending', attempts: 0, ...confirm }
}

/**
 * Moves a card at once on the board, then, after a pause for further moves,
 * asks the backend to make it so. A refused move waits for a retry and, once
 * out of tries, puts the card back and says why.
 */
export async function moveCard(
  $: EngineInterface,
  cardId: string,
  to: KanbanColumn,
  opts?: MoveOptions,
): Promise<void> {
  // The card is found inside the write: a read here could be an older moment.
  const seen: { from?: KanbanColumn; entry?: KanbanSync } = {}
  await setBoard($, board => {
    const card = board.cards.find(one => one.id === cardId)
    seen.from =
      card === undefined || card.column === to ? undefined : card.column
    if (card === undefined || card.column === to) return board

    const order = maxOrder(board.cards, to) + 1

    return {
      ...board,
      cards: board.cards.map(one =>
        one.id === cardId ? { ...one, column: to, order } : one,
      ),
    }
  })
  const from = seen.from
  if (from === undefined) return

  await updateSync($, sync => {
    seen.entry = retarget(
      sync[cardId],
      cardId,
      from,
      to,
      inFlight.has(cardId),
      opts?.onConfirm,
    )

    return seen.entry === undefined
      ? without(sync, cardId)
      : { ...sync, [cardId]: seen.entry }
  })

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

async function tick($: EngineInterface): Promise<void> {
  const sync = await readSync($)
  const isShowing = Object.values(sync).some(
    entry => entry.phase === 'pending' || entry.phase === 'ok',
  )
  if (isShowing) {
    await updateTick($, count => count + 1)

    return
  }

  ticker?.cancel()
  ticker = undefined
}

function expireLater(
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
    patch = await moveRemote($, info, { ...card, column: sent.from }, sent.to)
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
  const settledAt = await $.clock.now()
  const seen: {
    next: 'ok' | 'more' | 'failed' | 'undone' | 'gone'
    onConfirm?: KanbanSync['onConfirm']
  } = { next: 'gone' }

  await updateSync($, sync => {
    const entry = sync[card.id]
    seen.next = 'gone'
    if (entry === undefined) return sync

    const { error: _error, queued, onConfirm, ...rest } = entry
    const target = queued ?? entry.to
    // The person asked for something else while the call was out.
    const isOverridden = target !== sent.to

    if ('patch' in outcome) {
      if (isOverridden) {
        seen.next = 'more'

        return {
          ...sync,
          [card.id]: {
            ...rest,
            ...(onConfirm === undefined ? {} : { onConfirm }),
            from: sent.to,
            to: target,
            phase: 'pending',
            attempts: 0,
          },
        }
      }
      seen.next = 'ok'
      seen.onConfirm = onConfirm

      return { ...sync, [card.id]: { ...rest, phase: 'ok', settledAt } }
    }

    if (isOverridden) {
      if (target === entry.from) return without(sync, card.id)
      seen.next = 'more'

      return {
        ...sync,
        [card.id]: {
          ...rest,
          ...(onConfirm === undefined ? {} : { onConfirm }),
          to: target,
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
    // still shows the one this call set does the backend's order apply.
    await setBoard($, board => ({
      ...board,
      cards: board.cards.map(one =>
        one.id !== card.id
          ? one
          : { ...one, ...(one.column === sent.to ? outcome.patch : elsewhere) },
      ),
    }))
  }

  if (seen.next === 'ok') {
    expireLater($, card.id, settledAt, settledAt)
    if (seen.onConfirm !== undefined) {
      detach(
        $,
        $.prompt.submit({
          text:
            seen.onConfirm === 'work'
              ? S.workPrompt(card.number, card.title)
              : S.resumePrompt(card.number),
        }),
      )
    }
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
    $.ui.toast(S.movedBack(card, sent.to, sent.from, outcome.reason))
    // A load restores the card's place in the column it is back in.
    $.clock.after(0, () => detach($, refresh($)))
  }

  return seen.next === 'more'
}

import type { EngineInterface, Timer } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanBackendMode,
  KanbanBoard,
  KanbanCard,
  KanbanSync,
} from '../types'
import { readBoard, readSync, updateBoard, updatePausedUntil } from './atoms'
import { backendMode, detectBackend, loadCards } from './backend'
import {
  EMPTY_BOARD,
  PANE,
  errorMessage,
  isKanbanFile,
  isPendingId,
} from './model'
import { placeIn } from './order'
import { releaseQueued } from './queue'
import { pauseLeft } from './rate-limit'
import { S } from './strings'

const POLL_MS = 45_000
const CACHE_SHAPE = 'cache-2'

// What the pane opens with before the first load of a session answers.
type BoardCache = {
  shape: typeof CACHE_SHAPE
  mode: KanbanBackendMode
  backend: KanbanBackendInfo
  cards: KanbanCard[]
}

let loading: Promise<KanbanBoard> | undefined
let isStale = false
let pollTimer: Timer | undefined
// Cards whose move the backend confirmed while a load was reading: it may have read them
// from before the move. Not the sync entries, which are gone two seconds after a confirm,
// sooner than a slow load can land.
let confirmedDuringLoad: Set<string> | undefined

/** Notes that the backend confirmed a card's move, so a load reading now does not undo it. */
export function noteConfirmed(cardId: string): void {
  confirmedDuringLoad?.add(cardId)
}

/** The status line: how many cards sit in Human, or nothing when none do. */
function updateStatusLine($: EngineInterface, cards: readonly KanbanCard[]) {
  const waiting = cards.filter(card => card.column === 'human').length
  $.ui.status(waiting === 0 ? undefined : S.waiting(waiting))
}

/** The one way the board is written, so every write can be followed up. */
export async function setBoard(
  $: EngineInterface,
  change: (board: KanbanBoard) => KanbanBoard,
): Promise<KanbanBoard> {
  const board = await updateBoard($, change)
  updateStatusLine($, board.cards)

  return board
}

/**
 * Makes the board the one for this `backend` setting. A board kept from
 * another setting (the plugin reloads when the setting changes, the board does
 * not) is dropped, so its cards never show under the new one.
 */
export async function applyMode(
  $: EngineInterface,
  mode: KanbanBackendMode,
): Promise<void> {
  const seen = { isReset: false }
  const board = await updateBoard($, current => {
    seen.isReset = current.mode !== mode

    return seen.isReset ? { ...EMPTY_BOARD, mode } : current
  })
  if (seen.isReset) {
    // A pause for GitHub's rate limit belongs to the board that is gone.
    await updatePausedUntil($, () => 0)
    updateStatusLine($, board.cards)
  }
}

// What the person is told about a card that is theirs now: the question Claude asks, or
// that the card waits on them.
const waitingText = (card: KanbanCard) =>
  card.tag === 'question' && card.question !== undefined
    ? S.claudeAsks(card)
    : S.handedToYou(card)

/**
 * Toasts each card that is in Human now and was not before. Only a load calls
 * it: a move the person makes is already on the board, so it never shows as new.
 * Without a board to compare against (the first load ever) nothing is new.
 */
function announceHumanChanges(
  $: EngineInterface,
  before: KanbanBoard | undefined,
  after: KanbanBoard,
) {
  if (before === undefined) return
  if (before.fetchedAt === 0 && before.cards.length === 0) return

  const known = new Set(
    before.cards.filter(card => card.column === 'human').map(card => card.id),
  )
  for (const card of after.cards)
    if (card.column === 'human' && !known.has(card.id))
      $.ui.toast(waitingText(card))
}

/** Tells the person Claude put a card in Human: a toast, and a notification. */
export function announceHandoff($: EngineInterface, card: KanbanCard): void {
  const text = waitingText(card)
  $.ui.toast(text)
  $.ui
    .notify(text)
    .catch((error: unknown) => $.ui.log(S.notifyFailed(errorMessage(error))))
}

/** Runs work no hook waits on; a failure goes to the transcript, not nowhere. */
export function inBackground($: EngineInterface, work: Promise<unknown>): void {
  work.catch((error: unknown) => $.ui.log(S.refreshFailed(errorMessage(error))))
}

/** Lets a Write or Edit finish, then reloads the board if it touched a card file. */
export async function refreshAfter<R extends { deny?: string }>(
  $: EngineInterface,
  path: unknown,
  running: Promise<R>,
): Promise<R> {
  const ran = await running
  if (ran.deny === undefined && isKanbanFile(path)) inBackground($, refresh($))

  return ran
}

/**
 * Remote is authoritative, except for a card whose move is still unsettled or was
 * confirmed while the load was reading (`confirmed`): that load may be older than the move.
 */
export function mergeRemote(
  remote: readonly KanbanCard[],
  local: readonly KanbanCard[],
  sync: Readonly<Record<string, KanbanSync>>,
  confirmed: ReadonlySet<string>,
): KanbanCard[] {
  const isUnsettled = (card: KanbanCard) => {
    const phase = sync[card.id]?.phase

    return phase === 'pending' || phase === 'failed'
  }
  const mine = new Map(local.map(card => [card.id, card]))
  const merged = remote.map(card => {
    const own = mine.get(card.id)

    return own !== undefined && (isUnsettled(card) || confirmed.has(card.id))
      ? {
          ...card,
          column: own.column,
          order: own.order,
          // The question Claude just asked may not be in the comments this load read.
          ...(own.column === 'human' &&
          own.tag === 'question' &&
          own.question !== undefined
            ? { tag: own.tag, question: own.question }
            : {}),
        }
      : card
  })
  const kept = local.filter(
    card => isUnsettled(card) && !remote.some(other => other.id === card.id),
  )

  // A card put after another keeps its place among the remote's cards, whose
  // orders it was not computed against.
  return Object.values(sync).reduce(
    (cards, entry) => {
      const to = entry.queued ?? entry.to
      const after = entry.queued === undefined ? entry.after : entry.queuedAfter
      const isHeld = entry.phase !== 'ok' || confirmed.has(entry.cardId)
      const own = cards.find(card => card.id === entry.cardId)
      if (!isHeld || after === undefined || own?.column !== to) return cards

      const placed = placeIn(cards, entry.cardId, to, after)
      if (placed === undefined) return cards

      return cards.map(card => {
        const order =
          card.id === entry.cardId ? placed.order : placed.shifted[card.id]

        return order === undefined ? card : { ...card, order }
      })
    },
    [...merged, ...kept],
  )
}

const cacheKey = (cwd: string) => `cache:${cwd}`

function isBoardCache(value: unknown): value is BoardCache {
  if (typeof value !== 'object' || value === null) return false
  const { shape, mode, backend, cards } = value as Record<string, unknown>

  return (
    shape === CACHE_SHAPE &&
    backendMode(mode) === mode &&
    typeof backend === 'object' &&
    backend !== null &&
    Array.isArray(cards)
  )
}

async function saveCache($: EngineInterface, board: KanbanBoard) {
  if (board.backend === null) return

  try {
    const entry: BoardCache = {
      shape: CACHE_SHAPE,
      mode: board.mode,
      backend: board.backend,
      // A card still being made would come back as a ghost at the next start.
      cards: board.cards.filter(card => !isPendingId(card.id)),
    }
    await $.store.set(cacheKey(await $.session.cwd()), entry)
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })
  }
}

async function readCache($: EngineInterface): Promise<BoardCache | undefined> {
  const cached = await $.store.get(cacheKey(await $.session.cwd()))

  return isBoardCache(cached) ? cached : undefined
}

/**
 * Shows the cards saved from the last load while the first load of this session
 * runs. They are not "fetched": a tool must not take them for the board, so
 * `fetchedAt` stays 0. Cards saved under another `backend` setting are not shown.
 */
async function showCached($: EngineInterface) {
  try {
    const cached = await readCache($)
    if (cached === undefined) return

    await setBoard($, board =>
      board.fetchedAt === 0 &&
      board.cards.length === 0 &&
      board.mode === cached.mode
        ? {
            ...board,
            // A saved local backend is not kept: the config may name a board by now.
            backend:
              board.backend ??
              (cached.backend.kind === 'github' ? cached.backend : null),
            cards: cached.cards,
            isLoading: true,
          }
        : board,
    )
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })
  }
}

/**
 * Sets the status line from the saved cards while the pane is closed, so it
 * shows what waits on the person without a load. The board is left as it is: no
 * load starts and the cards stay unfetched. A board already loaded, or saved
 * under another `backend` setting, is not the cache's to speak for.
 */
async function showCachedStatus($: EngineInterface) {
  try {
    const cached = await readCache($)
    if (cached === undefined) return

    const seen = { isUnloaded: false }
    await updateBoard($, board => {
      seen.isUnloaded =
        board.fetchedAt === 0 &&
        board.cards.length === 0 &&
        board.mode === cached.mode

      return board
    })
    if (seen.isUnloaded) updateStatusLine($, cached.cards)
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })
  }
}

/** The board's backend, detected and remembered on first use. */
export async function ensureBackend(
  $: EngineInterface,
): Promise<KanbanBackendInfo> {
  const { backend, mode } = await readBoard($)
  if (backend !== null) return backend

  const info = await detectBackend($, mode)
  await setBoard($, board => ({ ...board, backend: info }))

  return info
}

/**
 * The board with its cards loaded. Reads in one dispatch are one moment, so a
 * caller that waited on a load made elsewhere takes the board from here, not
 * from a read of its own.
 */
export async function ensureBoard($: EngineInterface): Promise<KanbanBoard> {
  const board = await readBoard($)

  return board.fetchedAt === 0 ? refresh($) : board
}

async function refreshOnce($: EngineInterface): Promise<KanbanBoard> {
  await setBoard($, board => ({ ...board, isLoading: true }))

  try {
    const info = await ensureBackend($)
    const confirmed = new Set<string>()
    confirmedDuringLoad = confirmed
    const remote = await loadCards($, info)
    const sync = await readSync($)
    const fetchedAt = await $.clock.now()

    const seen: { before?: KanbanBoard } = {}
    const board = await setBoard($, ({ error: _cleared, ...current }) => {
      seen.before = current

      return {
        ...current,
        cards: mergeRemote(remote, current.cards, sync, confirmed),
        fetchedAt,
        isLoading: false,
      }
    })
    announceHumanChanges($, seen.before, board)
    await saveCache($, board)
    // A card may have left Claude behind our back.
    inBackground($, releaseQueued($))

    return board
  } catch (error) {
    const reason = errorMessage(error)
    $.ui.log(S.refreshFailed(reason), { to: 'debug' })

    return setBoard($, board => ({ ...board, isLoading: false, error: reason }))
  } finally {
    confirmedDuringLoad = undefined
  }
}

/**
 * Reloads the cards. A request made mid-load joins it and, because the load may
 * have read before the change that prompted the request, a later timer runs
 * one more (a new dispatch, so it reads the state as it then stands).
 */
export function refresh($: EngineInterface): Promise<KanbanBoard> {
  if (loading !== undefined) {
    isStale = true

    return loading
  }

  loading = refreshOnce($).finally(() => {
    loading = undefined
    if (isStale) {
      isStale = false
      $.clock.after(0, () => inBackground($, refresh($)))
    }
  })

  return loading
}

/** Reloads the board every 45 s; asking again restarts the count. */
export function startPolling($: EngineInterface): void {
  pollTimer?.cancel()
  pollTimer = $.clock.every(POLL_MS, () => inBackground($, pollOnce($)))
}

// A tick reloads while the pane is open and ends the polling once it is not;
// opening the pane again starts it. While the GitHub rate limit pauses polling,
// ticks pass without a load.
async function pollOnce($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) {
    if ((await pauseLeft($)) === 0) await refresh($)

    return
  }

  pollTimer?.cancel()
  pollTimer = undefined
}

/** Called when the pane opens. */
export async function openBoard($: EngineInterface): Promise<void> {
  startPolling($)
  await showCached($)
  await refresh($)
}

/**
 * Called at session start and on a hot reload: refreshes a pane still open;
 * with none, restores the status line from the saved cards.
 */
export async function bootstrap($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) await openBoard($)
  else await showCachedStatus($)
}

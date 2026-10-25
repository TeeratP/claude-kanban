import type { EngineInterface, Timer } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanBoard,
  KanbanCard,
  KanbanSync,
} from '../types'
import { readBoard, readSync, updateBoard } from './atoms'
import { detectBackend, loadCards } from './backend'
import { PANE, errorMessage, isKanbanFile } from './model'
import { S } from './strings'

const POLL_MS = 45_000
const CACHE_SHAPE = 'cache-1'

// What the pane opens with before the first load of a session answers.
type BoardCache = {
  shape: typeof CACHE_SHAPE
  backend: KanbanBackendInfo
  cards: KanbanCard[]
}

let loading: Promise<KanbanBoard> | undefined
let isStale = false
let pollTimer: Timer | undefined

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
      $.ui.toast(S.handedToYou(card))
}

/** Tells the person Claude put a card in Human: a toast, and a notification. */
export function announceHandoff($: EngineInterface, card: KanbanCard): void {
  const text = S.handedToYou(card)
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

/** Remote is authoritative, except for a card whose move is still unsettled. */
export function mergeRemote(
  remote: readonly KanbanCard[],
  local: readonly KanbanCard[],
  sync: Readonly<Record<string, KanbanSync>>,
): KanbanCard[] {
  const isUnsettled = (card: KanbanCard) => {
    const phase = sync[card.id]?.phase

    return phase === 'pending' || phase === 'failed'
  }
  const mine = new Map(local.map(card => [card.id, card]))
  const merged = remote.map(card => {
    const own = mine.get(card.id)

    return own !== undefined && isUnsettled(card)
      ? { ...card, column: own.column, order: own.order }
      : card
  })
  const kept = local.filter(
    card => isUnsettled(card) && !remote.some(other => other.id === card.id),
  )

  return [...merged, ...kept]
}

const cacheKey = (cwd: string) => `cache:${cwd}`

function isBoardCache(value: unknown): value is BoardCache {
  if (typeof value !== 'object' || value === null) return false
  const { shape, backend, cards } = value as Record<string, unknown>

  return (
    shape === CACHE_SHAPE &&
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
      backend: board.backend,
      cards: board.cards,
    }
    await $.store.set(cacheKey(await $.session.cwd()), entry)
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })
  }
}

/**
 * Shows the cards saved from the last load while the first load of this session
 * runs. They are not "fetched": a tool must not take them for the board, so
 * `fetchedAt` stays 0.
 */
async function showCached($: EngineInterface) {
  try {
    const cached = await $.store.get(cacheKey(await $.session.cwd()))
    if (!isBoardCache(cached)) return

    await setBoard($, board =>
      board.fetchedAt === 0 && board.cards.length === 0
        ? {
            ...board,
            backend: board.backend ?? cached.backend,
            cards: cached.cards,
            isLoading: true,
          }
        : board,
    )
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })
  }
}

/** The board's backend, detected and remembered on first use. */
export async function ensureBackend(
  $: EngineInterface,
): Promise<KanbanBackendInfo> {
  const { backend } = await readBoard($)
  if (backend !== null) return backend

  const info = await detectBackend($)
  await setBoard($, board => ({ ...board, backend: info }))

  return info
}

/**
 * The board with its cards loaded. Reads in one dispatch are one moment, so a
 * caller that waited on a load made elsewhere takes the board from here, not
 * from a read of its own.
 */
export async function ensureBoard($: EngineInterface): Promise<KanbanBoard> {
  await ensureBackend($)
  const board = await readBoard($)

  return board.fetchedAt === 0 ? refresh($) : board
}

async function refreshOnce($: EngineInterface): Promise<KanbanBoard> {
  await setBoard($, board => ({ ...board, isLoading: true }))

  try {
    const info = await ensureBackend($)
    const remote = await loadCards($, info)
    const sync = await readSync($)
    const fetchedAt = await $.clock.now()

    const seen: { before?: KanbanBoard } = {}
    const board = await setBoard($, ({ error: _cleared, ...current }) => {
      seen.before = current

      return {
        ...current,
        cards: mergeRemote(remote, current.cards, sync),
        fetchedAt,
        isLoading: false,
      }
    })
    announceHumanChanges($, seen.before, board)
    await saveCache($, board)

    return board
  } catch (error) {
    const reason = errorMessage(error)
    $.ui.log(S.refreshFailed(reason), { to: 'debug' })

    return setBoard($, board => ({ ...board, isLoading: false, error: reason }))
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
// opening the pane again starts it.
async function pollOnce($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) {
    await refresh($)

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

/** Called at session start and on a hot reload: refreshes a pane still open. */
export async function bootstrap($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) await openBoard($)
}

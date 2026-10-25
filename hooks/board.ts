import type { EngineInterface } from 'claude-code'

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

let loading: Promise<KanbanBoard> | undefined
let isStale = false

/** The one way the board is written, so every write can be followed up. */
export function setBoard(
  $: EngineInterface,
  change: (board: KanbanBoard) => KanbanBoard,
): Promise<KanbanBoard> {
  return updateBoard($, change)
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

    return await setBoard($, ({ error: _cleared, ...board }) => ({
      ...board,
      cards: mergeRemote(remote, board.cards, sync),
      fetchedAt,
      isLoading: false,
    }))
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

/** Called when the pane opens. */
export async function openBoard($: EngineInterface): Promise<void> {
  await refresh($)
}

/** Called at session start and on a hot reload: refreshes a pane still open. */
export async function bootstrap($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) await openBoard($)
}

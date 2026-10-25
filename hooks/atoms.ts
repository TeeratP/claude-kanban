import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  KanbanBoard,
  KanbanCheckRun,
  KanbanDetail,
  KanbanSync,
  KanbanUi,
} from '../types'
import { EMPTY_BOARD, INITIAL_UI } from './model'

// The scan that lists what a module reads and writes only accepts an atom
// written in the file that reads it, so the atoms stay here and every other
// file goes through these accessors. Bump a shape tag whenever its value's
// type changes.
const board = atom({ plugin: 'kanban', key: 'board' } as const, EMPTY_BOARD, {
  shape: 'board-2',
})
const ui = atom({ plugin: 'kanban', key: 'ui' } as const, INITIAL_UI, {
  shape: 'ui-1',
})
const sync = atom(
  { plugin: 'kanban', key: 'sync' } as const,
  {},
  {
    shape: 'sync-2',
  },
)
const detail = atom({ plugin: 'kanban', key: 'detail' } as const, null, {
  shape: 'detail-2',
})
const check = atom(
  { plugin: 'kanban', key: 'check' } as const,
  {},
  {
    shape: 'check-1',
  },
)
const tick = atom({ plugin: 'kanban', key: 'tick' } as const, 0)
// When GitHub loads may resume after the rate limit ran low (0: not paused).
const pausedUntil = atom({ plugin: 'kanban', key: 'pausedUntil' } as const, 0)
// The signed-in GitHub login, asked for once ('' until then).
const viewer = atom({ plugin: 'kanban', key: 'viewer' } as const, '')

export function readBoard($: EngineInterface): Promise<KanbanBoard> {
  return read($, board)
}

export function updateBoard(
  $: EngineInterface,
  change: (value: KanbanBoard) => KanbanBoard,
): Promise<KanbanBoard> {
  return update($, board, change)
}

export function readUi($: EngineInterface): Promise<KanbanUi> {
  return read($, ui)
}

export function updateUi(
  $: EngineInterface,
  change: (value: KanbanUi) => KanbanUi,
): Promise<KanbanUi> {
  return update($, ui, change)
}

export function readSync(
  $: EngineInterface,
): Promise<Record<string, KanbanSync>> {
  return read($, sync)
}

export function updateSync(
  $: EngineInterface,
  change: (value: Record<string, KanbanSync>) => Record<string, KanbanSync>,
): Promise<Record<string, KanbanSync>> {
  return update($, sync, change)
}

export function readDetailState(
  $: EngineInterface,
): Promise<KanbanDetail | null> {
  return read($, detail)
}

export function updateDetailState(
  $: EngineInterface,
  change: (value: KanbanDetail | null) => KanbanDetail | null,
): Promise<KanbanDetail | null> {
  return update($, detail, change)
}

export function readTick($: EngineInterface): Promise<number> {
  return read($, tick)
}

export function updateTick(
  $: EngineInterface,
  change: (value: number) => number,
): Promise<number> {
  return update($, tick, change)
}

export function readCheck(
  $: EngineInterface,
): Promise<Record<string, KanbanCheckRun>> {
  return read($, check)
}

export function updateCheck(
  $: EngineInterface,
  change: (
    value: Record<string, KanbanCheckRun>,
  ) => Record<string, KanbanCheckRun>,
): Promise<Record<string, KanbanCheckRun>> {
  return update($, check, change)
}

export function readPausedUntil($: EngineInterface): Promise<number> {
  return read($, pausedUntil)
}

export function updatePausedUntil(
  $: EngineInterface,
  change: (value: number) => number,
): Promise<number> {
  return update($, pausedUntil, change)
}

export function readViewer($: EngineInterface): Promise<string> {
  return read($, viewer)
}

export function updateViewer(
  $: EngineInterface,
  change: (value: string) => string,
): Promise<string> {
  return update($, viewer, change)
}

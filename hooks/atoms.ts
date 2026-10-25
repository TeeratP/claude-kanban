import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { KanbanBoard, KanbanDetail, KanbanSync, KanbanUi } from '../types'
import { EMPTY_BOARD, INITIAL_UI } from './model'

// The scan that lists what a module reads and writes only accepts an atom
// written in the file that reads it, so the atoms stay here and every other
// file goes through these accessors. Bump a shape tag whenever its value's
// type changes.
const board = atom({ plugin: 'kanban', key: 'board' } as const, EMPTY_BOARD, {
  shape: 'board-1',
})
const ui = atom({ plugin: 'kanban', key: 'ui' } as const, INITIAL_UI, {
  shape: 'ui-1',
})
const sync = atom(
  { plugin: 'kanban', key: 'sync' } as const,
  {},
  {
    shape: 'sync-1',
  },
)
const detail = atom({ plugin: 'kanban', key: 'detail' } as const, null, {
  shape: 'detail-1',
})

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

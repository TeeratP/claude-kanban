import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  KanbanActivity,
  KanbanBoard,
  KanbanCheckRun,
  KanbanDetail,
  KanbanQueue,
  KanbanQuickAdd,
  KanbanSuggestion,
  KanbanSync,
  KanbanUi,
} from '../types'
import {
  EMPTY_ACTIVITY,
  EMPTY_BOARD,
  EMPTY_QUEUE,
  EMPTY_QUICK_ADD,
  INITIAL_UI,
} from './model'

// The scan that lists what a module reads and writes only accepts an atom
// written in the file that reads it, so the atoms stay here and every other
// file goes through these accessors. Bump a shape tag whenever its value's
// type changes.
const board = atom({ plugin: 'kanban', key: 'board' } as const, EMPTY_BOARD, {
  shape: 'board-3',
})
const ui = atom({ plugin: 'kanban', key: 'ui' } as const, INITIAL_UI, {
  shape: 'ui-4',
})
const sync = atom(
  { plugin: 'kanban', key: 'sync' } as const,
  {},
  {
    shape: 'sync-3',
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
const queue = atom({ plugin: 'kanban', key: 'queue' } as const, EMPTY_QUEUE, {
  shape: 'queue-1',
})
// When GitHub loads may resume after the rate limit ran low (0: not paused).
const pausedUntil = atom({ plugin: 'kanban', key: 'pausedUntil' } as const, 0)
// The signed-in GitHub login, asked for once ('' until then).
const viewer = atom({ plugin: 'kanban', key: 'viewer' } as const, '')
const activity = atom(
  { plugin: 'kanban', key: 'activity' } as const,
  EMPTY_ACTIVITY,
  { shape: 'activity-1' },
)
// The add-a-card form: open or not, and what has been typed in it.
const quickAdd = atom(
  { plugin: 'kanban', key: 'quickAdd' } as const,
  EMPTY_QUICK_ADD,
  { shape: 'quickAdd-1' },
)
// Claude's follow-ups waiting for the person to add or dismiss them.
const suggestions = atom(
  { plugin: 'kanban', key: 'suggestions' } as const,
  [],
  {
    shape: 'suggestions-1',
  },
)

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

export function readQueue($: EngineInterface): Promise<KanbanQueue> {
  return read($, queue)
}

export function updateQueue(
  $: EngineInterface,
  change: (value: KanbanQueue) => KanbanQueue,
): Promise<KanbanQueue> {
  return update($, queue, change)
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

export function readActivity($: EngineInterface): Promise<KanbanActivity> {
  return read($, activity)
}

export function updateActivity(
  $: EngineInterface,
  change: (value: KanbanActivity) => KanbanActivity,
): Promise<KanbanActivity> {
  return update($, activity, change)
}

export function readQuickAdd($: EngineInterface): Promise<KanbanQuickAdd> {
  return read($, quickAdd)
}

export function updateQuickAdd(
  $: EngineInterface,
  change: (value: KanbanQuickAdd) => KanbanQuickAdd,
): Promise<KanbanQuickAdd> {
  return update($, quickAdd, change)
}

export function readSuggestions(
  $: EngineInterface,
): Promise<KanbanSuggestion[]> {
  return read($, suggestions)
}

export function updateSuggestions(
  $: EngineInterface,
  change: (value: KanbanSuggestion[]) => KanbanSuggestion[],
): Promise<KanbanSuggestion[]> {
  return update($, suggestions, change)
}

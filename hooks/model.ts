import type { KanbanBoard, KanbanCard, KanbanColumn, KanbanUi } from '../types'

export const PANE = 'kanban'
export const KANBAN_DIR = '.kanban'
export const DONE_LIMIT = 10

// Top to bottom on the board.
export const COLUMNS: readonly KanbanColumn[] = [
  'human',
  'claude',
  'backlog',
  'done',
]

export const EMPTY_BOARD: KanbanBoard = {
  backend: null,
  cards: [],
  fetchedAt: 0,
  isLoading: false,
}

export const INITIAL_UI: KanbanUi = {
  view: { mode: 'board' },
  offsets: { human: 0, claude: 0, backlog: 0, done: 0 },
  collapsed: { human: false, claude: false, backlog: false, done: true },
  draft: '',
}

export function isColumn(value: unknown): value is KanbanColumn {
  return COLUMNS.some(column => column === value)
}

const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

function charWidth(cp: number): 0 | 1 | 2 {
  const isMark =
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x0e31 ||
    (cp >= 0x0e34 && cp <= 0x0e3a) ||
    (cp >= 0x0e47 && cp <= 0x0e4e)
  if (isMark) return 0

  return WIDE.some(([from, to]) => cp >= from && cp <= to) ? 2 : 1
}

/** Terminal cells a string takes: CJK and emoji two, combining marks none. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char.codePointAt(0) ?? 0)

  return width
}

/** Cuts a string to at most `width` cells, ending in an ellipsis when cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(text) <= width) return text

  let out = ''
  let used = 0
  for (const char of text) {
    const next = charWidth(char.codePointAt(0) ?? 0)
    if (used + next > width - 1) break
    out += char
    used += next
  }

  return out + '…'
}

/** Pads a string with spaces to exactly `width` cells. */
export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cellWidth(text)))
}

/** A short relative age: `now`, `5m`, `3h`, `2d`; empty for a bad date. */
export function ageLabel(since: string | number, now: number): string {
  const then = typeof since === 'number' ? since : Date.parse(since)
  if (Number.isNaN(then)) return ''

  const minutes = Math.floor(Math.max(0, now - then) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`

  return `${Math.floor(minutes / (60 * 24))}d`
}

export function maxOrder(cards: readonly KanbanCard[], column: KanbanColumn) {
  return cards
    .filter(card => card.column === column)
    .reduce((max, card) => Math.max(max, card.order), 0)
}

const KANBAN_FILE = /(^|\/)\.kanban\/[^/]+\.md$/

/** Whether a path names a card file under a `.kanban/` folder. */
export function isKanbanFile(path: unknown): boolean {
  return typeof path === 'string' && KANBAN_FILE.test(path)
}

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text.split('\n')[0]?.trim() || 'unknown error'
}

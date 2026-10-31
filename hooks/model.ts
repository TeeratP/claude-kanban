import type {
  KanbanActivity,
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  KanbanGroup,
  KanbanQueue,
  KanbanQuickAdd,
  KanbanSettings,
  KanbanReconcile,
  KanbanUi,
} from '../types'

export const PANE = 'kanban'
export const KANBAN_DIR = '.kanban'
// Done and Cancelled list their newest cards only.
export const NEWEST_LIMIT = 10
export const DIFF_LIMIT = 90_000

// A move is tried once and retried by hand up to three times before it is undone.
export const MAX_ATTEMPTS = 4
// A confirmed move shows a bright tick for this long, a dim one for as long again.
export const TICK_BRIGHT_MS = 1000
export const TICK_SHOWN_MS = 2000
// A card the review has just moved on to ignores decisions for this long, so a
// key pressed twice, or held, decides one card and not two.
export const SETTLE_MS = 600

// The sections of each group, top to bottom.
export const GROUPS: Record<KanbanGroup, readonly KanbanColumn[]> = {
  active: ['backlog', 'claude', 'human'],
  inactive: ['done', 'cancelled', 'suspended'],
}
export const GROUP_ORDER: readonly KanbanGroup[] = ['active', 'inactive']
export const SECTIONS_PER_GROUP = 3
// Rows under a section's header, at the least: a card and a `more` row.
export const MIN_SECTION_BODY = 2

// Top to bottom on the board; also the 1-6 keys that move a card.
export const COLUMNS: readonly KanbanColumn[] = [
  ...GROUPS.active,
  ...GROUPS.inactive,
]

/** The group a section belongs to. */
export const groupOf = (column: KanbanColumn): KanbanGroup =>
  GROUPS.active.includes(column) ? 'active' : 'inactive'

/** Whether a section keeps its cards in the order they were put in; Done and Cancelled list by update time. */
export const isOrdered = (column: KanbanColumn) =>
  column !== 'done' && column !== 'cancelled'

// The key after `m` that sends a card to a section, besides its digit.
export const MOVE_KEY: Record<KanbanColumn, string> = {
  human: 'h',
  claude: 'c',
  backlog: 'b',
  done: 'd',
  suspended: 's',
  cancelled: 'x',
}

export const EMPTY_BOARD: KanbanBoard = {
  mode: 'auto',
  backend: null,
  cards: [],
  fetchedAt: 0,
  isLoading: false,
}

export const EMPTY_ACTIVITY: KanbanActivity = {
  cards: {},
  live: { cardId: '', since: 0, isRunning: false },
  agents: {},
}

// How many cards Claude works on at once unless the setting says otherwise.
export const DEFAULT_CLAUDE_LIMIT = 1

export const EMPTY_QUEUE: KanbanQueue = {
  limit: DEFAULT_CLAUDE_LIMIT,
  held: {},
}

export const INITIAL_UI: KanbanUi = {
  view: { mode: 'board' },
  offsets: {
    backlog: 0,
    human: 0,
    claude: 0,
    done: 0,
    cancelled: 0,
    suspended: 0,
  },
  openGroup: 'active',
  draft: '',
  filter: '',
  isFilterOpen: false,
}

export const EMPTY_QUICK_ADD: KanbanQuickAdd = {
  isOpen: false,
  hasDetails: false,
  title: '',
  spec: '',
}

export const EMPTY_SETTINGS: KanbanSettings = {
  isLoaded: false,
  rows: [],
  denied: {},
}

export const EMPTY_TURN: KanbanReconcile['turn'] = {
  isReconcile: false,
  hasEdits: false,
  cards: {},
}

export const EMPTY_RECONCILE: KanbanReconcile = {
  turn: EMPTY_TURN,
  sent: {},
  waiting: [],
  isNudged: false,
}

// A card shown before its backend has made it carries this prefix in its id.
export const PENDING_PREFIX = 'new:'

/** Whether a card id is one shown before its backend has made the card. */
export const isPendingId = (cardId: string) => cardId.startsWith(PENDING_PREFIX)

export function isColumn(value: unknown): value is KanbanColumn {
  return COLUMNS.some(column => column === value)
}

/** The section a name stands for, in any case; `canceled` reads as `cancelled`. Undefined for none. */
export function parseColumn(value: unknown): KanbanColumn | undefined {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''

  return COLUMNS.find(
    column => column === (name === 'canceled' ? 'cancelled' : name),
  )
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

/** Pads a string with spaces on the left to exactly `width` cells. */
export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - cellWidth(text))) + text
}

/** Copy written in full and again for a narrow pane. */
export type Copy = { long: string; short: string }

/** `copy` whole when it fits `room` cells, else its short form, cut if that is too wide as well. */
export function fit(copy: Copy, room: number): string {
  if (cellWidth(copy.long) <= room) return copy.long

  return truncate(copy.short, room)
}

/** A short relative age of at most 3 cells: `now`, `5m`, `3h`, `13d`, `8w`, `2y`; empty for a bad date. */
export function ageLabel(since: string | number, now: number): string {
  const then = typeof since === 'number' ? since : Date.parse(since)
  if (Number.isNaN(then)) return ''

  const minutes = Math.floor(Math.max(0, now - then) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`

  const days = Math.floor(minutes / (60 * 24))
  if (days < 14) return `${days}d`
  if (days < 365) return `${Math.floor(days / 7)}w`

  // Past 99 years the label would outgrow its 3 cells.
  return `${Math.min(99, Math.floor(days / 365))}y`
}

/**
 * Cuts a diff to at most `limit` characters, at the last file boundary so every
 * kept file is whole (a diff cut mid-hunk does not parse); `omitted` counts
 * the characters left out.
 */
export function capDiff(
  diff: string,
  limit = DIFF_LIMIT,
): { text: string; omitted: number } {
  if (diff.length <= limit) return { text: diff, omitted: 0 }

  const boundary = diff.lastIndexOf('\ndiff --git', limit)
  const end = boundary > 0 ? boundary : diff.lastIndexOf('\n', limit)
  const text = diff.slice(0, Math.max(end, 0))

  return { text, omitted: diff.length - text.length }
}

export function maxOrder(cards: readonly KanbanCard[], column: KanbanColumn) {
  return cards
    .filter(card => card.column === column)
    .reduce((max, card) => Math.max(max, card.order), 0)
}

/**
 * The cards with `card` at the end of its column; a card with its id, or with
 * the id `replaces`, gives way to it.
 */
export function withCard(
  cards: readonly KanbanCard[],
  card: KanbanCard,
  replaces?: string,
): KanbanCard[] {
  const rest = cards.filter(one => one.id !== card.id && one.id !== replaces)

  return [
    ...rest,
    { ...card, order: Math.max(card.order, maxOrder(rest, card.column) + 1) },
  ]
}

const KANBAN_FILE = /(^|\/)\.kanban\/[^/]+\.md$/

/** Whether a path names a card file under a `.kanban/` folder. */
export function isKanbanFile(path: unknown): boolean {
  return typeof path === 'string' && KANBAN_FILE.test(path)
}

/** Text on one line, trimmed: a card title never wraps. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text.split('\n')[0]?.trim() || 'unknown error'
}

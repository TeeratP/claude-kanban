import type { KanbanCard, KanbanColumn, KanbanGroup, KanbanUi } from '../types'
import { filterCards, isFiltering } from './filter'
import {
  GROUPS,
  GROUP_ORDER,
  MIN_SECTION_BODY,
  NEWEST_LIMIT,
  SECTIONS_PER_GROUP,
  cellWidth,
  groupOf,
  isOrdered,
  isPendingId,
  padStart,
  truncate,
} from './model'
import { S } from './strings'

/** How many of a section's cards the filter lets through, out of all of them. */
export type SectionCount = {
  column: KanbanColumn
  shown: number
  total: number
}

// Every Row is exactly one terminal row, so a Row's index is its tree row.
export type Row =
  // The status text, then the buttons.
  | { kind: 'toolbar'; line: 'status' | 'actions' }
  // A group's header, with the counts of its three sections.
  | {
      kind: 'group'
      group: KanbanGroup
      isOpen: boolean
      counts: SectionCount[]
      isLoading?: true
    }
  // `isLoading` while the first load runs: no counts yet.
  | {
      kind: 'header'
      column: KanbanColumn
      shown: number
      total: number
      isLoading?: true
    }
  | { kind: 'more'; column: KanbanColumn; dir: 'up' | 'down'; n: number }
  | { kind: 'card'; column: KanbanColumn; card: KanbanCard }
  // The dim second row under a Claude card Claude has worked on.
  | { kind: 'detail'; column: KanbanColumn; card: KanbanCard }
  | { kind: 'empty'; column: KanbanColumn }
  // A bar standing in for a card while the first load runs, `percent` of the title room.
  | { kind: 'skeleton'; column: KanbanColumn; index: number; percent: number }
  // Filler that keeps a section's height; `index` counts from the section's first.
  // A section's spare room is marked with a quiet slot dot unless `isPlain`.
  | { kind: 'blank'; column?: KanbanColumn; index: number; isPlain?: true }
  // The key hint in the first row left over at the bottom.
  | { kind: 'legend' }
  // What the list says while both groups are folded.
  | { kind: 'folded' }
  | { kind: 'note' }
  // A line under the note on how to use GitHub.
  | { kind: 'hint'; line: number }

/** Rows the toolbar takes: the status, then the actions. */
export const TOOLBAR_ROWS = 2

export type LayoutInput = {
  cards: readonly KanbanCard[]
  ui: KanbanUi
  bodyRows: number
  /** The ids of the cards that get a second row. */
  details?: ReadonlySet<string>
  /** Whether an empty board also says how to use GitHub. */
  hint?: boolean
  /** Rows the picker, filter field, add form and suggestions take above the list. */
  extraRows?: number
  /** Whether a row left over at the bottom carries the key hint. */
  legend?: boolean
  /** Whether the first load is running with nothing to show yet: bars stand in for cards. */
  isLoading?: boolean
}

/** The cards a section lists, in order: Done and Cancelled are their newest ten. */
export function sectionList(
  cards: readonly KanbanCard[],
  column: KanbanColumn,
): KanbanCard[] {
  const inColumn = cards.filter(card => card.column === column)
  if (!isOrdered(column)) {
    return inColumn
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, NEWEST_LIMIT)
  }

  return inColumn.sort((a, b) => a.order - b.order || a.number - b.number)
}

/** Where a card stands in the Human queue, which is the section's order; none if it is not in it. */
export function queueAt(
  cards: readonly KanbanCard[],
  cardId: string,
): { index: number; total: number } | undefined {
  const list = sectionList(cards, 'human')
  const index = list.findIndex(card => card.id === cardId)

  return index < 0 ? undefined : { index, total: list.length }
}

/** The Human card `step` places from a card, wrapping at the ends; none when it has no other. */
export function queueStep(
  cards: readonly KanbanCard[],
  cardId: string,
  step: 1 | -1,
): string | undefined {
  const list = sectionList(cards, 'human')
  const index = list.findIndex(card => card.id === cardId)
  if (index < 0 || list.length < 2) return undefined

  return list[(index + step + list.length) % list.length]?.id
}

/** The Human card after `card` in the queue, wrapping to the first; `card` may have left Human already. */
export function queueAfter(
  cards: readonly KanbanCard[],
  card: KanbanCard,
): string | undefined {
  const rest = sectionList(cards, 'human').filter(one => one.id !== card.id)
  const after = rest.find(
    one =>
      one.order > card.order ||
      (one.order === card.order && one.number > card.number),
  )

  return (after ?? rest[0])?.id
}

/**
 * What the board shows of `cards`: those the filter lets through, and `ui` with
 * the group that is drawn open. While filtering that is the one a header press
 * chose (`filterGroup`), else the open group if it has a match, else the first
 * group that has one. The stored `openGroup` stays as it is, so clearing the
 * filter gives the groups back as they were.
 */
export function applyFilter(
  cards: readonly KanbanCard[],
  ui: KanbanUi,
): { cards: readonly KanbanCard[]; ui: KanbanUi } {
  if (!isFiltering(ui.filter)) return { cards, ui }

  const matched = filterCards(cards, ui.filter)
  const hasMatch = (group: KanbanGroup) =>
    matched.some(card => groupOf(card.column) === group)
  const openGroup =
    ui.filterGroup ??
    (ui.openGroup !== 'none' && hasMatch(ui.openGroup)
      ? ui.openGroup
      : (GROUP_ORDER.find(hasMatch) ?? ui.openGroup))

  return { cards: matched, ui: { ...ui, openGroup } }
}

/** Rows an empty board adds under the groups: the note, and with `hint` the GitHub lines; none while loading. */
export function footRows(
  cards: readonly KanbanCard[],
  hint = false,
  isLoading = false,
): number {
  if (cards.length > 0 || isLoading) return 0

  return 1 + (hint ? S.githubHint.length : 0)
}

/**
 * Rows under each section's header, the same for all three sections of the
 * open group, and the rows left over (at most two) that go below everything.
 * A pane too short for the least leaves the tree taller than the pane.
 */
export function sectionBody(input: {
  bodyRows: number
  extraRows?: number
  footRows?: number
}): { body: number; slack: number } {
  const avail =
    input.bodyRows -
    TOOLBAR_ROWS -
    (input.extraRows ?? 0) -
    GROUP_ORDER.length -
    SECTIONS_PER_GROUP -
    (input.footRows ?? 0)
  const body = Math.max(
    MIN_SECTION_BODY,
    Math.floor(avail / SECTIONS_PER_GROUP),
  )

  return { body, slack: Math.max(0, avail - SECTIONS_PER_GROUP * body) }
}

const sumFrom = (sizes: readonly number[], from: number) =>
  sizes.slice(from).reduce((total, size) => total + size, 0)

/** The rows each card of a list takes: 1, or 2 with a second row (Claude only). */
export function blocksOf(
  list: readonly KanbanCard[],
  column: KanbanColumn,
  details?: ReadonlySet<string>,
): number[] {
  return list.map(card =>
    column === 'claude' && details?.has(card.id) === true ? 2 : 1,
  )
}

/**
 * The furthest a window of `body` rows can scroll: the first card from which
 * the rest fit, under a `more` row when it is not the first.
 */
export function maxOffset(sizes: readonly number[], body: number): number {
  for (let offset = 0; offset < sizes.length; offset += 1) {
    if (sumFrom(sizes, offset) <= body - (offset > 0 ? 1 : 0)) return offset
  }

  return Math.max(0, sizes.length - 1)
}

/** A section's body: where its window starts, how many cards it shows and its `body` rows. */
export type SectionWindow = { offset: number; taken: number; rows: Row[] }

/**
 * The rows under a section's header, exactly `body` of them. A window of the
 * list from card `offset` (cut to what can be scrolled to) is filled with
 * cards, `more` rows where cards lie beyond it, and blank filler. A card whose
 * second row does not fit gives it up, never itself.
 */
export function sectionWindow(
  list: readonly KanbanCard[],
  column: KanbanColumn,
  offset: number,
  body: number,
  details?: ReadonlySet<string>,
): SectionWindow {
  // An empty section says so and leaves the rest plain; one with cards marks its spare room.
  const filler = (rows: Row[], isPlain = false): Row[] => {
    const filled = [...rows]
    while (filled.length < body) {
      filled.push({
        kind: 'blank',
        column,
        index: filled.length,
        ...(isPlain ? { isPlain: true as const } : {}),
      })
    }

    return filled
  }
  if (list.length === 0) {
    return {
      offset: 0,
      taken: 0,
      rows: filler([{ kind: 'empty', column }], true),
    }
  }

  const sizes = blocksOf(list, column, details)
  const start = Math.min(Math.max(0, offset), maxOffset(sizes, body))
  const hasAbove = start > 0
  let taken: number
  let hasUp = hasAbove
  let isTrimmed = false

  if (sumFrom(sizes, start) <= body - (hasAbove ? 1 : 0)) {
    taken = list.length - start
  } else {
    // A `more` row below, and above too if the window has the room for both.
    hasUp = hasAbove && body > MIN_SECTION_BODY
    const room = body - (hasUp ? 1 : 0) - 1
    let used = 0
    taken = 0
    while (start + taken < list.length) {
      const size = sizes[start + taken] ?? 1
      if (used + size > room) break
      used += size
      taken += 1
    }
    if (taken === 0) {
      taken = 1
      isTrimmed = true
    }
  }

  const rows: Row[] = hasUp
    ? [{ kind: 'more', column, dir: 'up', n: start }]
    : []
  list.slice(start, start + taken).forEach((card, index) => {
    rows.push({ kind: 'card', column, card })
    if (sizes[start + index] === 2 && !(isTrimmed && index === 0)) {
      rows.push({ kind: 'detail', column, card })
    }
  })
  const below = list.length - start - taken
  if (below > 0) rows.push({ kind: 'more', column, dir: 'down', n: below })

  return { offset: start, taken, rows: filler(rows) }
}

// How much of the title room each bar of the first load fills, in turn.
const SKELETON_PERCENT = [60, 40, 75] as const
// At most this many bars to a section.
const SKELETON_BARS = 3

// A section's body while the first load runs: bars, then filler. Each section
// starts a step further along `SKELETON_PERCENT`, so the bars do not line up.
function skeletonRows(column: KanbanColumn, body: number, step: number): Row[] {
  return Array.from({ length: body }, (_, index): Row => {
    const percent = SKELETON_PERCENT[(step + index) % SKELETON_PERCENT.length]

    return index < SKELETON_BARS && percent !== undefined
      ? { kind: 'skeleton', column, index, percent }
      : { kind: 'blank', column, index, isPlain: true }
  })
}

export function layoutBoard({
  cards,
  ui: stored,
  bodyRows,
  details,
  hint,
  extraRows,
  legend,
  isLoading,
}: LayoutInput): Row[] {
  const loading = isLoading === true
  const { cards: matched, ui } = applyFilter(cards, stored)
  const { body, slack } = sectionBody({
    bodyRows,
    extraRows: extraRows ?? 0,
    footRows: footRows(cards, hint, loading),
  })
  const rows: Row[] = [
    { kind: 'toolbar', line: 'status' },
    { kind: 'toolbar', line: 'actions' },
  ]

  for (const group of GROUP_ORDER) {
    const counts = GROUPS[group].map(column => ({
      column,
      shown: matched.filter(card => card.column === column).length,
      total: cards.filter(card => card.column === column).length,
    }))
    const isOpen = ui.openGroup === group
    rows.push({
      kind: 'group',
      group,
      isOpen,
      counts,
      ...(loading ? { isLoading: true as const } : {}),
    })
    if (!isOpen) continue

    counts.forEach(({ column, shown, total }, step) => {
      const header: Row = {
        kind: 'header',
        column,
        shown,
        total,
        ...(loading ? { isLoading: true as const } : {}),
      }
      rows.push(
        header,
        ...(loading
          ? skeletonRows(column, body, step)
          : sectionWindow(
              sectionList(matched, column),
              column,
              ui.offsets[column],
              body,
              details,
            ).rows),
      )
    })
  }

  if (ui.openGroup === 'none') {
    rows.push({ kind: 'folded' })
  } else {
    for (let index = 0; index < slack; index += 1) {
      rows.push(
        index === 0 && legend === true && !loading && cards.length > 0
          ? { kind: 'legend' }
          : { kind: 'blank', index },
      )
    }
  }

  if (cards.length === 0 && !loading) {
    rows.push({ kind: 'note' })
    if (hint === true) {
      S.githubHint.forEach((_, line) => rows.push({ kind: 'hint', line }))
    }
  }

  return rows
}

/** The column a tree row belongs to; undefined for the toolbar, a group header, the legend or past the end. */
export function hitTest(
  rows: readonly Row[],
  treeRow: number,
): KanbanColumn | undefined {
  const row = rows[treeRow]

  return row !== undefined && 'column' in row ? row.column : undefined
}

// Cells before a card's number; its title starts after the number column and a space.
const CARD_INDENT = 2
// The number column of a board with no card to size it by: `#111`.
const DEFAULT_NUMBER_WIDTH = 4
// The age takes this many cells, flush right, and the title leaves this many before it.
const AGE_CELLS = 3
const META_GAP = 2
/** The cells a card row keeps at its right for the gap and the age, and so the title room's end. */
export const META_CELLS = META_GAP + AGE_CELLS
// A title that would get fewer cells than this makes the age give way.
const MIN_TITLE = 8

/** What a card's number column says: `#12`, `?12` on a question, `new` on a card not yet made. */
export function numberLabel(card: KanbanCard, hasHash = true): string {
  if (isPendingId(card.id)) return S.newCard

  return `${card.tag === 'question' ? '?' : hasHash ? '#' : ''}${card.number}`
}

/** The width of the number column, and whether its labels keep the `#`. */
export type NumberColumn = { width: number; hasHash: boolean }

/**
 * The number column of the whole board, as wide as its widest label, so titles
 * start at one cell in every section and while scrolling. The `#` goes when
 * the numbers would take more than a quarter of the row.
 */
export function numberColumn(
  cards: readonly KanbanCard[],
  columns: number,
): NumberColumn {
  const widest = (hasHash: boolean) =>
    cards.reduce(
      (most, card) => Math.max(most, cellWidth(numberLabel(card, hasHash))),
      0,
    )
  const withHash = widest(true)
  if (withHash === 0) return { width: DEFAULT_NUMBER_WIDTH, hasHash: true }

  return withHash * 4 <= columns
    ? { width: withHash, hasHash: true }
    : { width: widest(false), hasHash: false }
}

/** The cell a card's title starts at: the indent, the number column and a space. */
export const titleColumn = (cards: readonly KanbanCard[], columns: number) =>
  CARD_INDENT + numberColumn(cards, columns).width + 1

/** A card row's pieces; the cells of all of them sum to the pane's width, or to less with no meta. */
export type CardLine = {
  /** The indent, the number right-aligned in its column, and a space. */
  indent: string
  number: string
  title: string
  /** Spaces from the title to the meta, so the meta ends at the right edge. */
  gap: string
  mark: string
  /** The one space between the mark and the age, when both show. */
  between: string
  age: string
}

/**
 * A card row for a pane `columns` wide: the number, the title, and the meta
 * flush right (the sync `mark`, then the `age` in 3 cells). The title gives up
 * room for the mark only while it shows, and the age goes when the title would
 * get under 8 cells.
 */
export function cardLine(
  card: KanbanCard,
  columns: number,
  column: NumberColumn,
  meta: { mark: string; age: string },
): CardLine {
  const number = numberLabel(card, column.hasHash)
  const indent = ' '.repeat(
    CARD_INDENT + Math.max(0, column.width - cellWidth(number)),
  )
  const left = cellWidth(indent) + cellWidth(number) + 1

  const metaOf = (age: string) => {
    const aged = age === '' ? '' : padStart(age, AGE_CELLS)
    const between = meta.mark !== '' && aged !== '' ? ' ' : ''

    return {
      age: aged,
      between,
      width: cellWidth(meta.mark) + between.length + cellWidth(aged),
    }
  }
  const roomFor = (shown: { width: number }) =>
    columns - left - (shown.width === 0 ? 0 : META_GAP + shown.width)

  let shown = metaOf(meta.age)
  if (meta.age !== '' && roomFor(shown) < MIN_TITLE) shown = metaOf('')

  const title = truncate(card.title, Math.max(0, roomFor(shown)))
  const gap =
    shown.width === 0
      ? ''
      : ' '.repeat(Math.max(0, columns - left - cellWidth(title) - shown.width))

  return {
    indent,
    number,
    title,
    gap,
    mark: meta.mark,
    between: shown.between,
    age: shown.age,
  }
}

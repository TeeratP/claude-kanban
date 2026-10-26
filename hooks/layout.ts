import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import { filterCards, isFiltering } from './filter'
import { COLUMNS, DONE_LIMIT, cellWidth, padEnd, truncate } from './model'
import { S } from './strings'

// Every Row is exactly one terminal row, so a Row's index is its tree row.
export type Row =
  // The status text, then the buttons.
  | { kind: 'toolbar'; line: 'status' | 'actions' }
  | { kind: 'header'; column: KanbanColumn; shown: number; total: number }
  | { kind: 'more'; column: KanbanColumn; dir: 'up' | 'down'; n: number }
  | { kind: 'card'; column: KanbanColumn; card: KanbanCard }
  // The dim second row under a Claude card Claude has worked on.
  | { kind: 'detail'; column: KanbanColumn; card: KanbanCard }
  | { kind: 'empty'; column: KanbanColumn }
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
}

/** The cards a section lists, in order: Done is its newest ten. */
export function sectionList(
  cards: readonly KanbanCard[],
  column: KanbanColumn,
): KanbanCard[] {
  const inColumn = cards.filter(card => card.column === column)
  if (column === 'done') {
    return inColumn
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, DONE_LIMIT)
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
 * every collapsed section that has a match open, except where a header press
 * since the filter was set says otherwise. The stored flags stay as they are,
 * so clearing the filter gives the sections back as they were.
 */
export function applyFilter(
  cards: readonly KanbanCard[],
  ui: KanbanUi,
): { cards: readonly KanbanCard[]; ui: KanbanUi } {
  if (!isFiltering(ui.filter)) return { cards, ui }

  const matched = filterCards(cards, ui.filter)
  const shown = (column: KanbanColumn) =>
    ui.filterCollapsed[column] ??
    (ui.collapsed[column] && !matched.some(card => card.column === column))

  return {
    cards: matched,
    ui: {
      ...ui,
      collapsed: {
        human: shown('human'),
        claude: shown('claude'),
        backlog: shown('backlog'),
        done: shown('done'),
      },
    },
  }
}

export function openCount(ui: KanbanUi): number {
  return COLUMNS.filter(column => !ui.collapsed[column]).length
}

/**
 * Rows to keep back for second rows: those the Claude section can show, at most
 * a section's cap of 5, none while it is collapsed.
 */
export function detailReserve(
  cards: readonly KanbanCard[],
  ui: KanbanUi,
  details: ReadonlySet<string> | undefined,
): number {
  if (details === undefined || ui.collapsed.claude) return 0

  return Math.min(
    5,
    cards.filter(card => card.column === 'claude' && details.has(card.id))
      .length,
  )
}

/**
 * Cards a section shows at once, so the whole tree fits `bodyRows`, with
 * `reserve` rows kept back for the second rows of Claude cards.
 */
export function capFor(
  bodyRows: number,
  openSections: number,
  reserve = 0,
): number {
  const sections = Math.max(1, openSections)
  const cap =
    Math.floor(
      (bodyRows - TOOLBAR_ROWS - COLUMNS.length - reserve) / sections,
    ) - 2

  return Math.min(5, Math.max(1, cap))
}

export function clampOffset(offset: number, len: number, cap: number): number {
  return Math.min(Math.max(0, len - cap), Math.max(0, offset))
}

export function layoutBoard({
  cards,
  ui: stored,
  bodyRows,
  details,
  hint,
}: LayoutInput): Row[] {
  const { cards: matched, ui } = applyFilter(cards, stored)
  const cap = capFor(
    bodyRows,
    openCount(ui),
    detailReserve(matched, ui, details),
  )
  const rows: Row[] = [
    { kind: 'toolbar', line: 'status' },
    { kind: 'toolbar', line: 'actions' },
  ]

  for (const column of COLUMNS) {
    const list = sectionList(matched, column)
    const total = cards.filter(card => card.column === column).length
    rows.push({ kind: 'header', column, shown: list.length, total })
    if (ui.collapsed[column]) continue

    if (list.length === 0) {
      rows.push({ kind: 'empty', column })
      continue
    }

    const offset = clampOffset(ui.offsets[column], list.length, cap)
    if (offset > 0) rows.push({ kind: 'more', column, dir: 'up', n: offset })
    for (const card of list.slice(offset, offset + cap)) {
      rows.push({ kind: 'card', column, card })
      if (details?.has(card.id) === true && column === 'claude') {
        rows.push({ kind: 'detail', column, card })
      }
    }
    const below = list.length - (offset + cap)
    if (below > 0) rows.push({ kind: 'more', column, dir: 'down', n: below })
  }

  if (cards.length === 0) {
    rows.push({ kind: 'note' })
    if (hint === true) {
      S.githubHint.forEach((_, line) => rows.push({ kind: 'hint', line }))
    }
  }

  return rows
}

/** The column a tree row belongs to; undefined for the toolbar rows or past the end. */
export function hitTest(
  rows: readonly Row[],
  treeRow: number,
): KanbanColumn | undefined {
  const row = rows[treeRow]

  return row !== undefined && 'column' in row ? row.column : undefined
}

export type CardLine = {
  left: string
  title: string
  glyph: string
  age: string
}

/** A card row's pieces, sized so `left + title + glyph + age` is `columns` cells. */
export function cardLine(
  card: KanbanCard,
  columns: number,
  glyph: string,
  age: string,
): CardLine {
  const left = `  #${card.number} ${card.tag ? `${S.tagShort[card.tag]} ` : ''}`
  const fixed = cellWidth(left) + 1 + cellWidth(glyph)
  const ageText = age === '' ? '' : ` ${age}`

  let room = columns - fixed - cellWidth(ageText)
  let shownAge = ageText
  if (room < 4) {
    shownAge = ''
    room = columns - fixed
  }
  const width = Math.max(0, room)

  return {
    left,
    title: `${padEnd(truncate(card.title, width), width)} `,
    glyph,
    age: shownAge,
  }
}

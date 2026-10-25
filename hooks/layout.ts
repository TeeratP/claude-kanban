import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import { COLUMNS, DONE_LIMIT, cellWidth, padEnd, truncate } from './model'
import { S } from './strings'

// Every Row is exactly one terminal row, so a Row's index is its tree row.
export type Row =
  | { kind: 'toolbar' }
  | { kind: 'header'; column: KanbanColumn; shown: number; total: number }
  | { kind: 'more'; column: KanbanColumn; dir: 'up' | 'down'; n: number }
  | { kind: 'card'; column: KanbanColumn; card: KanbanCard }
  | { kind: 'empty'; column: KanbanColumn }
  | { kind: 'note' }

export type LayoutInput = {
  cards: readonly KanbanCard[]
  ui: KanbanUi
  bodyRows: number
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

export function openCount(ui: KanbanUi): number {
  return COLUMNS.filter(column => !ui.collapsed[column]).length
}

/** Cards a section shows at once, so the whole tree fits `bodyRows`. */
export function capFor(bodyRows: number, openSections: number): number {
  const sections = Math.max(1, openSections)
  const cap = Math.floor((bodyRows - 1 - COLUMNS.length) / sections) - 2

  return Math.min(5, Math.max(1, cap))
}

export function clampOffset(offset: number, len: number, cap: number): number {
  return Math.min(Math.max(0, len - cap), Math.max(0, offset))
}

export function layoutBoard({ cards, ui, bodyRows }: LayoutInput): Row[] {
  const cap = capFor(bodyRows, openCount(ui))
  const rows: Row[] = [{ kind: 'toolbar' }]

  for (const column of COLUMNS) {
    const list = sectionList(cards, column)
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
    }
    const below = list.length - (offset + cap)
    if (below > 0) rows.push({ kind: 'more', column, dir: 'down', n: below })
  }

  if (cards.length === 0) rows.push({ kind: 'note' })

  return rows
}

/** The column a tree row belongs to; undefined for the toolbar or past the end. */
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

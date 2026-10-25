import type { KanbanCard, KanbanColumn } from '../types'
import type { RowView, Seg } from './board-client'
import { cardLine } from './layout'
import type { Row } from './layout'
import { cellWidth, isColumn, truncate } from './model'
import { S } from './strings'

export type RowViewInput = {
  rows: readonly Row[]
  columns: number
  collapsed: Readonly<Record<KanbanColumn, boolean>>
  /** The sync mark a card shows, if any. */
  glyphOf: (
    card: KanbanCard,
  ) => { text: string; color: string; dim: boolean } | undefined
  ageOf: (card: KanbanCard) => string
}

/** A message the board's Client posts, checked: it came from code, not a fact. */
export type BoardMessage =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: KanbanColumn }
  | { type: 'toggle'; column: KanbanColumn }
  | { type: 'page'; column: KanbanColumn; dir: 'up' | 'down' }

const seg = (text: string, style: Partial<Omit<Seg, 'text'>> = {}): Seg => ({
  text,
  bold: false,
  dim: false,
  color: '',
  ...style,
})

const view = (segs: Seg[]) => ({
  segs,
  width: cellWidth(segs.map(one => one.text).join('')),
})

/** The list rows (everything under the toolbar) as the Client draws them. */
export function toRowViews(input: RowViewInput): RowView[] {
  const { columns, collapsed, glyphOf, ageOf } = input
  const views: RowView[] = []

  for (const row of input.rows) {
    switch (row.kind) {
      case 'toolbar':
        break

      case 'header':
        views.push({
          key: `hdr:${row.column}`,
          kind: 'header',
          column: row.column,
          ...view([
            seg(`${collapsed[row.column] ? S.expand : S.collapse} `),
            seg(S.col[row.column], { bold: true }),
            seg(' '),
            seg(S.count(row.shown, row.total), { dim: true }),
          ]),
        })
        break

      case 'more':
        views.push({
          key: `more:${row.column}:${row.dir}`,
          kind: 'more',
          column: row.column,
          dir: row.dir,
          ...view([seg(S.more(row.dir, row.n), { dim: true })]),
        })
        break

      case 'card': {
        const { card } = row
        const glyph = glyphOf(card)
        const line = cardLine(card, columns, glyph?.text ?? ' ', ageOf(card))
        // A done card is dim all through.
        const dim = card.column === 'done'
        views.push({
          key: `card:${card.id}`,
          kind: 'card',
          column: row.column,
          cardId: card.id,
          ...view([
            seg(line.left, { dim }),
            seg(line.title, { dim }),
            seg(line.glyph, {
              dim: glyph?.dim ?? dim,
              color: glyph?.color ?? '',
            }),
            seg(line.age, { dim: true }),
          ]),
        })
        break
      }

      case 'empty':
        views.push({
          key: `empty:${row.column}`,
          kind: 'text',
          ...view([seg(S.empty, { dim: true })]),
        })
        break

      case 'note':
        views.push({
          key: 'note',
          kind: 'text',
          ...view([seg(truncate(S.noCards, columns), { dim: true })]),
        })
        break
    }
  }

  return views
}

/** The message in `data`, or undefined when it is none the Client posts. */
export function parseBoardMessage(data: unknown): BoardMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined

  const { type, cardId, column, dir } = data as Record<string, unknown>

  switch (type) {
    case 'open':
      return typeof cardId === 'string' ? { type, cardId } : undefined
    case 'drop':
      return typeof cardId === 'string' && isColumn(column)
        ? { type, cardId, column }
        : undefined
    case 'toggle':
      return isColumn(column) ? { type, column } : undefined
    case 'page':
      return isColumn(column) && (dir === 'up' || dir === 'down')
        ? { type, column, dir }
        : undefined
    default:
      return undefined
  }
}

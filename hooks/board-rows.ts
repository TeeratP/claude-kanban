import type { KanbanCard, KanbanColumn } from '../types'
import type { Place, RowView, Seg } from './board-client'
import { cardLine } from './layout'
import type { Row } from './layout'
import { COLUMNS, cellWidth, isColumn, truncate } from './model'
import { headerCount, queuePlace } from './queue'
import type { QueueView } from './queue'
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
  /** The pieces of a Claude card's second row. */
  detailOf: (card: KanbanCard) => Seg[]
  /** Claude's limit and who waits for it. */
  queue: QueueView
}

/** A message the board's Client posts, checked: it came from code, not a fact. */
export type BoardMessage =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: KanbanColumn; place?: Place }
  | { type: 'shift'; cardId: string; dir: 'up' | 'down' }
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

// Done lists by update time, so a card has no place to be put in it.
const isOrdered = (column: KanbanColumn) => column !== 'done'

// The keys that send the card under the cursor to a section: its place from
// the top (1-4) and its initial (h, c, b, d).
const moveKeysOf = (column: KanbanColumn) => [
  String(COLUMNS.indexOf(column) + 1),
  column.charAt(0),
]

/** The list rows (everything under the toolbar) as the Client draws them. */
export function toRowViews(input: RowViewInput): RowView[] {
  const { columns, collapsed, glyphOf, ageOf, detailOf, queue } = input
  const views: RowView[] = []

  for (const row of input.rows) {
    switch (row.kind) {
      case 'toolbar':
        break

      case 'header': {
        const moveKeys = moveKeysOf(row.column)
        views.push({
          key: `hdr:${row.column}`,
          kind: 'header',
          column: row.column,
          moveKeys,
          hint: S.moveKeys(moveKeys),
          isOrdered: isOrdered(row.column),
          ...view([
            seg(`${collapsed[row.column] ? S.expand : S.collapse} `),
            seg(S.col[row.column], { bold: true }),
            seg(' '),
            seg(headerCount(row.column, row.shown, row.total, queue), {
              dim: true,
            }),
          ]),
        })
        break
      }

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
        const place = queuePlace(queue, card.id)
        const mark = place === undefined ? ' ' : S.queuedMark(place)
        const line = cardLine(card, columns, glyph?.text ?? mark, ageOf(card))
        // A done card and a queued one are dim all through.
        const dim = card.column === 'done' || place !== undefined
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

      case 'detail':
        views.push({
          key: `act:${row.card.id}`,
          kind: 'detail',
          column: row.column,
          cardId: row.card.id,
          ...view(detailOf(row.card)),
        })
        break

      case 'empty':
        views.push({
          key: `empty:${row.column}`,
          kind: 'text',
          column: row.column,
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

function placeOf(value: unknown): Place | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const { at, cardId } = value as Record<string, unknown>
  if (at === 'top') return { at }

  return (at === 'before' || at === 'after') && typeof cardId === 'string'
    ? { at, cardId }
    : undefined
}

/** The message in `data`, or undefined when it is none the Client posts. */
export function parseBoardMessage(data: unknown): BoardMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined

  const { type, cardId, column, dir, place } = data as Record<string, unknown>

  switch (type) {
    case 'open':
      return typeof cardId === 'string' ? { type, cardId } : undefined
    case 'drop': {
      if (typeof cardId !== 'string' || !isColumn(column)) return undefined
      if (place === undefined) return { type, cardId, column }

      const at = placeOf(place)

      return at === undefined ? undefined : { type, cardId, column, place: at }
    }
    case 'shift':
      return typeof cardId === 'string' && (dir === 'up' || dir === 'down')
        ? { type, cardId, dir }
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

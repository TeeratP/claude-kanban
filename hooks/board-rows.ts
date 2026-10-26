import type { KanbanCard, KanbanColumn, KanbanGroup } from '../types'
import type { Place, RowView, Seg } from './board-client'
import { cardLine } from './layout'
import type { Row, SectionCount } from './layout'
import {
  COLUMNS,
  MOVE_KEY,
  cellWidth,
  groupOf,
  isColumn,
  isOrdered,
  truncate,
} from './model'
import { headerMeta, queuePlace } from './queue'
import type { QueueView } from './queue'
import { S } from './strings'

export type RowViewInput = {
  rows: readonly Row[]
  columns: number
  /** Whether a filter is on: headers then count what it lets through. */
  isFiltered: boolean
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
  | { type: 'toggleGroup'; group: KanbanGroup }
  | { type: 'page'; column: KanbanColumn; dir: 'up' | 'down' }

const seg = (text: string, style: Partial<Omit<Seg, 'text'>> = {}): Seg => ({
  text,
  bold: false,
  dim: false,
  color: '',
  ...style,
})

const widthOf = (segs: readonly Seg[]) =>
  cellWidth(segs.map(one => one.text).join(''))

const view = (segs: Seg[]) => ({ segs, width: widthOf(segs) })

// The keys that send the card under the cursor to a section: its place from
// the top (1-6) and its initial (b, h, c, d, x, s).
const moveKeysOf = (column: KanbanColumn) => [
  String(COLUMNS.indexOf(column) + 1),
  MOVE_KEY[column],
]

// Sections are indented under their group; a rule runs from the count to the edge.
const INDENT = '  '
const RULE = '─'
// A rule shorter than this is no rule: the header gives up its meta first.
const MIN_RULE = 2
// Under this many columns Claude's meta is written short.
const SHORT_META_BELOW = 36
// The "press a group" line needs this much room.
const FOLDED_MIN_COLUMNS = 30
// The legend is written whole from this many columns.
const LEGEND_LONG_FROM = 40
// The chips carry the group's name from this many columns.
const CHIPS_NAMED_FROM = 40

// The colour a section's label is drawn in: Human is "needs you", Claude is Claude.
const LABEL_COLOR: Partial<Record<KanbanColumn, string>> = {
  human: 'permission',
  claude: 'claude',
}

type Right = { text: string; style: Partial<Omit<Seg, 'text'>> }

// `  Human 2 ─────── meta`: the label, the count, a dim rule to the right edge
// and, when it leaves a rule, the meta flush right. `rights` are the choices
// for the meta, longest first; the first that fits is used.
function sectionHeader(
  row: Extract<Row, { kind: 'header' }>,
  columns: number,
  isFiltered: boolean,
  rights: readonly Right[],
): Seg[] {
  const { column } = row
  const isInactive = groupOf(column) === 'inactive'
  const count = isFiltered
    ? S.filterCount(row.shown, row.total)
    : String(row.total)
  const color = LABEL_COLOR[column]
  const left = [
    seg(INDENT),
    seg(S.col[column], {
      bold: true,
      ...(isInactive ? { dim: true } : color === undefined ? {} : { color }),
    }),
    seg(` ${count}`, { dim: true }),
  ]
  const room = columns - widthOf(left) - 1
  const right = rights.find(one => room - 1 - cellWidth(one.text) >= MIN_RULE)
  const rule = Math.max(
    0,
    room - (right === undefined ? 0 : 1 + cellWidth(right.text)),
  )

  return [
    ...left,
    seg(` ${RULE.repeat(rule)}`, { dim: true }),
    ...(right === undefined ? [] : [seg(' '), seg(right.text, right.style)]),
  ]
}

// The summary of a closed group: its sections that hold cards, whole, then
// cut to initials, then to the total alone; `empty` for none.
function summaryOptions(
  counts: readonly SectionCount[],
  isFiltered: boolean,
): Seg[][] {
  const shownOf = (one: SectionCount) => (isFiltered ? one.shown : one.total)
  if (isFiltered) {
    const total = counts.reduce((sum, one) => sum + one.shown, 0)

    return [[seg(S.groupMatches(total), { dim: true })]]
  }

  const filled = counts.filter(one => shownOf(one) > 0)
  if (filled.length === 0) return [[seg(S.groupEmpty, { dim: true })]]

  const total = filled.reduce((sum, one) => sum + shownOf(one), 0)
  const part = (one: SectionCount, isShort: boolean) =>
    seg(S.groupCount(shownOf(one), one.column, isShort), {
      dim: one.column !== 'human',
      ...(one.column === 'human' ? { color: 'permission' } : {}),
    })
  const joined = (isShort: boolean) =>
    filled.flatMap((one, index) => [
      ...(index === 0 ? [] : [seg(isShort ? ' ' : S.statsSep, { dim: true })]),
      part(one, isShort),
    ])

  return [joined(false), joined(true), [seg(String(total), { dim: true })]]
}

// A group's label, then `right` flush to the edge; just the label when `right` does not fit.
function groupLine(
  label: Seg,
  columns: number,
  rights: readonly Seg[][],
): Seg[] {
  const right = rights.find(
    one => widthOf([label]) + 2 + widthOf(one) <= columns,
  )
  if (right === undefined) return [label]

  return [
    label,
    seg(' '.repeat(columns - widthOf([label]) - widthOf(right))),
    ...right,
  ]
}

type Chips = {
  segs: Seg[]
  chips: Extract<RowView, { kind: 'group' }>['chips']
}

// The sections of a closed group as chips, for a card being dragged to land on:
// ` Done  Cancelled  Suspended ` after the group's name, or in its place when
// the name does not fit, or as initials. A chip is drawn where its cells are.
function groupChips(
  group: KanbanGroup,
  columns: number,
  sections: readonly KanbanColumn[],
): Chips {
  const chevron = seg(`${S.expand} `, { bold: true })
  const tiers: { lead: Seg[]; text: (column: KanbanColumn) => string }[] = [
    {
      lead: [seg(`${S.expand} ${S.group[group]}`, { bold: true })],
      text: column => ` ${S.col[column]} `,
    },
    { lead: [chevron], text: column => ` ${S.col[column]} ` },
    { lead: [chevron], text: column => ` ${S.col[column].charAt(0)} ` },
  ]
  const fitting = tiers.filter(
    (one, index) => index > 0 || columns >= CHIPS_NAMED_FROM,
  )
  const build = (tier: (typeof tiers)[number]): Chips => {
    const lead = tier.lead
    let at = widthOf(lead)
    const segs = [...lead]
    const chips: Chips['chips'] = []
    for (const column of sections) {
      const chip = seg(tier.text(column), { bold: true })
      chips.push({
        column,
        seg: segs.length,
        from: at,
        to: at + widthOf([chip]),
      })
      segs.push(chip)
      at += widthOf([chip])
    }

    return { segs, chips }
  }
  const built = fitting.map(build)
  const chosen = built.find(one => widthOf(one.segs) <= columns) ?? built.at(-1)
  if (chosen === undefined) return { segs: [], chips: [] }

  // Padded to the edge, so a row drawn from these runs the pane's width.
  return {
    ...chosen,
    segs: [
      ...chosen.segs,
      seg(' '.repeat(Math.max(0, columns - widthOf(chosen.segs)))),
    ],
  }
}

/** The list rows (everything under the toolbar) as the Client draws them. */
export function toRowViews(input: RowViewInput): RowView[] {
  const { columns, isFiltered, glyphOf, ageOf, detailOf, queue } = input
  const views: RowView[] = []

  for (const row of input.rows) {
    switch (row.kind) {
      case 'toolbar':
        break

      case 'group': {
        const label = seg(
          `${row.isOpen ? S.collapse : S.expand} ${S.group[row.group]}`,
          { bold: true },
        )
        const sections = row.counts.map(one => ({
          column: one.column,
          moveKeys: moveKeysOf(one.column),
        }))
        const carried = seg(
          sections.map(one => one.moveKeys.join('/')).join(' '),
          { bold: true },
        )
        const chips = row.isOpen
          ? { segs: [], chips: [] }
          : groupChips(
              row.group,
              columns,
              row.counts.map(one => one.column),
            )
        views.push({
          key: `grp:${row.group}`,
          kind: 'group',
          group: row.group,
          isOpen: row.isOpen,
          sections,
          chipSegs: chips.segs,
          chips: chips.chips,
          carrySegs: row.isOpen
            ? [label]
            : groupLine(label, columns, [[carried]]),
          ...view(
            row.isOpen
              ? [label]
              : groupLine(
                  label,
                  columns,
                  summaryOptions(row.counts, isFiltered),
                ),
          ),
        })
        break
      }

      case 'header': {
        const moveKeys = moveKeysOf(row.column)
        const meta = headerMeta(row.column, row.total, queue)
        const rights: Right[] =
          meta === undefined
            ? []
            : [
                ...(columns < SHORT_META_BELOW
                  ? []
                  : [{ text: meta.long, style: metaStyle(meta.isWarning) }]),
                { text: meta.short, style: metaStyle(meta.isWarning) },
              ]
        views.push({
          key: `hdr:${row.column}`,
          kind: 'header',
          column: row.column,
          moveKeys,
          isOrdered: isOrdered(row.column),
          // While a card is carried by `m`, the keys that send it here take the meta's place.
          carrySegs: sectionHeader(row, columns, isFiltered, [
            { text: moveKeys.join('/'), style: { bold: true } },
          ]),
          ...view(sectionHeader(row, columns, isFiltered, rights)),
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
        // A card in the inactive group and a queued one are dim all through.
        const dim = groupOf(card.column) === 'inactive' || place !== undefined
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
          ...view([seg(isFiltered ? S.noMatches : S.empty, { dim: true })]),
        })
        break

      // A space, so the row keeps its one terminal row.
      case 'blank':
        views.push({
          key:
            row.column === undefined
              ? `blank:slack:${row.index}`
              : `blank:${row.column}:${row.index}`,
          kind: 'text',
          ...(row.column === undefined ? {} : { column: row.column }),
          ...view([seg(' ')]),
        })
        break

      case 'legend':
        views.push({
          key: 'legend',
          kind: 'text',
          ...view([
            seg(
              truncate(
                `${INDENT}${columns < LEGEND_LONG_FROM ? S.legend.short : S.legend.long}`,
                columns,
              ),
              { dim: true },
            ),
          ]),
        })
        break

      case 'folded':
        if (columns >= FOLDED_MIN_COLUMNS) {
          views.push({
            key: 'folded',
            kind: 'text',
            ...view([seg(truncate(S.groupsFolded, columns), { dim: true })]),
          })
        }
        break

      case 'note':
        views.push({
          key: 'note',
          kind: 'text',
          ...view([seg(truncate(S.noCards, columns), { dim: true })]),
        })
        break

      case 'hint':
        views.push({
          key: `hint:${row.line}`,
          kind: 'text',
          ...view([
            seg(truncate(S.githubHint[row.line] ?? '', columns), { dim: true }),
          ]),
        })
        break
    }
  }

  return views
}

// Claude's meta is dim, and warning when cards are over the limit.
const metaStyle = (isWarning: boolean): Right['style'] =>
  isWarning ? { color: 'warning' } : { dim: true }

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

  const { type, cardId, column, group, dir, place } = data as Record<
    string,
    unknown
  >

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
    case 'toggleGroup':
      return group === 'active' || group === 'inactive'
        ? { type, group }
        : undefined
    case 'page':
      return isColumn(column) && (dir === 'up' || dir === 'down')
        ? { type, column, dir }
        : undefined
    default:
      return undefined
  }
}

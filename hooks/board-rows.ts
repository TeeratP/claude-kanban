import type { KanbanCard, KanbanColumn, KanbanGroup } from '../types'
import type { Place, RowView, Seg } from './board-client'
import { META_CELLS, cardLine, numberColumn, titleColumn } from './layout'
import type { Row, SectionCount } from './layout'
import {
  COLUMNS,
  MOVE_KEY,
  NEWEST_LIMIT,
  cellWidth,
  fit,
  groupOf,
  isColumn,
  isOrdered,
  isPendingId,
  truncate,
} from './model'
import type { Copy } from './model'
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
  /** Every card on the board: the number column is as wide as its widest number. */
  cards: readonly KanbanCard[]
  /** Whether the surface takes a drag, and whether it has text fields: some copy differs. */
  canDrag: boolean
  canType: boolean
  /** Whether the cards come from GitHub, which an empty board says. */
  isGithub: boolean
}

/** A message the board's Client posts, checked: it came from code, not a fact. */
export type BoardMessage =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: KanbanColumn; place?: Place }
  | { type: 'shift'; cardId: string; dir: 'up' | 'down' }
  | { type: 'toggleGroup'; group: KanbanGroup }
  | { type: 'page'; column: KanbanColumn; dir: 'up' | 'down' }
  | { type: 'settings' }

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
// The "press a group" line needs this much room.
const FOLDED_MIN_COLUMNS = 30
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
    // The first load has no counts to give yet.
    ...(row.isLoading === true ? [] : [seg(` ${count}`, { dim: true })]),
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

// What a section says when it holds no card, long and short; `canDrag` and
// `canType` pick the copy a surface can act on.
function emptyCopy(
  column: KanbanColumn,
  canDrag: boolean,
  canType: boolean,
): Copy {
  switch (column) {
    case 'human':
      return S.emptyHuman
    case 'claude':
      return S.emptyClaude(canDrag)
    case 'backlog':
      return S.emptyBacklog(canType)
    case 'done':
      return S.emptyDone
    case 'suspended':
      return S.emptySuspended
    case 'cancelled':
      return S.emptyCancelled
  }
}

/** Whether a card is dim from end to end: finished or dropped. */
export const isDimCard = (card: KanbanCard) =>
  card.column === 'done' || card.column === 'cancelled'

/**
 * What a section header shows on its right: Done and Cancelled say they list
 * only their newest ten once they hold more.
 */
export function headerMeta(
  column: KanbanColumn,
  total: number,
): string | undefined {
  return isOrdered(column) || total <= NEWEST_LIMIT
    ? undefined
    : S.newestMeta(NEWEST_LIMIT)
}

// How a card's number, title and age are drawn: its section sets it, a
// question stands out and a failed move turns the number red, where the eye
// scans.
function cardStyles(card: KanbanCard, glyph: { color: string } | undefined) {
  const { column } = card
  const isDim = isDimCard(card)
  const number: Partial<Omit<Seg, 'text'>> =
    glyph?.color === 'error'
      ? { color: 'error' }
      : card.tag === 'question'
        ? { bold: true, color: 'permission' }
        : column === 'suspended'
          ? {}
          : { dim: true }
  const title: Partial<Omit<Seg, 'text'>> = {
    ...(isDim || column === 'suspended' ? { dim: true } : {}),
    ...(column === 'cancelled' ? { strike: true } : {}),
  }

  return { number, title }
}

/** The list rows (everything under the toolbar) as the Client draws them. */
export function toRowViews(input: RowViewInput): RowView[] {
  const { columns, isFiltered, glyphOf, ageOf, detailOf } = input
  const views: RowView[] = []
  const numbers = numberColumn(input.cards, columns)
  // Titles, empty-state lines, bars and `more` rows all start at this cell.
  const titleAt = titleColumn(input.cards, columns)
  const lead = seg(' '.repeat(titleAt))

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
                  // No summary of what is not known yet.
                  row.isLoading === true
                    ? []
                    : summaryOptions(row.counts, isFiltered),
                ),
          ),
        })
        break
      }

      case 'header': {
        const moveKeys = moveKeysOf(row.column)
        const meta = headerMeta(row.column, row.total)
        const rights: Right[] =
          meta === undefined || row.isLoading === true
            ? []
            : [{ text: meta, style: { dim: true } }]
        views.push({
          key: `hdr:${row.column}`,
          kind: 'header',
          column: row.column,
          moveKeys,
          isOrdered: isOrdered(row.column),
          // The label is the second piece, after the indent.
          labelAt: 1,
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
          ...view([lead, seg(S.more(row.dir, row.n), { dim: true })]),
        })
        break

      case 'card': {
        const { card } = row
        const glyph = glyphOf(card)
        // A card not yet made has no age to give.
        const age = isPendingId(card.id) ? '' : ageOf(card)
        const line = cardLine(card, columns, numbers, {
          mark: glyph?.text ?? '',
          age,
        })
        const styles = cardStyles(card, glyph)
        views.push({
          key: `card:${card.id}`,
          kind: 'card',
          column: row.column,
          cardId: card.id,
          ...view(
            [
              seg(line.indent),
              seg(line.number, styles.number),
              seg(' '),
              seg(line.title, styles.title),
              seg(line.gap),
              seg(line.mark, {
                dim: glyph?.dim ?? false,
                color: glyph?.color ?? '',
              }),
              seg(line.between),
              seg(line.age, { dim: true }),
            ].filter(one => one.text !== ''),
          ),
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

      case 'empty': {
        const copy = isFiltered
          ? { long: S.noMatches, short: S.noMatches }
          : emptyCopy(row.column, input.canDrag, input.canType)
        // Human, when clear, says so with a tick.
        const tick = !isFiltered && row.column === 'human'
        const room = columns - titleAt - (tick ? 2 : 0)
        views.push({
          key: `empty:${row.column}`,
          kind: 'text',
          column: row.column,
          ...view([
            lead,
            ...(tick ? [seg(`${S.confirmed} `, { color: 'success' })] : []),
            seg(fit(copy, room), { dim: true }),
          ]),
        })
        break
      }

      case 'skeleton': {
        const bar = Math.round(
          ((columns - titleAt - META_CELLS) * row.percent) / 100,
        )
        views.push({
          key: `skeleton:${row.column}:${row.index}`,
          kind: 'text',
          column: row.column,
          ...view([
            lead,
            seg(RULE.repeat(Math.max(0, bar)), { dim: true, color: 'subtle' }),
          ]),
        })
        break
      }

      // A space, so the row keeps its one terminal row; spare room in a
      // section is a quiet dot at the foot of the number column.
      case 'blank':
        views.push({
          key:
            row.column === undefined
              ? `blank:slack:${row.index}`
              : `blank:${row.column}:${row.index}`,
          kind: 'text',
          ...(row.column === undefined ? {} : { column: row.column }),
          ...view(
            row.column === undefined || row.isPlain === true
              ? [seg(' ')]
              : [
                  seg(' '.repeat(Math.max(0, titleAt - 2))),
                  seg(S.slot, { dim: true, color: 'subtle' }),
                ],
          ),
        })
        break

      case 'legend': {
        const room = columns - INDENT.length
        views.push({
          key: 'legend',
          kind: 'text',
          // Once a key has brought the cursor up, the legend lists the cursor's keys.
          keyed: [seg(`${INDENT}${fit(S.legendKeys, room)}`, { dim: true })],
          ...view([seg(`${INDENT}${fit(S.legendIdle, room)}`, { dim: true })]),
        })
        break
      }

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
          ...view([
            seg(
              `${INDENT}${fit(input.isGithub ? S.noIssues : S.noCards, columns - INDENT.length)}`,
              { dim: true },
            ),
          ]),
        })
        break

      case 'hint': {
        const copy = S.githubHint[row.line]
        views.push({
          key: `hint:${row.line}`,
          kind: 'text',
          ...view([
            seg(
              copy === undefined
                ? ''
                : `${INDENT}${fit(copy, columns - INDENT.length)}`,
              { dim: true },
            ),
          ]),
        })
        break
      }
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
    case 'settings':
      return { type }
    default:
      return undefined
  }
}

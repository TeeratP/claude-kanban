import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import {
  TOOLBAR_ROWS,
  applyFilter,
  blocksOf,
  cardLine,
  footRows,
  hitTest,
  layoutBoard,
  maxOffset,
  numberColumn,
  numberLabel,
  sectionBody,
  sectionList,
  sectionWindow,
  titleColumn,
} from '../hooks/layout'
import type { CardLine, Row } from '../hooks/layout'
import {
  COLUMNS,
  GROUPS,
  INITIAL_UI,
  ageLabel,
  cellWidth,
  fit,
  groupOf,
  padStart,
  truncate,
} from '../hooks/model'

function cardOf(
  number: number,
  column: KanbanColumn,
  extra: Partial<KanbanCard> = {},
) {
  return {
    id: `md:${number}`,
    number,
    title: `Card ${number}`,
    column,
    order: number,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: `2026-10-25T10:${String(number % 60).padStart(2, '0')}:00Z`,
    ...extra,
  } satisfies KanbanCard
}

const many = (column: KanbanColumn, n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => cardOf(from + i, column))

const showing = (openGroup: KanbanUi['openGroup']): KanbanUi => ({
  ...INITIAL_UI,
  openGroup,
})

const kinds = (rows: Row[]) =>
  rows.map(row => ('column' in row ? `${row.kind}:${row.column}` : row.kind))

// The rows of one section: its header and the body under it.
const sectionRows = (rows: Row[], column: KanbanColumn) =>
  rows.filter(
    row => 'column' in row && row.column === column && row.kind !== 'blank',
  )

// The rows from a section's header to the next header or group, blank filler included.
function block(rows: Row[], column: KanbanColumn): Row[] {
  const from = rows.findIndex(
    row => row.kind === 'header' && row.column === column,
  )
  const to = rows.findIndex(
    (row, index) =>
      index > from && (row.kind === 'header' || row.kind === 'group'),
  )

  return rows.slice(from, to < 0 ? rows.length : to)
}

test('the groups hold Backlog, Human, Claude and Done, Cancelled, Suspended, and the move keys follow COLUMNS', () => {
  expect(GROUPS.active).toEqual(['backlog', 'human', 'claude'])
  expect(GROUPS.inactive).toEqual(['done', 'cancelled', 'suspended'])
  expect(COLUMNS).toEqual([
    'backlog',
    'human',
    'claude',
    'done',
    'cancelled',
    'suspended',
  ])
  expect(COLUMNS.map(groupOf)).toEqual([
    'active',
    'active',
    'active',
    'inactive',
    'inactive',
    'inactive',
  ])
})

test('the open group lists its sections Backlog, Human, Claude under the toolbar, the closed group is its header', () => {
  const cards = [
    cardOf(1, 'backlog'),
    cardOf(2, 'human'),
    cardOf(3, 'done'),
    cardOf(4, 'claude'),
  ]
  const rows = layoutBoard({ cards, ui: INITIAL_UI, bodyRows: 30 })

  expect(kinds(rows).filter(kind => !kind.startsWith('blank'))).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'header:backlog',
    'card:backlog',
    'header:human',
    'card:human',
    'header:claude',
    'card:claude',
    'group',
  ])
  expect(rows[2]).toMatchObject({
    kind: 'group',
    group: 'active',
    isOpen: true,
  })
  expect(rows.find(row => row.kind === 'group' && !row.isOpen)).toMatchObject({
    group: 'inactive',
    counts: [
      { column: 'done', shown: 1, total: 1 },
      { column: 'cancelled', shown: 0, total: 0 },
      { column: 'suspended', shown: 0, total: 0 },
    ],
  })
})

test('the open Inactive group lists Done, Cancelled, Suspended under a folded Active group', () => {
  const rows = layoutBoard({
    cards: [cardOf(1, 'done'), cardOf(2, 'suspended'), cardOf(3, 'cancelled')],
    ui: showing('inactive'),
    bodyRows: 30,
  })

  expect(
    kinds(rows).filter(kind => kind.startsWith('header') || kind === 'group'),
  ).toEqual([
    'group',
    'group',
    'header:done',
    'header:cancelled',
    'header:suspended',
  ])
  expect(rows[2]).toMatchObject({
    kind: 'group',
    group: 'active',
    isOpen: false,
  })
  expect(rows[3]).toMatchObject({
    kind: 'group',
    group: 'inactive',
    isOpen: true,
  })
})

test('the toolbar is two rows, the status then the actions, so a row index is its tree row', () => {
  const rows = layoutBoard({
    cards: many('human', 1),
    ui: INITIAL_UI,
    bodyRows: 30,
  })

  expect(rows.slice(0, 2)).toEqual([
    { kind: 'toolbar', line: 'status' },
    { kind: 'toolbar', line: 'actions' },
  ])
  expect(rows[TOOLBAR_ROWS]).toMatchObject({ kind: 'group', group: 'active' })
})

test('both groups folded is the two group rows and a line saying to press one', () => {
  const rows = layoutBoard({
    cards: many('backlog', 3),
    ui: showing('none'),
    bodyRows: 30,
  })

  expect(kinds(rows)).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'group',
    'folded',
  ])
  expect(rows.slice(2, 4)).toEqual([
    {
      kind: 'group',
      group: 'active',
      isOpen: false,
      counts: [
        { column: 'backlog', shown: 3, total: 3 },
        { column: 'human', shown: 0, total: 0 },
        { column: 'claude', shown: 0, total: 0 },
      ],
    },
    expect.objectContaining({ group: 'inactive', isOpen: false }),
  ])
})

test('sectionBody gives every section floor(avail / 3) rows and the 0 to 2 left over go below them', () => {
  // 30 rows: the toolbar 2, group headers 2, section headers 3, leaves 23.
  expect(sectionBody({ bodyRows: 30 })).toEqual({ body: 7, slack: 2 })
  expect(sectionBody({ bodyRows: 31 })).toEqual({ body: 8, slack: 0 })
  expect(sectionBody({ bodyRows: 32 })).toEqual({ body: 8, slack: 1 })
  // The picker, filter, form and suggestions come off first.
  expect(sectionBody({ bodyRows: 30, extraRows: 3 })).toEqual({
    body: 6,
    slack: 2,
  })
  // An empty board's note and hint rows too.
  expect(sectionBody({ bodyRows: 30, footRows: 3 })).toEqual({
    body: 6,
    slack: 2,
  })
  // A pane too short for two rows each keeps two.
  expect(sectionBody({ bodyRows: 10 })).toEqual({ body: 2, slack: 0 })
  expect(footRows([], false)).toBe(1)
  expect(footRows([], true)).toBe(3)
  expect(footRows(many('backlog', 1), true)).toBe(0)
})

test('all three sections are as tall as each other at 30, 31 and 32 rows, and the leftover rows are at the bottom', () => {
  const cards = [
    ...many('backlog', 20),
    ...many('human', 20, 100),
    ...many('claude', 20, 200),
  ]
  for (const [bodyRows, body, slack] of [
    [30, 7, 2],
    [31, 8, 0],
    [32, 8, 1],
  ] as const) {
    const rows = layoutBoard({ cards, ui: INITIAL_UI, bodyRows })

    for (const column of GROUPS.active) {
      expect(block(rows, column)).toHaveLength(1 + body)
    }
    expect(rows).toHaveLength(bodyRows)
    // The Inactive group's header, then the slack rows.
    expect(kinds(rows).slice(rows.length - slack - 1)).toEqual([
      'group',
      ...Array<string>(slack).fill('blank'),
    ])
  }
})

test('the legend takes the first leftover row when asked for', () => {
  const rows = layoutBoard({
    cards: many('backlog', 1),
    ui: INITIAL_UI,
    bodyRows: 30,
    legend: true,
  })

  expect(kinds(rows).slice(-2)).toEqual(['legend', 'blank'])
  expect(
    layoutBoard({
      cards: many('backlog', 1),
      ui: INITIAL_UI,
      bodyRows: 31,
      legend: true,
    }).some(row => row.kind === 'legend'),
  ).toBe(false)
})

test('a pane too short for the least still gives two rows to each section, and the tree is taller than the pane', () => {
  const rows = layoutBoard({
    cards: many('backlog', 5),
    ui: INITIAL_UI,
    bodyRows: 10,
  })

  for (const column of GROUPS.active)
    expect(block(rows, column)).toHaveLength(3)
  expect(rows.length).toBeGreaterThan(10)
  // One card and a count of the rest.
  expect(kinds(block(rows, 'backlog'))).toEqual([
    'header:backlog',
    'card:backlog',
    'more:backlog',
  ])
})

test('extra rows above the list make the sections shorter', () => {
  const cards = many('backlog', 20)
  const plain = layoutBoard({ cards, ui: INITIAL_UI, bodyRows: 30 })
  const crowded = layoutBoard({
    cards,
    ui: INITIAL_UI,
    bodyRows: 30,
    extraRows: 3,
  })

  expect(block(plain, 'human')).toHaveLength(8)
  expect(block(crowded, 'human')).toHaveLength(7)
  // The picker, form and the rest are drawn by the view, so the tree still fits.
  expect(crowded.length + 3).toBe(30)
})

test('an empty section is its empty row and filler up to the height', () => {
  const rows = layoutBoard({
    cards: [cardOf(1, 'claude')],
    ui: INITIAL_UI,
    bodyRows: 30,
  })

  expect(kinds(block(rows, 'human'))).toEqual([
    'header:human',
    'empty:human',
    ...Array<string>(6).fill('blank:human'),
  ])
  expect(rows.slice(0, 4).map(row => row.kind)).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'header',
  ])
})

test('a section that overflows its height shows a count of the rest below, and above once scrolled', () => {
  const cards = many('backlog', 12)
  const top = layoutBoard({ cards, ui: INITIAL_UI, bodyRows: 30 })

  // Seven rows: six cards and the count of the other six.
  expect(kinds(block(top, 'backlog'))).toEqual([
    'header:backlog',
    ...Array<string>(6).fill('card:backlog'),
    'more:backlog',
  ])
  expect(sectionRows(top, 'backlog').at(-1)).toEqual({
    kind: 'more',
    column: 'backlog',
    dir: 'down',
    n: 6,
  })

  const middle = layoutBoard({
    cards,
    ui: { ...INITIAL_UI, offsets: { ...INITIAL_UI.offsets, backlog: 3 } },
    bodyRows: 30,
  })
  expect(kinds(block(middle, 'backlog'))).toEqual([
    'header:backlog',
    'more:backlog',
    ...Array<string>(5).fill('card:backlog'),
    'more:backlog',
  ])
  expect(sectionRows(middle, 'backlog')[1]).toEqual({
    kind: 'more',
    column: 'backlog',
    dir: 'up',
    n: 3,
  })

  // At the end only the count above is left, and the rows are exactly the height.
  const end = layoutBoard({
    cards,
    ui: { ...INITIAL_UI, offsets: { ...INITIAL_UI.offsets, backlog: 99 } },
    bodyRows: 30,
  })
  expect(block(end, 'backlog')).toHaveLength(8)
  expect(
    sectionRows(end, 'backlog').filter(row => row.kind === 'card'),
  ).toHaveLength(6)
  expect(
    sectionRows(end, 'backlog').some(
      row => row.kind === 'more' && row.dir === 'down',
    ),
  ).toBe(false)
})

test('a card with a second row that does not fit gives up the second row, never the card', () => {
  const cards = [cardOf(1, 'claude'), cardOf(2, 'claude')]
  const details = new Set(['md:1', 'md:2'])
  const kindsOf = (window: ReturnType<typeof sectionWindow>) =>
    window.rows.map(row => row.kind)

  // A card and its second row fit when nothing lies beyond.
  expect(
    kindsOf(sectionWindow(cards.slice(0, 1), 'claude', 0, 2, details)),
  ).toEqual(['card', 'detail'])
  // With a count to keep a row for, two rows hold the card alone.
  const tight = sectionWindow(cards, 'claude', 0, 2, details)
  expect(kindsOf(tight)).toEqual(['card', 'more'])
  expect(tight.taken).toBe(1)
  // Three rows hold the card, its second row and the count.
  expect(kindsOf(sectionWindow(cards, 'claude', 0, 3, details))).toEqual([
    'card',
    'detail',
    'more',
  ])
  // Only the first card has a second row, and it does not fit beside the count.
  const three = [cardOf(1, 'claude'), cardOf(2, 'claude'), cardOf(3, 'claude')]
  expect(
    kindsOf(sectionWindow(three, 'claude', 0, 2, new Set(['md:1']))),
  ).toEqual(['card', 'more'])
})

test('sectionWindow always returns exactly the height it is given', () => {
  const list = many('claude', 9)
  const details = new Set(['md:2', 'md:5', 'md:6'])
  for (const body of [2, 3, 4, 5, 7, 12]) {
    for (let offset = -1; offset <= 10; offset += 1) {
      const window = sectionWindow(list, 'claude', offset, body, details)

      expect(window.rows).toHaveLength(body)
      expect(window.taken).toBeGreaterThan(0)
      expect(window.rows.filter(row => row.kind === 'card')).toHaveLength(
        window.taken,
      )
    }
  }
})

test('maxOffset is the first card from which the rest fits, with a row kept for the count above', () => {
  const plain = blocksOf(many('backlog', 12), 'backlog')
  expect(maxOffset(plain, 7)).toBe(6)
  expect(maxOffset(plain, 12)).toBe(0)
  expect(maxOffset(plain, 2)).toBe(11)

  // Second rows count as two: 2 + 1 + 2 + 1 = 6 rows, and 3 after the first card.
  const mixed = [2, 1, 2, 1]
  expect(maxOffset(mixed, 6)).toBe(0)
  expect(maxOffset(mixed, 5)).toBe(1)
  expect(maxOffset(mixed, 4)).toBe(2)
  expect(maxOffset([], 5)).toBe(0)
  // A last card with a second row in two rows: the count above would not fit.
  expect(maxOffset([1, 2], 2)).toBe(1)
})

test('a window never starts past what can be scrolled to', () => {
  const window = sectionWindow(many('backlog', 12), 'backlog', 40, 7)

  expect(window.offset).toBe(6)
  expect(window.taken).toBe(6)
})

test('Done and Cancelled list their ten newest and count all of them; Suspended lists every card', () => {
  const cards = [
    ...many('done', 57),
    ...many('cancelled', 15, 100),
    ...many('suspended', 14, 200),
  ]
  const list = sectionList(cards, 'done')

  expect(list).toHaveLength(10)
  expect(list[0]?.number).toBe(57)
  expect(list[9]?.number).toBe(48)
  expect(sectionList(cards, 'cancelled')).toHaveLength(10)
  expect(sectionList(cards, 'cancelled')[0]?.number).toBe(114)
  // Suspended is in the order it was put in, whole.
  expect(sectionList(cards, 'suspended').map(card => card.number)).toEqual(
    Array.from({ length: 14 }, (_, i) => 200 + i),
  )

  const rows = layoutBoard({ cards, ui: showing('inactive'), bodyRows: 30 })
  expect(
    rows.find(row => row.kind === 'header' && row.column === 'done'),
  ).toEqual({ kind: 'header', column: 'done', shown: 57, total: 57 })
})

test('an empty board adds the note under the groups, and the sections give up its rows', () => {
  const rows = layoutBoard({ cards: [], ui: INITIAL_UI, bodyRows: 30 })

  expect(rows.at(-1)).toEqual({ kind: 'note' })
  expect(rows).toHaveLength(30)
})

test('an empty board with the hint adds the GitHub lines under the note, and a board with cards none', () => {
  const empty = layoutBoard({
    cards: [],
    ui: INITIAL_UI,
    bodyRows: 30,
    hint: true,
  })
  const full = layoutBoard({
    cards: [cardOf(1, 'claude')],
    ui: INITIAL_UI,
    bodyRows: 30,
    hint: true,
  })

  expect(empty.slice(-3)).toEqual([
    { kind: 'note' },
    { kind: 'hint', line: 0 },
    { kind: 'hint', line: 1 },
  ])
  expect(empty).toHaveLength(30)
  expect(full.some(row => row.kind === 'note' || row.kind === 'hint')).toBe(
    false,
  )
})

test('the filter draws the group with matches: the open one if it has any, else the first that has', () => {
  const cards = [
    cardOf(1, 'backlog', { title: 'alpha' }),
    cardOf(2, 'done', { title: 'beta' }),
    cardOf(3, 'suspended', { title: 'beta two' }),
  ]
  const filtered = (filter: string, ui: Partial<KanbanUi> = {}) =>
    applyFilter(cards, { ...INITIAL_UI, filter, ...ui })

  expect(filtered('alpha').ui.openGroup).toBe('active')
  // Active is open but has no match: Inactive is drawn open, and the stored group stays.
  const onlyInactive = filtered('beta')
  expect(onlyInactive.ui.openGroup).toBe('inactive')
  expect(onlyInactive.cards.map(card => card.number)).toEqual([2, 3])
  // Both have matches: the stored group stays.
  expect(filtered('a', { openGroup: 'inactive' }).ui.openGroup).toBe('inactive')
  // A fold stored as `none` gives way to the first group with a match.
  expect(filtered('alpha', { openGroup: 'none' }).ui.openGroup).toBe('active')
  // No match anywhere: the stored group.
  expect(filtered('zzz', { openGroup: 'inactive' }).ui.openGroup).toBe(
    'inactive',
  )
  // A group chosen under the filter wins.
  expect(filtered('beta', { filterGroup: 'active' }).ui.openGroup).toBe(
    'active',
  )
  expect(filtered('beta', { filterGroup: 'none' }).ui.openGroup).toBe('none')
  // No filter: nothing is drawn differently.
  expect(applyFilter(cards, INITIAL_UI).ui).toBe(INITIAL_UI)
})

test('under a filter the headers count the matches out of the whole section', () => {
  const cards = [
    cardOf(1, 'backlog', { title: 'alpha' }),
    cardOf(2, 'backlog', { title: 'beta' }),
    cardOf(3, 'backlog', { title: 'alpha too' }),
  ]
  const rows = layoutBoard({
    cards,
    ui: { ...INITIAL_UI, filter: 'alpha' },
    bodyRows: 30,
  })

  expect(
    rows.find(row => row.kind === 'header' && row.column === 'backlog'),
  ).toEqual({ kind: 'header', column: 'backlog', shown: 2, total: 3 })
})

// A card row's cells joined, as it is drawn.
const lineText = (line: CardLine) =>
  line.indent +
  line.number +
  ' ' +
  line.title +
  line.gap +
  line.mark +
  line.between +
  line.age

test('a card row never outgrows the pane, however wide its characters', () => {
  const titles = [
    'Fix login redirect loop that happens on every single request',
    '日本語のとても長いタイトルがここに入ります日本語のとても長いタイトル',
    'ผู้ใช้ไม่สามารถเข้าสู่ระบบได้เมื่อรหัสผ่านหมดอายุแล้ว',
    '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀',
  ]
  for (const columns of [20, 24, 30, 44, 80]) {
    for (const title of titles) {
      for (const tag of [undefined, 'question' as const]) {
        for (const meta of [
          { mark: '', age: '5m' },
          { mark: '⟳', age: '5m' },
          { mark: '✕', age: '' },
          { mark: '', age: 'queued 1' },
          { mark: '⟳', age: 'q1' },
        ]) {
          const one = cardOf(123, 'human', { title, ...(tag ? { tag } : {}) })
          const line = cardLine(
            one,
            columns,
            numberColumn([one], columns),
            meta,
          )

          expect(cellWidth(lineText(line))).toBeLessThanOrEqual(columns)
        }
      }
    }
  }
})

test('titles start at one cell: the numbers are right-aligned in a column as wide as the widest on the board', () => {
  const board = [cardOf(7, 'claude'), cardOf(12, 'human'), cardOf(111, 'done')]
  const column = numberColumn(board, 44)

  expect(column).toEqual({ width: 4, hasHash: true })
  expect(titleColumn(board, 44)).toBe(7)
  for (const one of board) {
    const line = cardLine(one, 44, column, { mark: '', age: '5m' })
    // The indent, the number ending at the column's edge, a space, the title.
    expect(lineText(line).indexOf('Card')).toBe(7)
    expect(cellWidth(line.indent + line.number)).toBe(6)
  }
})

test('the number column of a board with no cards is four cells, and a question or a card not yet made has its own label', () => {
  expect(numberColumn([], 44)).toEqual({ width: 4, hasHash: true })
  expect(numberLabel(cardOf(23, 'human', { tag: 'question' }))).toBe('?23')
  expect(numberLabel(cardOf(23, 'human', { tag: 'review' }))).toBe('#23')
  expect(numberLabel(cardOf(0, 'backlog', { id: 'new:1' }))).toBe('new')
  // A pending card widens the column to its three cells.
  expect(numberColumn([cardOf(5, 'backlog', { id: 'new:1' })], 44)).toEqual({
    width: 3,
    hasHash: true,
  })
})

test('the # goes from the numbers when they would take more than a quarter of the row', () => {
  const board = [cardOf(1234567, 'backlog')]

  expect(numberColumn(board, 44)).toEqual({ width: 8, hasHash: true })
  expect(numberColumn(board, 24)).toEqual({ width: 7, hasHash: false })
  const line = cardLine(board[0] as KanbanCard, 24, numberColumn(board, 24), {
    mark: '',
    age: '5m',
  })
  expect(line.number).toBe('1234567')
  expect(cellWidth(lineText(line))).toBeLessThanOrEqual(24)
})

test('a card row ends flush right in the age, in 3 cells, and a sync mark comes before it', () => {
  const one = cardOf(7, 'claude')
  const column = numberColumn([one], 44)
  const plain = cardLine(one, 44, column, { mark: '', age: '5m' })
  const marked = cardLine(one, 44, column, { mark: '⟳', age: '5m' })
  const alone = cardLine(one, 44, column, { mark: '⟳', age: '' })

  expect(cellWidth(lineText(plain))).toBe(44)
  expect(plain.age).toBe(' 5m')
  expect(lineText(plain).endsWith(' 5m')).toBe(true)
  expect(marked.mark + marked.between + marked.age).toBe('⟳  5m')
  expect(cellWidth(lineText(marked))).toBe(44)
  expect(alone.mark).toBe('⟳')
  expect(alone.age).toBe('')
  expect(lineText(alone).endsWith('⟳')).toBe(true)
  expect(cellWidth(lineText(alone))).toBe(44)
})

test('the title gives up room only while a mark shows, and always leaves two cells before the meta', () => {
  const one = cardOf(7, 'claude', { title: 'x'.repeat(60) })
  const column = numberColumn([one], 44)
  const plain = cardLine(one, 44, column, { mark: '', age: '5m' })
  const marked = cardLine(one, 44, column, { mark: '⟳', age: '5m' })

  expect(cellWidth(plain.title) - cellWidth(marked.title)).toBe(2)
  expect(plain.gap).toBe('  ')
  expect(marked.gap).toBe('  ')
  // With no mark and no age nothing is reserved.
  const bare = cardLine(one, 44, column, { mark: '', age: '' })
  expect(cellWidth(bare.title)).toBe(44 - 2 - 2 - 1)
  expect(bare.gap).toBe('')
})

test('a card row drops the age when the title would have fewer than 8 cells', () => {
  const one = cardOf(7, 'claude', { title: 'Long enough title to need room' })
  const kept = cardLine(one, 24, numberColumn([one], 24), {
    mark: '',
    age: '5m',
  })
  const tight = cardLine(one, 16, numberColumn([one], 16), {
    mark: '',
    age: '5m',
  })

  expect(kept.age).toBe(' 5m')
  expect(tight.age).toBe('')
  expect(cellWidth(tight.title)).toBeGreaterThanOrEqual(8)
})

test('hitTest maps a tree row to its section: its header, cards, count rows and filler, and the toolbar, group rows and legend to none', () => {
  const rows = layoutBoard({
    cards: [...many('backlog', 8), ...many('human', 1, 10)],
    ui: INITIAL_UI,
    bodyRows: 30,
    legend: true,
  })
  // 0-1 toolbar, 2 Active group, 3 Backlog header, 4-9 cards, 10 its count,
  // 11 Human header, 12 its card, 13 filler
  expect(hitTest(rows, 0)).toBeUndefined()
  expect(hitTest(rows, 1)).toBeUndefined()
  expect(hitTest(rows, 2)).toBeUndefined()
  expect(hitTest(rows, 3)).toBe('backlog')
  expect(hitTest(rows, 10)).toBe('backlog')
  expect(hitTest(rows, 11)).toBe('human')
  expect(hitTest(rows, 12)).toBe('human')
  expect(hitTest(rows, 13)).toBe('human')
  const legend = rows.findIndex(row => row.kind === 'legend')
  expect(legend).toBeGreaterThan(0)
  expect(hitTest(rows, legend)).toBeUndefined()
  expect(hitTest(rows, rows.length)).toBeUndefined()
  expect(hitTest(rows, -1)).toBeUndefined()
})

test('cell widths count wide characters twice and combining marks not at all', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('日本語')).toBe(6)
  expect(cellWidth('ที่')).toBe(1)
  expect(truncate('abc', 5)).toBe('abc')
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(cellWidth(truncate('日本語のタイトル', 7))).toBeLessThanOrEqual(7)
  expect(truncate('日本語', 0)).toBe('')
})

test('ages read as now, minutes, hours, days, weeks and years, never past 3 cells', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  const age = (iso: string) => ageLabel(iso, now)

  expect(age('2026-10-25T11:59:40Z')).toBe('now')
  expect(age('2026-10-25T11:55:00Z')).toBe('5m')
  expect(age('2026-10-25T09:00:00Z')).toBe('3h')
  expect(age('2026-10-23T12:00:00Z')).toBe('2d')
  // Days up to 13, then weeks up to 52, then years.
  expect(age('2026-10-12T12:00:00Z')).toBe('13d')
  expect(age('2026-10-11T12:00:00Z')).toBe('2w')
  expect(age('2026-09-27T12:00:00Z')).toBe('4w')
  expect(age('2025-10-26T12:00:00Z')).toBe('52w')
  expect(age('2025-10-25T12:00:00Z')).toBe('1y')
  expect(age('2016-10-25T12:00:00Z')).toBe('10y')
  expect(ageLabel(0, now * 20)).toBe('99y')
  expect(ageLabel('not a date', now)).toBe('')
  for (const days of [1, 13, 14, 100, 364, 365, 3650, 36_500]) {
    expect(
      cellWidth(ageLabel(now - days * 24 * 60 * 60_000, now)),
    ).toBeLessThanOrEqual(3)
  }
})

test('copy fits whole, else short, else cut', () => {
  const copy = { long: 'Nothing yet · n adds a card', short: 'n adds a card' }

  expect(fit(copy, 27)).toBe(copy.long)
  expect(fit(copy, 26)).toBe(copy.short)
  expect(fit(copy, 13)).toBe(copy.short)
  expect(fit(copy, 8)).toBe('n adds …')
  expect(padStart('5m', 3)).toBe(' 5m')
  expect(padStart('日', 3)).toBe(' 日')
})

test('while the first load runs the open group shows bars and no counts, and no note, hint, legend or folded Inactive summary', () => {
  const rows = layoutBoard({
    cards: [],
    ui: INITIAL_UI,
    bodyRows: 30,
    hint: true,
    legend: true,
    isLoading: true,
  })

  expect(rows).toHaveLength(30)
  expect(rows.some(row => ['note', 'hint', 'legend'].includes(row.kind))).toBe(
    false,
  )
  expect(rows.filter(row => row.kind === 'header')).toEqual(
    (['backlog', 'human', 'claude'] as const).map(column => ({
      kind: 'header',
      column,
      shown: 0,
      total: 0,
      isLoading: true,
    })),
  )
  expect(rows.filter(row => row.kind === 'group')).toMatchObject([
    { group: 'active', isOpen: true, isLoading: true },
    { group: 'inactive', isOpen: false, isLoading: true },
  ])
  // Every section is the same height: its header, three bars and plain filler.
  for (const column of ['backlog', 'human', 'claude'] as const) {
    const body = block(rows, column).slice(1)
    expect(body.map(row => row.kind)).toEqual([
      'skeleton',
      'skeleton',
      'skeleton',
      'blank',
      'blank',
      'blank',
      'blank',
    ])
    expect(body.every(row => row.kind !== 'blank' || row.isPlain)).toBe(true)
  }
})

test('the bars are the same on every draw and differ from one section to the next', () => {
  const draw = () =>
    layoutBoard({ cards: [], ui: INITIAL_UI, bodyRows: 30, isLoading: true })
  const percents = (rows: Row[], column: KanbanColumn) =>
    block(rows, column).flatMap(row =>
      row.kind === 'skeleton' ? [row.percent] : [],
    )

  expect(draw()).toEqual(draw())
  expect(percents(draw(), 'backlog')).toEqual([60, 40, 75])
  expect(percents(draw(), 'human')).toEqual([40, 75, 60])
  expect(percents(draw(), 'claude')).toEqual([75, 60, 40])
})

test('a pane of two-row sections shows two bars, and a loaded board no bars at all', () => {
  const short = layoutBoard({
    cards: [],
    ui: INITIAL_UI,
    bodyRows: 10,
    isLoading: true,
  })
  const loaded = layoutBoard({
    cards: [cardOf(1, 'backlog')],
    ui: INITIAL_UI,
    bodyRows: 30,
  })

  expect(
    block(short, 'human').filter(row => row.kind === 'skeleton'),
  ).toHaveLength(2)
  expect(loaded.some(row => row.kind === 'skeleton')).toBe(false)
  expect(footRows([], true, true)).toBe(0)
  expect(footRows([], true, false)).toBe(3)
})

test('an empty section says so and leaves plain filler, a section with cards marks its spare room', () => {
  const rows = layoutBoard({
    cards: [cardOf(1, 'human')],
    ui: INITIAL_UI,
    bodyRows: 30,
  })
  const spare = (column: KanbanColumn) =>
    block(rows, column).filter(row => row.kind === 'blank')

  expect(spare('human')).toHaveLength(6)
  expect(spare('human').some(row => row.kind === 'blank' && row.isPlain)).toBe(
    false,
  )
  expect(spare('claude')).toHaveLength(6)
  expect(
    spare('claude').every(row => row.kind === 'blank' && row.isPlain),
  ).toBe(true)
})

test('the legend is left out of a board with no card to act on', () => {
  const empty = layoutBoard({
    cards: [],
    ui: INITIAL_UI,
    bodyRows: 30,
    legend: true,
  })
  const full = layoutBoard({
    cards: [cardOf(1, 'human')],
    ui: INITIAL_UI,
    bodyRows: 30,
    legend: true,
  })

  expect(empty.some(row => row.kind === 'legend')).toBe(false)
  expect(full.some(row => row.kind === 'legend')).toBe(true)
})

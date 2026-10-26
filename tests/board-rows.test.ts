import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import type { RowView, Seg } from '../hooks/board-client'
import { parseBoardMessage, toRowViews } from '../hooks/board-rows'
import type { RowViewInput } from '../hooks/board-rows'
import { layoutBoard } from '../hooks/layout'
import { COLUMNS, INITIAL_UI, cellWidth } from '../hooks/model'

const WIDTHS = [24, 30, 44, 80] as const

function cardOf(
  number: number,
  column: KanbanColumn,
  title = `Card ${number}`,
): KanbanCard {
  return {
    id: `md:${number}`,
    number,
    title,
    column,
    order: number,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
  }
}

// Every section holds a card; one title is wide characters, one is long.
const CARDS = [
  cardOf(1, 'backlog', 'Write the docs for the whole of the plugin and more'),
  cardOf(2, 'human', '日本語のとても長いタイトルを持つカードです'),
  cardOf(3, 'claude'),
  cardOf(4, 'done'),
  cardOf(5, 'cancelled'),
  cardOf(6, 'suspended'),
]

const input = (
  rows: RowViewInput['rows'],
  columns: number,
  extra: Partial<RowViewInput> = {},
): RowViewInput => ({
  rows,
  columns,
  isFiltered: false,
  glyphOf: () => undefined,
  ageOf: () => '2h',
  detailOf: () => [],
  queue: { limit: 1, running: 1, waiting: ['md:99'] },
  ...extra,
})

const rowsOf = (
  columns: number,
  ui: KanbanUi,
  extra: Partial<RowViewInput> = {},
) =>
  toRowViews(
    input(
      layoutBoard({ cards: CARDS, ui, bodyRows: 30, legend: true }),
      columns,
      extra,
    ),
  )

const textOf = (segs: readonly Seg[]) => segs.map(one => one.text).join('')

const open = (openGroup: KanbanUi['openGroup']): KanbanUi => ({
  ...INITIAL_UI,
  openGroup,
})

test('every row, whole or in its carry and chip forms, fits the pane at 24, 30, 44 and 80 columns', () => {
  for (const columns of WIDTHS) {
    for (const openGroup of ['active', 'inactive', 'none'] as const) {
      for (const view of rowsOf(columns, open(openGroup))) {
        expect(view.width).toBe(cellWidth(textOf(view.segs)))
        expect(view.width).toBeLessThanOrEqual(columns)
        if (view.kind === 'group' || view.kind === 'header') {
          expect(cellWidth(textOf(view.carrySegs))).toBeLessThanOrEqual(columns)
        }
        if (view.kind === 'group') {
          expect(cellWidth(textOf(view.chipSegs))).toBeLessThanOrEqual(columns)
        }
      }
    }
  }
})

test('a section header is its label and count, a rule to the edge and the meta flush right', () => {
  const views = rowsOf(44, open('active'))
  const header = (column: string) =>
    views.find(view => view.kind === 'header' && view.column === column)

  expect(textOf(header('backlog')?.segs ?? [])).toBe(
    `  Backlog 1 ${'─'.repeat(32)}`,
  )
  expect(header('human')?.width).toBe(44)
  // Claude's limit, who waits for a slot: the same width, the rule shorter.
  expect(textOf(header('claude')?.segs ?? [])).toMatch(
    /^ {2}Claude 1 ─+ limit 1 · 1 queued$/,
  )
})

test("Claude's meta is written short in a narrow pane, and gives way to the bare rule in the narrowest", () => {
  const meta = (columns: number) =>
    textOf(
      rowsOf(columns, open('active')).find(
        view => view.kind === 'header' && view.column === 'claude',
      )?.segs ?? [],
    )

  expect(meta(44)).toContain('limit 1 · 1 queued')
  expect(meta(30)).toMatch(/ lim 1 · 1q$/)
  expect(meta(24)).toMatch(/^ {2}Claude 1 ─+$|lim 1 · 1q$/)
  for (const columns of WIDTHS) {
    expect(cellWidth(meta(columns))).toBeLessThanOrEqual(columns)
  }
})

test('a header says nothing of the queue with no limit, and Done and Cancelled say they list their newest ten only once past it', () => {
  const free = rowsOf(44, open('inactive'), {
    queue: { limit: 0, running: 0, waiting: [] },
  })
  const header = (column: string) =>
    textOf(
      free.find(view => view.kind === 'header' && view.column === column)
        ?.segs ?? [],
    )

  expect(header('done')).not.toContain('newest')
  expect(header('suspended')).not.toContain('newest')

  const crowded = [
    ...CARDS,
    ...Array.from({ length: 11 }, (_, i) => cardOf(20 + i, 'done')),
  ]
  const views = toRowViews(
    input(
      layoutBoard({ cards: crowded, ui: open('inactive'), bodyRows: 30 }),
      44,
    ),
  )
  const done = views.find(
    view => view.kind === 'header' && view.column === 'done',
  )

  expect(textOf(done?.segs ?? [])).toMatch(/Done 12 ─+ 10 newest$/)
})

test('a closed group draws its three sections as chips, side by side, each over its own cells', () => {
  for (const columns of WIDTHS) {
    const group = rowsOf(columns, open('active')).find(
      (view): view is Extract<RowView, { kind: 'group' }> =>
        view.kind === 'group' && view.group === 'inactive',
    )
    const chips = group?.chips ?? []

    expect(chips.map(one => one.column)).toEqual([
      'done',
      'cancelled',
      'suspended',
    ])
    let edge = chips[0]?.from ?? 0
    for (const chip of chips) {
      // Each chip begins where the one before ends, and its Seg is as wide as its cells.
      expect(chip.from).toBe(edge)
      expect(chip.to).toBeGreaterThan(chip.from)
      expect(cellWidth(group?.chipSegs[chip.seg]?.text ?? '')).toBe(
        chip.to - chip.from,
      )
      edge = chip.to
    }
    expect(edge).toBeLessThanOrEqual(columns)
  }
})

test('at 44 columns the chips sit after the group name: Done 10-16, Cancelled 16-27, Suspended 27-38', () => {
  const group = rowsOf(44, open('active')).find(
    (view): view is Extract<RowView, { kind: 'group' }> =>
      view.kind === 'group' && view.group === 'inactive',
  )

  expect(group?.chips.map(one => [one.column, one.from, one.to])).toEqual([
    ['done', 10, 16],
    ['cancelled', 16, 27],
    ['suspended', 27, 38],
  ])
  expect(textOf(group?.chipSegs ?? []).trimEnd()).toBe(
    '▸ Inactive Done  Cancelled  Suspended',
  )
})

test('an open group has no chips, and its carry form is its label', () => {
  const group = rowsOf(44, open('active')).find(
    (view): view is Extract<RowView, { kind: 'group' }> =>
      view.kind === 'group' && view.group === 'active',
  )

  expect(group?.chips).toEqual([])
  expect(textOf(group?.carrySegs ?? [])).toBe('▾ Active')
})

test('a closed group carries the keys of its sections, and a section header the keys that send a card there', () => {
  const views = rowsOf(44, open('active'))
  const inactive = views.find(
    (view): view is Extract<RowView, { kind: 'group' }> =>
      view.kind === 'group' && view.group === 'inactive',
  )
  const human = views.find(
    (view): view is Extract<RowView, { kind: 'header' }> =>
      view.kind === 'header' && view.column === 'human',
  )

  expect(inactive?.sections).toEqual([
    { column: 'done', moveKeys: ['4', 'd'] },
    { column: 'cancelled', moveKeys: ['5', 'x'] },
    { column: 'suspended', moveKeys: ['6', 's'] },
  ])
  expect(textOf(inactive?.carrySegs ?? [])).toContain('4/d 5/x 6/s')
  expect(human?.moveKeys).toEqual(['2', 'h'])
  expect(textOf(human?.carrySegs ?? [])).toMatch(/Human 1 ─+ 2\/h$/)
  // The move keys follow the order of the columns.
  expect(COLUMNS.map((_, index) => String(index + 1))).toEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ])
})

test('a closed group summarises its sections, whole then cut to initials, then to a total', () => {
  const summary = (columns: number, openGroup: KanbanUi['openGroup']) =>
    textOf(
      rowsOf(columns, open(openGroup)).find(
        (view): view is Extract<RowView, { kind: 'group' }> =>
          view.kind === 'group' && view.group === 'active' && !view.isOpen,
      )?.segs ?? [],
    )

  expect(summary(44, 'inactive')).toMatch(
    /^▸ Active +1 Backlog · 1 Human · 1 Claude$/,
  )
  expect(summary(30, 'inactive')).toMatch(/^▸ Active +1B 1H 1C$/)
  expect(summary(24, 'inactive')).toMatch(/^▸ Active +(1B 1H 1C|3)$/)
})

test('a closed group with nothing in it says empty, and under a filter how many cards match', () => {
  const none = toRowViews(
    input(layoutBoard({ cards: [], ui: open('active'), bodyRows: 30 }), 44),
  )
  const inactive = (views: RowView[]) =>
    textOf(
      views.find(view => view.kind === 'group' && view.group === 'inactive')
        ?.segs ?? [],
    )

  expect(inactive(none)).toMatch(/^▸ Inactive +empty$/)

  const filtered = (filter: string) =>
    toRowViews(
      input(
        layoutBoard({
          cards: CARDS,
          ui: { ...open('active'), filter },
          bodyRows: 30,
        }),
        44,
        { isFiltered: true },
      ),
    )
  expect(inactive(filtered('zzz'))).toMatch(/^▸ Inactive +no matches$/)
  expect(inactive(filtered('#3 #4'))).toMatch(/^▸ Inactive +1 match$/)
  expect(inactive(filtered('card'))).toMatch(/^▸ Inactive +3 matches$/)
})

test('both groups folded add the line that says to press one, left out of a pane too narrow for it', () => {
  const folded = (columns: number) =>
    rowsOf(columns, open('none')).filter(view => view.key === 'folded')

  expect(folded(44)).toHaveLength(1)
  expect(textOf(folded(44)[0]?.segs ?? [])).toBe('  Press a group to open it')
  expect(folded(24)).toHaveLength(0)
})

test('the blank filler is a space on one row, and the legend keeps to the pane', () => {
  for (const columns of WIDTHS) {
    const views = rowsOf(columns, open('active'))
    const blanks = views.filter(view => view.key.startsWith('blank:'))
    const legend = views.find(view => view.key === 'legend')

    expect(blanks.every(view => textOf(view.segs) === ' ')).toBe(true)
    if (legend !== undefined) {
      expect(legend.width).toBeLessThanOrEqual(columns)
      expect(textOf(legend.segs)).toContain(columns < 40 ? 'm move' : 'reorder')
    }
  }
})

test('a message from the Client is taken only whole: a group of the two, a column of the six, a place that exists', () => {
  expect(parseBoardMessage({ type: 'toggleGroup', group: 'inactive' })).toEqual(
    {
      type: 'toggleGroup',
      group: 'inactive',
    },
  )
  expect(
    parseBoardMessage({ type: 'toggleGroup', group: 'done' }),
  ).toBeUndefined()
  expect(parseBoardMessage({ type: 'toggleGroup' })).toBeUndefined()

  for (const column of COLUMNS) {
    expect(parseBoardMessage({ type: 'drop', cardId: 'md:1', column })).toEqual(
      {
        type: 'drop',
        cardId: 'md:1',
        column,
      },
    )
    expect(parseBoardMessage({ type: 'page', column, dir: 'down' })).toEqual({
      type: 'page',
      column,
      dir: 'down',
    })
  }
  expect(
    parseBoardMessage({ type: 'drop', cardId: 'md:1', column: 'later' }),
  ).toBeUndefined()
  expect(
    parseBoardMessage({
      type: 'drop',
      cardId: 'md:1',
      column: 'suspended',
      place: { at: 'after', cardId: 'md:2' },
    }),
  ).toEqual({
    type: 'drop',
    cardId: 'md:1',
    column: 'suspended',
    place: { at: 'after', cardId: 'md:2' },
  })
  expect(
    parseBoardMessage({
      type: 'drop',
      cardId: 'md:1',
      column: 'suspended',
      place: { at: 'middle' },
    }),
  ).toBeUndefined()
  expect(
    parseBoardMessage({ type: 'page', column: 'done', dir: 'left' }),
  ).toBeUndefined()
  expect(parseBoardMessage('open')).toBeUndefined()
})

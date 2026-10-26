import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import { filterCards, isFiltering, matchesFilter } from '../hooks/filter'
import { applyFilter, layoutBoard, sectionList } from '../hooks/layout'
import type { Row } from '../hooks/layout'
import { INITIAL_UI } from '../hooks/model'

function cardOf(
  number: number,
  column: KanbanColumn,
  title: string,
  labels?: string[],
): KanbanCard {
  return {
    id: `md:${number}`,
    number,
    title,
    column,
    order: number,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: `2026-10-25T10:${String(number % 60).padStart(2, '0')}:00Z`,
    ...(labels === undefined ? {} : { labels }),
  }
}

const CARDS = [
  cardOf(12, 'backlog', '[KANB-UIX] Filter and search the board', [
    'ai',
    'feature',
  ]),
  cardOf(13, 'claude', '[KANB-API] Retry the move', ['AI', 'bug']),
  cardOf(14, 'human', '[OTHR-UIX] Tidy the Filter docs', ['human']),
  cardOf(15, 'backlog', 'Plain card with no prefix'),
  cardOf(16, 'done', '[kanb-uix] Old filter work', ['good first issue']),
]

// The same, and a card in each of the other two sections of the Inactive group.
const ALL = [
  ...CARDS,
  cardOf(17, 'suspended', 'Parked filter idea'),
  cardOf(18, 'cancelled', 'Dropped filter idea'),
]
const numbersAll = (query: string) =>
  ALL.filter(one => matchesFilter(one, query)).map(one => one.number)

const numbers = (query: string) =>
  CARDS.filter(one => matchesFilter(one, query)).map(one => one.number)

test('a blank query lets every card through', () => {
  expect(isFiltering('')).toBe(false)
  expect(isFiltering('   ')).toBe(false)
  expect(isFiltering(' a ')).toBe(true)
  expect(numbers('')).toEqual([12, 13, 14, 15, 16])
  expect(numbers('  ')).toEqual([12, 13, 14, 15, 16])
  expect(filterCards(CARDS, '')).toBe(CARDS)
})

test('plain words match the title, all of them, without regard to case or order', () => {
  expect(numbers('filter')).toEqual([12, 14, 16])
  expect(numbers('FILTER docs')).toEqual([14])
  expect(numbers('docs filter')).toEqual([14])
  expect(numbers('filter retry')).toEqual([])
  expect(numbers('prefix')).toEqual([15])
  // The words are in the title, not the labels or the number.
  expect(numbers('feature')).toEqual([])
  expect(numbers('12')).toEqual([])
})

test('a phrase in quotes is one word, and a quote still open counts', () => {
  expect(numbers('"the board"')).toEqual([12])
  expect(numbers('"board the"')).toEqual([])
  expect(numbers('the board')).toEqual([12])
  expect(numbers('"search the')).toEqual([12])
  expect(numbers('"tidy the" docs')).toEqual([14])
})

test('#12 matches the card number, and several numbers are alternatives', () => {
  expect(numbers('#12')).toEqual([12])
  expect(numbers('#1')).toEqual([])
  expect(numbers('#12 #15')).toEqual([12, 15])
  expect(numbers('#12 filter')).toEqual([12])
  expect(numbers('#12 docs')).toEqual([])
  // Not a number yet: a word like any other.
  expect(numbers('#')).toEqual([])
  expect(numbers('#12x')).toEqual([])
})

test('label:ai needs the label and -label:human refuses it, without regard to case', () => {
  expect(numbers('label:ai')).toEqual([12, 13])
  expect(numbers('label:AI')).toEqual([12, 13])
  expect(numbers('label:a')).toEqual([])
  expect(numbers('-label:ai')).toEqual([14, 15, 16])
  expect(numbers('-label:human')).toEqual([12, 13, 15, 16])
  expect(numbers('label:ai -label:bug')).toEqual([12])
  // Labels all have to hold, as GitHub's search has it.
  expect(numbers('label:ai label:feature')).toEqual([12])
  expect(numbers('label:feature label:bug')).toEqual([])
  expect(numbers('label:ai filter')).toEqual([12])
})

test('a label with spaces is named in quotes, and a card with no labels has none', () => {
  expect(numbers('label:"good first issue"')).toEqual([16])
  // A label is named whole, as on GitHub, even while its quote is still open.
  expect(numbers('label:"good first issue')).toEqual([16])
  expect(numbers('label:"good first')).toEqual([])
  expect(numbers('-label:"good first issue"')).toEqual([12, 13, 14, 15])
  expect(numbers('label:ai')).not.toContain(15)
  expect(numbers('-label:ai')).toContain(15)
})

test('a key with nothing after it yet asks nothing', () => {
  expect(numbers('label:')).toEqual([12, 13, 14, 15, 16])
  expect(numbers('-label:')).toEqual([12, 13, 14, 15, 16])
  expect(numbers('area:')).toEqual([12, 13, 14, 15, 16])
  expect(numbers('label: filter')).toEqual([12, 14, 16])
})

test('[PRJ-AREA] matches the whole prefix of the title, or just its project', () => {
  expect(numbers('[KANB-UIX]')).toEqual([12, 16])
  expect(numbers('[kanb-uix]')).toEqual([12, 16])
  expect(numbers('[KANB]')).toEqual([12, 13, 16])
  expect(numbers('[KANB-API]')).toEqual([13])
  expect(numbers('[KANB-UI]')).toEqual([])
  expect(numbers('[KAN]')).toEqual([])
  expect(numbers('[KANB-UIX] [KANB-API]')).toEqual([12, 13, 16])
  expect(numbers('[KANB-UIX] retry')).toEqual([])
  // A prefix is read at the start of the title only, and not before it is closed.
  expect(numbers('[KANB-UIX')).toEqual([12, 16])
  const mid = cardOf(99, 'backlog', 'Fix [KANB-UIX] later')
  expect(matchesFilter(mid, '[KANB-UIX]')).toBe(false)
  expect(matchesFilter(mid, 'fix later')).toBe(true)
})

test('area:UIX matches the area of the prefix whatever the project', () => {
  expect(numbers('area:UIX')).toEqual([12, 14, 16])
  expect(numbers('area:api')).toEqual([13])
  expect(numbers('area:UI')).toEqual([])
  expect(numbers('area:uix area:api')).toEqual([12, 13, 14, 16])
  expect(numbers('area:uix docs')).toEqual([14])
  expect(numbers('area:uix -label:human')).toEqual([12, 16])
})

test('@claude limits the sections, and several are alternatives', () => {
  expect(numbers('@claude')).toEqual([13])
  expect(numbers('@HUMAN')).toEqual([14])
  expect(numbers('@backlog')).toEqual([12, 15])
  expect(numbers('@done')).toEqual([16])
  expect(numbers('@claude @human')).toEqual([13, 14])
  expect(numbersAll('@suspended')).toEqual([17])
  expect(numbersAll('@cancelled')).toEqual([18])
  // Either spelling of cancelled, in any case.
  expect(numbersAll('@canceled')).toEqual([18])
  expect(numbersAll('@Cancelled')).toEqual([18])
  expect(numbersAll('@done @suspended')).toEqual([16, 17])
  expect(numbers('@backlog filter')).toEqual([12])
  expect(numbers('@backlog label:ai #12')).toEqual([12])
  // Not a section: a word like any other.
  expect(numbers('@everyone')).toEqual([])
  expect(numbers('@')).toEqual([])
})

test('@active and @inactive name the three sections of a group, as alternatives', () => {
  expect(numbersAll('@active')).toEqual([12, 13, 14, 15])
  expect(numbersAll('@inactive')).toEqual([16, 17, 18])
  expect(numbersAll('@ACTIVE @cancelled')).toEqual([12, 13, 14, 15, 18])
  expect(numbersAll('@inactive filter')).toEqual([16, 17, 18])
  expect(numbersAll('@inactive label:human')).toEqual([])
  expect(numbersAll('@active label:human')).toEqual([14])
})

test('filterCards keeps the cards the query asks for, in their order', () => {
  expect(filterCards(CARDS, 'filter').map(one => one.number)).toEqual([
    12, 14, 16,
  ])
  expect(filterCards([], 'filter')).toEqual([])
})

const kinds = (rows: Row[]) =>
  rows.map(row => ('column' in row ? `${row.kind}:${row.column}` : row.kind))

// The rows that are not filler or the slack at the bottom.
const content = (rows: Row[]) =>
  kinds(rows).filter(kind => !kind.startsWith('blank'))

const open = (extra: Partial<KanbanUi> = {}): KanbanUi => ({
  ...INITIAL_UI,
  ...extra,
})

const many = (column: KanbanColumn, n: number, title: string, from = 1) =>
  Array.from({ length: n }, (_, i) => cardOf(from + i, column, `${title} ${i}`))

test('a blank filter changes nothing about the layout', () => {
  const ui = open()
  const cards = [
    ...many('backlog', 8, 'Backlog'),
    ...many('done', 3, 'Done', 20),
  ]

  expect(applyFilter(cards, ui)).toEqual({ cards, ui })
  expect(
    layoutBoard({ cards, ui: open({ filter: '  ' }), bodyRows: 30 }),
  ).toEqual(layoutBoard({ cards, ui, bodyRows: 30 }))
})

test('headers count what the filter lets through out of all the section holds', () => {
  const cards = [
    ...many('backlog', 8, 'Backlog'),
    ...many('human', 2, 'Human', 20),
  ]
  const rows = layoutBoard({
    cards,
    ui: open({ filter: 'backlog 1' }),
    bodyRows: 30,
  })

  expect(rows.filter(row => row.kind === 'header')).toEqual([
    { kind: 'header', column: 'backlog', shown: 1, total: 8 },
    { kind: 'header', column: 'claude', shown: 0, total: 0 },
    { kind: 'header', column: 'human', shown: 0, total: 2 },
  ])
})

test('a section with no match is an empty row, and the empty-board note stays away', () => {
  const rows = layoutBoard({
    cards: many('backlog', 3, 'Backlog'),
    ui: open({ filter: 'nothing like it' }),
    bodyRows: 30,
  })

  expect(content(rows)).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'header:backlog',
    'empty:backlog',
    'header:claude',
    'empty:claude',
    'header:human',
    'empty:human',
    'group',
  ])
})

test('a folded group with a match is drawn open, and the stored group stays', () => {
  const cards = [
    ...many('backlog', 2, 'Backlog'),
    ...many('done', 3, 'Done', 20),
  ]
  const ui = { ...INITIAL_UI, filter: 'done' }
  expect(ui.openGroup).toBe('active')

  const rows = layoutBoard({ cards, ui, bodyRows: 30 })
  expect(content(rows).slice(0, 7)).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'group',
    'header:done',
    'card:done',
    'card:done',
  ])
  expect(rows[2]).toMatchObject({ group: 'active', isOpen: false })
  expect(rows[3]).toMatchObject({ group: 'inactive', isOpen: true })
  expect(
    rows.find(row => row.kind === 'header' && row.column === 'done'),
  ).toEqual({ kind: 'header', column: 'done', shown: 3, total: 3 })
  expect(applyFilter(cards, ui).ui.openGroup).toBe('inactive')
  expect(ui.openGroup).toBe('active')

  // A match in the open group leaves it open; with no match anywhere the stored group stays.
  expect(applyFilter(cards, { ...ui, filter: 'backlog' }).ui.openGroup).toBe(
    'active',
  )
  expect(
    applyFilter(cards, { ...ui, filter: 'zzz', openGroup: 'inactive' }).ui
      .openGroup,
  ).toBe('inactive')
})

// A group pressed under a filter keeps its own answer, apart from the stored group.
test('a group press under a filter overrides what the board shows, never the stored group', () => {
  const cards = [
    ...many('backlog', 2, 'Backlog'),
    ...many('done', 3, 'Done', 20),
  ]
  // The filter opens Inactive; the person chose Active.
  const ui = { ...INITIAL_UI, filter: 'done', filterGroup: 'active' as const }

  const shown = applyFilter(cards, ui).ui
  expect(shown.openGroup).toBe('active')
  expect(ui.openGroup).toBe('active')
  expect(content(layoutBoard({ cards, ui, bodyRows: 30 })).slice(2, 5)).toEqual(
    ['group', 'header:backlog', 'empty:backlog'],
  )

  // A press that folded both under the filter.
  expect(applyFilter(cards, { ...ui, filterGroup: 'none' }).ui.openGroup).toBe(
    'none',
  )
  expect(
    kinds(
      layoutBoard({
        cards,
        ui: { ...ui, filterGroup: 'none' },
        bodyRows: 30,
      }),
    ),
  ).toEqual(['toolbar', 'toolbar', 'group', 'group', 'folded'])

  // With no filter the override means nothing.
  const plain = { ...INITIAL_UI, filterGroup: 'inactive' as const }
  expect(applyFilter(cards, plain)).toEqual({ cards, ui: plain })
})

test('the closed group says how many cards match', () => {
  const cards = [
    ...many('backlog', 2, 'Backlog'),
    ...many('done', 3, 'Done', 20),
  ]
  const rows = layoutBoard({
    cards,
    ui: { ...INITIAL_UI, filter: 'done' },
    bodyRows: 30,
  })

  expect(rows[2]).toMatchObject({
    kind: 'group',
    group: 'active',
    counts: [
      { column: 'backlog', shown: 0, total: 2 },
      { column: 'claude', shown: 0, total: 0 },
      { column: 'human', shown: 0, total: 0 },
    ],
  })
})

test('an opened group gives each section the same share of the rows', () => {
  const cards = many('done', 7, 'Done')
  const ui = { ...INITIAL_UI, filter: 'done' }

  const rows = layoutBoard({ cards, ui, bodyRows: 30 })
  expect(rows.filter(row => row.kind === 'card')).toHaveLength(7)
  expect(rows).toHaveLength(30)
})

test('Done lists its ten newest of the cards that match, not of all of them', () => {
  // Twelve about docs, older than the twenty-eight chores.
  const cards = [...many('done', 12, 'Docs'), ...many('done', 28, 'Chore', 20)]
  const ui = open({ filter: 'docs' })

  const list = sectionList(applyFilter(cards, ui).cards, 'done')
  expect(list.map(one => one.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  expect(
    layoutBoard({ cards, ui, bodyRows: 30 }).find(
      row => row.kind === 'header' && row.column === 'done',
    ),
  ).toEqual({ kind: 'header', column: 'done', shown: 12, total: 40 })
})

test('the window clamps to the cards that match', () => {
  const cards = many('backlog', 8, 'Backlog')
  const ui = open({
    filter: 'backlog 1',
    offsets: { ...INITIAL_UI.offsets, backlog: 6 },
  })

  const rows = layoutBoard({ cards, ui, bodyRows: 30 })
  expect(
    rows.filter(
      row =>
        'column' in row && row.column === 'backlog' && row.kind !== 'blank',
    ),
  ).toMatchObject([{ kind: 'header' }, { kind: 'card' }])
})

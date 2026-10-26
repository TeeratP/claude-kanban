import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanTag, KanbanUi } from '../types'
import type { RowView, Seg } from '../hooks/board-client'
import { parseBoardMessage, toRowViews } from '../hooks/board-rows'
import type { RowViewInput } from '../hooks/board-rows'
import { layoutBoard } from '../hooks/layout'
import type { Row } from '../hooks/layout'
import { COLUMNS, INITIAL_UI, cellWidth } from '../hooks/model'

const WIDTHS = [24, 30, 44, 80] as const

function cardOf(
  number: number,
  column: KanbanColumn,
  title = `Card ${number}`,
  tag?: KanbanTag,
): KanbanCard {
  return {
    id: `md:${number}`,
    number,
    title,
    column,
    order: number,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    ...(tag === undefined ? {} : { tag }),
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
  cards: CARDS,
  canDrag: true,
  canType: true,
  isGithub: false,
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
  expect(human?.moveKeys).toEqual(['3', 'h'])
  expect(textOf(human?.carrySegs ?? [])).toMatch(/Human 1 ─+ 3\/h$/)
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
    /^▸ Active +1 Backlog · 1 Claude · 1 Human$/,
  )
  expect(summary(30, 'inactive')).toMatch(/^▸ Active +1B 1C 1H$/)
  expect(summary(24, 'inactive')).toMatch(/^▸ Active +(1B 1C 1H|3)$/)
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

test('spare room in a section is a quiet dot under the numbers, the leftover rows are spaces, and the legend keeps to the pane', () => {
  for (const columns of WIDTHS) {
    const views = rowsOf(columns, open('active'))
    const slack = views.filter(view => view.key.startsWith('blank:slack'))
    const spare = views.filter(view => /^blank:(?!slack)[a-z]+:/.test(view.key))
    const legend = views.find(view => view.key === 'legend')

    expect(spare.length).toBeGreaterThan(0)
    expect(slack.every(view => textOf(view.segs) === ' ')).toBe(true)
    for (const view of spare) {
      // The dot sits in the last cell of the number column (here `#6`, two cells), one before the title column.
      expect(textOf(view.segs)).toBe(`${' '.repeat(3)}·`)
      expect(view.segs[1]).toMatchObject({ dim: true, color: 'subtle' })
    }
    if (legend !== undefined) {
      expect(legend.width).toBeLessThanOrEqual(columns)
      expect(textOf(legend.segs)).toContain(columns < 40 ? 'm move' : 'reorder')
    }
  }
})

test('an empty section and the filler of the first load stay plain', () => {
  const views = toRowViews(
    input(layoutBoard({ cards: [], ui: open('active'), bodyRows: 30 }), 44),
  )
  const loading = toRowViews(
    input(
      layoutBoard({
        cards: [],
        ui: open('active'),
        bodyRows: 30,
        isLoading: true,
      }),
      44,
    ),
  )

  for (const list of [views, loading]) {
    const spare = list.filter(view => /^blank:[a-z]+:/.test(view.key))
    expect(spare.length).toBeGreaterThan(0)
    expect(spare.every(view => textOf(view.segs) === ' ')).toBe(true)
  }
})

// A single card row, as the Client draws it.
const cardRow = (
  one: KanbanCard,
  columns = 44,
  extra: Partial<RowViewInput> = {},
) =>
  toRowViews(
    input([{ kind: 'card', column: one.column, card: one }], columns, {
      cards: [one],
      ...extra,
    }),
  )[0]
const piece = (view: RowView | undefined, text: string) =>
  view?.segs.find(one => one.text === text)

test('a card row is its number right-aligned, its title and its age flush right, each in its own style', () => {
  const one = cardOf(12, 'human', 'Fix the login')
  const view = cardRow(one, 44, { ageOf: () => '12m' })

  expect(textOf(view?.segs ?? [])).toBe(
    `  #12 Fix the login${' '.repeat(44 - 2 - 3 - 1 - 13 - 3)}12m`,
  )
  expect(view?.width).toBe(44)
  expect(piece(view, '#12')).toMatchObject({ dim: true })
  expect(piece(view, 'Fix the login')).toMatchObject({ dim: false, color: '' })
  expect(piece(view, '12m')).toMatchObject({ dim: true })
})

test('Done is dim from end to end, Cancelled is dim with a struck title, Suspended has a dim title and a plain number', () => {
  const done = cardRow(cardOf(5, 'done', 'Shipped'))
  const cancelled = cardRow(cardOf(5, 'cancelled', 'Dropped'))
  const suspended = cardRow(cardOf(5, 'suspended', 'On hold'))

  expect(piece(done, '#5')).toMatchObject({ dim: true })
  expect(piece(done, 'Shipped')).toMatchObject({ dim: true })
  expect(piece(done, 'Shipped')?.strike).toBeUndefined()
  expect(piece(cancelled, '#5')).toMatchObject({ dim: true })
  expect(piece(cancelled, 'Dropped')).toMatchObject({ dim: true, strike: true })
  expect(piece(suspended, '#5')).toMatchObject({ dim: false })
  expect(piece(suspended, 'On hold')).toMatchObject({ dim: true })
  expect(piece(suspended, 'On hold')?.strike).toBeUndefined()
})

test('a question shows ? and its number in the colour for what needs you, and the tags rev and hum are gone', () => {
  const question = cardRow(cardOf(23, 'human', 'Which provider?', 'question'))
  const review = cardRow(cardOf(23, 'human', 'Needs a look', 'review'))

  expect(textOf(question?.segs ?? [])).toMatch(/^ {2}\?23 Which provider\?/)
  expect(piece(question, '?23')).toMatchObject({
    bold: true,
    color: 'permission',
  })
  expect(textOf(review?.segs ?? [])).toMatch(/^ {2}#23 Needs a look/)
  expect(textOf(review?.segs ?? [])).not.toMatch(/rev|hum/)
})

test('a card not yet made says new in the number column, and gives no age', () => {
  const pending = { ...cardOf(0, 'backlog', 'Write the README'), id: 'new:1' }
  const view = cardRow(pending, 44, { ageOf: () => 'now' })

  expect(textOf(view?.segs ?? [])).toMatch(/^ {2}new Write the README\s*$/)
  expect(piece(view, 'new')).toMatchObject({ dim: true })
})

test('a sync mark takes the cell before the age, keeps its colour, and a failed move turns the number red', () => {
  const one = cardOf(5, 'claude', 'In flight')
  const mark = (text: string, color: string, dim = false) => ({
    text,
    color,
    dim,
  })
  const syncing = cardRow(one, 44, {
    ageOf: () => '10d',
    glyphOf: () => mark('⟳', 'warning', true),
  })
  const failed = cardRow(one, 44, {
    ageOf: () => '10d',
    glyphOf: () => mark('✕', 'error'),
  })

  expect(textOf(syncing?.segs ?? [])).toMatch(/In flight +⟳ 10d$/)
  expect(piece(syncing, '⟳')).toMatchObject({ color: 'warning', dim: true })
  expect(piece(syncing, '#5')).toMatchObject({ dim: true })
  expect(piece(failed, '✕')).toMatchObject({ color: 'error', dim: false })
  expect(piece(failed, '#5')).toMatchObject({ color: 'error' })
  expect(piece(failed, '#5')?.dim).toBe(false)
})

test('a queued card is dim all through and says its place where the age goes, short in a narrow pane', () => {
  const one = cardOf(5, 'claude', 'Waiting its turn')
  const queued = { limit: 1, running: 1, waiting: [one.id] }
  const wide = cardRow(one, 44, { queue: queued })
  const narrow = cardRow(one, 30, { queue: queued })

  expect(textOf(wide?.segs ?? [])).toMatch(/Waiting its turn +queued 1$/)
  expect(textOf(narrow?.segs ?? [])).toMatch(/ +q1$/)
  expect(piece(wide, 'Waiting its turn')).toMatchObject({ dim: true })
  expect(piece(wide, '#5')).toMatchObject({ dim: true })
})

test('a more row, an empty line and a bar start at the title column', () => {
  const board = [cardOf(7, 'backlog'), cardOf(111, 'backlog')]
  const rows = (row: Row) => toRowViews(input([row], 44, { cards: board }))[0]
  const lead = (text: string) => text.length - text.trimStart().length

  expect(
    lead(
      textOf(
        rows({ kind: 'more', column: 'backlog', dir: 'down', n: 3 })?.segs ??
          [],
      ),
    ),
  ).toBe(7)
  expect(
    lead(textOf(rows({ kind: 'empty', column: 'backlog' })?.segs ?? [])),
  ).toBe(7)
  expect(
    lead(
      textOf(
        rows({ kind: 'skeleton', column: 'backlog', index: 0, percent: 60 })
          ?.segs ?? [],
      ),
    ),
  ).toBe(7)
  // And as far in as the numbers are wide: here only `#7`.
  const narrow = toRowViews(
    input([{ kind: 'empty', column: 'backlog' }], 44, {
      cards: [cardOf(7, 'backlog')],
    }),
  )[0]
  expect(lead(textOf(narrow?.segs ?? []))).toBe(5)
})

test('every section says what it is for when it is empty, in a short form where the long one does not fit', () => {
  const empty = (
    column: KanbanColumn,
    columns: number,
    extra: Partial<RowViewInput> = {},
  ) =>
    textOf(
      toRowViews(
        input([{ kind: 'empty', column }], columns, { cards: [], ...extra }),
      )[0]?.segs ?? [],
    ).trim()

  expect(empty('human', 44)).toBe('✓ All clear, nothing needs you')
  expect(empty('human', 24)).toBe('✓ All clear')
  expect(empty('claude', 44)).toBe('Idle · drag a card here')
  expect(empty('claude', 44, { canDrag: false })).toBe(
    'Idle · open a card to move it',
  )
  expect(empty('claude', 24)).toBe('Idle')
  expect(empty('backlog', 44)).toBe('Nothing yet · n adds a card')
  expect(empty('backlog', 44, { canType: false })).toBe('Nothing parked')
  expect(empty('backlog', 24)).toBe('n adds a card')
  expect(empty('done', 44)).toBe('Nothing finished yet')
  expect(empty('done', 24)).toBe('None yet')
  expect(empty('suspended', 44)).toBe('Nothing on hold')
  expect(empty('suspended', 24)).toBe('Nothing on hold')
  expect(empty('suspended', 20)).toBe('None')
  expect(empty('cancelled', 44)).toBe('Nothing dropped')
  expect(empty('cancelled', 20)).toBe('None')
})

test('the tick of an all-clear Human is in the colour for success, the words dim, and a filter makes every section say no matches', () => {
  const [view] = toRowViews(
    input([{ kind: 'empty', column: 'human' }], 44, { cards: [] }),
  )

  expect(view?.segs.find(one => one.text.startsWith('✓'))).toMatchObject({
    color: 'success',
  })
  expect(view?.segs.at(-1)).toMatchObject({ dim: true })
  for (const column of COLUMNS) {
    const [shown] = toRowViews(
      input([{ kind: 'empty', column }], 44, { cards: [], isFiltered: true }),
    )

    expect(textOf(shown?.segs ?? []).trim()).toBe('No matches')
  }
})

test('the first load draws bars of the section header rule glyph, dim and subtle, at 60, 40 and 75 percent of the title room', () => {
  const bar = (percent: number) =>
    toRowViews(
      input([{ kind: 'skeleton', column: 'human', index: 0, percent }], 44, {
        cards: [],
      }),
    )[0]

  // 44 columns, the title column at 7, the age and its gap at the right: 32 cells of title room.
  expect(textOf(bar(60)?.segs ?? [])).toBe(`${' '.repeat(7)}${'─'.repeat(19)}`)
  expect(textOf(bar(40)?.segs ?? [])).toBe(`${' '.repeat(7)}${'─'.repeat(13)}`)
  expect(textOf(bar(75)?.segs ?? [])).toBe(`${' '.repeat(7)}${'─'.repeat(24)}`)
  expect(bar(60)?.segs.at(-1)).toMatchObject({ dim: true, color: 'subtle' })
})

test('while the first load runs the headers have no counts or meta, and the folded group no summary', () => {
  const views = toRowViews(
    input(
      layoutBoard({
        cards: [],
        ui: open('active'),
        bodyRows: 30,
        isLoading: true,
      }),
      44,
      { cards: [] },
    ),
  )
  const header = (column: string) =>
    textOf(
      views.find(view => view.kind === 'header' && view.column === column)
        ?.segs ?? [],
    )

  expect(header('human')).toBe(
    `  Human ${'─'.repeat(36)}`.slice(0, 44).replace(/─$/, '─'),
  )
  expect(header('claude')).not.toMatch(/limit|\d/)
  expect(
    textOf(views.find(view => view.key === 'grp:inactive')?.segs ?? []),
  ).toBe('▸ Inactive')
  expect(
    views.some(
      view =>
        ['note', 'legend'].includes(view.key) || view.key.startsWith('hint'),
    ),
  ).toBe(false)
})

test('the legend lists the cursor keys once a key has brought the cursor up, and each form fits the pane', () => {
  for (const columns of WIDTHS) {
    const legend = rowsOf(columns, open('active')).find(
      view => view.key === 'legend',
    )
    if (legend?.kind !== 'text') throw new Error('no legend')

    expect(textOf(legend.segs)).toMatch(/⏎ open · m move/)
    expect(textOf(legend.keyed ?? [])).toMatch(/↑↓/)
    expect(cellWidth(textOf(legend.segs))).toBeLessThanOrEqual(columns)
    expect(cellWidth(textOf(legend.keyed ?? []))).toBeLessThanOrEqual(columns)
  }
  const wide = rowsOf(44, open('active')).find(view => view.key === 'legend')
  expect(textOf(wide?.segs ?? [])).toBe('  ⏎ open · m move · ⇧J/K reorder')
  expect(textOf(wide?.kind === 'text' ? (wide.keyed ?? []) : [])).toBe(
    '  ↑↓ walk · ⏎ open · m+key move',
  )
})

test('an empty board explains itself in one form at 44 columns and a short one at 30, never cut mid-word', () => {
  const lines = (columns: number, extra: Partial<RowViewInput> = {}) =>
    toRowViews(
      input(
        layoutBoard({
          cards: [],
          ui: open('active'),
          bodyRows: 30,
          hint: true,
        }),
        columns,
        { cards: [], ...extra },
      ),
    )
      .filter(view => view.key === 'note' || view.key.startsWith('hint:'))
      .map(view => textOf(view.segs))

  expect(lines(44)).toEqual([
    '  Cards live in .kanban/*.md here.',
    '  On GitHub? Link a Project to the repo',
    '  or set backend: github to see why.',
  ])
  expect(lines(30)).toEqual([
    '  Cards live in .kanban/',
    '  GitHub? Link a Project',
    '  or set backend: github',
  ])
  for (const columns of WIDTHS) {
    for (const line of lines(columns)) {
      expect(cellWidth(line)).toBeLessThanOrEqual(columns)
      expect(line).not.toContain('…')
    }
  }
  expect(lines(44, { isGithub: true })[0]).toBe(
    '  No issues on this board yet.',
  )
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

import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanUi } from '../types'
import {
  capFor,
  cardLine,
  clampOffset,
  hitTest,
  layoutBoard,
  sectionList,
} from '../hooks/layout'
import type { Row } from '../hooks/layout'
import { INITIAL_UI, ageLabel, cellWidth, truncate } from '../hooks/model'

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

const open = (collapsed: Partial<KanbanUi['collapsed']> = {}): KanbanUi => ({
  ...INITIAL_UI,
  collapsed: {
    human: false,
    claude: false,
    backlog: false,
    done: false,
    ...collapsed,
  },
})

const kinds = (rows: Row[]) =>
  rows.map(row => ('column' in row ? `${row.kind}:${row.column}` : row.kind))

test('columns run Human, Claude, Backlog, Done under the toolbar', () => {
  const cards = [
    cardOf(1, 'backlog'),
    cardOf(2, 'human'),
    cardOf(3, 'done'),
    cardOf(4, 'claude'),
  ]
  const rows = layoutBoard({ cards, ui: open(), bodyRows: 30 })

  expect(kinds(rows)).toEqual([
    'toolbar',
    'header:human',
    'card:human',
    'header:claude',
    'card:claude',
    'header:backlog',
    'card:backlog',
    'header:done',
    'card:done',
  ])
})

test('a collapsed section is its header alone, with the count', () => {
  const rows = layoutBoard({
    cards: [...many('backlog', 2), ...many('done', 3, 10)],
    ui: INITIAL_UI,
    bodyRows: 30,
  })

  expect(kinds(rows).slice(-2)).toEqual(['card:backlog', 'header:done'])
  expect(rows.at(-1)).toEqual({
    kind: 'header',
    column: 'done',
    shown: 3,
    total: 3,
  })
})

test('a section shows five cards and counts the rest below', () => {
  const ui = open({ done: true })
  const rows = layoutBoard({ cards: many('backlog', 8), ui, bodyRows: 30 })
  const backlog = rows.filter(
    row => 'column' in row && row.column === 'backlog',
  )

  expect(backlog.map(row => row.kind)).toEqual([
    'header',
    'card',
    'card',
    'card',
    'card',
    'card',
    'more',
  ])
  expect(backlog.at(-1)).toEqual({
    kind: 'more',
    column: 'backlog',
    dir: 'down',
    n: 3,
  })
})

test('an offset of three shows the cards after it and a count above', () => {
  const ui = {
    ...open({ done: true }),
    offsets: { ...INITIAL_UI.offsets, backlog: 3 },
  }
  const rows = layoutBoard({ cards: many('backlog', 8), ui, bodyRows: 30 })
  const backlog = rows.filter(
    row => 'column' in row && row.column === 'backlog',
  )

  expect(backlog[1]).toEqual({
    kind: 'more',
    column: 'backlog',
    dir: 'up',
    n: 3,
  })
  expect(backlog.filter(row => row.kind === 'card')).toHaveLength(5)
  expect(backlog.some(row => row.kind === 'more' && row.dir === 'down')).toBe(
    false,
  )
})

test('an empty section says so', () => {
  const rows = layoutBoard({
    cards: [cardOf(1, 'claude')],
    ui: open(),
    bodyRows: 30,
  })

  expect(kinds(rows).slice(0, 3)).toEqual([
    'toolbar',
    'header:human',
    'empty:human',
  ])
})

test('an empty board adds the note under the sections', () => {
  const rows = layoutBoard({ cards: [], ui: INITIAL_UI, bodyRows: 30 })

  expect(rows.at(-1)).toEqual({ kind: 'note' })
})

test('clampOffset keeps the window inside the list', () => {
  expect(clampOffset(-2, 8, 5)).toBe(0)
  expect(clampOffset(99, 8, 5)).toBe(3)
  expect(clampOffset(2, 3, 5)).toBe(0)
  expect(clampOffset(2, 8, 5)).toBe(2)
})

test('Done lists its ten newest and counts all of them', () => {
  const cards = many('done', 57)
  const list = sectionList(cards, 'done')

  expect(list).toHaveLength(10)
  expect(list[0]?.number).toBe(57)
  expect(list[9]?.number).toBe(48)

  const rows = layoutBoard({ cards, ui: open(), bodyRows: 30 })
  expect(
    rows.find(row => row.kind === 'header' && row.column === 'done'),
  ).toEqual({
    kind: 'header',
    column: 'done',
    shown: 10,
    total: 57,
  })
})

test('capFor shrinks with the body and the tree always fits it', () => {
  expect(capFor(30, 3)).toBe(5)
  expect(capFor(14, 3)).toBe(1)
  expect(capFor(8, 3)).toBe(1)

  const cards = [
    ...many('human', 20),
    ...many('claude', 20, 100),
    ...many('backlog', 20, 200),
    ...many('done', 20, 300),
  ]
  for (const bodyRows of [20, 24, 30, 40]) {
    for (const collapsed of [{}, { done: true }, { human: true, done: true }]) {
      const rows = layoutBoard({ cards, ui: open(collapsed), bodyRows })

      expect(rows.length).toBeLessThanOrEqual(bodyRows)
    }
  }
})

test('a card row never outgrows the pane, however wide its characters', () => {
  const titles = [
    'Fix login redirect loop that happens on every single request',
    '日本語のとても長いタイトルがここに入ります日本語のとても長いタイトル',
    'ผู้ใช้ไม่สามารถเข้าสู่ระบบได้เมื่อรหัสผ่านหมดอายุแล้ว',
    '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀',
  ]
  for (const columns of [20, 30, 44, 80]) {
    for (const title of titles) {
      for (const tag of [undefined, 'review' as const]) {
        const line = cardLine(
          cardOf(123, 'human', { title, ...(tag ? { tag } : {}) }),
          columns,
          '⟳',
          '5m',
        )
        const width = cellWidth(line.left + line.title + line.glyph + line.age)

        expect(width).toBeLessThanOrEqual(columns)
      }
    }
  }
})

test('a card row lines its age up at the right edge', () => {
  const line = cardLine(cardOf(7, 'claude'), 44, ' ', '5m')

  expect(line.left).toBe('  #7 ')
  expect(cellWidth(line.left + line.title + line.glyph + line.age)).toBe(44)
  expect(line.age).toBe(' 5m')
})

test('a card row drops the age when the title would have no room', () => {
  const line = cardLine(cardOf(7, 'claude'), 13, ' ', '5m')

  expect(line.age).toBe('')
})

test('hitTest maps a tree row to its column, and the toolbar to none', () => {
  const rows = layoutBoard({
    cards: [...many('human', 1), ...many('backlog', 8, 10)],
    ui: open({ done: true }),
    bodyRows: 30,
  })
  // 0 toolbar, 1 Human header, 2 its card, 3 Claude header, 4 (empty), 5 Backlog header
  expect(hitTest(rows, 0)).toBeUndefined()
  expect(hitTest(rows, 1)).toBe('human')
  expect(hitTest(rows, 2)).toBe('human')
  expect(hitTest(rows, 4)).toBe('claude')
  expect(hitTest(rows, 6)).toBe('backlog')
  expect(hitTest(rows, rows.length - 1)).toBe('done')
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

test('ages read as now, minutes, hours and days', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')

  expect(ageLabel('2026-10-25T11:59:40Z', now)).toBe('now')
  expect(ageLabel('2026-10-25T11:55:00Z', now)).toBe('5m')
  expect(ageLabel('2026-10-25T09:00:00Z', now)).toBe('3h')
  expect(ageLabel('2026-10-23T12:00:00Z', now)).toBe('2d')
  expect(ageLabel('not a date', now)).toBe('')
})

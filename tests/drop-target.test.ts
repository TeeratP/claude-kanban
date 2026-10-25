import { expect, test } from 'claude-code/testing'

import { dropTarget } from '../hooks/board-client'
import type { RowView } from '../hooks/board-client'
import { parseBoardMessage } from '../hooks/board-rows'

const base = (key: string) => ({ key, segs: [], width: 0 })
const header = (column: string, isOrdered = true): RowView => ({
  ...base(`hdr:${column}`),
  kind: 'header',
  column,
  moveKeys: [],
  hint: '',
  isOrdered,
})
const card = (id: string, column: string): RowView => ({
  ...base(`card:${id}`),
  kind: 'card',
  column,
  cardId: id,
})
const more = (column: string, dir: 'up' | 'down'): RowView => ({
  ...base(`more:${column}:${dir}`),
  kind: 'more',
  column,
  dir,
})
const detail = (id: string, column: string): RowView => ({
  ...base(`act:${id}`),
  kind: 'detail',
  column,
  cardId: id,
})
const empty = (column: string): RowView => ({
  ...base(`empty:${column}`),
  kind: 'text',
  column,
})
const note: RowView = { ...base('note'), kind: 'text' }

// 0 hdr claude, 1 a, 2 b, 3 hdr backlog, 4 up, 5 c, 6 d, 7 down,
// 8 hdr human, 9 empty, 10 hdr done, 11 e, 12 note
const rows: RowView[] = [
  header('claude'),
  card('a', 'claude'),
  card('b', 'claude'),
  header('backlog'),
  more('backlog', 'up'),
  card('c', 'backlog'),
  card('d', 'backlog'),
  more('backlog', 'down'),
  header('human'),
  empty('human'),
  header('done', false),
  card('e', 'done'),
  note,
]

test('a header, or the empty row of a section, puts the card first, the line under the header', () => {
  expect(dropTarget(rows, 0)).toEqual({
    column: 'claude',
    place: { at: 'top' },
    line: 0,
  })
  expect(dropTarget(rows, 9)).toEqual({
    column: 'human',
    place: { at: 'top' },
    line: 8,
  })
  expect(dropTarget(rows, 3)).toMatchObject({ column: 'backlog', line: 3 })
})

test('a card puts the dropped one before it, the line under the row above', () => {
  expect(dropTarget(rows, 2)).toEqual({
    column: 'claude',
    place: { at: 'before', cardId: 'b' },
    line: 1,
  })
  expect(dropTarget(rows, 1)).toMatchObject({
    place: { at: 'before', cardId: 'a' },
    line: 0,
  })
  // Under the `more` row above, for the first card shown.
  expect(dropTarget(rows, 5)).toMatchObject({
    place: { at: 'before', cardId: 'c' },
    line: 4,
  })
})

test('the lower half of a card, where the pointer is known that finely, puts it after', () => {
  expect(dropTarget(rows, 2, 2.5)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'b' },
    line: 2,
  })
  expect(dropTarget(rows, 2, 2.9)).toMatchObject({
    place: { at: 'after', cardId: 'b' },
  })
  expect(dropTarget(rows, 2, 2.49)).toMatchObject({
    place: { at: 'before', cardId: 'b' },
  })
  expect(dropTarget(rows, 2, 2)).toMatchObject({
    place: { at: 'before', cardId: 'b' },
  })
})

test('a more row puts the card at its edge of the window shown', () => {
  expect(dropTarget(rows, 4)).toEqual({
    column: 'backlog',
    place: { at: 'before', cardId: 'c' },
    line: 4,
  })
  expect(dropTarget(rows, 7)).toEqual({
    column: 'backlog',
    place: { at: 'after', cardId: 'd' },
    line: 6,
  })
})

test('a section that keeps no order is lit and names no place', () => {
  expect(dropTarget(rows, 10)).toEqual({ column: 'done', lit: 10 })
  expect(dropTarget(rows, 11, 11.8)).toEqual({ column: 'done', lit: 10 })
})

test('rows that belong to no section, and rows past either end, take no drop', () => {
  expect(dropTarget(rows, 12)).toBeUndefined()
  expect(dropTarget(rows, -1)).toBeUndefined()
  expect(dropTarget(rows, 40)).toBeUndefined()
  expect(dropTarget([], 0)).toBeUndefined()
  // A card with no header above it names no section to put the card in.
  expect(dropTarget([card('x', 'claude')], 0)).toBeUndefined()
})

test('the board messages carry a place only when it is a good one', () => {
  const drop = { type: 'drop', cardId: 'md:1', column: 'claude' }

  expect(parseBoardMessage(drop)).toEqual(drop)
  expect(
    parseBoardMessage({ ...drop, place: { at: 'before', cardId: 'md:2' } }),
  ).toEqual({ ...drop, place: { at: 'before', cardId: 'md:2' } })
  expect(parseBoardMessage({ ...drop, place: { at: 'top' } })).toEqual({
    ...drop,
    place: { at: 'top' },
  })
  for (const place of [
    null,
    'top',
    {},
    { at: 'middle' },
    { at: 'before' },
    { at: 'after', cardId: 4 },
  ]) {
    expect(parseBoardMessage({ ...drop, place })).toBeUndefined()
  }

  expect(
    parseBoardMessage({ type: 'shift', cardId: 'md:1', dir: 'up' }),
  ).toEqual({ type: 'shift', cardId: 'md:1', dir: 'up' })
  expect(
    parseBoardMessage({ type: 'shift', cardId: 'md:1', dir: 'left' }),
  ).toBeUndefined()
  expect(parseBoardMessage({ type: 'shift', dir: 'up' })).toBeUndefined()
})

// 0 hdr claude, 1 a, 2 a's row, 3 b, 4 b's row, 5 down, 6 hdr backlog, 7 c
const withRows: RowView[] = [
  header('claude'),
  card('a', 'claude'),
  detail('a', 'claude'),
  card('b', 'claude'),
  detail('b', 'claude'),
  more('claude', 'down'),
  header('backlog'),
  card('c', 'backlog'),
]

test("a card's second row takes a drop after that card, the line under the row", () => {
  expect(dropTarget(withRows, 2)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'a' },
    line: 2,
  })
  // Which half of the row the pointer is in does not matter.
  expect(dropTarget(withRows, 4, 4.1)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'b' },
    line: 4,
  })
})

test('a place after a card with a second row has its line under that row, not between the two', () => {
  expect(dropTarget(withRows, 1, 1.75)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'a' },
    line: 2,
  })
  expect(dropTarget(withRows, 3, 3.5)).toMatchObject({
    place: { at: 'after', cardId: 'b' },
    line: 4,
  })
  // Without a finer position, the direction of the drag decides, and the line is the same.
  expect(dropTarget(withRows, 3, undefined, true)).toMatchObject({
    place: { at: 'after', cardId: 'b' },
    line: 4,
  })
})

test('a place before a card is under the second row of the card above it', () => {
  expect(dropTarget(withRows, 3)).toEqual({
    column: 'claude',
    place: { at: 'before', cardId: 'b' },
    line: 2,
  })
  expect(dropTarget(withRows, 1)).toMatchObject({
    place: { at: 'before', cardId: 'a' },
    line: 0,
  })
})

test('a more row below a card with a second row puts the dropped one after that card', () => {
  expect(dropTarget(withRows, 5)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'b' },
    line: 4,
  })
})

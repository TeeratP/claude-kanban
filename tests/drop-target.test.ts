import { expect, test } from 'claude-code/testing'

import { dropTarget } from '../hooks/board-client'
import type { RowView } from '../hooks/board-client'
import { parseBoardMessage } from '../hooks/board-rows'

const base = (key: string) => ({ key, segs: [], width: 0 })
const header = (column: string, isOrdered = true): RowView => ({
  ...base(`hdr:${column}`),
  kind: 'header',
  column,
  labelAt: 0,
  moveKeys: [],
  carrySegs: [],
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
const blank = (column: string, index: number): RowView => ({
  ...base(`blank:${column}:${index}`),
  kind: 'text',
  column,
})
// A group's header: closed, it shows its sections as chips over cells 12 to 36.
const group = (name: string, isOpen: boolean): RowView => ({
  ...base(`grp:${name}`),
  kind: 'group',
  group: name,
  isOpen,
  sections: [],
  chipSegs: [],
  chips: isOpen
    ? []
    : [
        { column: 'done', seg: 1, from: 12, to: 18 },
        { column: 'cancelled', seg: 2, from: 18, to: 29 },
        { column: 'suspended', seg: 3, from: 29, to: 40 },
      ],
  carrySegs: [],
})

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
  const drop = { type: 'drop', cardId: 'gh:1', column: 'claude' }

  expect(parseBoardMessage(drop)).toEqual(drop)
  expect(
    parseBoardMessage({ ...drop, place: { at: 'before', cardId: 'gh:2' } }),
  ).toEqual({ ...drop, place: { at: 'before', cardId: 'gh:2' } })
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
    parseBoardMessage({ type: 'shift', cardId: 'gh:1', dir: 'up' }),
  ).toEqual({ type: 'shift', cardId: 'gh:1', dir: 'up' })
  expect(
    parseBoardMessage({ type: 'shift', cardId: 'gh:1', dir: 'left' }),
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

// 0 hdr backlog, 1 a, 2 b, 3 blank, 4 blank, 5 hdr human, 6 empty, 7 blank,
// 8 hdr claude, 9 c, 10 detail, 11 blank, 12 hdr done, 13 e, 14 blank, 15 slack
const filled: RowView[] = [
  header('backlog'),
  card('a', 'backlog'),
  card('b', 'backlog'),
  blank('backlog', 3),
  blank('backlog', 4),
  header('human'),
  empty('human'),
  blank('human', 2),
  header('claude'),
  card('c', 'claude'),
  detail('c', 'claude'),
  blank('claude', 3),
  header('done', false),
  card('e', 'done'),
  blank('done', 2),
  { ...base('blank:slack:0'), kind: 'text' },
]

test('a blank row puts the card after the last card shown, the line under it', () => {
  expect(dropTarget(filled, 3)).toEqual({
    column: 'backlog',
    place: { at: 'after', cardId: 'b' },
    line: 2,
  })
  expect(dropTarget(filled, 4)).toEqual({
    column: 'backlog',
    place: { at: 'after', cardId: 'b' },
    line: 2,
  })
  // Under a card's second row, the line goes under that row.
  expect(dropTarget(filled, 11)).toEqual({
    column: 'claude',
    place: { at: 'after', cardId: 'c' },
    line: 10,
  })
})

test('a blank row of a section with no cards puts the card first, the line under the header', () => {
  expect(dropTarget(filled, 7)).toEqual({
    column: 'human',
    place: { at: 'top' },
    line: 5,
  })
})

test('a blank row under a more row is the same as the more row', () => {
  const rows = [
    header('backlog'),
    card('a', 'backlog'),
    more('backlog', 'down'),
    blank('backlog', 3),
  ]

  expect(dropTarget(rows, 3)).toEqual(dropTarget(rows, 2))
  expect(dropTarget(rows, 3)).toMatchObject({
    place: { at: 'after', cardId: 'a' },
  })
})

test('a blank row of a section that keeps no order lights the section, and the leftover rows take nothing', () => {
  expect(dropTarget(filled, 14)).toEqual({ column: 'done', lit: 12 })
  expect(dropTarget(filled, 15)).toBeUndefined()
})

test('a closed group takes a card on the chip at the pointer, last in that section', () => {
  const rows = [
    group('active', true),
    card('a', 'backlog'),
    group('inactive', false),
  ]

  expect(dropTarget(rows, 2, undefined, false, 14)).toEqual({
    column: 'done',
    lit: 2,
  })
  expect(dropTarget(rows, 2, undefined, false, 18)).toEqual({
    column: 'cancelled',
    lit: 2,
  })
  expect(dropTarget(rows, 2, undefined, false, 39)).toMatchObject({
    column: 'suspended',
  })
  // The label before the chips, past them, and no known column take nothing.
  expect(dropTarget(rows, 2, undefined, false, 5)).toBeUndefined()
  expect(dropTarget(rows, 2, undefined, false, 40)).toBeUndefined()
  expect(dropTarget(rows, 2)).toBeUndefined()
})

test('an open group is no target', () => {
  expect(
    dropTarget([group('active', true)], 0, undefined, false, 14),
  ).toBeUndefined()
})

test('the board messages name a group to toggle', () => {
  expect(parseBoardMessage({ type: 'toggleGroup', group: 'active' })).toEqual({
    type: 'toggleGroup',
    group: 'active',
  })
  expect(parseBoardMessage({ type: 'toggleGroup', group: 'inactive' })).toEqual(
    { type: 'toggleGroup', group: 'inactive' },
  )
  expect(
    parseBoardMessage({ type: 'toggleGroup', group: 'done' }),
  ).toBeUndefined()
  expect(parseBoardMessage({ type: 'toggleGroup' })).toBeUndefined()
  // The old section toggle is gone.
  expect(parseBoardMessage({ type: 'toggle', column: 'done' })).toBeUndefined()
  expect(
    parseBoardMessage({ type: 'drop', cardId: 'gh:1', column: 'suspended' }),
  ).toEqual({ type: 'drop', cardId: 'gh:1', column: 'suspended' })
})

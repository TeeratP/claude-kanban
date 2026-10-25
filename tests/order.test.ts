import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn } from '../types'
import { placeIn } from '../hooks/order'

let n = 0
const make = (
  id: string,
  column: KanbanColumn,
  order: number,
  number = (n += 1),
): KanbanCard => ({
  id,
  number,
  title: id,
  column,
  order,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
})

test('a card dropped between two with room between them takes the middle and shifts nothing', () => {
  const cards = [
    make('a', 'backlog', 10),
    make('b', 'backlog', 20),
    make('c', 'claude', 5),
  ]

  expect(placeIn(cards, 'c', 'backlog', 'a')).toEqual({
    order: 15,
    shifted: {},
  })
})

test('a card dropped first takes an order below the first, when there is room', () => {
  const cards = [make('a', 'backlog', 10), make('b', 'backlog', 20)]

  expect(placeIn(cards, 'b', 'backlog', null)).toEqual({
    order: 5,
    shifted: {},
  })
})

test('a card dropped last takes the next order after the last, and an empty section starts at one', () => {
  const cards = [
    make('a', 'backlog', 10),
    make('b', 'backlog', 20),
    make('c', 'claude', 5),
  ]

  expect(placeIn(cards, 'c', 'backlog', 'b')).toEqual({
    order: 21,
    shifted: {},
  })
  expect(placeIn(cards, 'c', 'human', null)).toEqual({ order: 1, shifted: {} })
})

test('a card with no room around it renumbers the section by tens and shifts only what changed', () => {
  const cards = [
    make('a', 'backlog', 10),
    make('b', 'backlog', 11),
    make('c', 'backlog', 12),
    make('d', 'claude', 1),
  ]

  // After a: a keeps 10, so only the cards that moved to a new number are named.
  expect(placeIn(cards, 'd', 'backlog', 'a')).toEqual({
    order: 20,
    shifted: { b: 30, c: 40 },
  })
  // First, with the first card at 1: nothing below it, so every card moves over.
  const dense = [
    make('a', 'backlog', 1),
    make('b', 'backlog', 2),
    make('d', 'claude', 1),
  ]
  expect(placeIn(dense, 'd', 'backlog', null)).toEqual({
    order: 10,
    shifted: { a: 20, b: 30 },
  })
})

test('orders that tie, or are not whole, leave no room and renumber', () => {
  const tied = [
    make('a', 'backlog', 5, 1),
    make('b', 'backlog', 5, 2),
    make('c', 'claude', 1),
  ]
  expect(placeIn(tied, 'c', 'backlog', 'a')).toEqual({
    order: 20,
    shifted: { a: 10, b: 30 },
  })

  const halves = [make('a', 'backlog', 2), make('b', 'backlog', 2.5)]
  expect(
    placeIn([...halves, make('c', 'claude', 1)], 'c', 'backlog', 'a'),
  ).toMatchObject({ order: 20 })
})

test('a card moved within its section is left out when finding its neighbours', () => {
  const cards = [
    make('a', 'backlog', 10),
    make('b', 'backlog', 20),
    make('c', 'backlog', 30),
  ]

  // a goes after b: between b and c, though a's own 10 is out of the way.
  expect(placeIn(cards, 'a', 'backlog', 'b')).toEqual({
    order: 25,
    shifted: {},
  })
  // c goes first: below a's 10.
  expect(placeIn(cards, 'c', 'backlog', null)).toEqual({
    order: 5,
    shifted: {},
  })
})

test('a card that would stay where it is has no placement', () => {
  const cards = [
    make('a', 'backlog', 10),
    make('b', 'backlog', 20),
    make('c', 'backlog', 30),
  ]

  expect(placeIn(cards, 'a', 'backlog', null)).toBeUndefined()
  expect(placeIn(cards, 'b', 'backlog', 'a')).toBeUndefined()
  expect(placeIn(cards, 'c', 'backlog', 'b')).toBeUndefined()
  expect(placeIn(cards, 'c', 'backlog', 'c')).toBeUndefined()
  // Last, when the card it should follow is not there.
  expect(placeIn(cards, 'c', 'backlog', 'gone')).toBeUndefined()
  expect(placeIn(cards, 'a', 'backlog', 'gone')).toEqual({
    order: 31,
    shifted: {},
  })
})

test('cards in other sections never count as neighbours', () => {
  const cards = [
    make('a', 'claude', 10),
    make('b', 'backlog', 11),
    make('c', 'backlog', 12),
  ]

  expect(placeIn(cards, 'a', 'backlog', 'b')).toEqual({
    order: 20,
    shifted: { b: 10, c: 30 },
  })
})

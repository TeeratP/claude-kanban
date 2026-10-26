import type {
  ClientKeyEvent,
  ClientPointerEvent,
  ClientSurface,
} from 'claude-code'
import { expect, test } from 'claude-code/testing'

import Board from '../hooks/board-client'
import type { BoardPost, BoardProps, RowView, Seg } from '../hooks/board-client'

// The test kit hands a Client no sub-cell position (`fine`), as a terminal that
// reports none does. This drives the board's module directly, as the engine
// does, with a stand-in surface that does.

type Node = {
  type: string
  props: Record<string, unknown>
  children: Node[]
}

// The module draws with the environment's `h`.
const env = globalThis as unknown as { h: unknown; Fragment: unknown }
env.h = (
  type: unknown,
  props: Record<string, unknown> | null,
  ...kids: Node[]
) => ({
  type: typeof type === 'function' ? type.name : String(type),
  props: props ?? {},
  children: kids.flat(),
})
env.Fragment = 'Fragment'

const seg = (text: string): Seg => ({
  text,
  bold: false,
  dim: false,
  color: '',
})
const row = (key: string, text: string) => ({
  key,
  segs: [seg(text)],
  width: text.length,
})
const header = (column: string): RowView => ({
  ...row(`hdr:${column}`, column),
  kind: 'header',
  column,
  labelAt: 0,
  moveKeys: [],
  carrySegs: [],
  isOrdered: true,
})
const card = (id: string, column: string): RowView => ({
  ...row(`card:${id}`, id),
  kind: 'card',
  column,
  cardId: id,
})

const detail = (id: string, column: string): RowView => ({
  ...row(`act:${id}`, `row of ${id}`),
  kind: 'detail',
  column,
  cardId: id,
})

const props: BoardProps = {
  columns: 40,
  rows: [
    header('claude'),
    card('a', 'claude'),
    card('b', 'claude'),
    header('backlog'),
    card('c', 'backlog'),
  ],
}

// The same board with a second row under each card of Claude.
const withDetail: BoardProps = {
  columns: 40,
  rows: [
    header('claude'),
    card('a', 'claude'),
    detail('a', 'claude'),
    card('b', 'claude'),
    detail('b', 'claude'),
    header('backlog'),
    card('c', 'backlog'),
  ],
}

function mount(shown: BoardProps = props) {
  const posts: BoardPost[] = []
  let state: unknown
  let onPointer: (event: ClientPointerEvent) => void = () => {}
  let onKey: (event: ClientKeyEvent) => void = () => {}
  const Box = function Box() {}
  const Text = function Text() {}
  const surface = {
    elements: { Box, Text },
    get state() {
      return state
    },
    setState: (next: unknown) => {
      state = next
    },
    columns: 40,
    rows: 5,
    every: () => () => {},
    onPointer: (fn: (event: ClientPointerEvent) => void) => {
      onPointer = fn
      return () => {}
    },
    onKey: (fn: (event: ClientKeyEvent) => void) => {
      onKey = fn
      return () => {}
    },
    post: (data: BoardPost) => {
      posts.push(data)
    },
  }
  const draw = () =>
    (Board as unknown as (p: BoardProps, s: unknown) => Node)(shown, surface)
  draw()

  return {
    posts,
    // The state as the module last set it: its identity changes with every set.
    state: () => state,
    pointer: (event: ClientPointerEvent) => {
      onPointer(event)
      return draw()
    },
    key: (event: ClientKeyEvent) => {
      onKey(event)
      return draw()
    },
  }
}

// The keys of the rows drawn with a line under them.
const lined = (tree: Node) =>
  tree.children.flatMap(box =>
    box.children[0]?.props.underline === true ? [String(box.props.key)] : [],
  )

const at = (type: ClientPointerEvent['type'], y: number, fine?: number) =>
  ({
    type,
    x: 3,
    y,
    button: 'left',
    ...(fine === undefined ? {} : { fine: { x: 3, y: fine } }),
  }) as ClientPointerEvent

test('a drop in the lower half of a card, where the pointer is known that finely, goes after it', () => {
  const board = mount()

  board.pointer(at('down', 4))
  board.pointer(at('move', 2, 2.75))
  board.pointer(at('up', 2, 2.75))

  expect(board.posts).toEqual([
    {
      type: 'drop',
      cardId: 'c',
      column: 'claude',
      place: { at: 'after', cardId: 'b' },
    },
  ])
})

test('the upper half, a pointer that is not known so finely and the middle go before or after as the rule says', () => {
  const places = (fine?: number) => {
    const board = mount()
    board.pointer(at('down', 4))
    board.pointer(at('move', 2, fine))
    board.pointer(at('up', 2, fine))

    return board.posts.map(post => (post.type === 'drop' ? post.place : post))
  }

  expect(places(2.25)).toEqual([{ at: 'before', cardId: 'b' }])
  expect(places(2.49)).toEqual([{ at: 'before', cardId: 'b' }])
  expect(places()).toEqual([{ at: 'before', cardId: 'b' }])
  expect(places(2.5)).toEqual([{ at: 'after', cardId: 'b' }])
})

test('the line follows the pointer across the middle of a row, and only the up event decides', () => {
  const board = mount()

  board.pointer(at('down', 4))
  expect(lined(board.pointer(at('move', 2, 2.25)))).toEqual(['card:a'])
  expect(lined(board.pointer(at('move', 2, 2.4)))).toEqual(['card:a'])
  expect(lined(board.pointer(at('move', 2, 2.6)))).toEqual(['card:b'])
  expect(lined(board.pointer(at('move', 2, 2.9)))).toEqual(['card:b'])
  // A pointer that stops reporting falls back to the upper half.
  expect(lined(board.pointer(at('move', 2)))).toEqual(['card:a'])
  board.pointer(at('move', 2, 2.8))
  const tree = board.pointer(at('up', 2, 2.1))

  expect(lined(tree)).toEqual([])
  expect(board.posts).toEqual([
    {
      type: 'drop',
      cardId: 'c',
      column: 'claude',
      place: { at: 'before', cardId: 'b' },
    },
  ])
})

test('the lower half of the card above the dragged one is the place it already has', () => {
  const board = mount()

  // b is dragged to the lower half of a: after a is where b is.
  board.pointer(at('down', 2))
  board.pointer(at('move', 1, 1.8))
  expect(lined(board.pointer(at('move', 1, 1.8)))).toEqual([])
  board.pointer(at('up', 1, 1.8))
  expect(board.posts).toEqual([])
})

test('shift-K and shift-J post a shift for the card under the cursor, once a key has brought the cursor up', () => {
  const board = mount()

  board.pointer(at('down', 2))
  board.pointer(at('up', 2))
  board.key({ key: 'J' })
  expect(board.posts).toEqual([{ type: 'open', cardId: 'b' }])
  board.key({ key: 'J' })
  board.key({ key: 'K' })
  board.key({ key: 'j', shift: true })
  board.key({ key: 'k', shift: true })

  expect(board.posts).toEqual([
    { type: 'open', cardId: 'b' },
    { type: 'shift', cardId: 'b', dir: 'down' },
    { type: 'shift', cardId: 'b', dir: 'up' },
    { type: 'shift', cardId: 'b', dir: 'down' },
    { type: 'shift', cardId: 'b', dir: 'up' },
  ])
})

test('without a finer position a card comes down onto a card after it and goes up onto one before it', () => {
  const places = (from: number, ...over: number[]) => {
    const board = mount()
    board.pointer(at('down', from))
    for (const y of over) board.pointer(at('move', y))
    const end = over[over.length - 1] ?? from
    board.pointer(at('up', end))

    return board.posts.map(post => (post.type === 'drop' ? post.place : post))
  }

  // Within a section: a (row 1) down onto b (row 2), b up onto a.
  expect(places(1, 2)).toEqual([{ at: 'after', cardId: 'b' }])
  expect(places(2, 1)).toEqual([{ at: 'before', cardId: 'a' }])
  // Across sections: a down onto c (row 4), c up onto b.
  expect(places(1, 4)).toEqual([{ at: 'after', cardId: 'c' }])
  expect(places(4, 2)).toEqual([{ at: 'before', cardId: 'b' }])
  // A pointer that goes past and comes back follows its last step.
  expect(places(1, 4, 3, 4)).toEqual([{ at: 'after', cardId: 'c' }])
  expect(places(4, 0, 2)).toEqual([{ at: 'after', cardId: 'b' }])
  expect(places(4, 1, 0, 1)).toEqual([{ at: 'after', cardId: 'a' }])
  expect(places(4, 1, 2, 1)).toEqual([{ at: 'before', cardId: 'a' }])
  // A card that began above the target in its own section is going down to it, however it got there.
  expect(places(1, 4, 2)).toEqual([{ at: 'after', cardId: 'b' }])
})

test('a finer position beats the direction the pointer came from', () => {
  const places = (fine: number) => {
    const board = mount()
    board.pointer(at('down', 1))
    board.pointer(at('move', 4, fine))
    board.pointer(at('up', 4, fine))

    return board.posts.map(post => (post.type === 'drop' ? post.place : post))
  }

  // Coming down onto c, the upper half is still before it and the lower after.
  expect(places(4.25)).toEqual([{ at: 'before', cardId: 'c' }])
  expect(places(4.75)).toEqual([{ at: 'after', cardId: 'c' }])

  // Going up onto b, the lower half is after it.
  const board = mount()
  board.pointer(at('down', 4))
  board.pointer(at('move', 2, 2.8))
  board.pointer(at('up', 2, 2.8))
  expect(board.posts).toEqual([
    {
      type: 'drop',
      cardId: 'c',
      column: 'claude',
      place: { at: 'after', cardId: 'b' },
    },
  ])
})

test('the line follows the direction of the drag when no finer position is known', () => {
  const board = mount()

  board.pointer(at('down', 4))
  expect(lined(board.pointer(at('move', 2)))).toEqual(['card:a'])
  expect(lined(board.pointer(at('move', 1)))).toEqual(['hdr:claude'])
  expect(lined(board.pointer(at('move', 2)))).toEqual(['card:b'])
})

test("a click on a card's second row opens the card, and the cursor never rests on it", () => {
  const board = mount(withDetail)
  const lit = (tree: Node) =>
    tree.children.flatMap(box =>
      box.children[0]?.props.inverse === true ? [String(box.props.key)] : [],
    )

  board.pointer(at('down', 2))
  board.pointer(at('up', 2))
  expect(board.posts).toEqual([{ type: 'open', cardId: 'a' }])

  // The first key brings the cursor up, on the first card (the headers are labels);
  // then it walks past the second rows.
  expect(lit(board.key({ key: 'down' }))).toEqual(['card:a'])
  expect(lit(board.key({ key: 'down' }))).toEqual(['card:b'])
  expect(lit(board.key({ key: 'down' }))).toEqual(['card:c'])
  expect(lit(board.key({ key: 'up' }))).toEqual(['card:b'])
  expect(lit(board.key({ key: 'up' }))).toEqual(['card:a'])
})

test("a drop on a card's second row lands after that card, with the line under that row", () => {
  const board = mount(withDetail)

  board.pointer(at('down', 6))
  expect(lined(board.pointer(at('move', 2)))).toEqual(['act:a'])
  board.pointer(at('up', 2))

  expect(board.posts).toEqual([
    {
      type: 'drop',
      cardId: 'c',
      column: 'claude',
      place: { at: 'after', cardId: 'a' },
    },
  ])
})

test('the line of an after place is under the second row, whichever row the pointer is on', () => {
  const board = mount(withDetail)

  board.pointer(at('down', 6))
  expect(lined(board.pointer(at('move', 1, 1.8)))).toEqual(['act:a'])
  expect(lined(board.pointer(at('move', 3, 3.2)))).toEqual(['act:a'])
  expect(lined(board.pointer(at('move', 3, 3.8)))).toEqual(['act:b'])
})

test('a card dropped on its own second row, or on the second row of the card above it, stays where it is', () => {
  const stays = (from: number, over: number, fine?: number) => {
    const board = mount(withDetail)
    board.pointer(at('down', from))
    const shown = lined(board.pointer(at('move', over, fine)))
    board.pointer(at('up', over, fine))

    return { shown, posts: board.posts }
  }

  // b (row 3) onto its own second row and onto a's second row.
  expect(stays(3, 4)).toEqual({ shown: [], posts: [] })
  expect(stays(3, 2)).toEqual({ shown: [], posts: [] })
  // a (row 1) onto its own second row, and onto the lower half of b's: after b is a move.
  expect(stays(1, 2)).toEqual({ shown: [], posts: [] })
  expect(stays(1, 3, 3.9).posts).toEqual([
    {
      type: 'drop',
      cardId: 'a',
      column: 'claude',
      place: { at: 'after', cardId: 'b' },
    },
  ])
  expect(stays(1, 3, 3.9).shown).toEqual(['act:b'])
})

test('a drag cannot start on a second row', () => {
  const board = mount(withDetail)

  board.pointer(at('down', 2))
  board.pointer(at('move', 6))
  board.pointer(at('up', 6))

  expect(board.posts).toEqual([])
})

// A row's text as drawn, strings of every Text inside it joined.
const flat = (node: Node | string | false): string =>
  typeof node === 'string'
    ? node
    : node === false
      ? ''
      : node.children.map(flat).join('')

// The row Box with a key, and its drawn text.
const rowOf = (tree: Node, key: string) =>
  tree.children.find(box => box.props.key === key)
const textOfRow = (tree: Node, key: string) => {
  const box = rowOf(tree, key)

  return box === undefined ? undefined : flat(box)
}

// Rows with an indent, as the board draws them, so a hover has a free cell to mark.
const pad = (key: string, text: string, extra: Partial<RowView> = {}) =>
  ({ ...row(key, text), ...extra }) as RowView
const group = (name: string, text: string): RowView => ({
  ...row(`grp:${name}`, text),
  kind: 'group',
  group: name,
  isOpen: false,
  sections: [],
  chipSegs: [],
  chips: [],
  carrySegs: [],
})
const spaced: BoardProps = {
  columns: 40,
  rows: [
    group('active', '▸ Active'),
    pad('hdr:claude', '  Claude', {
      kind: 'header',
      column: 'claude',
      labelAt: 0,
      moveKeys: [],
      carrySegs: [],
      isOrdered: true,
    } as Partial<RowView>),
    pad('card:a', '  a', {
      kind: 'card',
      column: 'claude',
      cardId: 'a',
    } as Partial<RowView>),
    pad('card:b', '  b', {
      kind: 'card',
      column: 'claude',
      cardId: 'b',
    } as Partial<RowView>),
    pad('more:claude:down', '  ↓ 2 more', {
      kind: 'more',
      column: 'claude',
      dir: 'down',
    } as Partial<RowView>),
    pad('blank:claude:4', ' ', {
      kind: 'text',
      column: 'claude',
    } as Partial<RowView>),
  ],
}
const hover = (y: number) => ({ type: 'move', x: 3, y }) as ClientPointerEvent

test('a pointer resting on a card, a more row or a group header is pointed at, and nothing else is', () => {
  const board = mount(spaced)

  // Rows 2 and 3 are cards, row 4 is a more row.
  let tree = board.pointer(hover(2))
  expect(textOfRow(tree, 'card:a')).toBe('› a')
  expect(textOfRow(tree, 'card:b')).toBe('  b')
  tree = board.pointer(hover(3))
  expect(textOfRow(tree, 'card:a')).toBe('  a')
  expect(textOfRow(tree, 'card:b')).toBe('› b')
  tree = board.pointer(hover(4))
  expect(textOfRow(tree, 'more:claude:down')).toBe('› ↓ 2 more')
  // A header, a spare row and the space past the list are labels or nothing.
  for (const y of [1, 5, 9]) {
    tree = board.pointer(hover(y))
    expect(tree.children.map(flat)).toEqual(
      spaced.rows.map(one => one.segs.map(s => s.text).join('')),
    )
  }
})

test('a group header under the pointer keeps its chevron and underlines its name', () => {
  const board = mount(spaced)
  const tree = board.pointer(hover(0))
  const box = rowOf(tree, 'grp:active')

  expect(box && flat(box)).toBe('▸ Active')
  const parts = box?.children[0]?.children ?? []
  expect(
    parts.some(
      part => typeof part === 'object' && part.props.underline === true,
    ),
  ).toBe(true)
  // The whole row is not underlined: that mark is the insertion line.
  expect(lined(tree)).toEqual([])
})

test('the pointer leaving, or a hover over a row with nothing to press, ends the mark', () => {
  const board = mount(spaced)

  board.pointer(hover(2))
  expect(
    textOfRow(board.pointer({ type: 'leave', x: 3, y: 2 }), 'card:a'),
  ).toBe('  a')
  board.pointer(hover(2))
  expect(textOfRow(board.pointer(hover(1)), 'card:a')).toBe('  a')
})

test('a hover sets the state only when the row under the pointer changes', () => {
  const board = mount(spaced)

  board.pointer(hover(2))
  const first = board.state()
  board.pointer({ ...hover(2), x: 9 })
  board.pointer({ ...hover(2), x: 12 })
  expect(board.state()).toBe(first)
  board.pointer(hover(3))
  expect(board.state()).not.toBe(first)
  // Nothing to press under a pointer that was never over anything: no state at all.
  const idle = mount(spaced)
  idle.pointer(hover(1))
  expect(idle.state()).toBeUndefined()
})

test('a mark is not drawn on the row under the cursor, nor while a button is held', () => {
  const board = mount(spaced)

  board.pointer(at('down', 2))
  board.pointer(at('up', 2))
  board.key({ key: 'down' })
  // The cursor is on a, and a hover there shows the cursor only (its row runs to the edge).
  expect(textOfRow(board.pointer(hover(2)), 'card:a')?.trimEnd()).toBe('  a')
  // A held button is a drag, whose own mark is the ghost's.
  board.pointer(at('down', 3))
  expect(textOfRow(board.pointer(at('move', 4)), 'card:b')?.trimEnd()).toBe(
    '› b',
  )
  expect(textOfRow(board.pointer(at('move', 4)), 'more:claude:down')).toBe(
    '  ↓ 2 more',
  )
})

test('the dragged card is dim and slanted with a mark in the free cell, and the section it would land in has its name lit', () => {
  const board = mount(spaced)

  board.pointer(at('down', 3))
  const tree = board.pointer(at('move', 2))
  const ghost = rowOf(tree, 'card:b')

  expect(ghost && flat(ghost)).toBe('› b')
  expect(ghost?.children[0]?.props).toMatchObject({
    dimColor: true,
    italic: true,
  })
  expect(rowOf(tree, 'card:a')?.children[0]?.props.italic).toBeUndefined()
})

test('the header of the section a drag would land in has its name lit, not the whole row', () => {
  const named: BoardProps = {
    columns: 40,
    rows: [
      {
        ...row('hdr:claude', ''),
        segs: [seg('  '), seg('Claude'), seg(' 2')],
        width: 10,
        kind: 'header',
        column: 'claude',
        labelAt: 1,
        moveKeys: [],
        carrySegs: [],
        isOrdered: true,
      },
      pad('card:a', '  a', {
        kind: 'card',
        column: 'claude',
        cardId: 'a',
      } as Partial<RowView>),
      pad('card:b', '  b', {
        kind: 'card',
        column: 'claude',
        cardId: 'b',
      } as Partial<RowView>),
      {
        ...row('hdr:backlog', ''),
        segs: [seg('  '), seg('Backlog'), seg(' 1')],
        width: 11,
        kind: 'header',
        column: 'backlog',
        labelAt: 1,
        moveKeys: [],
        carrySegs: [],
        isOrdered: true,
      },
      pad('card:c', '  c', {
        kind: 'card',
        column: 'backlog',
        cardId: 'c',
      } as Partial<RowView>),
    ],
  }
  const lit = (tree: Node, key: string) =>
    (rowOf(tree, key)?.children[0]?.children ?? []).flatMap(part =>
      typeof part === 'object' && part.props.inverse === true
        ? [flat(part)]
        : [],
    )
  const board = mount(named)

  board.pointer(at('down', 4))
  // Over a card of Claude: the line is under the card above, and Claude's name is lit.
  const tree = board.pointer(at('move', 2, 2.8))
  expect(lit(tree, 'hdr:claude')).toEqual(['Claude'])
  expect(lit(tree, 'hdr:backlog')).toEqual([])
  expect(rowOf(tree, 'hdr:claude')?.children[0]?.props.inverse).toBeUndefined()
  // A place the card already has lights nothing.
  const home = board.pointer(at('move', 4))
  expect(lit(home, 'hdr:claude')).toEqual([])
  expect(lit(home, 'hdr:backlog')).toEqual([])
})

test('the legend lists the cursor keys once a key has brought the cursor up', () => {
  const legend: RowView = {
    ...row('legend', '  ⏎ open · m move'),
    kind: 'text',
    keyed: [seg('  ↑↓ ⏎ open · m move')],
  }
  const board = mount({ columns: 40, rows: [...spaced.rows, legend] })

  expect(textOfRow(board.pointer(hover(1)), 'legend')).toBe('  ⏎ open · m move')
  expect(textOfRow(board.key({ key: 'down' }), 'legend')).toBe(
    '  ↑↓ ⏎ open · m move',
  )
  // It is no stop for the cursor, and no target for a drop.
  board.pointer(at('down', 6))
  board.pointer(at('up', 6))
  expect(board.posts).toEqual([])
})

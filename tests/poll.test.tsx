import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanSync } from '../types'
import { mergeRemote } from '../hooks/board'
import {
  CWD,
  HANDED_OFF,
  PANE,
  RUN,
  SYNC_PAUSE,
  boot,
  card,
  path,
} from './fakes'

const POLL = 45_000

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  // Card 3 is moved to Human by these tests, which needs a handoff.
  [path(3, 'docs')]: card(
    3,
    { status: 'backlog', title: 'Write docs' },
    HANDED_OFF,
  ),
  [path(4, 'old')]: card(4, { status: 'done', title: 'Old thing' }),
})

const cardOf = (
  number: number,
  column: KanbanColumn,
  extra: Partial<KanbanCard> = {},
): KanbanCard => ({
  id: `md:${String(number).padStart(4, '0')}-card`,
  number,
  title: `Card ${number}`,
  column,
  order: number,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T11:00:00Z',
  ...extra,
})

const syncOf = (
  cardId: string,
  phase: KanbanSync['phase'],
): Record<string, KanbanSync> => ({
  [cardId]: { cardId, from: 'backlog', to: 'claude', phase, attempts: 1 },
})

const saved = (savedCards: KanbanCard[], key = `cache:${CWD}`) => ({
  [key]: { shape: 'cache-1', backend: { kind: 'local' }, cards: savedCards },
})

const SAVED_CARD = cardOf(9, 'human', {
  id: 'md:0009-cached',
  title: 'Cached card',
})

async function open($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
}

test('a load takes the remote board', () => {
  const remote = [cardOf(1, 'claude', { order: 7 }), cardOf(3, 'human')]
  const local = [cardOf(1, 'backlog'), cardOf(2, 'done')]

  expect(mergeRemote(remote, local, {})).toEqual(remote)
})

test('a card whose move is pending keeps its column and order here', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'backlog', { title: 'Renamed' })]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'pending'))).toEqual([
    { ...remote[0], column: 'claude', order: 9 },
  ])
})

test('a card whose move failed keeps its column and order here', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'backlog')]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'failed'))).toEqual([
    { ...remote[0], column: 'claude', order: 9 },
  ])
})

test('a move that has settled no longer outranks the remote', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'human')]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'ok'))).toEqual(remote)
})

test('a card gone from the remote stays only while its move is pending', () => {
  const moving = cardOf(1, 'claude')
  const other = cardOf(2, 'backlog')

  expect(
    mergeRemote([], [moving, other], syncOf(moving.id, 'pending')),
  ).toEqual([moving])
  expect(mergeRemote([], [moving, other], {})).toEqual([])
})

test('the board reloads every 45 seconds while the pane is open', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(calls.lists).toBe(1)

  await clock.advance(POLL - 1)
  expect(calls.lists).toBe(1)

  await clock.advance(1)
  expect(calls.lists).toBe(2)

  await clock.advance(POLL)
  expect(calls.lists).toBe(3)
})

test('a poll shows a card added on disk', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'card:md:0005-new' })).toBeUndefined()

  calls.edit(path(5, 'new'), card(5, { status: 'backlog', title: 'Fresh' }))
  await clock.advance(POLL)

  expect((await ui.find({ key: 'card:md:0005-new' }))?.text).toContain('Fresh')
  await ui.unmount()
})

test('polling ends once the pane is closed and starts again when it reopens', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  await clock.advance(POLL)
  expect(calls.lists).toBe(2)

  world.panes = []
  await clock.advance(POLL)
  await clock.advance(POLL)
  expect(calls.lists).toBe(2)

  world.panes = ['kanban']
  await $.command.run({ ...RUN })
  await clock.settle()
  expect(calls.lists).toBe(3)
  await clock.advance(POLL)
  expect(calls.lists).toBe(4)
})

test('a reload at the session start restarts the polling instead of doubling it', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(calls.lists).toBe(1)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(calls.lists).toBe(2)

  await clock.advance(POLL)
  expect(calls.lists).toBe(3)
})

test('a poll does not undo a move that is still pending', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const moving = $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  // Past the pause for further moves the move is out, held at the write.
  await clock.advance(SYNC_PAUSE)
  const before = calls.lists
  await clock.advance(POLL)
  expect(calls.lists).toBe(before + 1)
  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    result: expect.stringContaining('#3 [claude] Write docs'),
  })
  release()
  await moving
})

test('the pane opens from the saved board while the first load runs', async ($, on) => {
  const { clock, calls } = boot(on, cards(), saved([SAVED_CARD]))
  let release = () => {}
  calls.holdList = new Promise<void>(resolve => {
    release = resolve
  })
  await open($)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ key: 'card:md:0009-cached' }))?.text).toContain(
    'Cached card',
  )
  expect(await ui.find({ key: 'card:md:0001-login' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /loading/ })).toBeDefined()

  release()
  await clock.settle()

  expect(await ui.find({ key: 'card:md:0009-cached' })).toBeUndefined()
  expect((await ui.find({ key: 'card:md:0001-login' }))?.text).toContain(
    'Fix login',
  )
  expect(await ui.find({ type: 'Text', text: /loading/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /updated/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call waits for the load rather than reading the saved board', async ($, on) => {
  const { clock, calls } = boot(on, cards(), saved([SAVED_CARD]))
  let release = () => {}
  calls.holdList = new Promise<void>(resolve => {
    release = resolve
  })
  await open($)
  await clock.settle()

  const listing = $.tool.call({ tool: 'mcp__kanban__kanban_list' })
  await clock.settle()
  release()
  const listed = await listing

  expect(listed).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login'),
  })
  expect(JSON.stringify(listed)).not.toContain('Cached card')
})

test('a load saves the board for the next time the pane opens', async ($, on) => {
  const { clock, saved: store } = boot(on, cards())
  await open($)
  await clock.settle()

  const entry = JSON.parse(store.get(`cache:${CWD}`) ?? 'null')

  expect(entry).toMatchObject({
    shape: 'cache-1',
    backend: { kind: 'local' },
    cards: expect.arrayContaining([
      expect.objectContaining({ id: 'md:0001-login', column: 'human' }),
    ]),
  })
  expect(entry.cards).toHaveLength(4)
})

test('a saved board of another shape is ignored', async ($, on) => {
  const stale = { [`cache:${CWD}`]: { shape: 'cache-0', cards: 'nope' } }
  const { clock, calls, logs } = boot(on, cards(), stale)
  let release = () => {}
  calls.holdList = new Promise<void>(resolve => {
    release = resolve
  })
  await open($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = await ui.findAll({ type: 'Button' })
  expect(shown.filter(button => button.key?.startsWith('card:'))).toEqual([])

  release()
  await clock.settle()

  expect((await ui.find({ key: 'card:md:0001-login' }))?.text).toContain(
    'Fix login',
  )
  expect(logs).toEqual([])
  await ui.unmount()
})

test('the board saved for another directory is not shown', async ($, on) => {
  const { clock, calls } = boot(
    on,
    cards(),
    saved([SAVED_CARD], 'cache:/elsewhere'),
  )
  calls.holdList = new Promise<void>(() => {})
  await open($)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'card:md:0009-cached' })).toBeUndefined()
  await ui.unmount()
})

test('the status line counts the cards waiting on you', async ($, on) => {
  const { clock, calls, statuses, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(statuses.at(-1)).toBe('1 card waiting on you')

  calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))
  await clock.advance(POLL)
  expect(statuses.at(-1)).toBe('2 cards waiting on you')

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 1, to: 'done' })
  expect(statuses.at(-1)).toBe('1 card waiting on you')

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 5, to: 'claude' })
  expect(statuses.at(-1)).toBeUndefined()
})

test('the status line is shown the moment a card moves to Human', async ($, on) => {
  const { clock, calls, statuses } = boot(on, cards())
  await open($)
  await clock.settle()
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const moving = $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'human',
  })
  await clock.settle()

  expect(statuses.at(-1)).toBe('2 cards waiting on you')
  release()
  await moving
})

test('a poll that finds a card newly in Human toasts it', async ($, on) => {
  const { clock, calls, toasts, notices, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(toasts).toEqual([])

  calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))
  await clock.advance(POLL)

  expect(toasts).toEqual(['Waiting on you: #5 Fresh'])
  expect(notices).toEqual([])

  await clock.advance(POLL)
  expect(toasts).toHaveLength(1)
})

test('a card Claude edits into Human toasts once', async ($, on) => {
  const { clock, calls, toasts } = boot(on, cards())
  await open($)
  await clock.settle()

  calls.edit(path(3, 'docs'), card(3, { status: 'human', title: 'Write docs' }))
  await $.tool.call({
    tool: 'Write',
    file_path: '/work/.kanban/0003-docs.md',
    content: 'x',
  })
  await clock.settle()

  expect(toasts).toEqual(['Waiting on you: #3 Write docs'])
})

test('a card the person moves to Human is not announced to them', async ($, on) => {
  const { clock, toasts, notices, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'card:md:0003-docs' })
  await ui.press({ key: 'move:human' })
  await clock.advance(POLL)

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
  await ui.unmount()
})

test('a card Claude moves to Human is a toast and a notification', async ($, on) => {
  const { clock, toasts, notices, statuses } = boot(on, cards())
  await open($)
  await clock.settle()

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'human',
  })

  expect(moved).toMatchObject({ result: 'Moved #3 to Human (syncing).' })
  expect(toasts).toEqual([])
  expect(notices).toEqual([])

  await clock.advance(SYNC_PAUSE)

  expect(toasts).toEqual(['Waiting on you: #3 Write docs'])
  expect(notices).toEqual(['Waiting on you: #3 Write docs'])
  expect(statuses.at(-1)).toBe('2 cards waiting on you')
})

test('Claude moving a card elsewhere, or one already in Human, says nothing', async ($, on) => {
  const { clock, toasts, notices } = boot(on, cards())
  await open($)
  await clock.settle()

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 3, to: 'claude' })
  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 1, to: 'human' })

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

test('a move the backend refuses is not announced as handed over', async ($, on) => {
  const { clock, calls, toasts, notices, statuses } = boot(on, cards())
  await open($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  calls.denyWrite = 'EACCES: read-only'

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'human',
  })
  await clock.advance(SYNC_PAUSE)

  expect(moved).toMatchObject({ result: 'Moved #3 to Human (syncing).' })
  expect(toasts).toEqual([])
  expect(notices).toEqual([])

  // The first try failed; three retries follow before the card goes back.
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry-all' })
    await clock.settle()
  }

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Could not move #3 to Human')
  expect(toasts[0]).toContain('EACCES')
  expect(notices).toEqual([])
  expect(statuses.at(-1)).toBe('1 card waiting on you')
  await ui.unmount()
})

test('cards that reached Human since the saved board are announced, the rest are not', async ($, on) => {
  const known = cardOf(1, 'human', { id: 'md:0001-login', title: 'Fix login' })
  const { clock, calls, toasts } = boot(on, cards(), saved([known]))
  calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))

  await open($)
  await clock.settle()

  expect(toasts).toEqual(['Waiting on you: #5 Fresh'])
})

test('the first load ever announces nothing', async ($, on) => {
  const { clock, toasts, notices } = boot(on, cards())

  await open($)
  await clock.settle()

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

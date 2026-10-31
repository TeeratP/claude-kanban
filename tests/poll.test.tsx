import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanCard, KanbanColumn, KanbanSync } from '../types'
import { mergeRemote } from '../hooks/board'
import { click, row, rowKeys } from './board-ui'
import { CWD, PANE, RUN, SYNC_PAUSE } from './fakes'
import { HANDOFF, OPTION, bootGithub, issue } from './fake-github'
import { FIELD, PROJECT, REPO } from './github-board'

const POLL = 45_000
const AGE = 30_000
const NONE = new Set<string>()

const cards = () => [
  // Cards 1 and 3 are moved to Done and Human by these tests, which needs a handoff.
  issue(1, { column: 'human', title: 'Fix login', comments: [HANDOFF] }),
  issue(2, { column: 'claude', title: 'Build API' }),
  issue(3, { column: 'backlog', title: 'Write docs', comments: [HANDOFF] }),
  issue(4, { column: 'done', title: 'Old thing' }),
]

const cardOf = (
  number: number,
  column: KanbanColumn,
  extra: Partial<KanbanCard> = {},
): KanbanCard => ({
  id: `gh:${number}`,
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

// The board CLAUDE.md names, as the last load saved it.
const BACKEND = {
  kind: 'github',
  repo: REPO,
  owner: 'TeeratP',
  projectNumber: 7,
  projectId: PROJECT,
  statusFieldId: FIELD,
  options: {
    backlog: OPTION.Backlog,
    inProgress: OPTION['In progress'],
    inReview: OPTION['In review'],
    done: OPTION.Done,
  },
}

const saved = (savedCards: KanbanCard[], key = `cache:${CWD}`) => ({
  [key]: { shape: 'cache-4', backend: BACKEND, cards: savedCards },
})

const SAVED_CARD = cardOf(9, 'human', { title: 'Cached card' })

async function open($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
}

test('a load takes the remote board', () => {
  const remote = [cardOf(1, 'claude', { order: 7 }), cardOf(3, 'human')]
  const local = [cardOf(1, 'backlog'), cardOf(2, 'done')]

  expect(mergeRemote(remote, local, {}, NONE)).toEqual(remote)
})

test('a card whose move is pending keeps its column and order here', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'backlog', { title: 'Renamed' })]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'pending'), NONE)).toEqual(
    [{ ...remote[0], column: 'claude', order: 9 }],
  )
})

test('a card whose move failed keeps its column and order here', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'backlog')]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'failed'), NONE)).toEqual([
    { ...remote[0], column: 'claude', order: 9 },
  ])
})

test('a move that has settled no longer outranks the remote', () => {
  const mine = cardOf(1, 'claude', { order: 9 })
  const remote = [cardOf(1, 'human')]

  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'ok'), NONE)).toEqual(
    remote,
  )
})

test('a card whose move was confirmed while the load was reading keeps its column and order here', () => {
  const mine = cardOf(1, 'human', { order: 9 })
  const remote = [cardOf(1, 'backlog', { title: 'Renamed' })]
  const confirmed = new Set([mine.id])

  expect(mergeRemote(remote, [mine], {}, confirmed)).toEqual([
    { ...remote[0], column: 'human', order: 9 },
  ])
  expect(mergeRemote(remote, [mine], syncOf(mine.id, 'ok'), confirmed)).toEqual(
    [{ ...remote[0], column: 'human', order: 9 }],
  )
  expect(mergeRemote(remote, [mine], {}, new Set(['gh:99']))).toEqual(remote)
})

test('a card put after another keeps its place among the cards a load brings', () => {
  const mine = cardOf(1, 'backlog', { order: 15 })
  const remote = [
    cardOf(1, 'backlog', { order: 30 }),
    cardOf(2, 'backlog', { order: 10 }),
    cardOf(3, 'backlog', { order: 20 }),
  ]
  const placed = (
    phase: KanbanSync['phase'],
    place: Partial<KanbanSync>,
    confirmed = NONE,
  ) =>
    mergeRemote(
      remote,
      [mine],
      {
        [mine.id]: {
          cardId: mine.id,
          from: 'backlog',
          to: 'backlog',
          phase,
          attempts: 1,
          ...place,
        },
      },
      confirmed,
    )
      .sort((a, b) => a.order - b.order)
      .map(one => one.number)

  // Put after card 2: the load's own orders for 2 and 3 are the ones it sits between.
  expect(placed('pending', { after: 'gh:2' })).toEqual([2, 1, 3])
  expect(placed('failed', { after: 'gh:2' })).toEqual([2, 1, 3])
  expect(placed('pending', { after: null })).toEqual([1, 2, 3])
  // The place asked for last is the one kept.
  expect(
    placed('pending', {
      after: null,
      queued: 'backlog',
      queuedAfter: 'gh:3',
    }),
  ).toEqual([2, 3, 1])
  // A settled move is the remote's again, unless the load may have read before it.
  expect(placed('ok', { after: 'gh:2' })).toEqual([2, 3, 1])
  expect(
    placed('ok', { after: 'gh:2' }, new Set(['gh:1'])),
  ).toEqual([2, 1, 3])
})

test('a card gone from the remote stays only while its move is pending', () => {
  const moving = cardOf(1, 'claude')
  const other = cardOf(2, 'backlog')

  expect(
    mergeRemote([], [moving, other], syncOf(moving.id, 'pending'), NONE),
  ).toEqual([moving])
  expect(mergeRemote([], [moving, other], {}, NONE)).toEqual([])
})

test('the board reloads every 45 seconds while the pane is open', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(github.loads()).toBe(1)

  await clock.advance(POLL - 1)
  expect(github.loads()).toBe(1)

  await clock.advance(1)
  expect(github.loads()).toBe(2)

  await clock.advance(POLL)
  expect(github.loads()).toBe(3)
})

test('a poll shows a card added on GitHub', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await row(ui, 'card:gh:5')).toBeUndefined()

  github.cards.push(issue(5, { title: 'Fresh' }))
  await clock.advance(POLL)

  expect((await row(ui, 'card:gh:5'))?.text).toContain('Fresh')
  await ui.unmount()
})

test('polling ends once the pane is closed and starts again when it reopens', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  await clock.advance(POLL)
  expect(github.loads()).toBe(2)

  world.panes = []
  await clock.advance(POLL)
  await clock.advance(POLL)
  expect(github.loads()).toBe(2)

  world.panes = ['kanban']
  await $.command.run({ ...RUN })
  await clock.settle()
  expect(github.loads()).toBe(3)
  await clock.advance(POLL)
  expect(github.loads()).toBe(4)
})

test('a poll that was asking for the panes when the pane opened again does not end the new polling', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  // The ages tick at 30 s, the poll at 45 s.
  await clock.advance(AGE)
  expect(github.loads()).toBe(1)
  let release = () => {}
  world.holdPanes = new Promise<void>(resolve => {
    release = resolve
  })

  // The poll asks while the pane is shut; the pane opens, restarting the polling,
  // before the answer comes.
  world.panes = []
  await clock.advance(POLL - AGE)
  world.panes = ['kanban']
  await $.command.run({ ...RUN })
  await clock.settle()
  expect(github.loads()).toBe(2)
  release()
  await clock.settle()

  await clock.advance(POLL)
  expect(github.loads()).toBe(3)
})

test('a reload at the session start restarts the polling instead of doubling it', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(github.loads()).toBe(1)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(github.loads()).toBe(2)

  await clock.advance(POLL)
  expect(github.loads()).toBe(3)
})

test('a poll does not undo a move that is still pending', async ($, on) => {
  const { clock, github, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const moving = $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  // Past the pause for further moves the move is out, held at the write.
  await clock.advance(SYNC_PAUSE)
  const before = github.loads()
  await clock.advance(POLL)
  expect(github.loads()).toBe(before + 1)
  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    result: expect.stringContaining('#3 [claude] Write docs'),
  })
  release()
  await moving
})

// A poll starts its load, which reads the board as it stands but whose answer is late.
// Card 3 then moves to Human and the backend confirms; only then does the load land,
// with card 3 as it was before the move.
async function moveDuringLoad($: Engine, on: Parameters<typeof bootGithub>[0]) {
  const kit = bootGithub(on, cards())
  await open($)
  await kit.clock.settle()
  kit.world.panes = ['kanban']
  kit.github.cards.push(issue(5, { title: 'Fresh' }))
  let answer = () => {}
  kit.github.holdReads = new Promise<void>(resolve => {
    answer = resolve
  })
  const loads = kit.github.loads()

  await kit.clock.advance(POLL)
  await kit.clock.settle()
  // Only the poll's load waits; what the move reads is answered.
  kit.github.holdReads = undefined
  await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'human',
  })
  await kit.clock.advance(SYNC_PAUSE)
  const docs = kit.github.card(3)
  expect(docs.status).toBe('In review')
  expect(kit.github.loads()).toBe(loads)
  // The load lands with what it read: card 3 still in Backlog.
  const release = async () => {
    docs.status = 'Backlog'
    answer()
    await kit.clock.settle()
    docs.status = 'In review'
  }

  return { ...kit, release }
}

test('a load that read before a move was confirmed does not undo it', async ($, on) => {
  const { clock, toasts, statuses, release } = await moveDuringLoad($, on)
  expect(toasts).toEqual(['Waiting on you: #3 Write docs'])

  await release()
  await clock.settle()

  // The load landed: the new card is on the board.
  expect(
    await $.tool.call({ tool: 'mcp__kanban__kanban_list', column: 'backlog' }),
  ).toMatchObject({ result: expect.stringContaining('#5 [backlog] Fresh') })
  expect(
    await $.tool.call({ tool: 'mcp__kanban__kanban_list', column: 'human' }),
  ).toMatchObject({
    result: expect.stringContaining('#3 [human] Write docs'),
  })
  expect(statuses.at(-1)).toBe('2 cards waiting on you')

  await clock.advance(POLL)
  expect(toasts).toEqual(['Waiting on you: #3 Write docs'])
})

test('a slow load does not undo a move whose mark is already gone', async ($, on) => {
  const { clock, toasts, release } = await moveDuringLoad($, on)

  await clock.advance(5000)
  await release()
  await clock.settle()

  expect(
    await $.tool.call({ tool: 'mcp__kanban__kanban_list', column: 'human' }),
  ).toMatchObject({
    result: expect.stringContaining('#3 [human] Write docs'),
  })
  await clock.advance(POLL)
  expect(toasts).toEqual(['Waiting on you: #3 Write docs'])
})

test('the pane opens from the saved board while the first load runs', async ($, on) => {
  const { clock, github } = bootGithub(on, cards(), saved([SAVED_CARD]))
  let release = () => {}
  github.holdReads = new Promise<void>(resolve => {
    release = resolve
  })
  await open($)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await row(ui, 'card:gh:9'))?.text).toContain('Cached card')
  expect(await row(ui, 'card:gh:1')).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /loading/ })).toBeDefined()

  release()
  await clock.settle()

  expect(await row(ui, 'card:gh:9')).toBeUndefined()
  expect((await row(ui, 'card:gh:1'))?.text).toContain('Fix login')
  expect(await ui.find({ type: 'Text', text: /loading/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /updated/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call waits for the load rather than reading the saved board', async ($, on) => {
  const { clock, github } = bootGithub(on, cards(), saved([SAVED_CARD]))
  let release = () => {}
  github.holdReads = new Promise<void>(resolve => {
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
  const { clock, saved: store } = bootGithub(on, cards())
  await open($)
  await clock.settle()

  const entry = JSON.parse(store.get(`cache:${CWD}`) ?? 'null')

  expect(entry).toMatchObject({
    shape: 'cache-4',
    backend: { kind: 'github', repo: REPO, projectId: PROJECT },
    cards: expect.arrayContaining([
      expect.objectContaining({ id: 'gh:1', column: 'human' }),
    ]),
  })
  expect(entry.cards).toHaveLength(4)
})

test('a saved board of another shape is ignored', async ($, on) => {
  const stale = { [`cache:${CWD}`]: { shape: 'cache-0', cards: 'nope' } }
  const { clock, github, logs } = bootGithub(on, cards(), stale)
  let release = () => {}
  github.holdReads = new Promise<void>(resolve => {
    release = resolve
  })
  await open($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await rowKeys(ui)).filter(key => key.startsWith('card:'))).toEqual([])

  release()
  await clock.settle()

  expect((await row(ui, 'card:gh:1'))?.text).toContain('Fix login')
  expect(logs.filter(line => line.includes('saved board'))).toEqual([])
  await ui.unmount()
})

test('the board saved for another directory is not shown', async ($, on) => {
  const { clock, github } = bootGithub(
    on,
    cards(),
    saved([SAVED_CARD], 'cache:/elsewhere'),
  )
  github.holdReads = new Promise<void>(() => {})
  await open($)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await row(ui, 'card:gh:9')).toBeUndefined()
  await ui.unmount()
})

test('the status line counts the cards waiting on you', async ($, on) => {
  const { clock, github, statuses, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(statuses.at(-1)).toBe('1 card waiting on you')

  github.cards.push(issue(5, { column: 'human', title: 'Fresh' }))
  await clock.advance(POLL)
  expect(statuses.at(-1)).toBe('2 cards waiting on you')

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 1, to: 'done' })
  expect(statuses.at(-1)).toBe('1 card waiting on you')

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 5, to: 'claude' })
  expect(statuses.at(-1)).toBeUndefined()
})

test('the status line is shown the moment a card moves to Human', async ($, on) => {
  const { clock, github, statuses } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
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
  const { clock, github, toasts, notices, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  expect(toasts).toEqual([])

  github.cards.push(issue(5, { column: 'human', title: 'Fresh' }))
  await clock.advance(POLL)

  expect(toasts).toEqual(['Waiting on you: #5 Fresh'])
  expect(notices).toEqual([])

  await clock.advance(POLL)
  expect(toasts).toHaveLength(1)
})

test('a card the person moves to Human is not announced to them', async ($, on) => {
  const { clock, toasts, notices, world } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await click(ui, 'card:gh:3')
  await ui.press({ key: 'move:human' })
  await clock.advance(POLL)

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
  await ui.unmount()
})

test('a card Claude moves to Human is a toast and a notification', async ($, on) => {
  const { clock, toasts, notices, statuses } = bootGithub(on, cards())
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
  const { clock, toasts, notices } = bootGithub(on, cards())
  await open($)
  await clock.settle()

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 3, to: 'claude' })
  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 1, to: 'human' })

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

test('a move the backend refuses is not announced as handed over', async ($, on) => {
  const { clock, github, toasts, notices, statuses } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  github.fail['project item-edit'] = {
    exitCode: 1,
    stderr: 'GraphQL: Resource not accessible by integration',
  }

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
  expect(toasts[0]).toContain('Resource not accessible')
  expect(notices).toEqual([])
  expect(statuses.at(-1)).toBe('1 card waiting on you')
  await ui.unmount()
})

test('cards that reached Human since the saved board are announced, the rest are not', async ($, on) => {
  const known = cardOf(1, 'human', { title: 'Fix login' })
  const { clock, github, toasts } = bootGithub(on, cards(), saved([known]))
  github.cards.push(issue(5, { column: 'human', title: 'Fresh' }))

  await open($)
  await clock.settle()

  expect(toasts).toEqual(['Waiting on you: #5 Fresh'])
})

test('the first load ever announces nothing', async ($, on) => {
  const { clock, toasts, notices } = bootGithub(on, cards())

  await open($)
  await clock.settle()

  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

const HUMAN_CARDS = [
  cardOf(7, 'human', { title: 'First cached' }),
  cardOf(8, 'human', { title: 'Second cached' }),
  cardOf(9, 'claude', { title: 'Busy cached' }),
]

const savedHuman = (savedCards = HUMAN_CARDS) => saved(savedCards)

async function startClosed($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('the status line is set at the session start from the saved board with the pane closed', async ($, on) => {
  const { clock, github, statuses } = bootGithub(on, cards(), savedHuman())

  await startClosed($)
  await clock.settle()

  expect(statuses).toEqual(['2 cards waiting on you'])
  expect(github.loads()).toBe(0)
})

test('a saved board with nobody waiting leaves the status line empty', async ($, on) => {
  const { clock, statuses } = bootGithub(
    on,
    cards(),
    savedHuman([cardOf(9, 'claude')]),
  )

  await startClosed($)
  await clock.settle()

  expect(statuses.filter(text => text !== undefined)).toEqual([])
})

test('no saved board leaves the status line alone at the session start', async ($, on) => {
  const { clock, github, statuses } = bootGithub(on, cards())

  await startClosed($)
  await clock.settle()

  // Finding the backend clears the line; it never shows a count.
  expect(statuses.filter(text => text !== undefined)).toEqual([])
  expect(github.loads()).toBe(0)
})

test('a board saved for another directory does not set the status line', async ($, on) => {
  const { clock, statuses } = bootGithub(on, cards(), {
    'cache:/elsewhere': savedHuman()[`cache:${CWD}`],
  })

  await startClosed($)
  await clock.settle()

  // Finding the backend clears the line; it never shows a count.
  expect(statuses.filter(text => text !== undefined)).toEqual([])
})

test('a load after the session start replaces the saved count and tools never see the saved cards', async ($, on) => {
  const { clock, github, statuses } = bootGithub(on, cards(), savedHuman())
  await startClosed($)
  await clock.settle()
  expect(statuses.at(-1)).toBe('2 cards waiting on you')
  expect(github.loads()).toBe(0)

  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(github.loads()).toBe(1)
  expect(statuses.at(-1)).toBe('1 card waiting on you')
  expect(listed).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login'),
  })
  expect(JSON.stringify(listed)).not.toContain('cached')
})

test('the saved count does not replace the count of a board already loaded', async ($, on) => {
  const { clock, saved: store, statuses } = bootGithub(on, cards())
  await open($)
  await clock.settle()
  expect(statuses.at(-1)).toBe('1 card waiting on you')
  store.set(`cache:${CWD}`, JSON.stringify(savedHuman()[`cache:${CWD}`]))
  const before = statuses.length

  await startClosed($)
  await clock.settle()

  expect(statuses.slice(before)).toEqual([])
  expect(statuses.at(-1)).toBe('1 card waiting on you')
})

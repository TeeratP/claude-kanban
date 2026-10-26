import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import { row } from './board-ui'
import { HANDED_OFF, NOW, PANE, RUN, boot, card, path } from './fakes'

const AGE = 30_000
const LOGIN = 'card:md:0001-login'
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const

// Card 1 turns an hour old 15 s after the board opens: 59m now, 1h at the first tick.
const NEARLY_AN_HOUR = new Date(NOW - 59 * 60_000 - 45_000).toISOString()

const cards = () => ({
  [path(1, 'login')]: card(1, {
    status: 'human',
    title: 'Fix login',
    updated: NEARLY_AN_HOUR,
  }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  // Cards 3 and 4 are moved to Human by these tests, which needs a handoff.
  [path(3, 'docs')]: card(
    3,
    { status: 'backlog', title: 'Write docs' },
    HANDED_OFF,
  ),
  [path(4, 'ship')]: card(
    4,
    { status: 'backlog', title: 'Ship it' },
    HANDED_OFF,
  ),
})

async function open($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
}

test('the ages redraw every 30 seconds while the pane is open, before a poll would', async ($, on) => {
  const { clock, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await row(ui, LOGIN))?.text).toContain('59m')

  await clock.advance(AGE - 1)
  expect((await row(ui, LOGIN))?.text).toContain('59m')

  await clock.advance(1)
  expect((await row(ui, LOGIN))?.text).toContain('1h')
  await ui.unmount()
})

test('the ticker ends with the pane and does not start again by itself', async ($, on) => {
  const { clock, calls, world } = boot(on, cards())
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // Both the poll and the ticker fire with the pane closed and end.
  world.panes = []
  await clock.advance(90_000)
  expect((await row(ui, LOGIN))?.text).toContain('59m')

  // Open again with no new open: nothing is left to redraw or reload.
  world.panes = ['kanban']
  await clock.advance(90_000)
  expect((await row(ui, LOGIN))?.text).toContain('59m')
  expect(calls.lists).toBe(1)
  await ui.unmount()
})

test('a tick that was asking for the panes when the pane opened again does not end the new ticker', async ($, on) => {
  // Card 1 turns an hour old 45 s after the board opens, between the two ticks.
  const files = {
    ...cards(),
    [path(1, 'login')]: card(1, {
      status: 'human',
      title: 'Fix login',
      updated: new Date(NOW - 59 * 60_000 - 15_000).toISOString(),
    }),
  }
  const { clock, world } = boot(on, files)
  await open($)
  await clock.settle()
  world.panes = ['kanban']
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let release = () => {}
  world.holdPanes = new Promise<void>(resolve => {
    release = resolve
  })

  // The tick asks while the pane is shut; the pane opens, restarting the ticker,
  // before the answer comes.
  world.panes = []
  await clock.advance(AGE)
  world.panes = ['kanban']
  await $.command.run({ ...RUN })
  await clock.settle()
  release()
  await clock.settle()
  expect((await row(ui, LOGIN))?.text).toContain('59m')

  await clock.advance(AGE)
  expect((await row(ui, LOGIN))?.text).toContain('1h')
  await ui.unmount()
})

test('a pane left open across a reload keeps redrawing its ages', async ($, on) => {
  const { clock, world } = boot(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await row(ui, LOGIN))?.text).toContain('59m')

  await clock.advance(AGE)
  expect((await row(ui, LOGIN))?.text).toContain('1h')
  await ui.unmount()
})

// The title follows the count of cards in Human.
const titles = (opens: { title?: string }[]) => opens.map(one => one.title)

test('the pane title carries the Human count, set again only when it changes', async ($, on) => {
  const { clock, world } = boot(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  // Re-opening an open id retitles it. It must not ask for the keys (`focus`) or
  // change the size the pane asked for.
  expect(world.opens).toStrictEqual([
    { id: 'kanban', title: 'Kanban · 1', rows: 30, columns: 44 },
  ])

  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.settle()
  expect(titles(world.opens)).toEqual(['Kanban · 1', 'Kanban · 2'])

  // A poll and a move inside Human leave the count, so the title alone.
  await clock.advance(45_000)
  expect(titles(world.opens)).toEqual(['Kanban · 1', 'Kanban · 2'])

  await $.tool.call({ ...MOVE, card: 3, to: 'done' })
  await clock.settle()
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await clock.settle()
  expect(titles(world.opens)).toEqual([
    'Kanban · 1',
    'Kanban · 2',
    'Kanban · 1',
    'Kanban',
  ])
  expect(world.opens.every(one => one.focus === undefined)).toBe(true)
})

test('the pane title is kept when the person opens the pane again', async ($, on) => {
  const { clock, world } = boot(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(titles(world.opens)).toEqual(['Kanban · 1'])

  // /kanban opens with the plain title; the count has not changed since.
  await $.command.run({ ...RUN })
  await clock.settle()

  expect(titles(world.opens)).toEqual(['Kanban · 1', 'Kanban', 'Kanban · 1'])
})

test('the title is left alone while the pane is closed or waits undrawn', async ($, on) => {
  const { clock, world } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.settle()
  // The pane was never opened, so nothing is retitled (a retitle would open it).
  expect(world.opens).toEqual([])

  world.panes = ['kanban']
  world.isPlaced = false
  await $.tool.call({ ...MOVE, card: 4, to: 'human' })
  await clock.settle()
  expect(world.opens).toEqual([])

  world.isPlaced = true
  await $.tool.call({ ...MOVE, card: 4, to: 'done' })
  await clock.settle()
  expect(titles(world.opens)).toEqual(['Kanban · 2'])
})

test('a pane that closes while the retitle waits for the panes is not opened again', async ($, on) => {
  const { clock, world } = boot(on, cards())
  world.panes = ['kanban']
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  let release = () => {}
  world.holdPanes = new Promise<void>(resolve => {
    release = resolve
  })

  // The retitle for Human 2 is told the pane is open; the pane closes before it opens.
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  world.panes = []
  release()
  await clock.settle()

  expect(titles(world.opens)).toEqual(['Kanban · 1'])
})

// The test kit's `$.ui` cannot close a pane, so a plugin of the test does, as a person's
// close or an unload would reach the kanban hooks.
const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('command.run', { command: 'close-kanban' }, async $ => {
      await $.ui.close({ id: 'kanban' })

      return { text: 'closed' }
    })
  },
}

test(
  'a pane that closes after the retitle asked for the panes again is not opened again',
  { plugins: [CLOSER] },
  async ($, on) => {
    const { clock, world } = boot(on, cards())
    world.panes = ['kanban']
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await clock.settle()
    let releaseFirst = () => {}
    world.holdPanes = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    // The retitle for Human 2 is told the pane is open twice. The pane closes after the
    // second list is taken, so the retitle's last look at the panes is out of date.
    await $.tool.call({ ...MOVE, card: 3, to: 'human' })
    let releaseSecond = () => {}
    releaseFirst()
    world.holdPanes = new Promise<void>(resolve => {
      releaseSecond = resolve
    })
    await clock.settle()
    await $.command.run({ ...RUN, command: 'close-kanban' })
    releaseSecond()
    await clock.settle()

    expect(world.panes).toEqual([])
    expect(titles(world.opens)).toEqual(['Kanban · 1'])
  },
)

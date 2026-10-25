import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { claudeLimit } from '../hooks/queue'
import { click, hasClient, listRows, row, rowStyle } from './board-ui'
import type { BoardUi } from './board-ui'
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

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

const ALPHA = 'card:md:0001-alpha'
const BETA = 'card:md:0002-beta'
const GAMMA = 'card:md:0003-gamma'
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const
const KEY = `queue:${CWD}:auto`

// Every card has a handoff, so any of them can be given to the person.
const backlog = () => ({
  [path(1, 'alpha')]: card(1, { title: 'Alpha' }, HANDED_OFF),
  [path(2, 'beta')]: card(2, { title: 'Beta' }, HANDED_OFF),
  [path(3, 'gamma')]: card(3, { title: 'Gamma' }, HANDED_OFF),
})

const saved = (held: Record<string, string>) => ({
  [KEY]: { shape: 'queue-1', held },
})

async function open<S extends Surface = 'terminal'>(
  $: Engine,
  on: On,
  files: Record<string, string>,
  surface: S = 'terminal' as S,
  store?: Record<string, unknown>,
) {
  const world = boot(on, files, store)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

// The pane open on the saved board, with the first load held until `release()`.
async function openHeld(
  $: Engine,
  on: On,
  files: Record<string, string>,
  store: Record<string, unknown>,
) {
  const world = boot(on, files, store)
  let release = () => {}
  world.calls.holdList = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, calls: { ...world.calls, release }, ui }
}

/** Moves a card to Claude from its detail view, as the person does, and returns to the board. */
async function toClaude(ui: BoardUi, key: string) {
  await click(ui, key)
  await ui.press({ key: 'move:claude' })
  await ui.press({ key: 'back' })
}

const text = async (ui: BoardUi, key: string) =>
  (await row(ui, key))?.text ?? ''
// Whether a card's row is drawn dim: the Client dims its Text, the Buttons themselves.
async function isDim(ui: BoardUi, key: string, number: number) {
  if (!(await hasClient(ui))) return (await rowStyle(ui, key)).dimColor === true

  const lefts = await ui.findAll({
    type: 'Text',
    text: new RegExp(`^ {2}#${number} `),
    in: 'board',
  })

  return lefts.some(left => left.props.dimColor === true)
}
const held = (store: Map<string, string>) =>
  Object.keys(JSON.parse(store.get(KEY) ?? '{"held":{}}').held)

for (const surface of SURFACES) {
  test(`a second card moved to Claude waits: no prompt, a dim mark and a count in the header on the ${surface}`, async ($, on) => {
    const {
      clock,
      ui,
      files,
      prompts,
      saved: store,
    } = await open($, on, backlog(), surface)

    await toClaude(ui, ALPHA)
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([
      expect.stringMatching(/^Work on kanban card #1 "Alpha": read it with/),
    ])

    await toClaude(ui, BETA)
    await clock.advance(SYNC_PAUSE)
    // The card is in Claude on the backend, in Status In progress, but not started.
    expect(files[path(2, 'beta')]).toContain('status: claude')
    expect(prompts).toHaveLength(1)
    await clock.advance(2500)
    expect(prompts).toHaveLength(1)

    expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
    expect(await text(ui, BETA)).toContain('queued 1')
    expect(await text(ui, ALPHA)).not.toContain('queued')
    expect(await isDim(ui, BETA, 2)).toBe(true)
    expect(await isDim(ui, ALPHA, 1)).toBe(false)
    expect(held(store)).toEqual(['md:0002-beta'])
    await ui.unmount()
  })
}

test('the card that hands off starts the queued one with exactly one prompt', async ($, on) => {
  const { clock, ui, prompts, saved: store } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await toClaude(ui, GAMMA)
  await clock.advance(2500)
  expect(prompts).toHaveLength(1)
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 2 queued')
  expect(await text(ui, GAMMA)).toContain('queued 2')

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  // One at a time: Beta started, Gamma still waits behind it.
  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #1 "Alpha"/),
    expect.stringMatching(/^Work on kanban card #2 "Beta"/),
  ])
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(await text(ui, BETA)).not.toContain('queued')
  expect(await text(ui, GAMMA)).toContain('queued 1')
  expect(held(store)).toEqual(['md:0003-gamma'])

  await $.tool.call({ ...MOVE, card: 2, to: 'done' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toHaveLength(3)
  expect(prompts[2]).toMatch(/^Work on kanban card #3 "Gamma"/)
  expect(held(store)).toEqual([])
  await clock.advance(2500)
  expect(prompts).toHaveLength(3)
  await ui.unmount()
})

test('a queued card starts when the card ahead is parked or dropped back to Backlog', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)

  await click(ui, ALPHA)
  await ui.press({ key: 'move:backlog' })
  expect(prompts).toHaveLength(1)
  await clock.advance(SYNC_PAUSE)

  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  await clock.advance(2500)
  await ui.unmount()
})

test(
  'with no limit every card moved to Claude is asked at once',
  { options: { claudeLimit: 0 } },
  async ($, on) => {
    const { clock, ui, prompts } = await open($, on, backlog())

    await toClaude(ui, ALPHA)
    await toClaude(ui, BETA)
    await toClaude(ui, GAMMA)
    await clock.advance(SYNC_PAUSE)
    await clock.advance(2500)

    expect(prompts).toHaveLength(3)
    expect(await text(ui, 'hdr:claude')).toBe('▾ Claude 3')
    expect(await text(ui, GAMMA)).not.toContain('queued')
    await ui.unmount()
  },
)

test(
  'a higher limit lets that many cards work at once and queues the rest',
  { options: { claudeLimit: 2 } },
  async ($, on) => {
    const { clock, ui, prompts } = await open($, on, backlog())

    await toClaude(ui, ALPHA)
    await toClaude(ui, BETA)
    await toClaude(ui, GAMMA)
    await clock.advance(SYNC_PAUSE)
    await clock.advance(2500)

    expect(prompts).toHaveLength(2)
    expect(await text(ui, 'hdr:claude')).toContain('Claude 2/2 · 1 queued')
    expect(await text(ui, GAMMA)).toContain('queued 1')
    await ui.unmount()
  },
)

test('the limit setting is a whole number, 0 for none, and the default otherwise', () => {
  expect(claudeLimit(undefined)).toBe(1)
  expect(claudeLimit(0)).toBe(0)
  expect(claudeLimit(3)).toBe(3)
  expect(claudeLimit(2.9)).toBe(2)
  expect(claudeLimit(-1)).toBe(1)
  expect(claudeLimit(Number.NaN)).toBe(1)
  expect(claudeLimit('2')).toBe(1)
})

const queuedFiles = () => ({
  [path(1, 'alpha')]: card(1, { status: 'claude', title: 'Alpha' }, HANDED_OFF),
  [path(2, 'beta')]: card(2, { status: 'claude', title: 'Beta' }, HANDED_OFF),
})

test('the queue is read back after a reload and the card starts when the one ahead hands off', async ($, on) => {
  const { clock, ui, prompts } = await open(
    $,
    on,
    queuedFiles(),
    'terminal',
    saved({ 'md:0002-beta': 'work' }),
  )

  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(await text(ui, BETA)).toContain('queued 1')
  expect(prompts).toEqual([])

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #2 "Beta"/),
  ])
  await clock.advance(2500)
  await ui.unmount()
})

test('a session start in the same session keeps the queue', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test(
  'a limit raised since the queue was saved starts the waiting cards at the first load',
  { options: { claudeLimit: 2 } },
  async ($, on) => {
    const {
      clock,
      ui,
      prompts,
      saved: store,
    } = await open(
      $,
      on,
      queuedFiles(),
      'terminal',
      saved({ 'md:0002-beta': 'work' }),
    )

    expect(prompts).toEqual([
      expect.stringMatching(/^Work on kanban card #2 "Beta"/),
    ])
    expect(held(store)).toEqual([])
    expect(await text(ui, 'hdr:claude')).toContain('Claude 2/2')
    expect(await text(ui, 'hdr:claude')).not.toContain('queued')
    await clock.advance(2500)
    await ui.unmount()
  },
)

test(
  'a limit lowered since the queue was saved stops no card, it only makes new ones wait',
  { options: { claudeLimit: 1 } },
  async ($, on) => {
    const files = {
      ...queuedFiles(),
      [path(3, 'gamma')]: card(3, { title: 'Gamma' }, HANDED_OFF),
    }
    const { clock, ui, prompts } = await open($, on, files)

    // Two cards in Claude already, over the limit of 1: nothing is stopped.
    expect(await text(ui, 'hdr:claude')).toContain('Claude 2/1')
    await toClaude(ui, GAMMA)
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([])
    expect(await text(ui, 'hdr:claude')).toContain('Claude 2/1 · 1 queued')

    await $.tool.call({ ...MOVE, card: 1, to: 'human' })
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([])
    await $.tool.call({ ...MOVE, card: 2, to: 'human' })
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([
      expect.stringMatching(/^Work on kanban card #3 "Gamma"/),
    ])
    await clock.advance(2500)
    await ui.unmount()
  },
)

test('the queue is saved apart for each directory setting and ignored in another', async ($, on) => {
  const {
    clock,
    ui,
    saved: store,
  } = await open($, on, queuedFiles(), 'terminal', {
    ...saved({ 'md:0002-beta': 'work' }),
    [`queue:${CWD}:github`]: {
      shape: 'queue-1',
      held: { 'md:0001-alpha': 'work' },
    },
  })

  expect(await text(ui, BETA)).toContain('queued 1')
  expect(await text(ui, ALPHA)).not.toContain('queued')
  expect(held(store)).toEqual(['md:0002-beta'])
  expect(
    Object.keys(JSON.parse(store.get(`queue:${CWD}:github`) ?? '{}').held),
  ).toEqual(['md:0001-alpha'])
  await clock.advance(2500)
  await ui.unmount()
})

test('a saved queue of another shape or with bad entries is ignored', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, queuedFiles(), 'terminal', {
    [KEY]: { shape: 'queue-0', held: { 'md:0002-beta': 'work' } },
  })

  expect(await text(ui, 'hdr:claude')).toContain('Claude 2/1')
  expect(await text(ui, BETA)).not.toContain('queued')
  expect(prompts).toEqual([])
  await clock.advance(2500)
  await ui.unmount()
})

test('queued cards start in the section order, not the order they were queued in', async ($, on) => {
  const files = {
    [path(1, 'alpha')]: card(
      1,
      { status: 'claude', title: 'Alpha', order: 1 },
      HANDED_OFF,
    ),
    [path(2, 'beta')]: card(
      2,
      { status: 'claude', title: 'Beta', order: 5 },
      HANDED_OFF,
    ),
    [path(3, 'gamma')]: card(
      3,
      { status: 'claude', title: 'Gamma', order: 3 },
      HANDED_OFF,
    ),
  }
  const { clock, ui, prompts } = await open(
    $,
    on,
    files,
    'terminal',
    saved({ 'md:0002-beta': 'work', 'md:0003-gamma': 'work' }),
  )

  expect(await text(ui, GAMMA)).toContain('queued 1')
  expect(await text(ui, BETA)).toContain('queued 2')

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #3 "Gamma"/),
  ])

  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  await clock.advance(2500)
  await ui.unmount()
})

test('a queued card the person moves out of Claude leaves the queue and is never asked', async ($, on) => {
  const { clock, ui, prompts, saved: store } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await toClaude(ui, GAMMA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)
  expect(held(store)).toEqual(['md:0002-beta', 'md:0003-gamma'])

  await click(ui, BETA)
  await ui.press({ key: 'move:backlog' })
  await ui.press({ key: 'back' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(await text(ui, GAMMA)).toContain('queued 1')
  expect(held(store)).toEqual(['md:0003-gamma'])

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #3 "Gamma"/)
  await clock.advance(2500)
  await ui.unmount()
})

test('a queued card put in a new place in Claude stays queued, and the queue follows the new order', async ($, on) => {
  const { clock, ui, prompts, saved: store } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await toClaude(ui, GAMMA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)
  expect(await text(ui, BETA)).toContain('queued 1')
  expect(await text(ui, GAMMA)).toContain('queued 2')

  // Gamma is dragged up onto Beta: before it.
  const keysNow = (await listRows(ui)).map(one => one.key)
  const from = keysNow.indexOf(GAMMA)
  const to = keysNow.indexOf(BETA)
  const { pointer } = ui as unknown as {
    pointer: Mounted<'terminal'>['pointer']
  }
  await pointer({ type: 'down', x: 3, y: from, button: 'left' })
  await pointer({ type: 'move', x: 3, y: to, button: 'left' })
  await pointer({ type: 'up', x: 3, y: to, button: 'left' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(await text(ui, GAMMA)).toContain('queued 1')
  expect(await text(ui, BETA)).toContain('queued 2')
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 2 queued')
  expect(held(store).sort()).toEqual(['md:0002-beta', 'md:0003-gamma'])
  // A reorder sends no prompt.
  expect(prompts).toHaveLength(1)

  // When the running card hands off, the card that was moved up starts first.
  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #3 "Gamma"/)
  await ui.unmount()
})

test('a queued card moved to Backlog and back to Claude queues again, at the end', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await toClaude(ui, GAMMA)
  await clock.advance(SYNC_PAUSE)

  await click(ui, BETA)
  await ui.press({ key: 'move:backlog' })
  await ui.press({ key: 'move:claude' })
  await ui.press({ key: 'back' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(prompts).toHaveLength(1)
  expect(await text(ui, GAMMA)).toContain('queued 1')
  expect(await text(ui, BETA)).toContain('queued 2')
  await ui.unmount()
})

test('a card that left Claude behind our back is dropped from the queue at the next load', async ($, on) => {
  const {
    clock,
    calls,
    ui,
    prompts,
    saved: store,
  } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)
  expect(held(store)).toEqual(['md:0002-beta'])

  // The person edits the card file themselves, as they may.
  calls.edit(
    path(2, 'beta'),
    card(2, { status: 'backlog', title: 'Beta' }, HANDED_OFF),
  )
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1')
  expect(await text(ui, 'hdr:claude')).not.toContain('queued')
  expect(held(store)).toEqual([])

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test('a card that hands off by a file edit starts the queued one at the next load', async ($, on) => {
  const { clock, calls, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  calls.edit(
    path(1, 'alpha'),
    card(1, { status: 'done', title: 'Alpha' }, HANDED_OFF),
  )
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  await clock.advance(2500)
  await ui.unmount()
})

test('send back respects the limit too: the resume prompt waits for a slot', async ($, on) => {
  const files = {
    [path(1, 'alpha')]: card(
      1,
      { status: 'claude', title: 'Alpha' },
      HANDED_OFF,
    ),
    [path(2, 'beta')]: card(2, { status: 'human', title: 'Beta' }, HANDED_OFF),
  }
  const { clock, ui, prompts, saved: store } = await open($, on, files)

  await click(ui, BETA)
  await ui.input({ key: 'feedback', text: 'Add a test' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  // The feedback is recorded and the card is in Claude, waiting.
  expect(files[path(2, 'beta')]).toContain(
    '## Feedback (2026-10-25)\nAdd a test',
  )
  expect(files[path(2, 'beta')]).toContain('status: claude')
  expect(prompts).toEqual([])
  expect(await text(ui, BETA)).toContain('queued 1')
  expect(JSON.parse(store.get(KEY) ?? '{}').held).toEqual({
    'md:0002-beta': 'resume',
  })

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([
    expect.stringMatching(/^Resume kanban card #2: read the newest feedback/),
  ])
  await clock.advance(2500)
  await ui.unmount()
})

test('a card whose move to Claude is given up frees its slot for the queue', async ($, on) => {
  const { clock, calls, ui, prompts, toasts } = await open($, on, backlog())
  calls.denyWrite = 'EACCES: read-only'

  await toClaude(ui, ALPHA)
  await clock.advance(SYNC_PAUSE)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')

  // Alpha is tried again until the card goes back; Beta, still waiting, goes on.
  for (let tries = 0; tries < 3; tries += 1) {
    await click(ui, ALPHA)
    await ui.press({ key: 'retry' })
    await ui.press({ key: 'back' })
    await clock.settle()
  }
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(
    /^Could not move #1 to Claude, so it is back in Backlog/,
  )
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1')
  expect(await text(ui, 'hdr:claude')).not.toContain('queued')

  // Beta's own move is not confirmed yet, so its prompt goes out when it is.
  expect(prompts).toEqual([])
  calls.denyWrite = undefined
  await click(ui, BETA)
  await ui.press({ key: 'retry' })
  await clock.settle()
  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #2 "Beta"/),
  ])
  await clock.advance(2500)
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test('the queue waits for the backend to confirm a card leaving Claude', async ($, on) => {
  const { clock, calls, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  // Alpha shows in Human already, but the backend has not said so.
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(prompts).toHaveLength(1)

  release()
  await clock.settle()
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  await clock.advance(2500)
  await ui.unmount()
})

test('a card moved to Claude as another leaves goes behind the ones already waiting', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await toClaude(ui, GAMMA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(await text(ui, GAMMA)).toContain('queued 1')
  await ui.unmount()
})

test('a card moved in while the first load runs goes behind the one already waiting', async ($, on) => {
  const files = {
    ...backlog(),
    [path(2, 'beta')]: card(2, { status: 'claude', title: 'Beta' }, HANDED_OFF),
  }
  const shown = (number: number, name: string, column: string) => ({
    id: `md:${String(number).padStart(4, '0')}-${name}`,
    number,
    title: name[0]?.toUpperCase() + name.slice(1),
    column,
    order: number,
    file: path(number, name),
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T11:00:00Z',
  })
  const { clock, calls, ui, prompts } = await openHeld($, on, files, {
    [`cache:${CWD}`]: {
      shape: 'cache-2',
      mode: 'auto',
      backend: { kind: 'local' },
      cards: [
        shown(1, 'alpha', 'backlog'),
        shown(2, 'beta', 'claude'),
        shown(3, 'gamma', 'backlog'),
      ],
    },
    ...saved({ 'md:0002-beta': 'work' }),
  })

  // The slot is free, as far as the saved board shows, but Beta is waiting for it.
  await toClaude(ui, GAMMA)
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([])
  calls.release()
  await clock.settle()
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #2 "Beta"/),
  ])
  expect(await text(ui, GAMMA)).toContain('queued 1')
  await ui.unmount()
})

test('kanban_list marks a waiting card, so Claude does not take it up itself', async ($, on) => {
  const { clock, ui } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)

  const listed = await $.tool.call({
    tool: 'mcp__kanban__kanban_list',
    column: 'claude',
  })

  expect(listed).toMatchObject({
    result: expect.stringMatching(
      /#1 \[claude\] Alpha updated .*\n#2 \[claude\] Beta \(queued\) updated /,
    ),
  })
  await clock.advance(2500)
  await ui.unmount()
})

const QUESTION =
  '## Question (2026-10-25)\nWhich database should the tests use?'

test('an answer to a question respects the limit too: the prompt waits for a slot', async ($, on) => {
  const files = {
    [path(1, 'alpha')]: card(
      1,
      { status: 'claude', title: 'Alpha' },
      HANDED_OFF,
    ),
    [path(2, 'beta')]: card(
      2,
      { status: 'human', title: 'Beta' },
      `Spec text.\n\n${QUESTION}`,
    ),
  }
  const { clock, ui, prompts, saved: store } = await open($, on, files)

  await click(ui, BETA)
  await ui.input({ key: 'feedback', text: 'The staging one' })
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  expect(files[path(2, 'beta')]).toContain('## Answer (2026-10-25)')
  expect(files[path(2, 'beta')]).toContain('status: claude')
  expect(prompts).toEqual([])
  expect(await text(ui, BETA)).toContain('queued 1')
  expect(JSON.parse(store.get(KEY) ?? '{}').held).toEqual({
    'md:0002-beta': 'answer',
  })

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([
    'Resume kanban card #2: the person answered your question; read it with mcp__kanban__kanban_show and continue.',
  ])
  await clock.advance(2500)
  await ui.unmount()
})

test('a card that asks a question frees its slot for the queue', async ($, on) => {
  const { clock, ui, prompts } = await open($, on, backlog())
  await toClaude(ui, ALPHA)
  await toClaude(ui, BETA)
  await clock.advance(SYNC_PAUSE)
  await clock.advance(2500)

  await $.tool.call({
    tool: 'mcp__kanban__kanban_ask',
    card: 1,
    question: 'Which database should the tests use?',
  })
  await clock.advance(SYNC_PAUSE)

  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toMatch(/^Work on kanban card #2 "Beta"/)
  await clock.advance(2500)
  await ui.unmount()
})

// #28: a move out of Claude that was refused still holds its slot.
test('a refused move out of Claude keeps its slot: the queued card does not start until the move is confirmed, nor when it snaps back', async ($, on) => {
  const { clock, calls, ui, prompts, toasts } = await open(
    $,
    on,
    queuedFiles(),
    'terminal',
    saved({ 'md:0002-beta': 'work' }),
  )
  calls.denyWrite = 'EACCES: read-only'

  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  // Refused once: Alpha shows in Human but may still snap back to Claude.
  expect(await text(ui, ALPHA)).toContain('✕')
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(prompts).toEqual([])

  // Tried again until the card goes back: still the one running.
  for (let tries = 0; tries < 3; tries += 1) {
    await click(ui, ALPHA)
    await ui.press({ key: 'retry' })
    await ui.press({ key: 'back' })
    await clock.settle()
  }
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(
    /^Could not move #1 to Human, so it is back in Claude/,
  )
  expect(await text(ui, 'hdr:claude')).toContain('Claude 1/1 · 1 queued')
  expect(await text(ui, BETA)).toContain('queued 1')
  expect(prompts).toEqual([])

  // Once the backend takes the move, the slot is free.
  calls.denyWrite = undefined
  await $.tool.call({ ...MOVE, card: 1, to: 'human' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  expect(prompts).toEqual([
    expect.stringMatching(/^Work on kanban card #2 "Beta"/),
  ])
  await clock.advance(2500)
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { marks, row, rowIndex, under } from './board-ui'
import { cellWidth } from '../hooks/model'
import { stripRows } from '../hooks/suggest'
import { PANE, RUN, SCROLL, SYNC_PAUSE, boot, card, path } from './fakes'
import {
  ISSUE_CREATE,
  ITEM_ADD,
  ITEM_EDIT,
  KANBAN,
  LABEL_LIST,
  github,
  writes,
} from './github-board'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

const SUGGEST = 'mcp__kanban__kanban_suggest'
const FLAKY = {
  tool: SUGGEST,
  title: 'Fix flaky test',
  spec: 'The login test fails 1 in 10.',
  why: 'It blocks CI.',
} as const
const STORED = 'suggestions:/work'
// The facts a system prompt is composed from.
const COMPOSE = {
  model: 'model',
  promptModel: 'model',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
  [path(4, 'old')]: card(4, { status: 'done', title: 'Old thing' }),
})

async function open(
  $: Engine,
  on: On,
  surface: Surface,
  files: Record<string, string> = cards(),
  store?: Record<string, unknown>,
) {
  const world = boot(on, files, store)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

// What the plugin saved for the next start.
const savedTitles = (saved: Map<string, string>) => {
  const stored = JSON.parse(saved.get(STORED) ?? '{"items":[]}') as {
    items: { title: string }[]
  }

  return stored.items.map(one => one.title)
}

const suggest = ($: Engine, input: Record<string, unknown> = FLAKY) =>
  $.tool.call({ ...FLAKY, ...input })

test('stripRows counts the header, up to three suggestions and a +N more row', () => {
  expect([0, 1, 2, 3, 4, 9].map(stripRows)).toEqual([0, 2, 3, 4, 5, 5])
})

for (const surface of SURFACES) {
  test(`a suggestion shows as a row with Add and Dismiss, and toasts once, on the ${surface}`, async ($, on) => {
    const { files, saved, toasts, ui } = await open($, on, surface)
    expect(await ui.find({ type: 'Text', text: /Suggested/ })).toBeUndefined()

    const made = await suggest($)

    expect(made).toMatchObject({
      result: expect.stringContaining('Suggested "Fix flaky test"'),
    })
    expect(toasts).toEqual(['Claude suggests a card: Fix flaky test'])
    expect((await ui.find({ type: 'Text', text: /Suggested/ }))?.text).toBe(
      'Suggested (1)',
    )
    expect((await ui.find({ key: 'suggest:add:1' }))?.text).toBe(' Add')
    expect((await ui.find({ key: 'suggest:dismiss:1' }))?.text).toBe(' ✕')
    expect(
      (await ui.find({ type: 'Text', text: /Fix flaky test/ }))?.props.dimColor,
    ).toBe(true)
    // Nothing is created, and the list is untouched.
    expect(Object.keys(files)).toHaveLength(3)
    expect(await under(ui, 'hdr:backlog')).toEqual(['card:md:0003-docs'])
    expect(savedTitles(saved)).toEqual(['Fix flaky test'])
    await ui.unmount()
  })

  test(`Dismiss removes the suggestion and creates nothing, on the ${surface}`, async ($, on) => {
    const { clock, files, saved, ui } = await open($, on, surface)
    await suggest($)

    await ui.press({ key: 'suggest:dismiss:1' })
    await clock.settle()

    expect(await ui.find({ type: 'Text', text: /Suggested/ })).toBeUndefined()
    expect(await ui.find({ key: 'suggest:add:1' })).toBeUndefined()
    expect(Object.keys(files)).toHaveLength(3)
    expect(savedTitles(saved)).toEqual([])
    await ui.unmount()
  })

  test(`Add makes a Backlog card with the spec and the reason, and removes the suggestion, on the ${surface}`, async ($, on) => {
    const { clock, calls, files, saved, ui } = await open($, on, surface)
    await suggest($)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    const adding = ui.press({ key: 'suggest:add:1' })
    await clock.settle()

    // At once: the suggestion is gone and the card waits, marked syncing.
    expect(await ui.find({ key: 'suggest:add:1' })).toBeUndefined()
    expect(
      (await under(ui, 'hdr:backlog')).some(key => key.startsWith('card:new:')),
    ).toBe(true)
    expect(await marks(ui, '⟳')).toHaveLength(1)

    release()
    await adding
    await clock.settle()

    const text = files[path(5, 'fix-flaky-test')] ?? ''
    expect(text).toContain('title: Fix flaky test')
    expect(text).toContain('status: backlog')
    expect(text).toContain(
      'The login test fails 1 in 10.\n\nWhy: It blocks CI.\n',
    )
    expect(await under(ui, 'hdr:backlog')).toEqual([
      'card:md:0003-docs',
      'card:md:0005-fix-flaky-test',
    ])
    expect(savedTitles(saved)).toEqual([])
    await ui.unmount()
  })
}

test('a card the backend refuses puts the suggestion back, with a toast', async ($, on) => {
  const { clock, calls, files, saved, toasts, ui } = await open(
    $,
    on,
    'terminal',
  )
  await suggest($)
  await suggest($, { title: 'Second', spec: 's', why: '' })
  toasts.length = 0
  calls.denyWrite = 'EACCES: read-only'

  await ui.press({ key: 'suggest:add:1' })
  await clock.settle()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Could not add the card: .*EACCES: read-only$/)
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:md:0003-docs'])
  expect(Object.keys(files)).toHaveLength(3)
  expect(savedTitles(saved)).toEqual(['Fix flaky test', 'Second'])
  expect((await ui.find({ type: 'Text', text: /Suggested/ }))?.text).toBe(
    'Suggested (2)',
  )

  calls.denyWrite = undefined
  const [back] = (await ui.findAll({ type: 'Button' })).filter(
    one => one.key?.startsWith('suggest:add:') ?? false,
  )
  await ui.press({ key: back?.key ?? '' })
  await clock.settle()
  expect(files[path(5, 'fix-flaky-test')]).toBeDefined()
  await ui.unmount()
})

test('on GitHub Add creates the issue with the triage label, adds it to the board and removes the suggestion', async ($, on) => {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = github(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await suggest($, {
    title: 'Fix the login loop',
    spec: 'Users loop.',
    why: '',
  })

  await ui.press({ key: 'suggest:add:1' })
  await clock.settle()

  expect(writes(calls)).toEqual([
    ['gh', 'auth', 'status'],
    ['git', 'remote', 'get-url', 'origin'],
    LABEL_LIST,
    ISSUE_CREATE,
    ITEM_ADD,
    ITEM_EDIT,
  ])
  expect(calls.find(call => call.argv[2] === 'create')?.stdin).toBe(
    'Users loop.',
  )
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:4', 'card:gh:30'])
  expect(await ui.find({ key: 'suggest:add:1' })).toBeUndefined()
  await ui.unmount()
})

test('a suggestion with the title of an open card or of another suggestion is folded in, in any case', async ($, on) => {
  const { clock, calls, saved, toasts, ui } = await open($, on, 'terminal')

  const onCard = await suggest($, { title: 'write   DOCS' })
  expect(onCard).toMatchObject({
    result:
      '"write DOCS" is already a card or a suggestion; nothing was added.',
  })
  expect(toasts).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Suggested/ })).toBeUndefined()

  // A Done card is not open.
  expect(await suggest($, { title: 'old thing' })).toMatchObject({
    result: expect.stringContaining('Suggested "old thing"'),
  })
  await suggest($, { title: 'Fix FLAKY test' })
  const again = await suggest($, { title: ' fix flaky TEST ' })
  expect(again).toMatchObject({
    result: expect.stringContaining('nothing was added'),
  })
  expect(savedTitles(saved)).toEqual(['old thing', 'Fix FLAKY test'])
  expect(toasts).toHaveLength(2)

  // So is a card still being made.
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })
  const adding = ui.press({ key: 'suggest:add:2' })
  await clock.settle()
  expect(await suggest($, { title: 'fix flaky test' })).toMatchObject({
    result: expect.stringContaining('nothing was added'),
  })
  release()
  await adding
  await clock.settle()
  await ui.unmount()
})

test('a suggestion with the title of a Cancelled card is added, and one with the title of a Suspended card is folded in', async ($, on) => {
  const files = {
    ...cards(),
    [path(5, 'dropped')]: card(5, {
      status: 'cancelled',
      title: 'Dropped idea',
    }),
    [path(6, 'parked')]: card(6, { status: 'suspended', title: 'Parked idea' }),
  }
  const { saved, toasts, ui } = await open($, on, 'terminal', files)

  expect(await suggest($, { title: 'dropped  IDEA' })).toMatchObject({
    result: expect.stringContaining('Suggested "dropped IDEA"'),
  })
  expect(await suggest($, { title: 'parked idea' })).toMatchObject({
    result:
      '"parked idea" is already a card or a suggestion; nothing was added.',
  })
  expect(savedTitles(saved)).toEqual(['dropped IDEA'])
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

test('the suggestions survive a reload: they come back from the store', async ($, on) => {
  const { toasts, saved, ui } = await open($, on, 'terminal', cards(), {
    [STORED]: {
      shape: 'suggestions-1',
      items: [
        { id: 4, title: 'From before', spec: 'Spec', why: 'Because' },
        { id: 'x', title: 'Bad id', spec: '' },
        { id: 5, title: '', spec: '' },
      ],
    },
  })

  expect((await ui.find({ type: 'Text', text: /Suggested/ }))?.text).toBe(
    'Suggested (1)',
  )
  expect(await ui.find({ key: 'suggest:add:4' })).toBeDefined()
  // Brought back quietly, and numbered on from the highest.
  expect(toasts).toEqual([])
  await suggest($)
  expect(await ui.find({ key: 'suggest:add:5' })).toBeDefined()
  expect(savedTitles(saved)).toEqual(['From before', 'Fix flaky test'])
  await ui.unmount()
})

test('what the store holds in another shape is ignored', async ($, on) => {
  const { ui } = await open($, on, 'terminal', cards(), {
    [STORED]: {
      shape: 'suggestions-0',
      items: [{ id: 1, title: 'T', spec: '' }],
    },
  })

  expect(await ui.find({ type: 'Text', text: /Suggested/ })).toBeUndefined()
  await ui.unmount()
})

test('the strip lists three suggestions and counts the rest, and Add brings the next one up', async ($, on) => {
  const { clock, ui } = await open($, on, 'terminal')
  for (let n = 1; n <= 5; n += 1) await suggest($, { title: `Idea ${n}` })

  const boxes = async () =>
    (await ui.findAll({ type: 'Box' }))
      .map(one => one.key ?? '')
      .filter(key => key.startsWith('suggest:'))
  expect(await boxes()).toEqual(['suggest:1', 'suggest:2', 'suggest:3'])
  expect((await ui.find({ type: 'Text', text: /more/ }))?.text).toBe(
    '  +2 more',
  )
  expect((await ui.find({ type: 'Text', text: /Suggested/ }))?.text).toBe(
    'Suggested (5)',
  )

  await ui.press({ key: 'suggest:dismiss:1' })
  await clock.settle()
  expect(await boxes()).toEqual(['suggest:2', 'suggest:3', 'suggest:4'])
  expect((await ui.find({ type: 'Text', text: /more/ }))?.text).toBe(
    '  +1 more',
  )
  await ui.unmount()
})

test('a long title is cut to the row', async ($, on) => {
  const { ui } = await open($, on, 'terminal')
  await suggest($, { title: 'x'.repeat(120) })

  const title = await ui.find({ type: 'Text', text: /^ x+…$/ })
  expect(title).toBeDefined()
  const parts = [
    await ui.find({ key: 'suggest:add:1' }),
    await ui.find({ key: 'suggest:dismiss:1' }),
    title,
  ]
  const width = parts.reduce((sum, one) => sum + cellWidth(one?.text ?? ''), 0)
  expect(width).toBeLessThanOrEqual(PANE.props.bodyColumns)
  await ui.unmount()
})

test('kanban_suggest refuses a bad title or text and takes a missing why', async ($, on) => {
  boot(on, cards())

  expect(await suggest($, { title: '  ' })).toHaveProperty('deny')
  expect(await suggest($, { title: 4 })).toHaveProperty('deny')
  expect(await suggest($, { spec: 4 })).toMatchObject({
    deny: 'spec must be text.',
  })
  expect(await suggest($, { why: 4 })).toMatchObject({
    deny: 'why must be text.',
  })
  expect(
    await $.tool.call({ tool: SUGGEST, title: 'Only a title', spec: '' }),
  ).toHaveProperty('result')
})

test('the system prompt gets one short section, once, and the bare prompt none', async ($, on) => {
  boot(on, cards())
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' as const },
    ],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const first = await $.prompt.compose(COMPOSE)
  const second = await $.prompt.compose(COMPOSE)
  const bare = await $.prompt.compose({ ...COMPOSE, traits: ['bare'] })

  const mine = (sections: readonly { id: string }[]) =>
    sections.filter(one => one.id === 'kanban:suggest')
  expect(mine(first.sections)).toHaveLength(1)
  expect(mine(second.sections)).toHaveLength(1)
  expect(first.sections.map(one => one.id)).toEqual(['intro', 'kanban:suggest'])
  expect(first.sections[1]).toMatchObject({ scope: 'session' })
  expect(first.sections[1]?.text).toContain('mcp__kanban__kanban_suggest')
  expect(first.sections[1]?.text.length).toBeLessThan(300)
  expect(mine(bare.sections)).toHaveLength(0)
})

test('a prompt that already holds the section is not given a second', async ($, on) => {
  boot(on, cards())
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' as const },
      {
        id: 'kanban:suggest',
        text: 'Already here.',
        scope: 'session' as const,
      },
    ],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const { sections } = await $.prompt.compose(COMPOSE)

  expect(sections.map(one => [one.id, one.text])).toEqual([
    ['intro', 'You are Claude.'],
    ['kanban:suggest', 'Already here.'],
  ])
})

// With a strip of five rows above the list, the wheel and a drag still find
// their rows. Rows of the tree: 0-1 toolbar, 2-6 strip, then the layout from its
// row 2: 7 Active group, 8 Backlog header, 9-13 its cards, 14 its more row,
// 15 Human header, 16 (empty), 17 Claude header.
const STRIP = stripRows(5)

async function startWithStrip($: Engine, on: On) {
  const files: Record<string, string> = {}
  for (let n = 11; n <= 18; n += 1) {
    files[path(n, 'b')] = card(n, { status: 'backlog', title: `Backlog ${n}` })
  }
  const world = await open($, on, 'terminal', files)
  for (let n = 1; n <= 5; n += 1) await suggest($, { title: `Idea ${n}` })

  return world
}

test('with a strip above the list the wheel scrolls the section under the pointer', async ($, on) => {
  const { scrolls, ui } = await startWithStrip($, on)
  expect(STRIP).toBe(5)

  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 13 } })
  expect(scrolls).toHaveLength(0)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')

  // The Human header, which the same row would be a card of Backlog were the
  // strip not counted out; and the strip's own rows are the engine's.
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 15 } })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 4 } })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 1 } })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 0 } })
  expect(scrolls).toHaveLength(4)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')
  await ui.unmount()
})

test('with a strip above the list a card still drags onto a header', async ($, on) => {
  const { clock, files, ui } = await startWithStrip($, on)
  const { pointer } = ui as unknown as Mounted<'terminal'>
  const from = await rowIndex(ui, 'card:md:0011-b')
  const to = await rowIndex(ui, 'hdr:claude')

  await pointer({ type: 'down', x: 3, y: from, button: 'left' })
  await pointer({ type: 'move', x: 3, y: to, button: 'left' })
  await pointer({ type: 'up', x: 3, y: to, button: 'left' })
  await clock.advance(SYNC_PAUSE)

  expect(files[path(11, 'b')]).toContain('status: claude')
  await ui.unmount()
})

test('the suggestions need no pane: the tool works with it closed', async ($, on) => {
  const { saved, toasts } = boot(on, cards())

  const made = await suggest($)

  expect(made).toHaveProperty('result')
  expect(toasts).toEqual(['Claude suggests a card: Fix flaky test'])
  expect(savedTitles(saved)).toEqual(['Fix flaky test'])
})

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { click, keys, marks, row, rowIndex, rowKeys } from './board-ui'
import { PANE, RUN, SCROLL, boot, card, path } from './fakes'
import type { Route } from './fake-gh'
import {
  ISSUE_CREATE,
  ISSUE_URL,
  ITEM_ADD,
  ITEM_EDIT,
  KANBAN,
  LABEL_LIST,
  REPO,
  github,
  writes,
} from './github-board'

const SURFACES = ['terminal', 'desktop', 'vscode'] as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
})

async function open($: Engine, on: On, surface: (typeof SURFACES)[number]) {
  const files: Record<string, string> = cards()
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

for (const surface of SURFACES) {
  test(`the + button opens the form and closes it again on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    expect((await ui.find({ key: 'add' }))?.text).toBe(' +')
    expect(await ui.find({ key: 'add:title' })).toBeUndefined()

    await ui.press({ key: 'add' })
    const field = await ui.find({ key: 'add:title' })
    expect(field?.type).toBe('Input')
    expect(field?.props.placeholder).toBe('New card title')
    expect(await ui.find({ key: 'add:spec' })).toBeUndefined()

    await ui.press({ key: 'add' })
    expect(await ui.find({ key: 'add:title' })).toBeUndefined()
    await ui.unmount()
  })
}

const TITLE = 'add:title'

// The keys of the rows under a header, up to the next one.
async function under(ui: Parameters<typeof rowKeys>[0], header: string) {
  const all = await rowKeys(ui)
  const rest = all.slice(all.indexOf(header) + 1)
  const next = rest.findIndex(key => key.startsWith('hdr:'))

  return next < 0 ? rest : rest.slice(0, next)
}

for (const surface of SURFACES) {
  test(`Enter adds a card to Backlog at once, marked syncing until its file is written, on the ${surface}`, async ($, on) => {
    const { clock, calls, files, ui } = await open($, on, surface)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    await ui.press({ key: 'add' })
    const adding = ui.input({ key: TITLE, text: '  Write   the\nREADME ' })
    await clock.settle()

    expect(await ui.find({ key: TITLE })).toBeUndefined()
    const pending = (await under(ui, 'hdr:backlog')).find(key =>
      key.startsWith('card:new:'),
    )
    expect(pending).toBeDefined()
    expect((await row(ui, pending ?? ''))?.text).toContain('Write the README')
    expect(await marks(ui, '⟳')).toHaveLength(1)
    expect(Object.keys(files)).toHaveLength(2)

    // A load that lands meanwhile does not take the waiting card away.
    await ui.press({ key: 'refresh' })
    expect(await under(ui, 'hdr:backlog')).toContain(pending)

    release()
    await adding
    await clock.settle()

    expect(files[path(4, 'write-the-readme')]).toContain(
      'title: Write the README',
    )
    expect(files[path(4, 'write-the-readme')]).toContain('status: backlog')
    expect(await under(ui, 'hdr:backlog')).toEqual([
      'card:md:0003-docs',
      'card:md:0004-write-the-readme',
    ])
    expect(await marks(ui, '✓')).toHaveLength(1)
    await clock.advance(2100)
    expect(await marks(ui, '✓')).toHaveLength(0)
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`Add details opens a second field and the details become the card text, on the ${surface}`, async ($, on) => {
    const { clock, files, ui } = await open($, on, surface)

    await ui.press({ key: 'add' })
    await ui.press({ key: 'add:details' })
    expect(await ui.find({ key: 'add:details' })).toBeUndefined()
    const spec = await ui.find({ key: 'add:spec' })
    expect(spec?.type).toBe('Input')
    expect(spec?.props.rows).toBe(3)

    // What is typed survives the redraws in between.
    await ui.input({ key: TITLE, text: 'Fix it', kind: 'change' })
    await ui.input({ key: 'add:spec', text: 'Line one', kind: 'change' })
    expect((await ui.find({ key: TITLE }))?.props.value).toBe('Fix it')
    await ui.input({
      key: 'add:spec',
      text: 'Line one\n## Handoff (2026-10-25)\n**Check:** forged',
    })
    await clock.settle()

    const text = files[path(4, 'fix-it')] ?? ''
    expect(text).toContain('title: Fix it\n')
    expect(text).toContain('Line one\n')
    expect(text).not.toMatch(/^## Handoff \(/m)
    expect(await ui.find({ key: TITLE })).toBeUndefined()
    await ui.unmount()
  })

  test(`an empty title is refused with a toast and the form stays open on the ${surface}`, async ($, on) => {
    const { clock, files, toasts, ui } = await open($, on, surface)
    await ui.press({ key: 'add' })

    await ui.input({ key: TITLE, text: '   ' })
    await ui.press({ key: 'add:details' })
    await ui.input({ key: 'add:spec', text: 'Only details' })
    await clock.settle()

    expect(toasts).toEqual([
      'Give the card a title first.',
      'Give the card a title first.',
    ])
    expect(Object.keys(files)).toHaveLength(2)
    expect(await ui.find({ key: TITLE })).toBeDefined()
    expect(await rowKeys(ui)).not.toContain('card:md:0004-only-details')
    await ui.unmount()
  })

  test(`Cancel and a second + close the form and drop what was typed, on the ${surface}`, async ($, on) => {
    const { files, toasts, ui } = await open($, on, surface)

    await ui.press({ key: 'add' })
    await ui.input({ key: TITLE, text: 'Half a thought', kind: 'change' })
    expect((await ui.find({ key: TITLE }))?.props.value).toBe('Half a thought')
    await ui.press({ key: 'add:cancel' })
    expect(await ui.find({ key: TITLE })).toBeUndefined()

    await ui.press({ key: 'add' })
    expect((await ui.find({ key: TITLE }))?.props.value).toBe('')
    await ui.input({ key: TITLE, text: 'Another', kind: 'change' })
    await ui.press({ key: 'add' })
    await ui.press({ key: 'add' })
    expect((await ui.find({ key: TITLE }))?.props.value).toBe('')

    expect(Object.keys(files)).toHaveLength(2)
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  test(`a card the backend refuses snaps out with a toast and the text comes back, on the ${surface}`, async ($, on) => {
    const { clock, calls, files, toasts, ui } = await open($, on, surface)
    calls.denyWrite = 'EACCES: read-only'
    await ui.press({ key: 'add' })
    await ui.press({ key: 'add:details' })
    await ui.input({ key: 'add:spec', text: 'The details', kind: 'change' })

    await ui.input({ key: TITLE, text: 'Write the docs' })
    await clock.settle()

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/^Could not add the card: .*EACCES: read-only$/)
    expect(await under(ui, 'hdr:backlog')).toEqual(['card:md:0003-docs'])
    expect(await marks(ui, '⟳')).toHaveLength(0)
    expect(Object.keys(files)).toHaveLength(2)
    expect((await ui.find({ key: TITLE }))?.props.value).toBe('Write the docs')
    expect((await ui.find({ key: 'add:spec' }))?.props.value).toBe(
      'The details',
    )

    calls.denyWrite = undefined
    await ui.input({ key: TITLE, text: 'Write the docs' })
    await clock.settle()
    expect(files[path(4, 'write-the-docs')]).toContain('The details')
    expect(toasts).toHaveLength(1)
    await ui.unmount()
  })

  test(`two Enters add the card once, on the ${surface}`, async ($, on) => {
    const { clock, files, ui } = await open($, on, surface)
    await ui.press({ key: 'add' })

    await Promise.all([
      ui.input({ key: TITLE, text: 'Once' }),
      ui.input({ key: TITLE, text: 'Once' }),
    ])
    await clock.settle()

    expect(Object.keys(files).filter(file => file.includes('once'))).toEqual([
      path(4, 'once'),
    ])
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`a card still being made can not be opened, moved, listed or cached, on the ${surface}`, async ($, on) => {
    const { clock, calls, files, saved, ui } = await open($, on, surface)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })
    await ui.press({ key: 'add' })
    const adding = ui.input({ key: TITLE, text: 'Not there yet' })
    await clock.settle()
    const pending = (await under(ui, 'hdr:backlog')).find(key =>
      key.startsWith('card:new:'),
    )
    expect(pending).toBeDefined()
    const key = pending ?? ''

    // A click, Enter and a drop onto Claude do nothing.
    await click(ui, key)
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    if (surface !== 'vscode') {
      const { pointer } = ui as unknown as Mounted<'terminal'>
      const from = await rowIndex(ui, key)
      const to = await rowIndex(ui, 'hdr:claude')
      await keys(ui, 'down')
      await pointer({ type: 'down', x: 2, y: from, button: 'left' })
      await pointer({ type: 'move', x: 2, y: to, button: 'left' })
      await pointer({ type: 'up', x: 2, y: to, button: 'left' })
      await keys(ui, 'return')
    }
    await clock.advance(300)
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect(await under(ui, 'hdr:claude')).not.toContain(key)
    expect(await under(ui, 'hdr:backlog')).toContain(key)

    // Claude's tools do not see it.
    const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })
    expect(listed).toHaveProperty('result')
    expect(JSON.stringify(listed)).not.toContain('Not there yet')
    expect(
      await $.tool.call({ tool: 'mcp__kanban__kanban_show', card: 0 }),
    ).toMatchObject({ deny: 'There is no kanban card #0.' })
    expect(
      await $.tool.call({
        tool: 'mcp__kanban__kanban_move',
        card: 0,
        to: 'claude',
      }),
    ).toMatchObject({ deny: 'There is no kanban card #0.' })

    // A load saves the cards for the next start, without it.
    await ui.press({ key: 'refresh' })
    const cached = JSON.parse(saved.get('cache:/work') ?? '{}') as {
      cards?: { id: string }[]
    }
    expect(cached.cards?.map(one => one.id).sort()).toEqual([
      'md:0001-login',
      'md:0003-docs',
    ])

    release()
    await adding
    await clock.settle()
    expect(
      Object.keys(files).filter(file => file.includes('not-there')),
    ).toHaveLength(1)
    expect(calls.writes).toEqual([path(4, 'not-there-yet')])
    await ui.unmount()
  })
}

test('the new card is brought into view in a long or collapsed Backlog', async ($, on) => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 7; n += 1) {
    files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
  }
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await under(ui, 'hdr:backlog')).not.toContain('card:md:0008-new')

  await ui.press({ key: 'add' })
  await ui.input({ key: TITLE, text: 'New' })
  await world.clock.settle()
  expect(await under(ui, 'hdr:backlog')).toContain('card:md:0008-new')

  await click(ui, 'hdr:backlog')
  expect(await under(ui, 'hdr:backlog')).toEqual([])
  await ui.press({ key: 'add' })
  await ui.input({ key: TITLE, text: 'Newer' })
  await world.clock.settle()
  expect(await under(ui, 'hdr:backlog')).toContain('card:md:0009-newer')
  await ui.unmount()
})

test('mobile has no + button and no form', async ($, on) => {
  boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.command.run({ ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })

  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  expect(await ui.find({ key: 'add' })).toBeUndefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.unmount()
})

test('with the form open the wheel is the engine, as the list sits lower than the layout says', async ($, on) => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 8; n += 1) {
    files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
  }
  const { scrolls } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const wheel = { ...SCROLL, by: 1, pointer: { column: 3, row: 10 } }

  await ui.press({ key: 'add' })
  await $.ui.scroll(wheel)
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()

  await ui.press({ key: 'add:cancel' })
  await $.ui.scroll(wheel)
  expect(scrolls).toHaveLength(1)
  await ui.unmount()
})

test('a card still waiting when the plugin reloads is dropped, not sent as a move', async ($, on) => {
  const { clock, calls, files, ui } = await open($, on, 'terminal')
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await ui.press({ key: 'add' })
  const adding = ui.input({ key: TITLE, text: 'Lost in a reload' })
  await clock.settle()
  expect(await marks(ui, '⟳')).toHaveLength(1)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(await marks(ui, '⟳')).toHaveLength(0)
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:md:0003-docs'])

  release()
  await adding
  await clock.settle()
  // Only the creation ever wrote: no move for the waiting card was sent.
  expect(calls.writes).toEqual([path(4, 'lost-in-a-reload')])
  expect(files[path(4, 'lost-in-a-reload')]).toContain('status: backlog')
  await ui.unmount()
})

async function openGithub(
  $: Engine,
  on: On,
  overrides: Route[] = [],
  hold?: (argv: readonly string[]) => Promise<void> | undefined,
) {
  const world = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = github(on, overrides, hold)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, calls, ui }
}

test('on GitHub Enter creates the issue with the triage label, puts it on the board in Backlog and shows it', async ($, on) => {
  const { clock, calls, toasts, ui } = await openGithub($, on)
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:4'])

  await ui.press({ key: 'add' })
  await ui.press({ key: 'add:details' })
  await ui.input({ key: 'add:spec', text: 'Users loop.', kind: 'change' })
  await ui.input({ key: TITLE, text: 'Fix the login loop' })
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
  expect((await row(ui, 'card:gh:30'))?.text).toContain(
    '#30 Fix the login loop',
  )
  expect(toasts).toEqual([])
  await clock.advance(2100)
  expect(await marks(ui, '✓')).toHaveLength(0)
  await ui.unmount()
})

test('on GitHub the card shows at once, marked syncing, before gh has answered', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const { clock, ui } = await openGithub($, on, [], argv =>
    argv[2] === 'create' ? held : undefined,
  )

  await ui.press({ key: 'add' })
  const adding = ui.input({ key: TITLE, text: 'Fix the login loop' })
  await clock.settle()

  const pending = (await under(ui, 'hdr:backlog')).find(key =>
    key.startsWith('card:new:'),
  )
  expect(pending).toBeDefined()
  expect(await marks(ui, '⟳')).toHaveLength(1)

  release()
  await adding
  await clock.settle()
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:4', 'card:gh:30'])
  expect(await marks(ui, '⟳')).toHaveLength(0)
  await ui.unmount()
})

test('on GitHub a refused create snaps the card out with a toast, runs nothing more and brings the text back', async ($, on) => {
  const { clock, calls, toasts, ui } = await openGithub($, on, [
    {
      match: ['gh', 'issue', 'create'],
      reply: { exitCode: 1, stderr: 'HTTP 403: Resource not accessible' },
    },
  ])

  await ui.press({ key: 'add' })
  await ui.input({ key: TITLE, text: 'Fix the login loop' })
  await clock.settle()

  expect(toasts).toEqual([
    'Could not add the card: HTTP 403: Resource not accessible',
  ])
  expect(writes(calls).slice(2)).toEqual([LABEL_LIST, ISSUE_CREATE])
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:4'])
  expect(await marks(ui, '⟳')).toHaveLength(0)
  expect((await ui.find({ key: TITLE }))?.props.value).toBe(
    'Fix the login loop',
  )
  await ui.unmount()
})

test('on GitHub an issue made but not put on the board is named in the toast, and the next load shows what is there', async ($, on) => {
  const { clock, calls, toasts, ui } = await openGithub($, on, [
    {
      match: ['gh', 'project', 'item-add'],
      reply: { exitCode: 1, stderr: 'GraphQL: insufficient scopes' },
    },
  ])
  const loads = () => calls.filter(call => call.argv[2] === 'graphql').length
  const before = loads()

  await ui.press({ key: 'add' })
  await ui.input({ key: TITLE, text: 'Fix the login loop' })
  await clock.settle()

  expect(toasts).toEqual([
    `Could not add the card: Created ${ISSUE_URL} but could not finish adding it: GraphQL: insufficient scopes`,
  ])
  expect(writes(calls).slice(2)).toEqual([LABEL_LIST, ISSUE_CREATE, ITEM_ADD])
  expect(loads()).toBeGreaterThan(before)
  expect(
    (await under(ui, 'hdr:backlog')).some(key => key.startsWith('card:new:')),
  ).toBe(false)
  expect((await ui.find({ key: TITLE }))?.props.value).toBe(
    'Fix the login loop',
  )
  await ui.unmount()
})

const create = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({
    tool: 'mcp__kanban__kanban_create',
    title: 'Fix the login loop',
    spec: 'Users loop.',
    ...input,
  })

async function startGithub($: Engine, on: On, overrides: Route[] = []) {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = github(on, overrides)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  return { clock, calls }
}

test('kanban_create on a GitHub board makes a triage issue on the board in Backlog, shown at once', async ($, on) => {
  const { calls } = await startGithub($, on)

  const made = await create($, {})

  expect(made).toMatchObject({
    result: `Created #30 [backlog] Fix the login loop in ${ISSUE_URL}.`,
  })
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
  expect(
    await $.tool.call({ tool: 'mcp__kanban__kanban_list', column: 'backlog' }),
  ).toMatchObject({
    result: expect.stringContaining('#30 [backlog] Fix the login loop'),
  })
})

test('kanban_create on a GitHub board can start the card in Claude, with the ai label', async ($, on) => {
  const { calls } = await startGithub($, on)

  const made = await create($, { column: 'claude' })

  expect(made).toMatchObject({
    result: `Created #30 [claude] Fix the login loop in ${ISSUE_URL}.`,
  })
  expect(writes(calls).slice(-2)).toEqual([
    ['gh', 'issue', 'edit', '30', '--repo', REPO, '--add-label', 'ai'],
    [...ITEM_EDIT.slice(0, -1), 'b15c285e'],
  ])
})

test('kanban_create on a GitHub board says why it failed', async ($, on) => {
  await startGithub($, on, [
    {
      match: ['gh', 'issue', 'create'],
      reply: { exitCode: 1, stderr: 'HTTP 403: Resource not accessible' },
    },
  ])

  expect(await create($, {})).toMatchObject({
    deny: 'Could not create the card: HTTP 403: Resource not accessible',
  })
})

test('kanban_create still refuses an empty title and a start in Human on a GitHub board', async ($, on) => {
  const { calls } = await startGithub($, on)

  expect(await create($, { title: '  ' })).toHaveProperty('deny')
  expect(await create($, { column: 'human' })).toHaveProperty('deny')
  expect(writes(calls).slice(2)).toEqual([])
})

const CLIENT_SURFACES = ['terminal', 'desktop'] as const

for (const surface of CLIENT_SURFACES) {
  test(`a card still being made cannot be dragged, dropped on or shifted, so it is never queued or reordered on the ${surface}`, async ($, on) => {
    const { clock, calls, files, prompts, ui } = await open($, on, surface)
    const { pointer } = ui as unknown as {
      pointer: Mounted<'terminal'>['pointer']
    }
    const drag = async (from: string, to: string) => {
      const y = await rowIndex(ui, from)
      const end = await rowIndex(ui, to)
      await pointer({ type: 'down', x: 3, y, button: 'left' })
      await pointer({ type: 'move', x: 3, y: end, button: 'left' })
      await pointer({ type: 'up', x: 3, y: end, button: 'left' })
    }
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })
    await ui.press({ key: 'add' })
    const adding = ui.input({ key: TITLE, text: 'Write the README' })
    await clock.settle()
    const made =
      (await under(ui, 'hdr:backlog')).find(key =>
        key.startsWith('card:new:'),
      ) ?? ''
    expect(made).not.toBe('')
    const before = JSON.stringify(files)

    // Into Claude, onto a card of Backlog, and a place up by key: none takes.
    await drag(made, 'hdr:claude')
    await drag('card:md:0003-docs', made)
    await click(ui, made)
    await keys(ui, 'K')
    await keys(ui, 'J')
    await clock.advance(1000)

    expect(JSON.stringify(files)).toBe(before)
    expect(prompts).toEqual([])
    expect(await under(ui, 'hdr:claude')).toEqual(['empty:claude'])
    expect(await under(ui, 'hdr:backlog')).toEqual(['card:md:0003-docs', made])

    release()
    await adding
    await clock.settle()
    expect(await under(ui, 'hdr:backlog')).toEqual([
      'card:md:0003-docs',
      'card:md:0004-write-the-readme',
    ])
    await ui.unmount()
  })
}

test('the board view gives n to the add button and no other Button a hotkey that is also a Client key', async ($, on) => {
  const { ui } = await open($, on, 'terminal')
  // A suggestion adds its own buttons to the board view.
  await $.tool.call({
    tool: 'mcp__kanban__kanban_suggest',
    title: 'Fix flaky test',
    spec: 'It fails 1 in 10.',
  })
  expect(
    (await ui.findAll({ type: 'Button' })).some(button =>
      String(button.key).startsWith('suggest:add:'),
    ),
  ).toBe(true)

  const hotkeys = (await ui.findAll({ type: 'Button' })).flatMap(button =>
    button.props.hotkey === undefined ? [] : [String(button.props.hotkey)],
  )

  expect(hotkeys).toEqual(['n'])
  // The keys the board's list takes when it has the keyboard.
  const clientKeys = ['j', 'k', 'm', 'h', 'c', 'b', 'd', '1', '2', '3', '4']
  expect(hotkeys.filter(key => clientKeys.includes(key))).toEqual([])
  await ui.unmount()
})

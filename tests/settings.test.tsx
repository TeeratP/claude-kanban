import type { ConfigRow, On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanGithub, KanbanSettingRow } from '../types'
import { planStatus } from '../hooks/status'
import type { StatusInput } from '../hooks/status'
import {
  SETTING_FIELDS,
  boardAction,
  optionsOf,
  settingsOf,
} from '../hooks/settings'
import { S } from '../hooks/strings'
import { keys, litRows } from './board-ui'
import type { BoardUi } from './board-ui'
import { fakeProcess } from './fake-gh'
import { HANDOFF, bootGithub, issue } from './fake-github'
import { PANE, RUN, SYNC_PAUSE, boot } from './fakes'
import { overflow, renderPane } from './render'
import {
  ALL_STATUSES,
  GH_VERSION,
  SIGNED_IN,
  fieldList,
  graphql,
  lines,
  remote,
} from './zero'
import type { FakeProject } from './zero'

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const WIDTHS = [24, 30, 44, 80] as const
// The surfaces that draw the board's list through a Client, which takes the keys.
const HAS_CLIENT = new Set<RenderSurface>(['terminal', 'desktop'])

const provider = { plugin: 'kanban', tier: 'user' } as const

function row(
  field: string,
  label: string,
  kind: ConfigRow['kind'],
  value: ConfigRow['value'],
  options?: string[],
): ConfigRow {
  return {
    key: `kanban.${field}`,
    label,
    kind,
    value,
    provider,
    isLocked: false,
    ...(options === undefined ? {} : { options }),
  }
}

// The row the mod lists in /config, as `$.config.list()` returns it.
const rows = (): ConfigRow[] => [
  row('reconcile', 'Reconcile at turn end (default: on)', 'boolean', true),
]

// Stands in for the engine's /config: lists the rows, writes a change into them
// unless a reason is given for the key, and records every change asked for.
function fakeConfig(on: On, listed: ConfigRow[]) {
  const calls = {
    lists: 0,
    sets: [] as [string, ConfigRow['value']][],
    rows: listed,
    denials: {} as Record<string, string>,
    // While set, a change fails with this error instead of answering.
    failure: undefined as string | undefined,
  }
  on('config.list', () => {
    calls.lists += 1

    return { value: calls.rows }
  })
  on('config.set', (_, e) => {
    if (calls.failure !== undefined) throw new Error(calls.failure)

    calls.sets.push([e.key, e.value])
    const reason = calls.denials[e.key]
    if (reason !== undefined) return { deny: reason }

    calls.rows = calls.rows.map(one =>
      one.key === e.key ? { ...one, value: e.value } : one,
    )

    return { value: e.value }
  })

  return calls
}

async function open(
  $: Engine,
  on: On,
  surface: RenderSurface = 'terminal',
  listed: ConfigRow[] = rows(),
) {
  const world = bootGithub(on, [
    issue(1, { column: 'human', title: 'Fix login' }),
  ])
  const config = fakeConfig(on, listed)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return { ...world, config }
}

const mount = ($: Engine, surface: RenderSurface, width = 44) =>
  $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns: width },
    surface,
  })

// The view opened from the toolbar, drawn as text at a width.
async function settingsAt($: Engine, surface: RenderSurface, width: number) {
  const ui = await mount($, surface, width)
  await ui.press({ key: 'settings' })

  return ui
}

const textOf = async (ui: Awaited<ReturnType<typeof mount>>, width: number) =>
  renderPane(ui, width)

for (const surface of EVERY_SURFACE) {
  test(`the toolbar's Settings button opens the view and Back returns to the board on the ${surface}`, async ($, on) => {
    const { config } = await open($, on, surface)
    const ui = await mount($, surface)

    // Where a Client takes the keys it owns `s`, and the button names the key
    // in its label; elsewhere the button's hotkey is the key.
    const props = (await ui.find({ key: 'settings' }))?.props
    expect(props?.hotkey).toBe(HAS_CLIENT.has(surface) ? undefined : 's')
    expect(props?.label).toBe(
      HAS_CLIENT.has(surface) ? 's: Settings' : 'Settings',
    )
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.press({ key: 'settings' })

    expect(config.lists).toBe(1)
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    expect((await ui.find({ type: 'Text', text: 'Settings' }))?.text).toBe(
      'Settings',
    )

    await ui.press({ key: 'back' })
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe(
      HAS_CLIENT.has(surface) ? 's: Settings' : 'Settings',
    )
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })
}

// The Your name block for TeeratP, who goes by the login, at 44 columns.
const YOUR_NAME = [
  'Your name',
  '  TeeratP · Change',
  '  What your team sees for @TeeratP. Your',
  '  cards stay assigned to @TeeratP, so a new',
  '  name changes no issue.',
]

// The Board block for the board CLAUDE.md names.
const NAMED_BOARD = [
  'Board',
  '  GitHub · TeeratP/claude-kanban',
  '  #7',
  '  Named in CLAUDE.md or AGENTS.md',
]

test('each setting shows its name without the default, its value, its help and where the default is', async ($, on) => {
  await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  expect(await textOf(ui, 44)).toEqual([
    'b: ← Board',
    '',
    'Settings',
    '',
    'Reconcile at turn end',
    '  ✓ on (default) · off',
    '  Remind Claude to hand off at turn end.',
    '',
    ...YOUR_NAME,
    '',
    ...NAMED_BOARD,
    '',
    'Also in /config',
  ])
  await ui.unmount()
})

test('a changed value moves the mark, and the default stays marked', async ($, on) => {
  const { config } = await open($, on)
  config.rows = rows().map(one => ({ ...one, value: false }))
  const ui = await settingsAt($, 'terminal', 44)
  const lines = await textOf(ui, 44)

  expect(lines).toContain('  on (default) · ✓ off')
  expect(lines).not.toContain('  ✓ on (default) · off')
  await ui.unmount()
})

test('pressing another value calls config.set with the row key and shows the new value', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:reconcile:off' })

  expect(config.sets).toEqual([['kanban.reconcile', false]])
  expect(await textOf(ui, 44)).toContain('  on (default) · ✓ off')
  expect(await ui.find({ key: 'set:reconcile:off' })).toBeUndefined()
  expect(config.lists).toBe(2)
  await ui.unmount()
})

test('a boolean flips when its other word is pressed', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:reconcile:off' })
  expect(config.sets).toEqual([['kanban.reconcile', false]])
  expect(await textOf(ui, 44)).toContain('  on (default) · ✓ off')

  await ui.press({ key: 'set:reconcile:on' })
  expect(config.sets).toEqual([
    ['kanban.reconcile', false],
    ['kanban.reconcile', true],
  ])
  expect(await textOf(ui, 44)).toContain('  ✓ on (default) · off')
  await ui.unmount()
})

test('a refused change shows its reason under the row and in a toast, and the value stays', async ($, on) => {
  const { config, toasts } = await open($, on)
  config.denials['kanban.reconcile'] = 'policy keeps it on.'
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:reconcile:off' })

  const lines = await textOf(ui, 44)
  expect(lines).toContain('  ✓ on (default) · off')
  expect(lines).toContain('  Not changed: policy keeps it on.')
  const reason = lines.indexOf('  Not changed: policy keeps it on.')
  expect(lines.indexOf('Reconcile at turn end')).toBeLessThan(reason)
  expect(reason).toBeLessThan(lines.indexOf('Board'))
  expect(toasts).toEqual(['Not changed: policy keeps it on.'])

  // A change that goes through clears the reason.
  config.denials = {}
  await ui.press({ key: 'set:reconcile:off' })
  expect((await textOf(ui, 44)).join('\n')).not.toContain('Not changed')
  await ui.unmount()
})

test('a set that throws is shown like a refusal', async ($, on) => {
  const { config, toasts } = await open($, on)
  config.failure = 'no such row'
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:reconcile:off' })

  expect(config.sets).toEqual([])
  expect((await textOf(ui, 44)).join('\n')).toContain('  Not changed: ')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Not changed: /)
  await ui.unmount()
})

test('a row a trusted source owns shows its value, says so and has no buttons', async ($, on) => {
  const listed = rows().map(one =>
    one.key === 'kanban.reconcile' ? { ...one, isLocked: true } : one,
  )
  const { config } = await open($, on, 'terminal', listed)
  const ui = await settingsAt($, 'terminal', 44)

  const lines = await textOf(ui, 44)
  expect(lines).toContain('  on')
  expect(lines).toContain('  Set by your organization.')
  expect(await ui.find({ key: 'set:reconcile:off' })).toBeUndefined()
  expect(config.sets).toEqual([])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`no row runs past the pane at 24, 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
    const { config } = await open($, on, surface)
    config.denials['kanban.reconcile'] =
      'Your organization keeps the turn-end reminder on.'

    for (const width of WIDTHS) {
      const ui = await settingsAt($, surface, width)
      await ui.press({ key: 'set:reconcile:off' })
      const lines = await textOf(ui, width)

      expect(overflow(lines, width), `${surface} at ${width}`).toEqual([])
      expect(lines.join('\n')).toContain('Also in /config')
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  })
}

test('the view says it is loading until the rows are read', async ($, on) => {
  const world = bootGithub(on, [issue(1, { column: 'human' })])
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('config.list', async () => {
    await held

    return { value: rows() }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 'terminal')

  const opening = ui.press({ key: 'settings' })
  await world.clock.settle()
  expect(await textOf(ui, 44)).toEqual([
    'b: ← Board',
    '',
    'Settings',
    '',
    'Loading…',
    '',
    ...YOUR_NAME,
    '',
    ...NAMED_BOARD,
    '',
    'Also in /config',
  ])

  release()
  await opening
  expect((await textOf(ui, 44)).join('\n')).toContain('Reconcile at turn end')
  await ui.unmount()
})

test('a /config that cannot be read is told, not left blank', async ($, on) => {
  const world = bootGithub(on, [issue(1, { column: 'human' })])
  on('config.list', () => {
    throw new Error('menu unavailable')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 'terminal')

  await ui.press({ key: 'settings' })

  expect((await textOf(ui, 44)).join('\n')).toContain(
    'Could not read the settings: ',
  )
  await ui.unmount()
})

test('rows that are not the mod’s, or not shown, are left out', async ($, on) => {
  const listed = [
    row('theme', 'Theme', 'choice', 'dark', ['dark', 'light']),
    ...rows(),
    { ...row('backendNote', 'Note', 'text', 'x'), key: 'kanban.note' },
  ]
  await open($, on, 'terminal', listed)
  const ui = await settingsAt($, 'terminal', 44)

  const text = (await textOf(ui, 44)).join('\n')
  expect(text).not.toContain('Theme')
  expect(text).not.toContain('Note')
  expect(text).toContain('Reconcile at turn end')
  await ui.unmount()
})

test('a change made in /config reloads the plugin, and the open view reads the rows again', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)
  expect(config.lists).toBe(1)

  config.rows = rows().map(one =>
    one.key === 'kanban.reconcile' ? { ...one, value: false } : one,
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(config.lists).toBe(2)
  expect(await textOf(ui, 44)).toContain('  on (default) · ✓ off')
  await ui.unmount()
})

test('settingsOf keeps the order of the fields, drops the default from the name and reads it', () => {
  const found = settingsOf([
    ...rows().reverse(),
    row('theme', 'Theme', 'choice', 'dark', ['dark']),
  ] as KanbanSettingRow[])

  expect(found.map(one => [one.field, one.name, one.fallback])).toEqual([
    ['reconcile', 'Reconcile at turn end', 'on'],
  ])
  expect(optionsOf(found[0] as never).map(one => one.text)).toEqual([
    'on',
    'off',
  ])
})

test('a title with no default keeps its whole text and marks none', () => {
  const [found] = settingsOf([
    {
      ...rows()[0],
      label: 'Reconcile at turn end@marketplace',
      key: 'kanban@x.y.reconcile',
    },
  ] as KanbanSettingRow[])

  expect(found?.name).toBe('Reconcile at turn end@marketplace')
  expect(found?.fallback).toBe('')
})

// The detected GitHub board, and a second one to pick.
const SHARED: FakeProject = {
  number: 2,
  title: "@TeeratP's Kanban",
  items: { 'TeeratP/attend-baby': 50 },
}
const CAST: FakeProject = {
  number: 6,
  title: 'Car Cast',
  items: { 'TeeratP/attend-baby': 3 },
}

test('Change board picks again on a detected board, is not offered on one CLAUDE.md names, and shows a pick that waits', async () => {
  const named = {
    kind: 'github',
    repo: 'TeeratP/claude-kanban',
    owner: 'TeeratP',
    projectNumber: 7,
    projectId: 'PVT_7',
    statusFieldId: 'F',
    options: { backlog: 'b', inProgress: 'p', done: 'd' },
  } satisfies KanbanGithub

  expect(boardAction({ backend: { ...named, isDetected: true } })).toBe('pick')
  expect(boardAction({ backend: named })).toBeUndefined()
  expect(boardAction({ backend: null })).toBeUndefined()
  expect(boardAction({ backend: null, pick: [] })).toBe('show')
})

// The status row's input for a board that was updated just now.
const input = (
  columns: number,
  over: Partial<StatusInput> = {},
): StatusInput => ({
  columns,
  boardName: '',
  status: 'updated just now',
  isAge: true,
  canHint: true,
  ...over,
})

test('the status keeps the backend name and gives way to s: Settings: the age first, then the button shortens', () => {
  const plan = (columns: number, over?: Partial<StatusInput>) =>
    planStatus(input(columns, over))

  expect(plan(80)).toEqual({
    text: ' GitHub · updated just now · ↑↓ ⏎ open · m move',
    settings: 'long',
  })
  expect(plan(44)).toEqual({
    text: ' GitHub · updated just now',
    settings: 'long',
  })
  expect(plan(38)).toEqual({
    text: ' GitHub · updated just now',
    settings: 'long',
  })
  // Below 38 the button takes the room the age had.
  expect(plan(37)).toEqual({ text: ' GitHub', settings: 'long' })
  expect(plan(30)).toEqual({ text: ' GitHub', settings: 'long' })
  expect(plan(19)).toEqual({ text: ' GitHub', settings: 'long' })
  expect(plan(18)).toEqual({ text: ' GitHub', settings: 'short' })
  expect(plan(15)).toEqual({ text: ' GitHub', settings: 'short' })
  // No room for the name and a button: the name wins, cut as before.
  expect(plan(14)).toEqual({ text: ' GitHub · upd…' })
})

test('an error stays, cut, beside the button', () => {
  const failed = planStatus(
    input(44, {
      status: 'gh auth status failed: run gh auth login',
      isAge: false,
    }),
  )
  expect(failed).toEqual({
    text: ' GitHub · gh auth status failed…',
    settings: 'long',
  })
})

test('a detected board gets its name where the age gives way', () => {
  const board = { boardName: "#2 @TeeratP's Kanban" }

  expect(planStatus(input(30, board))).toEqual({
    text: ' GitHub · #2 @Tee…',
    settings: 'long',
  })
  expect(planStatus(input(44, board)).text).toBe(' GitHub · updated just now')
  expect(planStatus(input(80, board)).text).toBe(
    " GitHub · #2 @TeeratP's Kanban · updated just now",
  )
})

// Row 1 drawn as a terminal would: the status, then `s: Settings` flush right.
const firstRow = async ($: Engine, surface: RenderSurface, columns: number) => {
  const ui = await mount($, surface, columns)
  const [first = ''] = await renderPane(ui, columns)
  await ui.unmount()

  return first
}

// The status, then the button flush against the right edge.
const flush = (text: string, columns: number, button = 's: Settings') =>
  `${text.padEnd(columns - button.length)}${button}`

test('row 1 holds the status and s: Settings flush right at 24, 30, 44 and 80 columns', async ($, on) => {
  await open($, on)

  expect(await firstRow($, 'terminal', 24)).toBe(flush(' GitHub', 24))
  expect(await firstRow($, 'terminal', 30)).toBe(flush(' GitHub', 30))
  expect(await firstRow($, 'terminal', 44)).toBe(
    flush(' GitHub · updated just now', 44),
  )
  expect(await firstRow($, 'terminal', 80)).toBe(
    flush(' GitHub · updated just now · ↑↓ ⏎ open · m move', 80),
  )
  // The mobile app has no key hint.
  expect(await firstRow($, 'mobile', 80)).toBe(
    flush(' GitHub · updated just now', 80),
  )
})

test('row 1 shortens the button to s: Set… when the backend name has no more room', async ($, on) => {
  await open($, on)

  expect(await firstRow($, 'terminal', 17)).toBe(flush(' GitHub', 17, 's: Set…'))
  expect(await firstRow($, 'terminal', 12)).toBe(' GitHub · u…')
})

test('every setting has help', () => {
  expect(Object.keys(S.settingHelp)).toEqual([...SETTING_FIELDS])
})

// Boards: Change board opens the picker or looks again.
const URL = 'https://github.com/TeeratP/attend-baby.git'

// The repo has two linked boards; the one with the most of its issues is used.
async function openDetected($: Engine, on: On) {
  const world = boot(on, {})
  fakeConfig(on, rows())
  fakeProcess(on, [
    GH_VERSION,
    SIGNED_IN,
    remote(URL),
    graphql({ linked: [SHARED, CAST] }),
    fieldList(ALL_STATUSES),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return world
}

test('Change board on a detected GitHub board opens the picker on the board', async ($, on) => {
  const world = await openDetected($, on)
  const ui = await mount($, 'terminal')
  const picker = async () =>
    (await ui.findAll({ type: 'Button' })).flatMap(one =>
      String(one.key).startsWith('pick:') ? [String(one.key)] : [],
    )
  expect(await picker()).toEqual([])

  await ui.press({ key: 'settings' })
  const lines = await textOf(ui, 44)
  expect(lines).toContain('  GitHub · TeeratP/attend-baby')
  expect(lines).toContain("  #2 @TeeratP's Kanban")
  expect(lines).toContain('  Change board')

  await ui.press({ key: 'board:change' })
  await world.clock.settle()

  expect(await ui.find({ key: 'back' })).toBeUndefined()
  expect(await picker()).toEqual(['pick:PVT_2', 'pick:PVT_6'])
  await ui.unmount()
})

test('a long repo name is cut, not wrapped, in the narrowest pane', async ($, on) => {
  await openDetected($, on)
  const ui = await settingsAt($, 'terminal', 24)

  const lines = await textOf(ui, 24)
  expect(overflow(lines, 24)).toEqual([])
  expect(lines).toContain('  GitHub · TeeratP/atte…')
  expect(lines).toContain("  #2 @TeeratP's Kanban")
  await ui.unmount()
})

test('a GitHub board named in CLAUDE.md is shown, with a note that it is set there and no Change board', async ($, on) => {
  const world = bootGithub(on, [issue(1, { column: 'human' })])
  fakeConfig(on, rows())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await settingsAt($, 'terminal', 44)

  const text = await textOf(ui, 44)
  expect(text.slice(text.indexOf('Board'), -2)).toEqual(NAMED_BOARD)
  expect(await ui.find({ key: 'board:change' })).toBeUndefined()
  await ui.unmount()
})

test('with no GitHub board found the Board row says setup is needed, and offers no Change board', async ($, on) => {
  const world = boot(on, {})
  fakeConfig(on, rows())
  const commands = fakeProcess(on, [
    GH_VERSION,
    SIGNED_IN,
    remote(URL),
    graphql({}),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const searches = () =>
    lines(commands).filter(line => line.includes('-f o=')).length
  // The linked-boards lookup, then the scan of the viewer's and owner's.
  const first = searches()
  expect(first).toBe(2)
  const ui = await settingsAt($, 'terminal', 44)

  const text = await textOf(ui, 44)
  expect(text.slice(text.indexOf('Board'), -2)).toEqual([
    'Board',
    '  GitHub',
    '  setup needed',
  ])
  // The setup offer on the board is the way on; there is nothing to pick.
  expect(await ui.find({ key: 'board:change' })).toBeUndefined()
  expect(searches()).toBe(first)
  await ui.unmount()
})

// Brings the cursor up and walks it down to `key`.
async function goTo(ui: BoardUi, key: string) {
  await keys(ui, 'down')
  for (let step = 0; step < 30; step += 1) {
    if ((await litRows(ui)).includes(key)) break
    await keys(ui, 'down')
  }
  expect(await litRows(ui)).toEqual([key])
}

// Types keys as the engine hands them out: each to the board's Client, and to
// the Buttons that had it for a hotkey when it came.
async function typed(ui: BoardUi, ...names: string[]) {
  for (const name of names) {
    const armed = (await ui.findAll({ type: 'Button' })).flatMap(one =>
      one.props.hotkey === name && one.key !== undefined ? [one.key] : [],
    )
    await keys(ui, name)
    for (const key of armed) await ui.press({ key })
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`m then s moves the carried card to Suspended and does not open Settings, and a bare s opens it on the ${surface}`, async ($, on) => {
    const world = bootGithub(on, [
      issue(3, { column: 'backlog', title: 'Write docs' }),
    ])
    fakeConfig(on, rows())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await mount($, surface)

    await goTo(ui, 'card:gh:3')
    await typed(ui, 'm', 's')
    await world.clock.advance(SYNC_PAUSE)

    expect(world.github.card(3).status).toBe('Suspended')
    expect(await ui.find({ key: 'back' })).toBeUndefined()

    // Not carrying, `s` opens Settings.
    await keys(ui, 's')
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    await ui.unmount()
  })

  test(`a fast m then s suspends the card and never opens Settings, though the host hears the Client late on the ${surface}`, async ($, on) => {
    const world = bootGithub(on, [
      issue(3, { column: 'backlog', title: 'Write docs' }),
    ])
    fakeConfig(on, rows())
    // What the Client posts reaches the host after the next key: its writes of
    // the pane's state wait until `release`.
    const held = { isOn: false, release: () => {} }
    const wait = new Promise<void>(resolve => {
      held.release = resolve
    })
    on('state.set', async (_, e, next) => {
      if (held.isOn && e.key === 'ui') await wait

      return next(e)
    })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await mount($, surface)

    await goTo(ui, 'card:gh:3')
    held.isOn = true
    // `m` is sent but not yet heard by the host when `s` comes.
    const carrying = typed(ui, 'm')
    const dropping = typed(ui, 's')
    held.release()
    await Promise.all([carrying, dropping])
    await world.clock.advance(SYNC_PAUSE)

    expect(world.github.card(3).status).toBe('Suspended')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a carry that ends with another key leaves the card where it was on the ${surface}`, async ($, on) => {
    const world = bootGithub(on, [
      issue(3, { column: 'backlog', title: 'Write docs' }),
    ])
    fakeConfig(on, rows())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await mount($, surface)

    await goTo(ui, 'card:gh:3')
    await typed(ui, 'm', 'q')
    await world.clock.advance(SYNC_PAUSE)

    expect(world.github.card(3).status).toBe('Backlog')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })
}

const KANBAN_TOOL = (name: string) => `mcp__kanban__kanban_${name}` as const
const ASKED = (n: number) =>
  `Card #${n} is still in Claude. If the work is done, record a handoff and move it to Done (or to Human if it needs the person's approval); if you need a decision, kanban_ask; if you are still working, say so and continue.`

test('turning Reconcile off in the view stops the reconcile prompt, and on brings it back', async ($, on) => {
  const world = bootGithub(on, [
    issue(2, { column: 'claude', title: 'Build API', comments: [HANDOFF] }),
    issue(3, { column: 'backlog', title: 'Write docs' }),
    issue(4, { column: 'backlog', title: 'Old idea' }),
  ])
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const config = fakeConfig(on, rows())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: KANBAN_TOOL('list') })
  await world.clock.settle()
  // A turn that moves a card into Claude and says nothing more about it.
  const turn = async (n: number, card: number) => {
    await $.turn.start({ text: 'go', turnId: `t${n}` })
    await $.tool.call({ tool: KANBAN_TOOL('move'), card, to: 'claude' })
    await $.turn.complete({
      answer: 'done',
      durationMs: 0,
      isAborted: false,
      turnId: `t${n}`,
      reason: 'answer',
    })
    await world.clock.settle()
  }

  await turn(1, 3)
  expect(world.prompts).toEqual([ASKED(3)])

  const ui = await settingsAt($, 'terminal', 44)
  await ui.press({ key: 'set:reconcile:off' })
  expect(config.sets).toEqual([['kanban.reconcile', false]])
  await turn(2, 4)
  expect(world.prompts).toEqual([ASKED(3)])

  await ui.press({ key: 'set:reconcile:on' })
  await turn(3, 4)
  expect(world.prompts).toEqual([ASKED(3), ASKED(4)])
  await ui.unmount()
})

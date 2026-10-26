import type { ConfigRow, On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanSettingRow } from '../types'
import { planActions } from '../hooks/toolbar'
import {
  SETTING_FIELDS,
  boardAction,
  optionsOf,
  settingsOf,
  stepped,
} from '../hooks/settings'
import { S } from '../hooks/strings'
import { toolbar } from './board-ui'
import { fakeProcess } from './fake-gh'
import { PANE, RUN, boot, card, path } from './fakes'
import { KANBAN, github } from './github-board'
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

// The three rows the mod lists in /config, as `$.config.list()` returns them.
const rows = (): ConfigRow[] => [
  row('backend', 'Card backend (default: auto)', 'choice', 'auto', [
    'auto',
    'github',
    'local',
  ]),
  row('claudeLimit', 'Claude limit (default: 1)', 'number', 1),
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
  const world = boot(on, {
    [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
    'CLAUDE.md': '# Notes\n',
  })
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

    expect((await ui.find({ key: 'settings' }))?.props.hotkey).toBe('s')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.press({ key: 'settings' })

    expect(config.lists).toBe(1)
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
    expect((await ui.find({ type: 'Text', text: 'Settings' }))?.text).toBe(
      'Settings',
    )

    await ui.press({ key: 'back' })
    expect((await ui.find({ key: 'settings' }))?.props.label).toBe('Settings')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })
}

test('each setting shows its name without the default, its value, its help and where the default is', async ($, on) => {
  await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  expect(await textOf(ui, 44)).toEqual([
    'b: ← Board',
    '',
    'Settings',
    '',
    'Card backend',
    '  ✓ auto (default) · github · local',
    '  auto uses GitHub when it finds a board.',
    '',
    'Claude limit',
    '  − 1 +  (default 1)',
    '  Cards Claude works at once; 0 is no limit.',
    '',
    'Reconcile at turn end',
    '  ✓ on (default) · off',
    '  Remind Claude to hand off at turn end.',
    '',
    'Board',
    '  Local · .kanban/',
    '  Change board',
    '',
    'Also in /config',
  ])
  await ui.unmount()
})

test('a changed value moves the mark, and the default stays marked', async ($, on) => {
  const { config } = await open($, on)
  config.rows = rows().map(one =>
    one.key === 'kanban.backend'
      ? { ...one, value: 'github' }
      : one.key === 'kanban.reconcile'
        ? { ...one, value: false }
        : { ...one, value: 3 },
  )
  const ui = await settingsAt($, 'terminal', 44)
  const lines = await textOf(ui, 44)

  expect(lines).toContain('  auto (default) · ✓ github · local')
  expect(lines).toContain('  on (default) · ✓ off')
  expect(lines).toContain('  − 3 +  (default 1)')
  await ui.unmount()
})

test('pressing another choice calls config.set with the row key and shows the new value', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:backend:github' })

  expect(config.sets).toEqual([['kanban.backend', 'github']])
  expect(await textOf(ui, 44)).toContain('  auto (default) · ✓ github · local')
  expect(await ui.find({ key: 'set:backend:github' })).toBeUndefined()
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
  config.denials['kanban.backend'] = 'gh is not installed.'
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:backend:github' })

  const lines = await textOf(ui, 44)
  expect(lines).toContain('  ✓ auto (default) · github · local')
  expect(lines).toContain('  Not changed: gh is not installed.')
  const reason = lines.indexOf('  Not changed: gh is not installed.')
  expect(lines.indexOf('Card backend')).toBeLessThan(reason)
  expect(reason).toBeLessThan(lines.indexOf('Claude limit'))
  expect(toasts).toEqual(['Not changed: gh is not installed.'])

  // A change that goes through clears the reason.
  config.denials = {}
  await ui.press({ key: 'set:backend:local' })
  expect((await textOf(ui, 44)).join('\n')).not.toContain('Not changed')
  await ui.unmount()
})

test('a set that throws is shown like a refusal', async ($, on) => {
  const { config, toasts } = await open($, on)
  config.failure = 'no such row'
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'set:backend:local' })

  expect(config.sets).toEqual([])
  expect((await textOf(ui, 44)).join('\n')).toContain('  Not changed: ')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^Not changed: /)
  await ui.unmount()
})

test('the number row steps by one and does not go below 0', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)

  await ui.press({ key: 'more:claudeLimit' })
  await ui.press({ key: 'less:claudeLimit' })
  await ui.press({ key: 'less:claudeLimit' })

  expect(config.sets).toEqual([
    ['kanban.claudeLimit', 2],
    ['kanban.claudeLimit', 1],
    ['kanban.claudeLimit', 0],
  ])
  // At 0 the minus rests: dim text, no Button.
  expect(await ui.find({ key: 'less:claudeLimit' })).toBeUndefined()
  expect(await textOf(ui, 44)).toContain('  − 0 +  (default 1)')
  expect((await ui.find({ key: 'more:claudeLimit' }))?.props.label).toBe('+')
  await ui.unmount()
})

test('stepped clamps at 0 and rounds a decimal down', () => {
  expect(stepped(0, -1)).toBeUndefined()
  expect(stepped(0, 1)).toBe(1)
  expect(stepped(3, -1)).toBe(2)
  expect(stepped(2.5, -1)).toBe(1)
  expect(stepped(2.5, 1)).toBe(3)
})

test('a row a trusted source owns shows its value, says so and has no buttons', async ($, on) => {
  const listed = rows().map(one =>
    one.key === 'kanban.claudeLimit' ? { ...one, isLocked: true } : one,
  )
  const { config } = await open($, on, 'terminal', listed)
  const ui = await settingsAt($, 'terminal', 44)

  const lines = await textOf(ui, 44)
  expect(lines).toContain('  1')
  expect(lines).toContain('  Set by your organization.')
  expect(await ui.find({ key: 'less:claudeLimit' })).toBeUndefined()
  expect(await ui.find({ key: 'more:claudeLimit' })).toBeUndefined()
  expect(config.sets).toEqual([])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`no row runs past the pane at 24, 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
    const { config } = await open($, on, surface)
    config.denials['kanban.backend'] =
      'GitHub needs gh, which is not installed.'
    config.rows = rows().map(one =>
      one.key === 'kanban.claudeLimit' ? { ...one, value: 12 } : one,
    )

    for (const width of WIDTHS) {
      const ui = await settingsAt($, surface, width)
      await ui.press({ key: 'set:backend:github' })
      const lines = await textOf(ui, width)

      expect(overflow(lines, width), `${surface} at ${width}`).toEqual([])
      expect(lines.join('\n')).toContain('Also in /config')
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  })
}

test('the view says it is loading until the rows are read', async ($, on) => {
  const world = boot(on, { 'CLAUDE.md': '# Notes\n' })
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
    'Board',
    '  Local · .kanban/',
    '  Change board',
    '',
    'Also in /config',
  ])

  release()
  await opening
  expect((await textOf(ui, 44)).join('\n')).toContain('Card backend')
  await ui.unmount()
})

test('a /config that cannot be read is told, not left blank', async ($, on) => {
  const world = boot(on, { 'CLAUDE.md': '# Notes\n' })
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
  expect(text).toContain('Claude limit')
  await ui.unmount()
})

test('a change made in /config reloads the plugin, and the open view reads the rows again', async ($, on) => {
  const { config } = await open($, on)
  const ui = await settingsAt($, 'terminal', 44)
  expect(config.lists).toBe(1)

  config.rows = rows().map(one =>
    one.key === 'kanban.claudeLimit' ? { ...one, value: 4 } : one,
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(config.lists).toBe(2)
  expect(await textOf(ui, 44)).toContain('  − 4 +  (default 1)')
  await ui.unmount()
})

test('settingsOf keeps the order of the fields, drops the default from the name and reads it', () => {
  const found = settingsOf([
    ...rows().reverse(),
    row('theme', 'Theme', 'choice', 'dark', ['dark']),
  ] as KanbanSettingRow[])

  expect(found.map(one => [one.field, one.name, one.fallback])).toEqual([
    ['backend', 'Card backend', 'auto'],
    ['claudeLimit', 'Claude limit', '1'],
    ['reconcile', 'Reconcile at turn end', 'on'],
  ])
  expect(optionsOf(found[2] as never).map(one => one.text)).toEqual([
    'on',
    'off',
  ])
})

test('a title with no default keeps its whole text and marks none', () => {
  const [found] = settingsOf([
    {
      ...rows()[0],
      label: 'Card backend@marketplace',
      key: 'kanban@x.y.backend',
    },
  ] as KanbanSettingRow[])

  expect(found?.name).toBe('Card backend@marketplace')
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

test('Change board is not offered when the backend is local by choice, and local under auto finds a board again', async () => {
  const local = { mode: 'local', backend: { kind: 'local' } } as const
  const auto = { mode: 'auto', backend: { kind: 'local' } } as const

  expect(boardAction(local)).toBeUndefined()
  expect(boardAction(auto)).toBe('detect')
  expect(boardAction({ mode: 'auto', backend: null })).toBeUndefined()
  expect(boardAction({ mode: 'auto', backend: null, pick: [] })).toBe('show')
})

test('the toolbar keeps Settings the longest of Refresh, New and Settings', () => {
  const labels = (columns: number, canType = true) =>
    planActions({ columns, canType, query: '', failed: 0 }).map(
      one => one.label,
    )

  expect(labels(44)).toEqual(['Refresh', 'New', 'Find', 'Settings'])
  expect(labels(37)).toEqual(['Refresh', 'New', 'Find', 'Settings'])
  expect(labels(30)).toEqual(['New', 'Find', 'Settings'])
  expect(labels(24)).toEqual(['Find', 'Settings'])
  expect(labels(10)).toEqual(['Find'])
  expect(labels(30, false)).toEqual(['Refresh', 'Settings'])
  expect(labels(24, false)).toEqual(['Refresh', 'Settings'])
  expect(labels(21, false)).toEqual(['Settings'])
})

test('the toolbar row ends with s: Settings', async ($, on) => {
  await open($, on)
  const ui = await mount($, 'terminal', 44)

  expect((await toolbar(ui))[1]).toBe(
    ' r: Refresh   n: New   f: Find   s: Settings',
  )
  await ui.unmount()
})

test('every setting has help', () => {
  expect(Object.keys(S.settingHelp)).toEqual([...SETTING_FIELDS])
})

// Boards: Change board opens the picker or looks again.
const URL = 'https://github.com/TeeratP/attend-baby.git'

// The repo has two linked boards; the one with the most of its issues is used.
async function openDetected($: Engine, on: On) {
  const world = boot(on, {
    [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  })
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
  const world = boot(on, { 'CLAUDE.md': KANBAN })
  fakeConfig(on, rows())
  github(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await settingsAt($, 'terminal', 44)

  const text = await textOf(ui, 44)
  expect(text.slice(text.indexOf('Board'), -2)).toEqual([
    'Board',
    '  GitHub · TeeratP/claude-kanban',
    '  #7',
    '  Named in CLAUDE.md or AGENTS.md',
  ])
  expect(await ui.find({ key: 'board:change' })).toBeUndefined()
  await ui.unmount()
})

test('under auto, a local board with no GitHub board found says why, and Change board looks again', async ($, on) => {
  const world = boot(on, {
    [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  })
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
    '  Local · .kanban/',
    '  no GitHub board for TeeratP/attend-baby',
    '  Change board',
  ])

  await ui.press({ key: 'board:change' })
  await world.clock.settle()

  expect(searches()).toBe(first * 2)
  // Nothing was found again, so the view stays.
  expect(await ui.find({ key: 'back' })).toBeDefined()
  await ui.unmount()
})

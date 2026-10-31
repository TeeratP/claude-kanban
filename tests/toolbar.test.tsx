import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { cellWidth, truncate } from '../hooks/model'
import { S } from '../hooks/strings'
import { keys, row, toolbar, treeKinds } from './board-ui'
import type { BoardUi } from './board-ui'
import { fakeProcess } from './fake-gh'
import { HANDOFF, bootGithub, issue } from './fake-github'
import { PANE, RUN, boot } from './fakes'
import { overflow, renderPane } from './render'
import { GH_VERSION, NO_GH, SIGNED_OUT, remote } from './zero'

// Row 1 of the toolbar is the status, row 2 the buttons. The engine draws a
// plain Button that has a hotkey as `<hotkey>: <label>`, so these tests read the
// drawn tree the way a terminal shows it.

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// The surfaces with a text field, so with New and Find.
const TYPING = ['terminal', 'desktop', 'vscode'] as const
const WIDTHS = [30, 44, 80] as const
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const
const QUERY = 'fix login page'

const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'claude', title: 'Build API' }),
  // Card 3 is moved to Human by these tests, which needs a handoff.
  issue(3, { column: 'backlog', title: 'Write docs', comments: [HANDOFF] }),
]

async function open($: Engine, on: On, surface: RenderSurface) {
  const world = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return world
}

const mount = <S extends RenderSurface>($: Engine, surface: S, width: number) =>
  $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns: width },
    surface,
  })

type FilterUi = BoardUi & Pick<Mounted<'terminal'>, 'input'>

// A filter kept: typed into the field, which Enter shuts.
async function filterBy(ui: FilterUi, text: string) {
  await ui.press({ key: 'filter' })
  await ui.input({ key: 'filter:text', text })
}

// Moves two cards while writes fail, so both show as failed.
async function failTwoMoves(
  $: Engine,
  world: Awaited<ReturnType<typeof open>>,
) {
  world.github.fail['project item-edit'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await world.clock.advance(300)
}

const HINT = ' · ↑↓ ⏎ open · m move'
const SETTINGS = 's: Settings'

// Row 1: the status, then `s: Settings` flush right. The button takes 12 cells,
// so the status gives way: below 40 columns the age goes, leaving the backend's name.
const status = (width: number, hint: boolean) => {
  const age = ' · updated just now'
  const text =
    width < 40
      ? ' GitHub'
      : width < 80
        ? ` GitHub${age}`
        : ` GitHub${age}${hint ? HINT : ''}`

  return `${text.padEnd(width - SETTINGS.length)}${SETTINGS}`
}

// The key hint shows where the pane has a Client and 80 columns hold it.
const hasHint = (surface: RenderSurface, width: number) =>
  width === 80 && (surface === 'terminal' || surface === 'desktop')

// A symbol-only label with a hotkey after it reads as that symbol's hotkey
// (`↻n:`, which is what the row said before it had words).
// (A symbol ending a word, as in `Mine+`, is part of that label, not one of its own.)
const SYMBOL_THEN_HOTKEY = /(^|\s)[↻+🔍✕]\s*[nfrv]: /

function expectReadable(rows: string[], width: number) {
  for (const line of rows) {
    expect(cellWidth(line)).toBeLessThanOrEqual(width)
    expect(line).not.toMatch(SYMBOL_THEN_HOTKEY)
  }
}

// Whose cards show sits before Find; below 44 columns Refresh gives way.
const ACTIONS = ' r: Refresh   n: New   v: Mine   f: Find'
const NARROW_ACTIONS = ' n: New   v: Mine   f: Find'
const MOBILE_ACTIONS = ' r: Refresh   v: Mine'
const actionsAt = (surface: RenderSurface, width: number) =>
  surface === 'mobile' ? MOBILE_ACTIONS : width < 44 ? NARROW_ACTIONS : ACTIONS

for (const surface of EVERY_SURFACE) {
  test(`row 1 is the status and row 2 the labelled actions at 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
    await open($, on, surface)

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status(width, hasHint(surface, width)),
        actionsAt(surface, width),
      ])
      expectReadable(rows, width)
      await ui.unmount()
    }
  })

  test(`failed moves show ✕N retry at the end of row 2, in the error colour, and row 1 keeps the status on the ${surface}`, async ($, on) => {
    const world = await open($, on, surface)
    await failTwoMoves($, world)
    const expected =
      surface === 'mobile'
        ? {
            80: ' r: Refresh   v: Mine   ✕2 retry',
            44: ' r: Refresh   v: Mine   ✕2 retry',
            // The spacing tightens first.
            30: 'r: Refresh v: Mine ✕2 retry',
          }
        : {
            80: ' r: Refresh   n: New   v: Mine   f: Find   ✕2 retry',
            // The spacing tightens first.
            44: 'r: Refresh n: New v: Mine f: Find ✕2 retry',
            // Refresh and New give way: the board refreshes itself.
            30: ' v: Mine   f: Find   ✕2 retry',
          }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status(width, hasHint(surface, width)),
        expected[width],
      ])
      expectReadable(rows, width)
      const retry = await ui.find({ key: 'retry-all' })
      expect(retry?.text).toBe('✕2 retry')
      expect(retry?.children[0]).toMatchObject({
        type: 'Text',
        props: { color: 'error' },
      })
      await ui.unmount()
    }
  })

  test(`r refreshes, n opens the form and f opens the filter field on the ${surface}`, async ($, on) => {
    const world = await open($, on, surface)
    const ui = await mount($, surface, 44)
    const hotkey = async (key: string) => (await ui.find({ key }))?.props.hotkey
    const text = async (key: string) => (await ui.find({ key }))?.text

    expect(await hotkey('refresh')).toBe('r')
    expect(await text('refresh')).toBe('Refresh')
    const loads = world.github.loads()
    await ui.press({ key: 'refresh' })
    await world.clock.settle()
    expect(world.github.loads()).toBeGreaterThan(loads)

    if (surface === 'mobile') {
      expect(await ui.find({ key: 'add' })).toBeUndefined()
      expect(await ui.find({ key: 'filter' })).toBeUndefined()
      await ui.unmount()

      return
    }

    expect(await hotkey('add')).toBe('n')
    expect(await text('add')).toBe('New')
    expect(await hotkey('filter')).toBe('f')
    expect(await text('filter')).toBe('Find')
    await ui.press({ key: 'add' })
    expect(await ui.find({ key: 'add:title' })).toBeDefined()
    await ui.press({ key: 'add' })
    await ui.press({ key: 'filter' })
    expect(await ui.find({ key: 'filter:text' })).toBeDefined()
    await ui.unmount()
  })
}

for (const surface of TYPING) {
  test(`a filter shows as f: Find "<query>" with a clear cross, the spacing and then Refresh giving way for the query, at 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const expected = {
      80: ` r: Refresh   n: New   v: Mine   f: Find "${QUERY}" ✕`,
      44: 'r: Refresh n: New v: Mine f: Find "fix l…" ✕',
      30: 'n: New v: Mine f: Find "fi…" ✕',
    }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      await filterBy(ui, QUERY)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status(width, hasHint(surface, width)),
        expected[width],
      ])
      expectReadable(rows, width)
      await ui.press({ key: 'filter:clear' })
      await ui.unmount()
    }
  })

  test(`the query is in the Find button and the cross clears it on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const ui = await mount($, surface, 80)
    await filterBy(ui, 'fix')

    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find "fix"')
    expect((await ui.find({ key: 'filter' }))?.props.hotkey).toBe('f')
    expect((await ui.find({ key: 'filter:clear' }))?.text).toBe('✕')

    await ui.press({ key: 'filter:clear' })

    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find')
    expect(await ui.find({ key: 'filter:clear' })).toBeUndefined()
    expect((await toolbar(ui))[1]).toBe(ACTIONS)
    await ui.unmount()
  })

  test(`a long query ends in an ellipsis inside its quotes on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const ui = await mount($, surface, 44)

    await filterBy(ui, 'label:ai label:feature words that go on')

    expect((await toolbar(ui))[1]).toBe(
      'r: Refresh n: New v: Mine f: Find "label…" ✕',
    )
    await ui.unmount()
  })

  test(`a filter and failed moves together keep the cross and the retry: Refresh gives way for the query, then the query and New go, on the ${surface}`, async ($, on) => {
    const world = await open($, on, surface)
    await failTwoMoves($, world)
    const expected = {
      80: ` r: Refresh   n: New   v: Mine   f: Find "${QUERY}" ✕   ✕2 retry`,
      44: 'n: New v: Mine f: Find "fix log…" ✕ ✕2 retry',
      30: 'v: Mine f: Find ✕ ✕2 retry',
    }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      await filterBy(ui, QUERY)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status(width, hasHint(surface, width)),
        expected[width],
      ])
      expectReadable(rows, width)
      await ui.press({ key: 'filter:clear' })
      await ui.unmount()
    }
  })
}

test('a very narrow pane keeps the filter, the cross and the retry, and gives up Refresh, New and then whose cards show', async ($, on) => {
  const world = await open($, on, 'terminal')
  await failTwoMoves($, world)
  const ui = await mount($, 'terminal', 20)

  await filterBy(ui, QUERY)

  const [, actions] = await toolbar(ui)
  expect(actions).toBe('f: Find ✕ ✕2 retry')
  expectReadable([actions], 20)
  await ui.unmount()
})

test('in a narrow pane the view goes by its short name before its button gives way', async ($, on) => {
  await open($, on, 'terminal')
  const rowAt = async (width: number) => {
    const ui = await mount($, 'terminal', width)
    const [, actions] = await toolbar(ui)
    expectReadable([actions], width)
    await ui.unmount()

    return actions
  }
  const step = async () => {
    const ui = await mount($, 'terminal', 44)
    await ui.press({ key: 'who' })
    await ui.unmount()
  }

  expect(await rowAt(20)).toBe(' v: Mine   f: Find')
  await step()
  // `Mine + open` does not fit beside Find: it goes by `Mine+`.
  expect(await rowAt(20)).toBe(' v: Mine+   f: Find')
  expect(await rowAt(24)).toBe('v: Mine + open f: Find')
  await step()
  expect(await rowAt(20)).toBe('v: Everyone f: Find')
  expect(await rowAt(16)).toBe('v: All f: Find')
})

for (const surface of ['terminal', 'vscode'] as const) {
  test(`the form and the filter field open under both toolbar rows on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const ui = await mount($, surface, 44)
    const list = surface === 'terminal' ? 'board' : 'grp:active'

    expect((await treeKinds(ui)).slice(0, 3)).toEqual([
      'settings',
      'refresh',
      list,
    ])

    await ui.press({ key: 'add' })
    await ui.press({ key: 'filter' })
    const kinds = await treeKinds(ui)

    expect(kinds.slice(0, 4)).toEqual([
      'settings',
      'refresh',
      'filter:text',
      'add:title',
    ])
    await ui.unmount()
  })
}

test('setup needed keeps the error colour on row 1 and the actions stay on row 2', async ($, on) => {
  const world = boot(on, {})
  fakeProcess(on, [
    GH_VERSION,
    SIGNED_OUT,
    remote('git@github.com:TeeratP/claude-kanban.git'),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  const ui = await mount($, 'terminal', 44)
  const first = (await ui.findAll({ type: 'Text' }))[0]
  const rows = await toolbar(ui)

  expect(first?.props.color).toBe('error')
  expect(rows[0]).toMatch(/^ GitHub · setup needed/)
  expect(rows[1]).toBe(ACTIONS)
  expectReadable(rows, 44)
  await ui.unmount()
})

for (const surface of EVERY_SURFACE) {
  test(`with gh missing the pane says so under the toolbar and offers g: Set up with Claude on the ${surface}`, async ($, on) => {
    const world = boot(on, {})
    fakeProcess(on, [
      NO_GH,
      remote('git@github.com:TeeratP/claude-kanban.git'),
    ])
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      const lines = await renderPane(ui, width)

      expect(lines[0]).toMatch(/^ GitHub · setup n/)
      // What is missing, then the button, once each, under both toolbar rows.
      expect(lines.slice(2, 4)).toEqual([
        truncate(` ${S.setupMissing.gh}`, width),
        ' g: Set up with Claude',
      ])
      expect(
        lines.filter(line => line.includes('Set up with Claude')),
      ).toHaveLength(1)
      expect((await ui.find({ key: 'setup' }))?.props.hotkey).toBe('g')
      expect(overflow(lines, width)).toEqual([])
      await ui.unmount()
    }
  })
}

test('pressing the setup button asks Claude to set GitHub up, with the reason', async ($, on) => {
  const world = boot(on, {})
  fakeProcess(on, [
      NO_GH,
      remote('git@github.com:TeeratP/claude-kanban.git'),
    ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 'terminal', 44)

  await ui.press({ key: 'setup' })
  await world.clock.settle()

  expect(world.prompts).toHaveLength(1)
  expect(world.prompts[0]).toContain('Set up GitHub for the kanban board')
  expect(world.prompts[0]).toContain('gh: command not found')
  expect(world.prompts[0]).toContain('(gh)')
  expect(world.toasts).toEqual([S.setupAsked])
  await ui.unmount()
})

test('the setup hotkey g submits the same prompt', async ($, on) => {
  const world = boot(on, {})
  fakeProcess(on, [
      NO_GH,
      remote('git@github.com:TeeratP/claude-kanban.git'),
    ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 'terminal', 44)

  // The engine hands the key to the Client and to the Buttons that have it for a hotkey.
  const armed = (await ui.findAll({ type: 'Button' })).flatMap(one =>
    one.props.hotkey === 'g' && one.key !== undefined ? [one.key] : [],
  )
  expect(armed).toEqual(['setup'])
  await keys(ui, 'g')
  for (const key of armed) await ui.press({ key })
  await world.clock.settle()

  expect(world.prompts).toHaveLength(1)
  expect(world.prompts[0]).toContain('gh: command not found')
  await ui.unmount()
})

test('once gh works, a refresh loads the board and the setup rows are gone', async ($, on) => {
  const world = bootGithub(on, cards())
  world.github.fail['--version'] = {
    exitCode: 127,
    stderr: 'gh: command not found',
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 'terminal', 44)
  expect(await ui.find({ key: 'setup' })).toBeDefined()
  expect((await toolbar(ui))[0]).toMatch(/^ GitHub · setup needed/)
  expect(await row(ui, 'card:gh:1')).toBeUndefined()

  delete world.github.fail['--version']
  await ui.press({ key: 'refresh' })
  await world.clock.settle()

  expect(await ui.find({ key: 'setup' })).toBeUndefined()
  expect(
    await ui.find({ type: 'Text', text: S.setupMissing.gh.trim() }),
  ).toBeUndefined()
  expect(await toolbar(ui)).toEqual([status(44, false), ACTIONS])
  expect((await row(ui, 'card:gh:1'))?.text).toContain('#1 Fix login')
  expect(world.github.loads()).toBeGreaterThanOrEqual(1)
  await ui.unmount()
})

test('the status is dim, with no colour of its own', async ($, on) => {
  await open($, on, 'terminal')
  const ui = await mount($, 'terminal', 44)

  const first = (await ui.findAll({ type: 'Text' }))[0]

  expect(first?.props.dimColor).toBe(true)
  expect(first?.props.color).toBeUndefined()
  await ui.unmount()
})

test('the status says in words how old the board is: just now, then minutes and hours ago', async ($, on) => {
  const world = await open($, on, 'terminal')
  const statusAt = async () => {
    const ui = await mount($, 'terminal', 80)
    const [first = ''] = await toolbar(ui)
    await ui.unmount()

    return first
  }

  expect(await statusAt()).toContain('· updated just now')
  await world.clock.advance(5 * 60_000)
  expect(await statusAt()).toContain('· updated 5m ago')
  await world.clock.advance(2 * 60 * 60_000)
  expect(await statusAt()).toContain('· updated 2h ago')
})

test('the status copy: ages in words, and the backend name', () => {
  expect(S.updated('now')).toBe('updated just now')
  expect(S.updated('5m')).toBe('updated 5m ago')
  expect(S.updated('3w')).toBe('updated 3w ago')
  expect(S.backendName).toBe('GitHub')
  expect(S.setupNeeded).toBe('setup needed')
})

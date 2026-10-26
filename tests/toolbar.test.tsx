import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import { S } from '../hooks/strings'
import { toolbar, treeKinds } from './board-ui'
import type { BoardUi } from './board-ui'
import { fakeProcess } from './fake-gh'
import { HANDED_OFF, PANE, RUN, boot, card, path } from './fakes'
import type { Files } from './fakes'
import { KANBAN, github } from './github-board'
import { GH_VERSION, SIGNED_OUT, remote } from './zero'

// Row 1 of the toolbar is the status, row 2 the buttons. The engine draws a
// plain Button that has a hotkey as `<hotkey>: <label>`, so these tests read the
// drawn tree the way a terminal shows it.

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// The surfaces with a text field, so with New and Find.
const TYPING = ['terminal', 'desktop', 'vscode'] as const
const WIDTHS = [30, 44, 80] as const
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const
const QUERY = 'fix login page'

const cards = (): Files => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  // Card 3 is moved to Human by these tests, which needs a handoff.
  [path(3, 'docs')]: card(
    3,
    { status: 'backlog', title: 'Write docs' },
    HANDED_OFF,
  ),
})

async function open(
  $: Engine,
  on: On,
  surface: RenderSurface,
  backend: 'local' | 'github' = 'local',
) {
  const world = boot(
    on,
    backend === 'github'
      ? { 'CLAUDE.md': KANBAN }
      : { ...cards(), 'CLAUDE.md': '# Notes\n' },
  )
  if (backend === 'github') github(on)
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
  world.calls.denyWrite = 'EIO: disk error'
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await world.clock.advance(300)
}

const HINT = ' · ↑↓ ⏎ open · m move'
// " (auto)" gives way to the backend's name below 40 columns.
const status = (name: string, width: number, hint: boolean) =>
  ` ${name}${width < 40 ? '' : ' (auto)'} · updated just now${hint ? HINT : ''}`

// The key hint shows where the pane has a Client and 80 columns hold it.
const hasHint = (surface: RenderSurface, width: number) =>
  width === 80 && (surface === 'terminal' || surface === 'desktop')

// A symbol-only label with a hotkey after it reads as that symbol's hotkey
// (`↻n:`, which is what the row said before it had words).
const SYMBOL_THEN_HOTKEY = /[↻+🔍✕]\s*[nfr]: /

function expectReadable(rows: string[], width: number) {
  for (const line of rows) {
    expect(cellWidth(line)).toBeLessThanOrEqual(width)
    expect(line).not.toMatch(SYMBOL_THEN_HOTKEY)
  }
}

// At 30 columns Refresh gives way to Settings, which gives way last; the spacing tightens first.
const actionsAt = (width: number) =>
  width < 44
    ? 'n: New f: Find s: Settings'
    : ' r: Refresh   n: New   f: Find   s: Settings'
const MOBILE_ACTIONS = ' r: Refresh   s: Settings'

for (const surface of EVERY_SURFACE) {
  for (const backend of ['local', 'github'] as const) {
    const label = backend === 'local' ? 'Local' : 'GitHub'

    test(`${backend}: row 1 is the status and row 2 the labelled actions at 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
      await open($, on, surface, backend)

      for (const width of WIDTHS) {
        const ui = await mount($, surface, width)
        const rows = await toolbar(ui)

        expect(rows).toEqual([
          status(label, width, hasHint(surface, width)),
          surface === 'mobile' ? MOBILE_ACTIONS : actionsAt(width),
        ])
        expectReadable(rows, width)
        await ui.unmount()
      }
    })
  }

  test(`failed moves show ✕N retry at the end of row 2, in the error colour, and row 1 keeps the status on the ${surface}`, async ($, on) => {
    const world = await open($, on, surface)
    await failTwoMoves($, world)
    const expected =
      surface === 'mobile'
        ? {
            80: ' r: Refresh   s: Settings   ✕2 retry',
            44: ' r: Refresh   s: Settings   ✕2 retry',
            // Refresh gives way: the board refreshes itself.
            30: ' s: Settings   ✕2 retry',
          }
        : {
            80: ' r: Refresh   n: New   f: Find   s: Settings   ✕2 retry',
            44: ' n: New   f: Find   s: Settings   ✕2 retry',
            // Then New, and the spacing tightens.
            30: 'f: Find s: Settings ✕2 retry',
          }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status('Local', width, hasHint(surface, width)),
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
    const lists = world.calls.lists
    await ui.press({ key: 'refresh' })
    await world.clock.settle()
    expect(world.calls.lists).toBeGreaterThan(lists)

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
  test(`a filter shows as f: Find "<query>" with a clear cross, the query cut first, at 30, 44 and 80 columns on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const expected = {
      80: ` r: Refresh   n: New   f: Find "${QUERY}" ✕   s: Settings`,
      // Little room for the query: the spacing tightens.
      44: 'r: Refresh n: New f: Find "f…" ✕ s: Settings',
      // None: Refresh gives way and the cross says a filter is on.
      30: 'n: New f: Find ✕ s: Settings',
    }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      await filterBy(ui, QUERY)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status('Local', width, hasHint(surface, width)),
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
    expect((await toolbar(ui))[1]).toBe(actionsAt(80))
    await ui.unmount()
  })

  test(`a long query ends in an ellipsis inside its quotes on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const ui = await mount($, surface, 80)

    await filterBy(ui, 'label:ai label:feature words that go on')

    expect((await toolbar(ui))[1]).toBe(
      ' r: Refresh   n: New   f: Find "label:ai label:feature words t…" ✕   s: Settings',
    )
    await ui.unmount()
  })

  test(`a filter and failed moves together keep the cross and the retry, and give up the query, Refresh and New in that order, and keep Settings, on the ${surface}`, async ($, on) => {
    const world = await open($, on, surface)
    await failTwoMoves($, world)
    const expected = {
      80: ` r: Refresh   n: New   f: Find "${QUERY}" ✕   s: Settings   ✕2 retry`,
      44: ' n: New   f: Find ✕   s: Settings   ✕2 retry',
      30: 'f: Find ✕ s: Settings ✕2 retry',
    }

    for (const width of WIDTHS) {
      const ui = await mount($, surface, width)
      await filterBy(ui, QUERY)
      const rows = await toolbar(ui)

      expect(rows).toEqual([
        status('Local', width, hasHint(surface, width)),
        expected[width],
      ])
      expectReadable(rows, width)
      await ui.press({ key: 'filter:clear' })
      await ui.unmount()
    }
  })
}

test('a very narrow pane keeps the filter, the cross and the retry and drops New and Settings too', async ($, on) => {
  const world = await open($, on, 'terminal')
  await failTwoMoves($, world)
  const ui = await mount($, 'terminal', 20)

  await filterBy(ui, QUERY)

  expect((await toolbar(ui))[1]).toBe('f: Find ✕ ✕2 retry')
  await ui.unmount()
})

for (const surface of ['terminal', 'vscode'] as const) {
  test(`the form and the filter field open under both toolbar rows and the suggestions follow them on the ${surface}`, async ($, on) => {
    await open($, on, surface)
    const ui = await mount($, surface, 44)
    const list = surface === 'terminal' ? 'board' : 'grp:active'

    expect((await treeKinds(ui)).slice(0, 3)).toEqual(['Text', 'refresh', list])

    await ui.press({ key: 'add' })
    await ui.press({ key: 'filter' })
    await $.tool.call({
      tool: 'mcp__kanban__kanban_suggest',
      title: 'Fix flaky test',
      spec: 'It fails 1 in 10.',
    })
    const kinds = await treeKinds(ui)

    expect(kinds.slice(0, 4)).toEqual([
      'Text',
      'refresh',
      'filter:text',
      'add:title',
    ])
    expect(kinds[4]).toMatch(/^suggest:/)
    await ui.unmount()
  })
}

test(
  'an error keeps its colour on row 1 and the actions stay on row 2',
  { options: { backend: 'github' } },
  async ($, on) => {
    const world = boot(on, { 'CLAUDE.md': KANBAN })
    fakeProcess(on, [
      GH_VERSION,
      SIGNED_OUT,
      remote('git@github.com:TeeratP/claude-kanban.git'),
    ])
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await $.command.run({ ...RUN })
    await world.clock.settle()

    const ui = await mount($, 'terminal', 44)
    const first = (await ui.findAll({ type: 'Text' }))[0]
    const rows = await toolbar(ui)

    expect(first?.props.color).toBe('error')
    expect(rows[0]).toMatch(/^ GitHub · gh auth status failed/)
    expect(rows[1]).toBe(actionsAt(44))
    expectReadable(rows, 44)
    await ui.unmount()
  },
)

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

test('the status copy: ages in words, and the backend name without (auto) when the pane is narrow', () => {
  expect(S.updated('now')).toBe('updated just now')
  expect(S.updated('5m')).toBe('updated 5m ago')
  expect(S.updated('3w')).toBe('updated 3w ago')
  expect(S.backendLabel('auto', 'local')).toBe('Local (auto)')
  expect(S.backendLabel('auto', 'github', true)).toBe('GitHub')
  // A backend that was asked for never had (auto) to lose.
  expect(S.backendLabel('local', 'local')).toBe('Local')
  expect(S.backendLabel('local', 'local', true)).toBe('Local')
})

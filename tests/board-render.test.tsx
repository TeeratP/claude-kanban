import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { group, rowIndex } from './board-ui'
import { CWD, NOW, PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'
import { overflow, renderPane } from './render'

// The board as a terminal would show it, at the widths the pane is used at,
// in the states it is seen in. The exact frames are at 44 columns; every state
// is checked not to run past the edge at each width.

const WIDTHS = [24, 30, 44, 80] as const
const MINUTE = 60_000
const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString()

// A board with every section filled, the Claude card with a second row.
function board() {
  const files: Record<string, string> = {}
  const add = (
    n: number,
    status: string,
    title: string,
    minutes: number,
    body?: string,
  ) => {
    files[path(n, `c${n}`)] = card(
      n,
      { status, title, updated: ago(minutes), order: n },
      body,
    )
  }
  add(12, 'human', 'Fix login redirect loop on Safari', 12)
  add(7, 'human', 'Rewrite the onboarding flow so that it is short', 24 * 60)
  add(
    23,
    'human',
    'Which auth provider?',
    600,
    'Spec.\n\n## Question (2026-10-25)\nWhich provider should we use?\n',
  )
  add(31, 'claude', 'Build the sync API', 3)
  add(32, 'claude', 'Add a dark theme', 180)
  const backlog = [
    'Write docs',
    'Ship 1.0',
    '[KANB-UIX] Polish the board',
    'Investigate flaky test in sync',
    'Rate-limit banner',
    'Cache warmup',
    'Telemetry opt-out',
    'Keyboard help overlay',
  ]
  backlog.forEach((title, i) =>
    add(40 + i, 'backlog', title, 20 * 60 + i * 24 * 60),
  )
  for (let i = 0; i < 12; i += 1) {
    add(100 + i, 'done', `Finished task ${i}`, 24 * 60 * (i + 1))
  }
  add(56, 'suspended', 'Keyboard help overlay v2', 14 * 24 * 60)
  add(57, 'cancelled', 'Export to CSV', 21 * 24 * 60)

  return files
}

// Claude has worked on card 31: two agents, 12 minutes, 48k tokens, idle for three.
const store = () => ({
  [`activity:${CWD}:md:0031-c31`]: {
    shape: 'activity-1',
    cwd: CWD,
    card: {
      cardId: 'md:0031-c31',
      rounds: [
        {
          startedAt: 0,
          ms: 12 * MINUTE,
          input: 40_000,
          output: 8_000,
          cacheRead: 90_000,
          agents: ['Explore', 'Plan'],
          isOpen: false,
        },
      ],
      lastAt: NOW - 3 * MINUTE,
      lastAgent: 'Explore',
      tool: '',
      target: '',
      toolId: '',
      isToolRunning: false,
    },
  },
})

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  files: Record<string, string>,
  surface: S = 'terminal' as S,
) {
  const world = boot(on, files, store())
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return world
}

const mountOn = <S extends RenderSurface>(
  $: Engine,
  columns: number,
  surface: S,
) =>
  $.ui.mount({
    ...PANE,
    surface,
    props: {
      ...PANE.props,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 30 },
    },
  })

const mount = ($: Engine, columns: number) => mountOn($, columns, 'terminal')

type Drawn = Pick<Mounted, 'drawn'>

// Every state drawn at every width: no line runs past the pane.
async function fits(ui: Drawn, columns: number, what: string) {
  const lines = await renderPane(ui, columns)

  expect(overflow(lines, columns), `${what} at ${columns}`).toEqual([])

  return lines
}

test('Active open at 44 columns: one title column, ages flush right, spare room marked, the legend in the leftover row', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 44)

  expect(await fits(ui, 44, 'active open')).toEqual([
    ' Local (auto) · updated just now s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▾ Active',
    '  Backlog 8 ────────────────────────────────',
    '   #40 Write docs                        20h',
    '   #41 Ship 1.0                           1d',
    '   #42 [KANB-UIX] Polish the board        2d',
    '   #43 Investigate flaky test in sync     3d',
    '   #44 Rate-limit banner                  4d',
    '   #45 Cache warmup                       5d',
    '       ↓ 2 more',
    '  Claude 2 ─────────────────────────────────',
    '   #31 Build the sync API                 3m',
    '       ●● Explore · idle 3m · 12m · 48k',
    '   #32 Add a dark theme                   3h',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '  Human 3 ──────────────────────────────────',
    '    #7 Rewrite the onboarding flow so …   1d',
    '   #12 Fix login redirect loop on Safa…  12m',
    '   ?23 Which auth provider?              10h',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '▸ Inactive                         12D 1C 1S',
    '  ⏎ open · m move · ⇧J/K reorder',
    '',
  ])
  await ui.unmount()
})

test('Active open at 30 columns drops (auto), the Refresh label stays and the long titles are cut', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 30)
  const lines = await fits(ui, 30, 'active open')

  expect(lines.slice(0, 7)).toEqual([
    ' Local             s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▾ Active',
    '  Backlog 8 ──────────────────',
    '   #40 Write docs          20h',
    '   #41 Ship 1.0             1d',
    '   #42 [KANB-UIX] Polish…   2d',
  ])
  expect(lines.slice(-4)).toEqual([
    '     ·',
    '▸ Inactive           12D 1C 1S',
    '  ⏎ open · m move',
    '',
  ])
  await ui.unmount()
})

test('Inactive open: Active is a summary, the dim cards keep the title column and the ages grow to weeks', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 44)
  await group(ui, 'inactive')

  expect(await fits(ui, 44, 'inactive open')).toEqual([
    ' Local (auto) · updated just now s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▸ Active      8 Backlog · 2 Claude · 3 Human',
    '▾ Inactive',
    '  Done 12 ──────────────────────── 10 newest',
    '  #100 Finished task 0                    1d',
    '  #101 Finished task 1                    2d',
    '  #102 Finished task 2                    3d',
    '  #103 Finished task 3                    4d',
    '  #104 Finished task 4                    5d',
    '  #105 Finished task 5                    6d',
    '       ↓ 4 more',
    '  Cancelled 1 ──────────────────────────────',
    '   #57 Export to CSV                      3w',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '  Suspended 1 ──────────────────────────────',
    '   #56 Keyboard help overlay v2           2w',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '     ·',
    '  ⏎ open · m move · ⇧J/K reorder',
    '',
  ])
  await ui.unmount()
})

test('both groups folded: two summaries and the line that says to press one, which a pane under 30 columns leaves out', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 44)
  await group(ui, 'active')

  expect(await fits(ui, 44, 'both folded')).toEqual([
    ' Local (auto) · updated just now s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▸ Active      8 Backlog · 2 Claude · 3 Human',
    '▸ Inactive                         12D 1C 1S',
    '  Press a group to open it',
  ])
  await ui.unmount()
  for (const columns of [24, 30, 80]) {
    const narrow = await mount($, columns)
    const lines = await fits(narrow, columns, 'both folded')

    expect(lines.length).toBe(columns < 30 ? 4 : 5)
    await narrow.unmount()
  }
})

test('an empty board says what each section is for, and where cards live', async ($, on) => {
  await start($, on, {})
  const ui = await mount($, 44)

  expect(await fits(ui, 44, 'empty')).toEqual([
    ' Local (auto) · updated just now s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▾ Active',
    '  Backlog 0 ────────────────────────────────',
    '       Nothing yet · n adds a card',
    '',
    '',
    '',
    '',
    '',
    '  Claude 0 ─────────────────────────────────',
    '       Idle · drag a card here',
    '',
    '',
    '',
    '',
    '',
    '  Human 0 ──────────────────────────────────',
    '       ✓ All clear, nothing needs you',
    '',
    '',
    '',
    '',
    '',
    '▸ Inactive                             empty',
    '',
    '',
    '  Cards live in .kanban/*.md here.',
    '  On GitHub? Link a Project to the repo',
    '  or set backend: github to see why.',
  ])
  await ui.unmount()

  const narrow = await mount($, 30)
  const lines = await fits(narrow, 30, 'empty')
  expect(lines.slice(-3)).toEqual([
    '  Cards live in .kanban/',
    '  GitHub? Link a Project',
    '  or set backend: github',
  ])
  await narrow.unmount()
})

test('the first load draws bars where the cards will be, never an empty board', async ($, on) => {
  const world = boot(on, board(), store())
  world.calls.holdList = new Promise(() => {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await mount($, 44)

  expect(await fits(ui, 44, 'loading')).toEqual([
    ' Local (auto) · loading…         s: Settings',
    ' r: Refresh   n: New   f: Find',
    '▾ Active',
    '  Backlog ──────────────────────────────────',
    '       ───────────────────',
    '       ─────────────',
    '       ────────────────────────',
    '',
    '',
    '',
    '',
    '  Claude ───────────────────────────────────',
    '       ─────────────',
    '       ────────────────────────',
    '       ───────────────────',
    '',
    '',
    '',
    '',
    '  Human ────────────────────────────────────',
    '       ────────────────────────',
    '       ───────────────────',
    '       ─────────────',
    '',
    '',
    '',
    '',
    '▸ Inactive',
    '',
    '',
  ])
  await ui.unmount()
  for (const columns of WIDTHS) {
    const shown = await mount($, columns)
    const lines = await fits(shown, columns, 'loading')

    expect(lines.join('\n')).not.toMatch(/No cards|Cards live|GitHub/)
    await shown.unmount()
  }
})

test('a card on its way shows the mark before its age, a failed one the cross and a red number, and neither moves the title column', async ($, on) => {
  const world = await start($, on, board())
  const first = await mount($, 44)
  world.calls.hold = new Promise(() => {})
  await first.post({ type: 'drop', cardId: 'md:0040-c40', column: 'claude' })
  await world.clock.advance(SYNC_PAUSE)
  await first.unmount()

  const ui = await mount($, 44)
  const lines = await fits(ui, 44, 'syncing')
  const syncing = lines.find(line => line.includes('#40'))

  // The mark, then the age.
  expect(syncing).toBe(`   #40 Write docs${' '.repeat(22)}⟳ 20h`)
  expect(lines.find(line => line.includes('#41'))?.indexOf('Ship')).toBe(7)
  await ui.unmount()
  for (const columns of WIDTHS) {
    const narrow = await mount($, columns)
    await fits(narrow, columns, 'syncing')
    await narrow.unmount()
  }
})

test('a failed move keeps the cross and the age flush right', async ($, on) => {
  const world = await start($, on, board())
  const first = await mount($, 44)
  world.calls.denyWrite = 'EIO: disk error'
  await first.post({ type: 'drop', cardId: 'md:0041-c41', column: 'human' })
  await world.clock.advance(SYNC_PAUSE)
  await world.clock.advance(SYNC_PAUSE)
  await first.unmount()

  for (const columns of WIDTHS) {
    const ui = await mount($, columns)
    const lines = await fits(ui, columns, 'failed')
    const failed = lines.find(line => line.includes('#41'))

    expect(failed).toMatch(/✕ {2}1d$/)
    await ui.unmount()
  }
})

test('dragging a card over a folded group draws its sections as chips, and the card is pointed at', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 44)
  const from = await rowIndex(ui, 'card:md:0042-c42')
  const over = await rowIndex(ui, 'grp:inactive')
  await ui.pointer({ type: 'down', x: 4, y: from, button: 'left' })
  await ui.pointer({ type: 'move', x: 14, y: over, button: 'left' })
  const lines = await fits(ui, 44, 'dragging')

  expect(lines[over + 2]).toBe('▸ Inactive Done  Cancelled  Suspended')
  expect(lines[from + 2]).toBe('›  #42 [KANB-UIX] Polish the board        2d')
  expect(lines[over + 3]).toBe('  ⏎ open · m move · ⇧J/K reorder')
  await ui.pointer({ type: 'up', x: 14, y: over, button: 'left' })
  await ui.unmount()
})

test('a filter with no match says so in every section, and keeps the pane in its width', async ($, on) => {
  await start($, on, board())
  const ui = await mount($, 44)
  await ui.press({ key: 'filter' })
  await ui.input({ key: 'filter:text', text: 'zzz' })
  const lines = await fits(ui, 44, 'no matches')

  expect(lines.filter(line => line.trim() === 'No matches')).toHaveLength(3)
  await ui.unmount()
})

for (const surface of ['vscode', 'mobile'] as const) {
  test(`the board has the same rows on the ${surface}, whose Buttons stand in for the Client`, async ($, on) => {
    await start($, on, board(), surface)
    for (const columns of WIDTHS) {
      const ui = await mountOn($, columns, surface)
      const lines = await fits(ui, columns, `${surface} active`)

      expect(lines.some(line => line.includes('#40 Write docs'))).toBe(true)
      expect(lines.filter(line => line.includes('·')).length).toBeGreaterThan(5)
      // No legend where there are no keys to list.
      expect(lines.join('\n')).not.toContain('⏎ open')
      await ui.unmount()
    }
  })
}

for (const columns of WIDTHS) {
  test(`every state fits ${columns} columns: first load, empty, Inactive open, folded`, async ($, on) => {
    const files = board()
    await start($, on, files)
    const ui = await mount($, columns)
    await fits(ui, columns, 'active')
    await group(ui, 'inactive')
    await fits(ui, columns, 'inactive')
    await group(ui, 'inactive')
    await fits(ui, columns, 'folded')
    await ui.unmount()
  })
}

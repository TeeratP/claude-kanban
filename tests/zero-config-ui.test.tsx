import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, PANE, RUN, boot, card, path } from './fakes'
import { rowKeys, toolbar } from './board-ui'
import { boardReply, fakeProcess, issueNode } from './fake-gh'
import type { Reply, Route } from './fake-gh'
import {
  ALL_STATUSES,
  BABY,
  GH_VERSION,
  NO_GH,
  SIGNED_IN,
  fieldList,
  graphql,
  lines,
  remote,
} from './zero'
import type { FakeProject } from './zero'

const URL = 'https://github.com/TeeratP/attend-baby.git'
const SHARED: FakeProject = {
  number: 2,
  title: "@TeeratP's Kanban",
  items: { [BABY]: 50 },
}
const CAST: FakeProject = { number: 6, title: 'Car Cast', items: { [BABY]: 3 } }
const TWIN: FakeProject = { number: 8, title: 'Twin', items: { [BABY]: 3 } }

// Local cards sit on disk in every test, so a GitHub board that showed them would be caught.
const files = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Local login' }),
})

// Each board holds one issue of its own, told apart by the project id the query sends.
const load = (argv: readonly string[]): Reply => {
  const project = argv.find(part => part.startsWith('projectId='))
  const number = Number(project?.slice('projectId=PVT_'.length))
  if (number === 9) {
    return {
      exitCode: 1,
      stderr: "Could not resolve to a node with the global id of 'PVT_9'",
    }
  }

  return boardReply([
    issueNode({ number: number * 10, repo: BABY, status: 'In progress' }),
    issueNode({ number: number * 10 + 1, repo: BABY, status: 'Backlog' }),
  ])(argv)
}

const ready = (lookup: Parameters<typeof graphql>[0], ...more: Route[]) => [
  GH_VERSION,
  SIGNED_IN,
  remote(URL),
  graphql({ ...lookup, load }),
  fieldList(ALL_STATUSES),
  ...more,
]

async function open(
  $: Engine,
  on: On,
  routes: Route[],
  store?: Record<string, unknown>,
) {
  const world = boot(on, files(), store)
  const commands = fakeProcess(on, routes)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return { ...world, commands }
}

async function pane($: Engine, bodyColumns: number = PANE.props.bodyColumns) {
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns },
    surface: 'terminal',
  })
  const toolbar = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
  const cards = (await rowKeys(ui)).filter(key => key.startsWith('card:'))
  const picks = (await ui.findAll({ type: 'Button' })).flatMap(one =>
    one.key?.startsWith('pick:') === true ? [one.key] : [],
  )

  return { ui, toolbar, cards, picks }
}

const view = async ($: Engine, bodyColumns?: number) => {
  const shown = await pane($, bodyColumns)
  await shown.ui.unmount()

  return shown
}

const listed = ($: Engine) => $.tool.call({ tool: 'mcp__kanban__kanban_list' })

const lookups = (commands: readonly { argv: readonly string[] }[]) =>
  lines(commands).filter(
    line => line.startsWith('gh api graphql') && line.includes('-f o='),
  )

const detected = (project: FakeProject, origin = URL) => ({
  shape: 'detect-1',
  origin,
  info: {
    kind: 'github',
    repo: BABY,
    owner: 'TeeratP',
    projectNumber: project.number,
    projectId: `PVT_${project.number}`,
    statusFieldId: 'PVTSSF_zero',
    options: {
      backlog: 'o-Backlog',
      inProgress: 'o-In progress',
      inReview: 'o-In review',
      done: 'o-Done',
    },
    title: project.title ?? '',
    isDetected: true,
  },
})

test('a repo with one linked board loads it with no config, and the toolbar names the board', async ($, on) => {
  const { commands } = await open($, on, ready({ linked: [SHARED] }))

  const wide = await view($, 120)

  expect(wide.toolbar).toContain("GitHub (auto) · #2 @TeeratP's Kanban")
  expect(wide.cards).toEqual(['card:gh:21', 'card:gh:20'])
  expect(wide.picks).toEqual([])
  expect(lines(commands).slice(0, 5)).toEqual([
    'git remote get-url origin',
    'gh --version',
    'gh auth status',
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
    'gh project field-list 2 --owner TeeratP --format json',
  ])
})

test('in a narrow pane the board name is cut, not the backend or the status', async ($, on) => {
  await open($, on, ready({ linked: [SHARED] }))

  const narrow = await view($)

  expect(narrow.toolbar).toMatch(/^ GitHub \(auto\) · #2 .+… · updated/)
  expect(narrow.toolbar.length).toBeLessThanOrEqual(44)
})

test('the board name is cut to the status row at 30, 44 and 80 columns, with the buttons on the row below', async ($, on) => {
  await open($, on, ready({ linked: [SHARED] }))
  const expected = {
    30: ' GitHub · updated just now',
    44: ' GitHub (auto) · #2 @Tee… · updated just now',
    80: " GitHub (auto) · #2 @TeeratP's Kanban · updated just now · ↑↓ ⏎ open · m move",
  }

  for (const width of [30, 44, 80] as const) {
    const ui = await $.ui.mount({
      ...PANE,
      props: { ...PANE.props, bodyColumns: width },
      surface: 'terminal',
    })

    expect(await toolbar(ui)).toEqual([
      expected[width],
      width < 44
        ? 'n: New f: Find s: Settings'
        : ' r: Refresh   n: New   f: Find   s: Settings',
    ])
    await ui.unmount()
  }
})

test('the board is detected from a repo that has no CLAUDE.md or AGENTS.md at all', async ($, on) => {
  const { world, commands } = await (async () => {
    const opened = await open($, on, ready({ linked: [SHARED] }))

    return { world: opened, commands: opened.commands }
  })()

  expect(world.calls.reads).toEqual([])
  expect(
    lines(commands).filter(line => line.startsWith('gh api')),
  ).toHaveLength(2)
  expect(JSON.stringify(await listed($))).toContain('#20 [claude]')
})

test('several boards with a tie show a one-row picker and no cards until one is picked', async ($, on) => {
  await open($, on, ready({ linked: [CAST, TWIN] }))

  const shown = await pane($)

  expect(shown.toolbar).toContain('Several GitHub boards fit')
  expect(shown.cards).toEqual([])
  expect(shown.picks).toEqual(['pick:PVT_6', 'pick:PVT_8'])
  expect(
    (await shown.ui.find({ type: 'Text', text: /^Pick board:/ }))?.text,
  ).toBe('Pick board:')
  expect(await listed($)).toMatchObject({
    deny: expect.stringContaining(
      'Several GitHub boards fit TeeratP/attend-baby',
    ),
  })
  await shown.ui.unmount()
})

test('while the picker waits for a pick, polling does not search again', async ($, on) => {
  const { commands, clock, world } = await open(
    $,
    on,
    ready({ linked: [CAST, TWIN] }),
  )
  // The pane stays open, so the ticks poll.
  world.panes = ['kanban']
  const before = lookups(commands).length

  await clock.advance(120_000)

  expect(before).toBe(1)
  expect(lookups(commands)).toHaveLength(before)
})

test('picking a board loads it, and the choice is kept for this directory', async ($, on) => {
  const { commands, saved } = await open($, on, ready({ linked: [CAST, TWIN] }))

  const shown = await pane($)
  await shown.ui.press({ key: 'pick:PVT_8' })
  await shown.ui.unmount()
  const after = await view($, 120)

  expect(after.picks).toEqual([])
  expect(after.toolbar).toContain('GitHub (auto) · #8 Twin')
  expect(after.cards).toEqual(['card:gh:81', 'card:gh:80'])
  expect(JSON.parse(saved.get(`detect:${CWD}`) ?? 'null')).toMatchObject({
    shape: 'detect-1',
    origin: URL,
    info: { projectNumber: 8, projectId: 'PVT_8', title: 'Twin' },
  })
  // The choice is the person's: nothing was written to GitHub.
  expect(
    lines(commands).filter(line => /item-edit|issue (edit|create)/.test(line)),
  ).toEqual([])
})

test('a saved choice means no lookup and no picker in the next session', async ($, on) => {
  const { commands } = await open($, on, ready({ linked: [CAST, TWIN] }), {
    [`detect:${CWD}`]: detected(TWIN),
  })

  const shown = await view($, 120)

  expect(shown.picks).toEqual([])
  expect(shown.toolbar).toContain('#8 Twin')
  expect(shown.cards).toEqual(['card:gh:81', 'card:gh:80'])
  expect(lookups(commands)).toEqual([])
  expect(lines(commands)).not.toContain('gh --version')
  expect(lines(commands)[0]).toBe('git remote get-url origin')
})

test('a changed origin is detected again, and the old board is not restored from the saved cards', async ($, on) => {
  const { commands } = await open($, on, ready({ linked: [SHARED] }), {
    [`detect:${CWD}`]: detected(
      CAST,
      'https://github.com/TeeratP/old-name.git',
    ),
    [`cache:${CWD}`]: {
      shape: 'cache-2',
      mode: 'auto',
      backend: detected(CAST).info,
      cards: [],
    },
  })

  const shown = await view($, 120)

  expect(shown.toolbar).toContain('#2 @TeeratP')
  expect(shown.cards).toEqual(['card:gh:21', 'card:gh:20'])
  expect(lookups(commands)).toHaveLength(1)
})

test('a detected board that is gone is looked for again in the same refresh', async ($, on) => {
  const { commands, saved } = await open($, on, ready({ linked: [SHARED] }), {
    [`detect:${CWD}`]: detected({ number: 9, title: 'Deleted' }),
  })

  const shown = await view($, 120)

  expect(shown.toolbar).toContain('#2 @TeeratP')
  expect(shown.cards).toEqual(['card:gh:21', 'card:gh:20'])
  expect(lookups(commands)).toHaveLength(1)
  expect(JSON.parse(saved.get(`detect:${CWD}`) ?? 'null')).toMatchObject({
    info: { projectNumber: 2 },
  })
})

test('no board for the repo: local cards show and the toolbar says so', async ($, on) => {
  await open($, on, ready({ linked: [], viewer: [{ number: 7 }], owner: [] }))

  const shown = await view($, 120)

  expect(shown.toolbar).toContain(`Local (auto) · no GitHub board for ${BABY}`)
  expect(shown.cards).toEqual(['card:md:0001-login'])
})

test('without gh, local cards show with no note about boards', async ($, on) => {
  await open($, on, [NO_GH, remote(URL)])

  const shown = await view($, 120)

  expect(shown.toolbar).toContain('Local (auto)')
  expect(shown.toolbar).not.toContain('no GitHub board')
  expect(shown.cards).toEqual(['card:md:0001-login'])
})

test(
  'github mode shows the failing zero-config check',
  { options: { backend: 'github' } },
  async ($, on) => {
    await open($, on, [NO_GH, remote(URL)])

    const shown = await view($, 120)

    expect(shown.toolbar).toContain('GitHub · gh is not installed')
    expect(shown.cards).toEqual([])
  },
)

test('Change board looks again and reopens the picker with the other boards', async ($, on) => {
  await open($, on, ready({ linked: [SHARED, CAST] }))

  const shown = await pane($, 120)
  expect(shown.picks).toEqual([])
  await shown.ui.press({ key: 'source' })
  await shown.ui.unmount()
  const reopened = await pane($, 120)

  expect(reopened.picks).toEqual(['pick:PVT_2', 'pick:PVT_6'])
  expect(
    (await reopened.ui.find({ type: 'Text', text: /^Change board:/ }))?.text,
  ).toBe('Change board:')
  await reopened.ui.press({ key: 'pick:PVT_6' })
  await reopened.ui.unmount()
  const after = await view($, 120)

  expect(after.picks).toEqual([])
  expect(after.toolbar).toContain('#6 Car Cast')
  expect(after.cards).toEqual(['card:gh:61', 'card:gh:60'])
})

test('Change board with no other board only says so', async ($, on) => {
  const { toasts } = await open($, on, ready({ linked: [SHARED] }))

  const shown = await pane($, 120)
  await shown.ui.press({ key: 'source' })
  await shown.ui.unmount()
  const after = await view($, 120)

  expect(toasts).toContain(`No other GitHub board is linked to ${BABY}.`)
  expect(after.picks).toEqual([])
  expect(after.cards).toEqual(['card:gh:21', 'card:gh:20'])
})

test('an explicit board in CLAUDE.md has no Change board button', async ($, on) => {
  const world = boot(on, {
    ...files(),
    'CLAUDE.md': [
      '- Repo: `TeeratP/attend-baby` (public).',
      '- Project board: #2 (owner `TeeratP`).',
    ].join('\n'),
  })
  fakeProcess(
    on,
    ready(
      { linked: [CAST, TWIN] },
      { match: ['gh', 'project', 'view'], reply: { stdout: 'PVT_2' } },
    ),
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  const shown = await pane($, 120)

  expect(shown.toolbar).toContain('GitHub (auto)')
  expect(shown.toolbar).not.toContain('#2')
  expect(await shown.ui.find({ type: 'Button', key: 'source' })).toBeUndefined()
  await shown.ui.unmount()
})

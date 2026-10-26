import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanBoard, KanbanCard } from '../types'
import { backendMode, detectBackend } from '../hooks/backend'
import { LOTTO, PUNN_AGENTS, PUNN_CLAUDE } from './configs'
import { CWD, PANE, RUN, boot, card, path } from './fakes'
import { row, rowKeys } from './board-ui'
import { boardRoute, fakeEngine, fakeProcess, issueNode } from './fake-gh'
import type { Route } from './fake-gh'
import { GH_VERSION, graphql } from './zero'

const KANBAN_MD = [
  '## Task tracking',
  '- Repo: `TeeratP/claude-kanban` (public).',
  '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
  '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
].join('\n')

const REPO = 'TeeratP/claude-kanban'

const SIGNED_IN: Route = { match: ['gh', 'auth', 'status'], reply: {} }
const SIGNED_OUT: Route = {
  match: ['gh', 'auth', 'status'],
  reply: { exitCode: 1, stderr: 'You are not logged into any GitHub hosts.' },
}
const REMOTE: Route = {
  match: ['git', 'remote', 'get-url', 'origin'],
  reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
}
const LOAD: Route[] = [
  boardRoute([
    issueNode({ number: 1, status: 'In progress', labels: ['ai'] }),
    issueNode({ number: 2, status: 'Backlog', labels: ['ai'] }),
  ]),
]

// Local cards sit on disk in every test, so a GitHub board that showed them
// would be caught.
const files = () => ({
  'CLAUDE.md': KANBAN_MD,
  [path(1, 'login')]: card(1, { status: 'human', title: 'Local login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Local API' }),
})

// The board's cards, in the repo the config names.
const loadFor = (repo: string): Route[] => [
  boardRoute([
    issueNode({ number: 1, repo, status: 'In progress', labels: ['ai'] }),
    issueNode({ number: 2, repo, status: 'Backlog', labels: ['ai'] }),
  ]),
]

const GITHUB_CARD = 'card:gh:1'
const LOCAL_CARD = 'card:md:0001-login'

async function open($: Engine, on: On, extra: Route[], withFiles = files()) {
  const world = boot(on, withFiles)
  const calls = fakeProcess(on, extra)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return { ...world, files: withFiles, commands: calls }
}

/** The toolbar's text and which cards the pane draws, and the note and hint rows under an empty board. */
async function board($: Engine, bodyColumns: number = PANE.props.bodyColumns) {
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns },
    surface: 'terminal',
  })
  const toolbar = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
  const keys = await rowKeys(ui)
  const cards = keys.filter(key => key.startsWith('card:'))
  const notes = keys.filter(key => /^(note|hint)\b/.test(key))
  const hints = await Promise.all(
    notes.map(async key => (await row(ui, key))?.text ?? ''),
  )
  await ui.unmount()

  return { toolbar, cards, notes, hints }
}

const listed = ($: Engine) => $.tool.call({ tool: 'mcp__kanban__kanban_list' })

test('with no setting, GitHub is used when it is available and the label says auto', async ($, on) => {
  await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

  const shown = await board($)

  expect(shown.toolbar).toContain('GitHub (auto)')
  expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
})

test('with no setting and no GitHub, the local cards show and the label says auto', async ($, on) => {
  await open($, on, [], { ...files(), 'CLAUDE.md': '# Notes\n' })

  const shown = await board($)

  expect(shown.toolbar).toContain('Local (auto)')
  expect(shown.cards).toContain(LOCAL_CARD)
})

test(
  'a value outside the options counts as unset',
  { options: { backend: 'sometimes' } },
  async ($, on) => {
    await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

    const shown = await board($)

    expect(shown.toolbar).toContain('GitHub (auto)')
    expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
  },
)

test(
  'the auto setting behaves as with no setting',
  { options: { backend: 'auto' } },
  async ($, on) => {
    await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

    expect((await board($)).toolbar).toContain('GitHub (auto)')
  },
)

test(
  'github loads the GitHub cards and the label does not say auto',
  { options: { backend: 'github' } },
  async ($, on) => {
    await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

    const shown = await board($)

    expect(shown.toolbar).toContain('GitHub · updated')
    expect(shown.toolbar).not.toContain('auto')
    expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
  },
)

test(
  'local shows only the local cards even when GitHub is available, and never calls gh or git',
  { options: { backend: 'local' } },
  async ($, on) => {
    const { commands } = await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

    const shown = await board($)

    expect(shown.toolbar).toContain('Local · updated')
    expect(shown.toolbar).not.toContain('auto')
    expect(shown.cards).toEqual([LOCAL_CARD, 'card:md:0002-api'])
    expect(commands).toEqual([])
    expect(await listed($)).toMatchObject({
      result: expect.stringContaining('#1 [human] Local login'),
    })
  },
)

test(
  'github with gh signed out shows the failing check and the fix, and no local cards',
  { options: { backend: 'github' } },
  async ($, on) => {
    const { logs } = await open($, on, [SIGNED_OUT, REMOTE, ...LOAD])

    const shown = await board($)

    expect(shown.toolbar).toContain('GitHub · gh auth status failed')
    expect(shown.toolbar).not.toContain('Local')
    expect(shown.cards).toEqual([])
    expect(logs).toEqual([
      'kanban: could not refresh the board: gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
    ])
  },
)

test(
  'github with gh signed out says why to Claude, and lists no local cards',
  { options: { backend: 'github' } },
  async ($, on) => {
    await open($, on, [SIGNED_OUT, REMOTE, ...LOAD])

    const answer = await listed($)

    expect(answer).toMatchObject({
      deny: expect.stringContaining('run gh auth login'),
    })
    expect(JSON.stringify(answer)).not.toContain('Local login')
  },
)

test(
  'github recovers on the next refresh once gh is signed in again',
  { options: { backend: 'github' } },
  async ($, on) => {
    const routes: Route[] = [SIGNED_OUT, REMOTE, ...LOAD]
    await open($, on, routes)
    expect((await board($)).cards).toEqual([])

    routes[0] = SIGNED_IN
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'refresh' })
    const keys = await rowKeys(ui)
    await ui.unmount()

    expect(keys).toContain(GITHUB_CARD)
  },
)

test(
  'github with no CLAUDE.md project and no linked board says what to add, and does not fall back',
  { options: { backend: 'github' } },
  async ($, on) => {
    await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, graphql()], {
      ...files(),
      'CLAUDE.md': '# Notes\n',
    })

    const shown = await board($, 120)

    expect(shown.toolbar).toContain(
      'GitHub · no GitHub Project is linked to TeeratP/claude-kanban',
    )
    expect(shown.cards).toEqual([])
  },
)

test(
  'github with no origin remote says to add one',
  { options: { backend: 'github' } },
  async ($, on) => {
    const NO_REMOTE: Route = {
      match: ['git', 'remote'],
      reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
    }
    await open($, on, [SIGNED_IN, NO_REMOTE, ...LOAD])

    const shown = await board($)

    expect(shown.toolbar).toContain('GitHub · no origin remote')
    expect(shown.cards).toEqual([])
  },
)

const detect = (routes: Route[], text: string) =>
  fakeEngine(routes, text === '' ? {} : { 'CLAUDE.md': text })

test('detect in github mode names each failing check and how to fix it', async () => {
  const noProject = detect(
    [GH_VERSION, SIGNED_IN, REMOTE, graphql()],
    '# Notes\n',
  )
  const signedOut = detect([SIGNED_OUT, REMOTE], KANBAN_MD)
  const noRemote = detect(
    [
      SIGNED_IN,
      {
        match: ['git', 'remote'],
        reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
      },
    ],
    KANBAN_MD,
  )
  const noStatus = detect(
    [
      SIGNED_IN,
      REMOTE,
      {
        match: ['gh', 'project', 'field-list'],
        reply: { stdout: JSON.stringify({ fields: [] }) },
      },
      { match: ['gh', 'project', 'view'], reply: { stdout: 'PVT_x' } },
    ],
    '- Repo: `a/b`\n- Project: #1\n',
  )

  await expect(detectBackend(noProject.$, 'github')).rejects.toThrow(
    'no GitHub Project is linked to TeeratP/claude-kanban: link one on GitHub, or add Repo and Project board lines to CLAUDE.md or AGENTS.md',
  )
  await expect(detectBackend(signedOut.$, 'github')).rejects.toThrow(
    'gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
  )
  await expect(detectBackend(noRemote.$, 'github')).rejects.toThrow(
    "no origin remote: run git remote add origin <url> (error: No such remote 'origin')",
  )
  await expect(detectBackend(noStatus.$, 'github')).rejects.toThrow(
    'project board: Project #1 has no Status field.; check the IDs in CLAUDE.md',
  )
  expect(signedOut.logs).toEqual([])
})

test('detect in github mode returns the GitHub backend when every check passes', async () => {
  const { $ } = detect([SIGNED_IN, REMOTE], KANBAN_MD)

  expect(await detectBackend($, 'github')).toMatchObject({
    kind: 'github',
    repo: REPO,
    projectNumber: 7,
  })
})

test('detect in local mode answers local without reading anything', async () => {
  const { $, calls, logs } = detect([SIGNED_IN, REMOTE], KANBAN_MD)

  expect(await detectBackend($, 'local')).toEqual({ kind: 'local' })
  expect(calls).toEqual([])
  expect(logs).toEqual([])
})

test('detect in auto mode still falls back to local and logs why', async () => {
  const { $, logs } = detect([SIGNED_OUT, REMOTE], KANBAN_MD)

  expect(await detectBackend($, 'auto')).toEqual({ kind: 'local' })
  expect(logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: You are not logged into any GitHub hosts.',
  ])
})

test('a setting that is not one of the three counts as auto', () => {
  expect(backendMode('github')).toBe('github')
  expect(backendMode('local')).toBe('local')
  expect(backendMode('auto')).toBe('auto')
  expect(backendMode('sometimes')).toBe('auto')
  expect(backendMode(undefined)).toBe('auto')
  expect(backendMode(['github'])).toBe('auto')
})

const SAVED_GITHUB = {
  kind: 'github',
  repo: REPO,
  owner: 'TeeratP',
  projectNumber: 7,
  projectId: 'PVT_x',
  statusFieldId: 'PVTSSF_x',
  options: {
    backlog: 'a',
    inProgress: 'b',
    inReview: 'c',
    done: 'd',
  },
}

const cached = (mode: string, backend: unknown, key = `cache:${CWD}`) => ({
  [key]: {
    shape: 'cache-2',
    mode,
    backend,
    cards: [
      {
        id: 'gh:9',
        number: 9,
        title: 'Cached remote',
        column: 'human',
        order: 9,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-02T10:00:00Z',
      },
    ],
  },
})

// Opens the pane with the first load held back, so what shows is what the cache gave.
async function openFromCache(
  $: Engine,
  on: On,
  store: Record<string, unknown>,
  routes: Route[] = [],
) {
  const world = boot(on, files(), store)
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  fakeProcess(on, routes, held)
  world.calls.holdList = held
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const whileLoading = await board($)
  release()
  await world.clock.settle()

  return { whileLoading, loaded: await board($) }
}

test(
  'the saved board shows while the first load runs when it was saved under the same setting',
  { options: { backend: 'github' } },
  async ($, on) => {
    const { whileLoading, loaded } = await openFromCache(
      $,
      on,
      cached('github', SAVED_GITHUB),
      [SIGNED_IN, REMOTE, ...LOAD],
    )

    expect(whileLoading.cards).toEqual(['card:gh:9'])
    expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
  },
)

test(
  'a board saved under another setting is not shown after the setting changes',
  { options: { backend: 'local' } },
  async ($, on) => {
    const { whileLoading, loaded } = await openFromCache(
      $,
      on,
      cached('auto', SAVED_GITHUB),
    )

    expect(whileLoading.cards).toEqual([])
    expect(whileLoading.toolbar).toContain('Local')
    expect(loaded.cards).toEqual([LOCAL_CARD, 'card:md:0002-api'])
  },
)

test(
  'a board saved under auto is not shown under github',
  { options: { backend: 'github' } },
  async ($, on) => {
    const { whileLoading, loaded } = await openFromCache(
      $,
      on,
      cached('auto', { kind: 'local' }),
      [SIGNED_IN, REMOTE, ...LOAD],
    )

    expect(whileLoading.cards).toEqual([])
    expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
  },
)

test('a saved board without a setting recorded is ignored', async ($, on) => {
  const old = cached('auto', { kind: 'local' })
  const entry = old[`cache:${CWD}`] as Record<string, unknown>
  delete entry.mode
  entry.shape = 'cache-1'

  const { whileLoading } = await openFromCache($, on, old, [
    SIGNED_IN,
    REMOTE,
    ...LOAD,
  ])

  expect(whileLoading.cards).toEqual([])
})

test(
  'a load saves the board with the setting it was loaded under',
  { options: { backend: 'local' } },
  async ($, on) => {
    const { saved } = await open($, on, [SIGNED_IN, REMOTE, ...LOAD])

    const entry = JSON.parse(saved.get(`cache:${CWD}`) ?? 'null')

    expect(entry).toMatchObject({
      shape: 'cache-2',
      mode: 'local',
      backend: { kind: 'local' },
    })
    expect(entry.cards.map((one: KanbanCard) => one.id)).toEqual([
      'md:0001-login',
      'md:0002-api',
    ])
  },
)

// What the engine kept of the board when the plugin reloaded with another setting.
function keepBoard(on: On, kept: KanbanBoard) {
  on('state.get', async (_, e, next) => {
    const answer = await next(e)
    if (answer.deny !== undefined) return answer
    if (e.plugin !== 'kanban' || e.key !== 'board') return answer
    if (answer.value.value !== undefined) return answer

    return {
      value: {
        version: answer.value.version,
        value: { shape: 'board-3', value: kept },
      },
    }
  })
}

const KEPT_GITHUB_BOARD: KanbanBoard = {
  mode: 'auto',
  backend: SAVED_GITHUB as KanbanBoard['backend'],
  cards: [
    {
      id: 'gh:9',
      number: 9,
      title: 'Kept remote',
      column: 'human',
      order: 9,
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-02T10:00:00Z',
    },
  ],
  fetchedAt: 1,
  isLoading: false,
}

test(
  'a reload with another setting drops the board kept from the old one, GitHub cards and backend included',
  { options: { backend: 'local' } },
  async ($, on) => {
    const world = boot(on, files())
    const commands = fakeProcess(on, [])
    keepBoard(on, KEPT_GITHUB_BOARD)
    world.world.panes = ['kanban']
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await world.clock.settle()

    const shown = await board($)

    expect(shown.cards).toEqual([LOCAL_CARD, 'card:md:0002-api'])
    expect(shown.toolbar).toContain('Local · updated')
    expect(commands).toEqual([])
    expect(world.statuses.at(-1)).toBe('1 card waiting on you')
    expect(JSON.stringify(await listed($))).not.toContain('Kept remote')
  },
)

test(
  'a reload with the same setting keeps the board',
  { options: { backend: 'auto' } },
  async ($, on) => {
    const world = boot(on, files())
    fakeProcess(on, [])
    keepBoard(on, KEPT_GITHUB_BOARD)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await world.clock.settle()

    expect(await listed($)).toMatchObject({
      result: expect.stringContaining('#9 [human] Kept remote'),
    })
    expect(world.calls.lists).toBe(0)
  },
)

const UNCLEAR_MD =
  '## Task tracking\n- Board id `PVT_kwHOAcCsLc4Bbjg2`; the repo is not written down.\n'

test('with a board mentioned that cannot be read and none found, the toolbar says so and the debug log says why', async ($, on) => {
  const { logs } = await open(
    $,
    on,
    [GH_VERSION, SIGNED_IN, REMOTE, graphql()],
    { ...files(), 'CLAUDE.md': UNCLEAR_MD },
  )

  const shown = await board($, 120)

  expect(shown.toolbar).toContain(
    'Local (auto) \u00b7 board config not understood',
  )
  expect(shown.cards).toContain(LOCAL_CARD)
  expect(logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: CLAUDE.md or AGENTS.md mentions a project board, but no Repo and Project number could be read from it',
  ])
})

test('in a narrow pane the toolbar keeps the unclear-config note over the age', async ($, on) => {
  await open($, on, [], { ...files(), 'CLAUDE.md': UNCLEAR_MD })

  const shown = await board($)

  expect(shown.toolbar).toContain('Local (auto)')
  expect(shown.toolbar).not.toContain('updated')
})

test('without a board in the config the toolbar has no unclear-config note', async ($, on) => {
  await open($, on, [], { ...files(), 'CLAUDE.md': '# Notes\n' })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('Local (auto)')
  expect(shown.toolbar).not.toContain('not understood')
})

test('an empty local board under auto says how to point the mod at GitHub', async ($, on) => {
  await open($, on, [], { 'CLAUDE.md': UNCLEAR_MD })

  const shown = await board($, 120)

  expect(shown.cards).toEqual([])
  expect(shown.notes).toEqual(['note', 'hint:0', 'hint:1'])
  expect(shown.hints[0]).toContain('.kanban/0001-title.md')
  expect(shown.hints[1]).toContain('CLAUDE.md or AGENTS.md')
  expect(shown.hints[2]).toContain('backend: github')
})

test(
  'an empty local board that was asked for has no GitHub hint',
  { options: { backend: 'local' } },
  async ($, on) => {
    await open($, on, [], { 'CLAUDE.md': KANBAN_MD })

    expect((await board($, 120)).notes).toEqual(['note'])
  },
)

test('an empty GitHub board has no GitHub hint', async ($, on) => {
  await open($, on, [SIGNED_IN, REMOTE, boardRoute([])], {
    'CLAUDE.md': KANBAN_MD,
  })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub (auto)')
  expect(shown.notes).toEqual(['note'])
})

test('AGENTS.md behind a CLAUDE.md import loads the GitHub cards (punn)', async ($, on) => {
  await open($, on, [SIGNED_IN, REMOTE, ...loadFor('TeeratP/attend-baby')], {
    ...files(),
    'CLAUDE.md': PUNN_CLAUDE,
    'AGENTS.md': PUNN_AGENTS,
  })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub (auto)')
  expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
  expect(await listed($)).toMatchObject({
    result: expect.stringContaining('#1 [claude]'),
  })
})

test('a lone AGENTS.md loads the GitHub cards (lotto)', async ($, on) => {
  await open($, on, [SIGNED_IN, REMOTE, ...loadFor('TeeratP/thai-lotto')], {
    ...files(),
    'CLAUDE.md': '# Notes\n',
    'AGENTS.md': LOTTO,
  })

  expect((await board($, 120)).cards).toEqual(['card:gh:2', GITHUB_CARD])
})

test('a local backend saved by an earlier start is detected again, so a config fixed since shows its board', async ($, on) => {
  const { whileLoading, loaded } = await openFromCache(
    $,
    on,
    cached('auto', { kind: 'local' }),
    [SIGNED_IN, REMOTE, ...LOAD],
  )

  expect(whileLoading.cards).toEqual(['card:gh:9'])
  expect(loaded.toolbar).toContain('GitHub (auto)')
  expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
})

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanBoard, KanbanCard } from '../types'
import { detectBackend } from '../hooks/backend'
import { SetupNeeded, setupOf } from '../hooks/detect'
import { S } from '../hooks/strings'
import { LOTTO, PUNN_AGENTS, PUNN_CLAUDE } from './configs'
import { CWD, PANE, RUN, boot } from './fakes'
import { row, rowKeys } from './board-ui'
import { boardRoute, fakeEngine, fakeProcess, issueNode } from './fake-gh'
import type { Route } from './fake-gh'
import { GH_VERSION, NO_GH, graphql, lines } from './zero'

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
const NO_REMOTE: Route = {
  match: ['git', 'remote'],
  reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
}
const LOAD: Route[] = [
  boardRoute([
    issueNode({ number: 1, status: 'In progress', labels: ['ai'] }),
    issueNode({ number: 2, status: 'Backlog', labels: ['ai'] }),
  ]),
]

const files = (): Record<string, string> => ({ 'CLAUDE.md': KANBAN_MD })

// The board's cards, in the repo the config names.
const loadFor = (repo: string): Route[] => [
  boardRoute([
    issueNode({ number: 1, repo, status: 'In progress', labels: ['ai'] }),
    issueNode({ number: 2, repo, status: 'Backlog', labels: ['ai'] }),
  ]),
]

const GITHUB_CARD = 'card:gh:1'

async function open($: Engine, on: On, extra: Route[], withFiles = files()) {
  const world = boot(on, withFiles)
  const calls = fakeProcess(on, extra)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()

  return { ...world, files: withFiles, commands: calls }
}

const MISSING: readonly string[] = Object.values(S.setupMissing)

/**
 * The toolbar's text, which cards the pane draws, the note rows under an empty
 * board, and the setup offer: what is missing, and whether its button shows.
 */
async function board($: Engine, bodyColumns: number = PANE.props.bodyColumns) {
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns },
    surface: 'terminal',
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const toolbar = texts[0] ?? ''
  const keys = await rowKeys(ui)
  const cards = keys.filter(key => key.startsWith('card:'))
  const notes = keys.filter(key => /^note\b/.test(key))
  const noteText = await Promise.all(
    notes.map(async key => (await row(ui, key))?.text ?? ''),
  )
  const missing = texts
    .map(text => text.trim())
    .find(text => MISSING.includes(text))
  const hasButton =
    (await ui.find({ type: 'Button', text: S.setupButton })) !== undefined
  await ui.unmount()

  return { toolbar, cards, notes, noteText, setup: { missing, hasButton } }
}

const NO_SETUP = { missing: undefined, hasButton: false }

const listed = ($: Engine) => $.tool.call({ tool: 'mcp__kanban__kanban_list' })

test('the GitHub cards load and the label names GitHub', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, ...LOAD])

  const shown = await board($)

  expect(shown.toolbar).toContain('GitHub · updated')
  expect(shown.toolbar).not.toContain('auto')
  expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
  expect(shown.setup).toEqual(NO_SETUP)
})

test('gh signed out offers setup for sign-in, flags it in the toolbar, and shows no cards', async ($, on) => {
  const { logs } = await open($, on, [GH_VERSION, SIGNED_OUT, REMOTE, ...LOAD])

  const shown = await board($)

  expect(shown.toolbar).toContain('GitHub · setup needed')
  expect(shown.setup).toEqual({
    missing: S.setupMissing.auth,
    hasButton: true,
  })
  expect(shown.cards).toEqual([])
  expect(logs).toEqual([
    'kanban: could not refresh the board: gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
  ])
})

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`the setup offer shows once under the toolbar on the ${surface}`, async ($, on) => {
    const world = boot(on, files())
    fakeProcess(on, [GH_VERSION, SIGNED_OUT, REMOTE, ...LOAD])
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
    const buttons = await ui.findAll({ type: 'Button', text: S.setupButton })
    await ui.unmount()

    expect(
      texts.filter(text => text.trim() === S.setupMissing.auth),
    ).toHaveLength(1)
    expect(buttons).toHaveLength(1)
  })
}

test('gh signed out says why to Claude', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_OUT, REMOTE, ...LOAD])

  expect(await listed($)).toMatchObject({
    deny: expect.stringContaining('run gh auth login'),
  })
})

test('a refresh once gh is signed in again loads the cards and drops the setup offer', async ($, on) => {
  const routes: Route[] = [GH_VERSION, SIGNED_OUT, REMOTE, ...LOAD]
  await open($, on, routes)
  const before = await board($)
  expect(before.cards).toEqual([])
  expect(before.setup.missing).toBe(S.setupMissing.auth)

  routes[1] = SIGNED_IN
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.unmount()

  const after = await board($)
  expect(after.cards).toEqual(['card:gh:2', GITHUB_CARD])
  expect(after.setup).toEqual(NO_SETUP)
  expect(after.toolbar).toContain('GitHub · updated')
  expect(after.toolbar).not.toContain('setup needed')
  expect(await listed($)).toMatchObject({
    result: expect.stringContaining('#1 [claude]'),
  })
})

test('a refresh that fails for another reason swaps the setup offer for the error', async ($, on) => {
  const failing: Route = {
    match: ['gh', 'api', 'graphql'],
    reply: { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' },
  }
  const routes: Route[] = [GH_VERSION, SIGNED_OUT, REMOTE, failing]
  await open($, on, routes)
  expect((await board($)).setup.missing).toBe(S.setupMissing.auth)

  routes[1] = SIGNED_IN
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.unmount()

  const after = await board($, 120)
  expect(after.setup).toEqual(NO_SETUP)
  expect(after.toolbar).toContain('HTTP 502')
  expect(after.toolbar).not.toContain('setup needed')
})

test('a configured board and no gh offers to install gh, not to sign in', async ($, on) => {
  const { logs, commands } = await open($, on, [NO_GH, SIGNED_OUT, REMOTE])

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub · setup needed')
  expect(shown.setup).toEqual({ missing: S.setupMissing.gh, hasButton: true })
  expect(shown.cards).toEqual([])
  expect(logs).toEqual([
    'kanban: could not refresh the board: gh is not installed: install it from https://cli.github.com (gh: command not found)',
  ])
  expect(lines(commands)).toEqual(['gh --version'])
})

test('no CLAUDE.md project and no linked board offers to set up a board, and tells Claude what to add', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, graphql()], {
    'CLAUDE.md': '# Notes\n',
  })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub · setup needed')
  expect(shown.setup).toEqual({
    missing: S.setupMissing.board,
    hasButton: true,
  })
  expect(shown.cards).toEqual([])
  expect(await listed($)).toMatchObject({
    deny: expect.stringContaining(S.githubNoBoard(REPO)),
  })
})

test('no origin remote offers to set up the repo', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_IN, NO_REMOTE, ...LOAD])

  const shown = await board($)

  expect(shown.toolbar).toContain('GitHub · setup needed')
  expect(shown.setup).toEqual({
    missing: S.setupMissing.remote,
    hasButton: true,
  })
  expect(shown.cards).toEqual([])
  expect(await listed($)).toMatchObject({
    deny: expect.stringContaining('no origin remote'),
  })
})

const detect = (routes: Route[], text: string) =>
  fakeEngine(routes, text === '' ? {} : { 'CLAUDE.md': text })

// What a detection that must fail threw.
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('expected the detection to fail')
}

test('detect names each failing check and how to fix it, and which are setup', async () => {
  const noProject = detect(
    [GH_VERSION, SIGNED_IN, REMOTE, graphql()],
    '# Notes\n',
  )
  const signedOut = detect([GH_VERSION, SIGNED_OUT, REMOTE], KANBAN_MD)
  const noRemote = detect([GH_VERSION, SIGNED_IN, NO_REMOTE], KANBAN_MD)
  const noStatus = detect(
    [
      GH_VERSION,
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

  expect(setupOf(await failureOf(detectBackend(noProject.$)))).toEqual({
    step: 'board',
    reason:
      'no GitHub Project is linked to TeeratP/claude-kanban: link one on GitHub, or add Repo and Project board lines to CLAUDE.md or AGENTS.md',
  })
  expect(setupOf(await failureOf(detectBackend(signedOut.$)))).toEqual({
    step: 'auth',
    reason:
      'gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
  })
  expect(setupOf(await failureOf(detectBackend(noRemote.$)))).toEqual({
    step: 'remote',
    reason:
      "no origin remote: run git remote add origin <url> (error: No such remote 'origin')",
  })
  const badBoard = await failureOf(detectBackend(noStatus.$))
  expect((badBoard as Error).message).toBe(
    'project board: Project #1 has no Status field.; check the IDs in CLAUDE.md',
  )
  expect(badBoard).not.toBeInstanceOf(SetupNeeded)
  expect(setupOf(badBoard)).toBeUndefined()
  expect(signedOut.logs).toEqual([])
})

test('detect with a configured board checks gh is installed before it is signed in', async () => {
  const { $, calls } = detect([NO_GH, SIGNED_OUT, REMOTE], KANBAN_MD)

  expect(setupOf(await failureOf(detectBackend($)))).toEqual({
    step: 'gh',
    reason:
      'gh is not installed: install it from https://cli.github.com (gh: command not found)',
  })
  expect(lines(calls)).toEqual(['gh --version'])
})

test('detect says gh is not installed when gh cannot even start', async () => {
  const { $ } = detect(
    [
      {
        match: ['gh'],
        reply: () => {
          throw new Error(
            'kanban: $.process.run(gh) failed to start: ENOENT: no such file or directory',
          )
        },
      },
      REMOTE,
    ],
    KANBAN_MD,
  )

  const failure = await failureOf(detectBackend($))

  expect(setupOf(failure)?.step).toBe('gh')
  expect((failure as Error).message).toContain(
    'gh is not installed: install it from https://cli.github.com (kanban: $.process.run(gh) failed to start',
  )
})

test('detect returns the GitHub backend when every check passes', async () => {
  const { $ } = detect([GH_VERSION, SIGNED_IN, REMOTE], KANBAN_MD)

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: REPO,
    projectNumber: 7,
  })
})

test('setupOf reads the step and reason of a SetupNeeded, and nothing from any other failure', () => {
  for (const step of ['gh', 'auth', 'remote', 'board', 'config'] as const) {
    const error = new SetupNeeded(step, `missing ${step}`)
    expect(error).toBeInstanceOf(Error)
    expect(setupOf(error)).toEqual({ step, reason: `missing ${step}` })
  }
  expect(setupOf(new Error('HTTP 502'))).toBeUndefined()
  expect(setupOf('gh auth status failed')).toBeUndefined()
  expect(setupOf(undefined)).toBeUndefined()
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

const cached = (
  backend: unknown,
  shape = 'cache-4',
  key = `cache:${CWD}`,
) => ({
  [key]: {
    shape,
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
  columns: number = PANE.props.bodyColumns,
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

  return { whileLoading, loaded: await board($, columns) }
}

test('the saved board shows while the first load runs', async ($, on) => {
  const { whileLoading, loaded } = await openFromCache(
    $,
    on,
    cached(SAVED_GITHUB),
    [GH_VERSION, SIGNED_IN, REMOTE, ...LOAD],
  )

  expect(whileLoading.cards).toEqual(['card:gh:9'])
  expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
})

test('a board saved in an older shape is ignored, the one with a backend setting included', async ($, on) => {
  const old = cached(SAVED_GITHUB, 'cache-2')
  ;(old[`cache:${CWD}`] as Record<string, unknown>).mode = 'github'

  const { whileLoading, loaded } = await openFromCache($, on, old, [
    GH_VERSION,
    SIGNED_IN,
    REMOTE,
    ...LOAD,
  ])

  expect(whileLoading.cards).toEqual([])
  expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
})

test('a board saved before cards had owners is ignored', async ($, on) => {
  const { whileLoading, loaded } = await openFromCache(
    $,
    on,
    cached(SAVED_GITHUB, 'cache-3'),
    [GH_VERSION, SIGNED_IN, REMOTE, ...LOAD],
  )

  expect(whileLoading.cards).toEqual([])
  expect(loaded.cards).toEqual(['card:gh:2', GITHUB_CARD])
})

test('a saved board without a setting recorded is ignored', async ($, on) => {
  const old = cached({ kind: 'local' }, 'cache-1')

  const { whileLoading } = await openFromCache($, on, old, [
    GH_VERSION,
    SIGNED_IN,
    REMOTE,
    ...LOAD,
  ])

  expect(whileLoading.cards).toEqual([])
})

test('a load saves the board with its GitHub backend and no setting', async ($, on) => {
  const { saved } = await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, ...LOAD])

  const entry = JSON.parse(saved.get(`cache:${CWD}`) ?? 'null')

  expect(entry).toMatchObject({
    shape: 'cache-4',
    backend: { kind: 'github', repo: REPO, projectNumber: 7 },
  })
  expect(entry).not.toHaveProperty('mode')
  expect(entry.cards.map((one: KanbanCard) => one.id)).toEqual([
    'gh:1',
    'gh:2',
  ])
})

// What the engine kept of the board when the plugin reloaded.
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

test('a reload keeps the board', async ($, on) => {
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
})

const UNCLEAR_MD =
  '## Task tracking\n- Board id `PVT_kwHOAcCsLc4Bbjg2`; the repo is not written down.\n'

test('with a board mentioned that cannot be read and none found, the pane offers to fix the config and the debug log says why', async ($, on) => {
  const { logs } = await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, graphql()], {
    'CLAUDE.md': UNCLEAR_MD,
  })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub · setup needed')
  expect(shown.setup).toEqual({
    missing: S.setupMissing.config,
    hasButton: true,
  })
  expect(shown.cards).toEqual([])
  expect(logs).toEqual([
    'kanban: could not refresh the board: CLAUDE.md or AGENTS.md mentions a project board, but no Repo and Project number could be read from it',
  ])
})

test('a board that is not set up says so under the empty sections', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, graphql()], {
    'CLAUDE.md': UNCLEAR_MD,
  })

  const shown = await board($, 120)

  expect(shown.cards).toEqual([])
  expect(shown.notes).toEqual(['note'])
  expect(shown.noteText[0]).toContain(S.notSetUp.long)
})

test('an empty GitHub board says it has no issues, with no setup offer', async ($, on) => {
  await open($, on, [GH_VERSION, SIGNED_IN, REMOTE, boardRoute([])], {
    'CLAUDE.md': KANBAN_MD,
  })

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub · updated')
  expect(shown.notes).toEqual(['note'])
  expect(shown.noteText[0]).toContain(S.noIssues.long)
  expect(shown.setup).toEqual(NO_SETUP)
})

test('AGENTS.md behind a CLAUDE.md import loads the GitHub cards (punn)', async ($, on) => {
  await open(
    $,
    on,
    [GH_VERSION, SIGNED_IN, REMOTE, ...loadFor('TeeratP/attend-baby')],
    {
      ...files(),
      'CLAUDE.md': PUNN_CLAUDE,
      'AGENTS.md': PUNN_AGENTS,
    },
  )

  const shown = await board($, 120)

  expect(shown.toolbar).toContain('GitHub · updated')
  expect(shown.cards).toEqual(['card:gh:2', GITHUB_CARD])
  expect(await listed($)).toMatchObject({
    result: expect.stringContaining('#1 [claude]'),
  })
})

test('a lone AGENTS.md loads the GitHub cards (lotto)', async ($, on) => {
  await open(
    $,
    on,
    [GH_VERSION, SIGNED_IN, REMOTE, ...loadFor('TeeratP/thai-lotto')],
    {
      ...files(),
      'CLAUDE.md': '# Notes\n',
      'AGENTS.md': LOTTO,
    },
  )

  expect((await board($, 120)).cards).toEqual(['card:gh:2', GITHUB_CARD])
})

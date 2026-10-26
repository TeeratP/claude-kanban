import { expect, test } from 'claude-code/testing'

import { choicesOf, parseOrigin } from '../hooks/detect'
import { detectBackend } from '../hooks/backend'
import { columnOf, planMove } from '../hooks/github'
import type { KanbanCard, KanbanGithub } from '../types'
import { PUNN_AGENTS } from './configs'
import { fakeEngine } from './fake-gh'
import { KANBAN } from './github-board'
import type { Route } from './fake-gh'
import {
  ALL_STATUSES,
  BABY,
  GH_VERSION,
  NO_GH,
  SIGNED_IN,
  SIGNED_OUT,
  fieldList,
  graphql,
  lines,
  remote,
} from './zero'
import type { FakeProject } from './zero'

const ORIGIN = remote('https://github.com/TeeratP/attend-baby.git')
const SHARED: FakeProject = {
  number: 2,
  title: "@TeeratP's Kanban",
  items: { [BABY]: 50, 'TeeratP/thai-horo-ai': 39, 'TeeratP/thai-lotto': 10 },
}
const CAST: FakeProject = {
  number: 6,
  title: 'Car Cast',
  items: { 'TeeratP/carcast': 25, [BABY]: 3 },
}

// Everything a clean machine answers, and the board the repo is linked to.
const ready = (...more: Route[]): Route[] => [
  GH_VERSION,
  SIGNED_IN,
  ORIGIN,
  ...more,
]

const detect = (routes: Route[], files: Record<string, string> = {}) =>
  fakeEngine(routes, files)

test('one linked open board is used, with its title and what gh lists for its Status field', async () => {
  const { $, calls } = detect(
    ready(
      graphql({ linked: [SHARED, { number: 9, closed: true }] }),
      fieldList(ALL_STATUSES),
    ),
  )

  expect(await detectBackend($, 'auto')).toEqual({
    kind: 'github',
    repo: BABY,
    owner: 'TeeratP',
    projectNumber: 2,
    projectId: 'PVT_2',
    statusFieldId: 'PVTSSF_zero',
    options: {
      backlog: 'o-Backlog',
      ready: 'o-Ready',
      inProgress: 'o-In progress',
      inReview: 'o-In review',
      done: 'o-Done',
    },
    title: "@TeeratP's Kanban",
    isDetected: true,
  })
  expect(lines(calls)).toEqual([
    'git remote get-url origin',
    'gh --version',
    'gh auth status',
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
    'gh project field-list 2 --owner TeeratP --format json',
  ])
})

test('several linked boards: the one with the most items from this repo wins, not the biggest', async () => {
  const bigger: FakeProject = {
    number: 5,
    title: 'Elsewhere',
    items: { 'TeeratP/offr-fyi': 100 },
  }
  const { $, calls } = detect(
    ready(graphql({ linked: [CAST, bigger, SHARED] }), fieldList(ALL_STATUSES)),
  )

  expect(await detectBackend($, 'auto')).toMatchObject({
    kind: 'github',
    projectNumber: 2,
    title: "@TeeratP's Kanban",
  })
  // One lookup counted the items too: a second call per board would be many.
  expect(lines(calls).filter(line => line.startsWith('gh api'))).toHaveLength(1)
})

test('a tie asks the person: the error carries the boards, most items first', async () => {
  const twin: FakeProject = { ...CAST, number: 8, title: 'Twin' }
  const { $ } = detect(ready(graphql({ linked: [CAST, twin] })))

  const failure = await detectBackend($, 'auto').catch(
    (error: unknown) => error,
  )

  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toContain(BABY)
  expect(choicesOf(failure)).toEqual([
    { id: 'PVT_6', number: 6, title: 'Car Cast', owner: 'TeeratP' },
    { id: 'PVT_8', number: 8, title: 'Twin', owner: 'TeeratP' },
  ])
})

test('several linked boards with no item from this repo are a tie too', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [{ number: 6 }, { number: 7 }] })),
  )

  const failure = await detectBackend($, 'auto').catch(
    (error: unknown) => error,
  )

  expect(choicesOf(failure)?.map(one => one.number)).toEqual([6, 7])
})

test('the same tie is a pick request under github too, and no other error is one', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [{ number: 6 }, { number: 7 }] })),
  )

  const failure = await detectBackend($, 'github').catch(
    (error: unknown) => error,
  )

  expect(choicesOf(failure)?.map(one => one.number)).toEqual([6, 7])
  expect(choicesOf(new Error('nope'))).toBeUndefined()
  expect(choicesOf('nope')).toBeUndefined()
})

test('no linked board: the owner and viewer projects are scanned for items from this repo (nae)', async () => {
  const { $, calls } = detect(
    ready(
      graphql({
        linked: [],
        viewer: [
          SHARED,
          CAST,
          { number: 7, items: { 'TeeratP/claude-kanban': 33 } },
        ],
        owner: [SHARED, CAST],
      }),
      fieldList(ALL_STATUSES),
    ),
  )

  expect(await detectBackend($, 'auto')).toMatchObject({
    kind: 'github',
    projectNumber: 2,
    isDetected: true,
  })
  expect(lines(calls).filter(line => line.startsWith('gh api'))).toEqual([
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
    'gh api graphql -f query=… -f o=TeeratP',
  ])
})

test('a scan finding two boards with items asks the person, one with a clear lead does not', async () => {
  const scan = (lead: number) =>
    detect(
      ready(
        graphql({
          linked: [],
          viewer: [
            { number: 2, items: { [BABY]: lead } },
            { number: 6, items: { [BABY]: 3 } },
            { number: 7, items: { 'TeeratP/other': 40 } },
          ],
        }),
        fieldList(ALL_STATUSES),
      ),
    ).$

  expect(await detectBackend(scan(5), 'auto')).toMatchObject({
    projectNumber: 2,
  })
  const tied = await detectBackend(scan(3), 'auto').catch(
    (error: unknown) => error,
  )
  expect(choicesOf(tied)?.map(one => one.number)).toEqual([2, 6])
})

test('no board anywhere: auto goes local and names the repo, github says what to do', async () => {
  const elsewhere: FakeProject = { number: 2, items: { 'TeeratP/other': 4 } }
  const routes = ready(
    graphql({ linked: [], viewer: [elsewhere], owner: [elsewhere] }),
  )
  const quiet = detect(routes)
  const loud = detect(routes)

  expect(await detectBackend(quiet.$, 'auto')).toEqual({
    kind: 'local',
    noBoardFor: 'TeeratP/attend-baby',
  })
  await expect(detectBackend(loud.$, 'github')).rejects.toThrow(
    'no GitHub Project is linked to TeeratP/attend-baby: link one on GitHub, or add Repo and Project board lines to CLAUDE.md or AGENTS.md',
  )
  expect(quiet.logs).toEqual([])
})

test('every form of a github.com origin gives owner/name; others give none', () => {
  const same = [
    'https://github.com/TeeratP/attend-baby.git',
    'https://github.com/TeeratP/attend-baby',
    'https://github.com/TeeratP/attend-baby/',
    'https://TeeratP@github.com/TeeratP/attend-baby.git',
    'http://github.com/TeeratP/attend-baby.git',
    'git@github.com:TeeratP/attend-baby.git',
    'git@github.com:TeeratP/attend-baby',
    'ssh://git@github.com/TeeratP/attend-baby.git',
    'ssh://git@github.com:22/TeeratP/attend-baby.git',
    'git://github.com/TeeratP/attend-baby.git',
    'https://GitHub.com/TeeratP/attend-baby.git\n',
  ]
  for (const url of same) expect(parseOrigin(url)).toBe(BABY)
  expect(parseOrigin('git@github.com:acme/widget.js.git')).toBe(
    'acme/widget.js',
  )
  for (const url of [
    'https://gitlab.com/TeeratP/attend-baby.git',
    'git@bitbucket.org:TeeratP/attend-baby.git',
    'https://github.example.com/TeeratP/attend-baby.git',
    'https://notgithub.com/TeeratP/attend-baby.git',
    'https://github.com/TeeratP',
    '/srv/git/attend-baby.git',
    '',
  ])
    expect(parseOrigin(url)).toBeUndefined()
})

test('an ssh origin finds the board', async () => {
  const { $, calls } = detect([
    GH_VERSION,
    SIGNED_IN,
    remote('git@github.com:TeeratP/attend-baby.git'),
    graphql({ linked: [SHARED] }),
    fieldList(ALL_STATUSES),
  ])

  expect(await detectBackend($, 'auto')).toMatchObject({ repo: BABY })
  expect(lines(calls)).toContain(
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
  )
})

test('an origin that is not on github.com goes local under auto and is named under github', async () => {
  const routes = [GH_VERSION, SIGNED_IN, remote('git@gitlab.com:me/app.git')]
  const quiet = detect(routes)

  expect(await detectBackend(quiet.$, 'auto')).toEqual({ kind: 'local' })
  expect(quiet.logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: origin git@gitlab.com:me/app.git is not a github.com URL',
  ])
  expect(lines(quiet.calls)).toEqual(['git remote get-url origin'])
  await expect(detectBackend(detect(routes).$, 'github')).rejects.toThrow(
    'origin git@gitlab.com:me/app.git is not a github.com URL',
  )
})

test('gh not installed: auto goes local quietly, github says to install it', async () => {
  const routes = [NO_GH, SIGNED_IN, ORIGIN, graphql({ linked: [SHARED] })]
  const quiet = detect(routes)

  expect(await detectBackend(quiet.$, 'auto')).toEqual({ kind: 'local' })
  expect(quiet.logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: gh: command not found',
  ])
  expect(lines(quiet.calls)).not.toContain('gh auth status')
  await expect(detectBackend(detect(routes).$, 'github')).rejects.toThrow(
    'gh is not installed: install it from https://cli.github.com, or set backend to auto or local in /config (gh: command not found)',
  )
})

test('gh signed out: auto goes local, github names the check and the fix', async () => {
  const routes = [GH_VERSION, SIGNED_OUT, ORIGIN, graphql({ linked: [SHARED] })]

  expect(await detectBackend(detect(routes).$, 'auto')).toEqual({
    kind: 'local',
  })
  await expect(detectBackend(detect(routes).$, 'github')).rejects.toThrow(
    'gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
  )
})

test('no origin remote is named first and gh is not asked anything', async () => {
  const noRemote: Route = {
    match: ['git', 'remote'],
    reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
  }
  const loud = detect([NO_GH, SIGNED_OUT, noRemote])
  const quiet = detect([GH_VERSION, SIGNED_IN, noRemote])

  await expect(detectBackend(loud.$, 'github')).rejects.toThrow(
    "no origin remote: run git remote add origin <url> (error: No such remote 'origin')",
  )
  expect(await detectBackend(quiet.$, 'auto')).toEqual({ kind: 'local' })
  expect(lines(loud.calls)).toEqual(['git remote get-url origin'])
  expect(lines(quiet.calls)).toEqual(['git remote get-url origin'])
})

test('a lookup gh refuses is named under github with the scope to ask for, and logged under auto', async () => {
  const refused =
    'Your token has not been granted the required scopes: read:project'
  const routes = ready(graphql({ failure: refused }))
  const quiet = detect(routes)

  expect(await detectBackend(quiet.$, 'auto')).toEqual({ kind: 'local' })
  expect(quiet.logs).toEqual([
    `kanban: using local cards, GitHub is not usable here: ${refused}`,
  ])
  await expect(detectBackend(detect(routes).$, 'github')).rejects.toThrow(
    `could not list the GitHub Projects of TeeratP/attend-baby: ${refused}; run gh auth refresh -s read:project`,
  )
})

test('a rate limit during detection is not a reason to settle for local files', async () => {
  const limited = 'GraphQL: API rate limit already exceeded for user ID 1.'
  const { $ } = detect([
    ...ready(graphql({ failure: limited })),
    {
      match: ['gh', 'api', 'rate_limit'],
      reply: { stdout: '{"remaining":0,"reset":1793000000}' },
    },
  ])

  await expect(detectBackend($, 'auto')).rejects.toThrow('rate limit')
})

test('a project whose Status field cannot be used is named under github', async () => {
  const noStatus: Route = {
    match: ['gh', 'project', 'field-list'],
    reply: { stdout: JSON.stringify({ fields: [] }) },
  }
  const routes = ready(graphql({ linked: [SHARED] }), noStatus)

  await expect(detectBackend(detect(routes).$, 'github')).rejects.toThrow(
    "project board #2 can't be used: Project #2 has no Status field.",
  )
  expect(await detectBackend(detect(routes).$, 'auto')).toEqual({
    kind: 'local',
  })
})

test('explicit config wins: a named repo and board make no board lookup', async () => {
  const { $, calls } = detect(
    [
      GH_VERSION,
      SIGNED_IN,
      remote('git@github.com:TeeratP/claude-kanban.git'),
      graphql({ linked: [SHARED] }),
    ],
    { 'CLAUDE.md': KANBAN },
  )

  expect(await detectBackend($, 'auto')).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/claude-kanban',
    projectNumber: 7,
  })
  expect(await detectBackend($, 'auto')).not.toHaveProperty('isDetected')
  expect(lines(calls).slice(0, 3)).toEqual([
    'gh --version',
    'gh auth status',
    'git remote get-url origin',
  ])
  expect(lines(calls).some(line => line.startsWith('gh api'))).toBe(false)
})

test('explicit config with AGENTS.md behind an import still wins (punn)', async () => {
  const { $ } = detect(
    [
      GH_VERSION,
      SIGNED_IN,
      remote('git@github.com:TeeratP/attend-baby.git'),
      graphql({ linked: [CAST] }),
    ],
    { 'CLAUDE.md': '@AGENTS.md', 'AGENTS.md': PUNN_AGENTS },
  )

  expect(await detectBackend($, 'auto')).toMatchObject({ projectNumber: 2 })
})

test('a board config that cannot be read still lets zero-config find the board', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(ALL_STATUSES)),
    {
      'AGENTS.md':
        'Board id: `PVT_kwHOAcCsLc4Bbjg2`, number written down elsewhere.',
    },
  )

  expect(await detectBackend($, 'auto')).toMatchObject({
    kind: 'github',
    projectNumber: 2,
    isDetected: true,
  })
})

test('a board config that cannot be read and no board found keeps the unclear note', async () => {
  const unclear = {
    'AGENTS.md':
      'Board id: `PVT_kwHOAcCsLc4Bbjg2`, number written down elsewhere.',
  }
  const none = detect(ready(graphql({ linked: [] })), unclear)
  const noGh = detect([NO_GH], unclear)

  expect(await detectBackend(none.$, 'auto')).toEqual({
    kind: 'local',
    isConfigUnclear: true,
  })
  expect(none.logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: CLAUDE.md or AGENTS.md mentions a project board, but no Repo and Project number could be read from it',
  ])
  expect(await detectBackend(noGh.$, 'auto')).toEqual({
    kind: 'local',
    isConfigUnclear: true,
  })
})

test('a board without In review keeps working, tells the person once, and maps Human to the label', async () => {
  const defaults = ['Todo', 'In Progress', 'Done']
  const { $, toasts, calls } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(defaults)),
  )

  const info = await detectBackend($, 'auto')

  expect(info).toMatchObject({
    kind: 'github',
    options: { backlog: 'o-Todo', inProgress: 'o-In Progress', done: 'o-Done' },
  })
  expect((info as KanbanGithub).options).not.toHaveProperty('inReview')
  expect(toasts).toEqual([
    'This board has no In review status: Human is the human label on a card in progress.',
  ])

  // Detected again from the saved copy, the person is not told twice.
  await detectBackend($, 'auto')
  expect(toasts).toHaveLength(1)
  expect(lines(calls).filter(line => line.includes('field-list'))).toHaveLength(
    1,
  )
})

test('other names for the statuses are understood, best name first', async () => {
  const { $ } = detect(
    ready(
      graphql({ linked: [SHARED] }),
      fieldList(['Ready', 'To Do', 'Doing', 'Review', 'Closed']),
    ),
  )

  expect((await detectBackend($, 'auto')) as KanbanGithub).toMatchObject({
    options: {
      backlog: 'o-To Do',
      ready: 'o-Ready',
      inProgress: 'o-Doing',
      inReview: 'o-Review',
      done: 'o-Closed',
    },
  })
})

test('a board with Ready but no Backlog uses Ready for both', async () => {
  const { $ } = detect(
    ready(
      graphql({ linked: [SHARED] }),
      fieldList(['Ready', 'In progress', 'In review', 'Done']),
    ),
  )

  expect((await detectBackend($, 'auto')) as KanbanGithub).toMatchObject({
    options: { backlog: 'o-Ready', ready: 'o-Ready' },
  })
})

test('a board with no Done (or Backlog, or In progress) cannot be used and says which', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(['Backlog', 'In progress'])),
  )

  await expect(detectBackend($, 'github')).rejects.toThrow(
    `project board #2 can't be used: The project's Status field has no "Done" option.`,
  )
})

test('the detection is saved per directory and reused: later sessions only read the origin', async () => {
  const { $, calls, saved } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(ALL_STATUSES)),
  )
  const first = await detectBackend($, 'auto')
  expect(JSON.parse(saved.get('detect:/work') ?? 'null')).toMatchObject({
    shape: 'detect-1',
    origin: 'https://github.com/TeeratP/attend-baby.git',
    info: { projectNumber: 2 },
  })
  calls.length = 0

  expect(await detectBackend($, 'auto')).toEqual(first)
  expect(await detectBackend($, 'github')).toEqual(first)
  expect(lines(calls)).toEqual([
    'git remote get-url origin',
    'git remote get-url origin',
  ])
})

test('a changed origin is detected again', async () => {
  let url = 'https://github.com/TeeratP/attend-baby.git'
  const { $, calls } = detect([
    GH_VERSION,
    SIGNED_IN,
    {
      match: ['git', 'remote', 'get-url', 'origin'],
      reply: () => ({ stdout: url }),
    },
    graphql({ linked: [SHARED] }),
    fieldList(ALL_STATUSES),
  ])
  await detectBackend($, 'auto')
  url = 'git@github.com:TeeratP/attend-baby.git'
  calls.length = 0

  await detectBackend($, 'auto')

  expect(lines(calls).filter(line => line.startsWith('gh api'))).toHaveLength(1)
})

test('a saved detection that is not ours or no longer fits is ignored', async () => {
  const { $, calls, saved } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(ALL_STATUSES)),
  )
  saved.set(
    'detect:/work',
    JSON.stringify({ shape: 'detect-0', info: { kind: 'local' } }),
  )

  expect(await detectBackend($, 'auto')).toMatchObject({ projectNumber: 2 })
  expect(lines(calls).filter(line => line.startsWith('gh api'))).toHaveLength(1)
})

test('a result that is not saved (local, a tie) is looked for again next time', async () => {
  const { $, calls, saved } = detect(ready(graphql({ linked: [] })))

  expect(await detectBackend($, 'auto')).toMatchObject({ noBoardFor: BABY })
  expect(saved.has('detect:/work')).toBe(false)
  await detectBackend($, 'auto')

  expect(lines(calls).filter(line => line.startsWith('gh api'))).toHaveLength(4)
})

const card = (fields: Partial<KanbanCard>): KanbanCard => ({
  id: 'gh:5',
  number: 5,
  title: 'A card',
  column: 'claude',
  order: 0,
  createdAt: '',
  updatedAt: '',
  itemId: 'PVTI_5',
  labels: ['ai'],
  ...fields,
})

const NO_REVIEW: KanbanGithub = {
  kind: 'github',
  repo: BABY,
  owner: 'TeeratP',
  projectNumber: 2,
  projectId: 'PVT_2',
  statusFieldId: 'PVTSSF_zero',
  options: { backlog: 'b', inProgress: 'p', done: 'd' },
}

test('other names for a status put a card in the same section', () => {
  const at = (status: string) => columnOf(status, [], false).column

  expect(['Todo', 'To Do', 'todo', 'Ready', 'Backlog', ''].map(at)).toEqual(
    Array(6).fill('backlog'),
  )
  expect(['Doing', 'doing', 'In progress', 'In Progress'].map(at)).toEqual(
    Array(4).fill('claude'),
  )
  expect(columnOf('Review', [], false)).toEqual({
    column: 'human',
    tag: 'review',
  })
  expect(columnOf('Closed', [], false)).toEqual({ column: 'done' })
  expect(columnOf('Whatever', [], false)).toEqual({ column: 'backlog' })
})

test('without In review, a card moves to Human by the human label, kept in progress', () => {
  expect(planMove(card({ status: 'In progress' }), 'human', NO_REVIEW)).toEqual(
    [['gh', 'issue', 'edit', '5', '--repo', BABY, '--add-label', 'human']],
  )
  expect(planMove(card({ status: 'Todo' }), 'human', NO_REVIEW)).toEqual([
    ['gh', 'issue', 'edit', '5', '--repo', BABY, '--add-label', 'human'],
    [
      'gh',
      'project',
      'item-edit',
      '--id',
      'PVTI_5',
      '--project-id',
      'PVT_2',
      '--field-id',
      'PVTSSF_zero',
      '--single-select-option-id',
      'p',
    ],
  ])
  expect(columnOf('In progress', ['human'], false)).toEqual({
    column: 'human',
    tag: 'human',
  })
})

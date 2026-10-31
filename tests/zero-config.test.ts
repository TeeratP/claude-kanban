import { expect, test } from 'claude-code/testing'

import { SetupNeeded, choicesOf, parseOrigin, setupOf } from '../hooks/detect'
import { detectBackend } from '../hooks/backend'
import { columnOf, planMove } from '../hooks/github'
import { S } from '../hooks/strings'
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

// What a detection that must fail threw.
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('expected the detection to fail')
}

test('one linked open board is used, with its title and what gh lists for its Status field', async () => {
  const { $, calls } = detect(
    ready(
      graphql({ linked: [SHARED, { number: 9, closed: true }] }),
      fieldList(ALL_STATUSES),
    ),
  )

  expect(await detectBackend($)).toEqual({
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

  expect(await detectBackend($)).toMatchObject({
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

  const failure = await detectBackend($).catch(
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

  const failure = await detectBackend($).catch(
    (error: unknown) => error,
  )

  expect(choicesOf(failure)?.map(one => one.number)).toEqual([6, 7])
})

test('no other error is a pick request', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [{ number: 6 }, { number: 7 }] })),
  )

  const failure = await detectBackend($).catch(
    (error: unknown) => error,
  )

  expect(choicesOf(failure)?.map(one => one.number)).toEqual([6, 7])
  expect(setupOf(failure)).toBeUndefined()
  expect(choicesOf(new SetupNeeded('board', 'no board'))).toBeUndefined()
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

  expect(await detectBackend($)).toMatchObject({
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

  expect(await detectBackend(scan(5))).toMatchObject({
    projectNumber: 2,
  })
  const tied = await detectBackend(scan(3)).catch(
    (error: unknown) => error,
  )
  expect(choicesOf(tied)?.map(one => one.number)).toEqual([2, 6])
})

test('no board anywhere: detection asks for a board and names the repo, quietly', async () => {
  const elsewhere: FakeProject = { number: 2, items: { 'TeeratP/other': 4 } }
  const { $, logs } = detect(
    ready(graphql({ linked: [], viewer: [elsewhere], owner: [elsewhere] })),
  )

  const failure = await failureOf(detectBackend($))

  expect(failure).toBeInstanceOf(SetupNeeded)
  expect((failure as Error).message).toBe(
    'no GitHub Project is linked to TeeratP/attend-baby: link one on GitHub, or add Repo and Project board lines to CLAUDE.md or AGENTS.md',
  )
  expect(setupOf(failure)).toEqual({ step: 'board', reason: S.githubNoBoard(BABY) })
  expect(logs).toEqual([])
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

  expect(await detectBackend($)).toMatchObject({ repo: BABY })
  expect(lines(calls)).toContain(
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
  )
})

test('an origin that is not on github.com asks for one, and gh is not asked anything', async () => {
  const { $, logs, calls } = detect([
    GH_VERSION,
    SIGNED_IN,
    remote('git@gitlab.com:me/app.git'),
  ])

  expect(setupOf(await failureOf(detectBackend($)))).toEqual({
    step: 'remote',
    reason: S.githubNoRemote(S.originNotGithub('git@gitlab.com:me/app.git')),
  })
  expect(S.originNotGithub('git@gitlab.com:me/app.git')).toBe(
    'origin git@gitlab.com:me/app.git is not a github.com URL',
  )
  expect(logs).toEqual([])
  expect(lines(calls)).toEqual(['git remote get-url origin'])
})

test('gh not installed: detection asks for gh, and says where to get it', async () => {
  const { $, calls } = detect([
    NO_GH,
    SIGNED_IN,
    ORIGIN,
    graphql({ linked: [SHARED] }),
  ])

  const failure = await failureOf(detectBackend($))

  expect(setupOf(failure)).toEqual({
    step: 'gh',
    reason: S.githubNoGh('gh: command not found'),
  })
  expect((failure as Error).message).toBe(
    'gh is not installed: install it from https://cli.github.com (gh: command not found)',
  )
  expect(lines(calls)).not.toContain('gh auth status')
})

test('gh signed out: detection asks for sign-in, naming the check and the fix', async () => {
  const { $, calls } = detect([
    GH_VERSION,
    SIGNED_OUT,
    ORIGIN,
    graphql({ linked: [SHARED] }),
  ])

  const failure = await failureOf(detectBackend($))

  expect(setupOf(failure)).toEqual({
    step: 'auth',
    reason: S.githubSignedOut('You are not logged into any GitHub hosts.'),
  })
  expect((failure as Error).message).toBe(
    'gh auth status failed: run gh auth login (You are not logged into any GitHub hosts.)',
  )
  expect(lines(calls).some(line => line.startsWith('gh api'))).toBe(false)
})

test('no origin remote is named first and gh is not asked anything', async () => {
  const noRemote: Route = {
    match: ['git', 'remote'],
    reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
  }
  const { $, calls } = detect([NO_GH, SIGNED_OUT, noRemote])

  const failure = await failureOf(detectBackend($))

  expect(setupOf(failure)).toEqual({
    step: 'remote',
    reason: S.githubNoRemote("error: No such remote 'origin'"),
  })
  expect((failure as Error).message).toBe(
    "no origin remote: run git remote add origin <url> (error: No such remote 'origin')",
  )
  expect(lines(calls)).toEqual(['git remote get-url origin'])
})

test('a lookup gh refuses is named with the scope to ask for, and is no setup step', async () => {
  const refused =
    'Your token has not been granted the required scopes: read:project'
  const { $, logs } = detect(ready(graphql({ failure: refused })))

  const failure = await failureOf(detectBackend($))

  expect((failure as Error).message).toBe(
    `could not list the GitHub Projects of TeeratP/attend-baby: ${refused}; run gh auth refresh -s read:project`,
  )
  expect(setupOf(failure)).toBeUndefined()
  expect(logs).toEqual([])
})

test('a rate limit during detection is thrown as it is, not taken for no board', async () => {
  const limited = 'GraphQL: API rate limit already exceeded for user ID 1.'
  const { $ } = detect([
    ...ready(graphql({ failure: limited })),
    {
      match: ['gh', 'api', 'rate_limit'],
      reply: { stdout: '{"remaining":0,"reset":1793000000}' },
    },
  ])

  const failure = await failureOf(detectBackend($))

  expect(String(failure)).toContain('rate limit')
  expect(setupOf(failure)).toBeUndefined()
})

test('a project whose Status field cannot be used is named, and is no setup step', async () => {
  const noStatus: Route = {
    match: ['gh', 'project', 'field-list'],
    reply: { stdout: JSON.stringify({ fields: [] }) },
  }
  const { $ } = detect(ready(graphql({ linked: [SHARED] }), noStatus))

  const failure = await failureOf(detectBackend($))

  expect((failure as Error).message).toBe(
    "project board #2 can't be used: Project #2 has no Status field.",
  )
  expect(setupOf(failure)).toBeUndefined()
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

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/claude-kanban',
    projectNumber: 7,
  })
  expect(await detectBackend($)).not.toHaveProperty('isDetected')
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

  expect(await detectBackend($)).toMatchObject({ projectNumber: 2 })
})

test('a board config that cannot be read still lets zero-config find the board', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(ALL_STATUSES)),
    {
      'AGENTS.md':
        'Board id: `PVT_kwHOAcCsLc4Bbjg2`, number written down elsewhere.',
    },
  )

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    projectNumber: 2,
    isDetected: true,
  })
})

test('a board config that cannot be read and no board found asks to fix the config', async () => {
  const unclear = {
    'AGENTS.md':
      'Board id: `PVT_kwHOAcCsLc4Bbjg2`, number written down elsewhere.',
  }
  const none = detect(ready(graphql({ linked: [] })), unclear)
  const noGh = detect([NO_GH, ORIGIN], unclear)

  expect(setupOf(await failureOf(detectBackend(none.$)))).toEqual({
    step: 'config',
    reason: S.githubConfigUnclear,
  })
  expect(none.logs).toEqual([])
  // A check that fails before any board is looked for is what to fix first.
  expect(setupOf(await failureOf(detectBackend(noGh.$)))).toEqual({
    step: 'gh',
    reason: S.githubNoGh('gh: command not found'),
  })
})

test('a board without In review keeps working, tells the person once, and maps Human to the label', async () => {
  const defaults = ['Todo', 'In Progress', 'Done']
  const { $, toasts, calls } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(defaults)),
  )

  const info = await detectBackend($)

  expect(info).toMatchObject({
    kind: 'github',
    options: { backlog: 'o-Todo', inProgress: 'o-In Progress', done: 'o-Done' },
  })
  expect((info as KanbanGithub).options).not.toHaveProperty('inReview')
  expect(toasts).toEqual([
    'This board has no In review status: Me is the human label on a card in progress.',
  ])

  // Detected again from the saved copy, the person is not told twice.
  await detectBackend($)
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

  expect((await detectBackend($)) as KanbanGithub).toMatchObject({
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

  expect((await detectBackend($)) as KanbanGithub).toMatchObject({
    options: { backlog: 'o-Ready', ready: 'o-Ready' },
  })
})

test('a board with no Done (or Backlog, or In progress) cannot be used and says which', async () => {
  const { $ } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(['Backlog', 'In progress'])),
  )

  await expect(detectBackend($)).rejects.toThrow(
    `project board #2 can't be used: The project's Status field has no "Done" option.`,
  )
})

test('the detection is saved per directory and reused: later sessions only read the origin', async () => {
  const { $, calls, saved } = detect(
    ready(graphql({ linked: [SHARED] }), fieldList(ALL_STATUSES)),
  )
  const first = await detectBackend($)
  expect(JSON.parse(saved.get('detect:/work') ?? 'null')).toMatchObject({
    shape: 'detect-1',
    origin: 'https://github.com/TeeratP/attend-baby.git',
    info: { projectNumber: 2 },
  })
  calls.length = 0

  expect(await detectBackend($)).toEqual(first)
  expect(await detectBackend($)).toEqual(first)
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
  await detectBackend($)
  url = 'git@github.com:TeeratP/attend-baby.git'
  calls.length = 0

  await detectBackend($)

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

  expect(await detectBackend($)).toMatchObject({ projectNumber: 2 })
  expect(lines(calls).filter(line => line.startsWith('gh api'))).toHaveLength(1)
})

test('a result that is not saved (no board, a tie) is looked for again next time', async () => {
  const { $, calls, saved } = detect(ready(graphql({ linked: [] })))

  expect(setupOf(await failureOf(detectBackend($)))).toMatchObject({
    step: 'board',
  })
  expect(saved.has('detect:/work')).toBe(false)
  await failureOf(detectBackend($))

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

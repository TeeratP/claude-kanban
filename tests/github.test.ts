import { expect, test } from 'claude-code/testing'

import type { KanbanCard, KanbanGithub } from '../types'
import { detectBackend, readDiff } from '../hooks/backend'
import {
  appendGithub,
  columnOf,
  detailGithub,
  diffGithub,
  loadGithub,
  moveGithub,
  parseClaudeMd,
  planMove,
} from '../hooks/github'
import { boot } from './fakes'
import { fakeEngine, fakeProcess } from './fake-gh'
import type { Route } from './fake-gh'

// Lines copied from the CLAUDE.md files this plugin is meant to read.
const CARCAST = [
  '## Task tracking',
  '',
  '- PRJ code: `CAST` — issue titles `[CAST-AREA] task name`.',
  '- Repo: `TeeratP/carcast` (private).',
  '- Project board: #6 "Car Cast" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4Bnjm9`).',
  '- Status field `PVTSSF_lAHOAcCsLc4Bnjm9zhmHqvQ` options: Backlog `7da4cde2` · Ready `cc4920bc` · In progress `932234e7` · In review `d4d39782` · Done `cb960c0f`.',
  '- Phase 0 epic: #1 (sub-issues #2–#7). Spike findings go in `docs/spikes/`.',
].join('\n')

const OFFR = [
  '- **PRJ code:** `OFFR` — issue titles `[OFFR-<AREA>] task name`.',
  '- **Repo:** `TeeratP/offr-fyi` (private).',
  '- **Project board:** #5 — https://github.com/users/TeeratP/projects/5',
  '  - Project ID: `PVT_kwHOAcCsLc4Bh4gY`',
  '  - Status field ID: `PVTSSF_lAHOAcCsLc4Bh4gYzhgyjns`',
  '  - Status options: Backlog `a5a90804` · Ready `43be2e5f` · In progress `8da11ef8` · In review `8355e926` · Done `93e11540`',
  '',
  'Set status with:',
  '```',
  'gh project item-edit --id <item-id> --project-id PVT_kwHOAcCsLc4Bh4gY \\',
  '  --field-id PVTSSF_lAHOAcCsLc4Bh4gYzhgyjns --single-select-option-id <option-id>',
  '```',
].join('\n')

const HORO = [
  '# Task Tracking — GitHub Issues + Project board',
  '',
  'Follows the global GitHub Issues protocol (see `~/.claude/CLAUDE.md`). Binding:',
  '',
  '- **Repo:** `TeeratP/thai-horo-ai`',
  '- **PRJ code:** `HORO`',
  "- **Project:** #2 `@TeeratP's Kanban` — id `PVT_kwHOAcCsLc4Bbjg2`",
  '- **Status field** (`PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY`): Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Done `98236657`',
  '- **Priority field** (`PVTSSF_lAHOAcCsLc4Bbjg2zhWTPUY`): P0 `79628723` · P1 `0a877460` · P2 `da944a9c`',
].join('\n')

const KANBAN = [
  '## Task tracking',
  '- Repo: `TeeratP/claude-kanban` (public).',
  '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
  '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
].join('\n')

const FIXTURES = [
  {
    name: 'carcast',
    text: CARCAST,
    expected: {
      repo: 'TeeratP/carcast',
      owner: 'TeeratP',
      projectNumber: 6,
      projectId: 'PVT_kwHOAcCsLc4Bnjm9',
      statusFieldId: 'PVTSSF_lAHOAcCsLc4Bnjm9zhmHqvQ',
      options: {
        backlog: '7da4cde2',
        ready: 'cc4920bc',
        inProgress: '932234e7',
        inReview: 'd4d39782',
        done: 'cb960c0f',
      },
    },
  },
  {
    name: 'offr-fyi (bullets, ids on separate lines, ids repeated in a code block)',
    text: OFFR,
    expected: {
      repo: 'TeeratP/offr-fyi',
      owner: 'TeeratP',
      projectNumber: 5,
      projectId: 'PVT_kwHOAcCsLc4Bh4gY',
      statusFieldId: 'PVTSSF_lAHOAcCsLc4Bh4gYzhgyjns',
      options: {
        backlog: 'a5a90804',
        ready: '43be2e5f',
        inProgress: '8da11ef8',
        inReview: '8355e926',
        done: '93e11540',
      },
    },
  },
  {
    name: 'horo (bold labels, a Priority field line under the Status one)',
    text: HORO,
    expected: {
      repo: 'TeeratP/thai-horo-ai',
      owner: 'TeeratP',
      projectNumber: 2,
      projectId: 'PVT_kwHOAcCsLc4Bbjg2',
      statusFieldId: 'PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY',
      options: {
        backlog: 'f75ad846',
        ready: '61e4505c',
        inProgress: '47fc9ee4',
        inReview: 'df73e18b',
        done: '98236657',
      },
    },
  },
  {
    name: 'claude-kanban',
    text: KANBAN,
    expected: {
      repo: 'TeeratP/claude-kanban',
      owner: 'TeeratP',
      projectNumber: 7,
      projectId: 'PVT_kwHOAcCsLc4BorgL',
      statusFieldId: 'PVTSSF_lAHOAcCsLc4BorgLzhnKcpg',
      options: {
        backlog: '1a1cd0bb',
        ready: '61b99878',
        inProgress: 'b15c285e',
        inReview: '5f34c9ff',
        done: '201b4a64',
      },
    },
  },
]

for (const { name, text, expected } of FIXTURES) {
  test(`parseClaudeMd reads the ids in the ${name} CLAUDE.md`, () => {
    expect(parseClaudeMd(text)).toEqual(expected)
  })
}

test('parseClaudeMd needs a repo and a project number, and leaves missing ids out', () => {
  expect(parseClaudeMd('# Notes\n\nNothing about GitHub here.')).toBeNull()
  expect(parseClaudeMd('- Repo: `a/b`\n')).toBeNull()
  expect(parseClaudeMd('- Project board: #3\n')).toBeNull()
  expect(parseClaudeMd('- Repo: `a/b`\n- Project board: #3 "x"\n')).toEqual({
    repo: 'a/b',
    owner: 'a',
    projectNumber: 3,
    options: {},
  })
})

test('parseClaudeMd takes the repo from a Repo: label, not from prose that mentions a path', () => {
  const text = [
    'Run it from the repo root `src/app` first.',
    '- **Repository (public):** `TeeratP/claude-kanban`',
    '- Project: #7',
  ].join('\n')

  expect(parseClaudeMd(text)?.repo).toBe('TeeratP/claude-kanban')
  expect(parseClaudeMd('The repo is `a/b`.\n- Project: #7')).toBeNull()
})

test('parseClaudeMd ignores a Done or Ready outside the status field lines', () => {
  const text = [
    '- Repo: `a/b`',
    '- Project: #1',
    '- Status field `PVTSSF_abc`: Backlog `aaaaaa1` · Done `bbbbbb2`',
    '',
    '',
    'Mark it Done `cccccc3` when merged.',
  ].join('\n')

  expect(parseClaudeMd(text)?.options).toEqual({
    backlog: 'aaaaaa1',
    done: 'bbbbbb2',
  })
})

const none: string[] = []

test('columnOf: a Done status or a closed issue is Done before anything else', () => {
  expect(columnOf('Done', ['human'], false)).toEqual({ column: 'done' })
  expect(columnOf('In progress', ['ai'], true)).toEqual({ column: 'done' })
  expect(columnOf('In review', none, true)).toEqual({ column: 'done' })
  expect(columnOf(undefined, none, true)).toEqual({ column: 'done' })
})

test('columnOf: Backlog, Ready and no status are Backlog, even labeled human', () => {
  for (const status of ['Backlog', 'Ready', '', undefined]) {
    expect(columnOf(status, ['human'], false)).toEqual({ column: 'backlog' })
    expect(columnOf(status, ['ai'], false)).toEqual({ column: 'backlog' })
  }
})

test('columnOf: In review is Human tagged review, label or not', () => {
  expect(columnOf('In review', none, false)).toEqual({
    column: 'human',
    tag: 'review',
  })
  expect(columnOf('In review', ['human'], false)).toEqual({
    column: 'human',
    tag: 'review',
  })
})

test('columnOf: the human label puts an in-progress issue in Human', () => {
  expect(columnOf('In progress', ['ai', 'human'], false)).toEqual({
    column: 'human',
    tag: 'human',
  })
  expect(columnOf('In progress', ['ai'], false)).toEqual({ column: 'claude' })
  expect(columnOf('In progress', none, false)).toEqual({ column: 'claude' })
})

test('columnOf: statuses compare without regard to case, unknown ones park in Backlog', () => {
  expect(columnOf('in progress', none, false)).toEqual({ column: 'claude' })
  expect(columnOf('IN REVIEW', none, false).column).toBe('human')
  expect(columnOf('Blocked', none, false)).toEqual({ column: 'backlog' })
  expect(columnOf('Blocked', ['human'], false).column).toBe('human')
})

const CFG: KanbanGithub = {
  kind: 'github',
  repo: 'TeeratP/claude-kanban',
  owner: 'TeeratP',
  projectNumber: 7,
  projectId: 'PVT_proj',
  statusFieldId: 'PVTSSF_status',
  options: {
    backlog: 'o-backlog',
    ready: 'o-ready',
    inProgress: 'o-progress',
    inReview: 'o-review',
    done: 'o-done',
  },
}

function ghCard(fields: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'gh:12',
    number: 12,
    title: 'Fix login',
    column: 'backlog',
    order: 0,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T11:00:00Z',
    itemId: 'PVTI_12',
    status: 'Backlog',
    labels: ['ai'],
    isClosed: false,
    ...fields,
  }
}

const itemEdit = (option: string) => [
  'gh',
  'project',
  'item-edit',
  '--id',
  'PVTI_12',
  '--project-id',
  'PVT_proj',
  '--field-id',
  'PVTSSF_status',
  '--single-select-option-id',
  option,
]
const REOPEN = [
  'gh',
  'issue',
  'reopen',
  '12',
  '--repo',
  'TeeratP/claude-kanban',
]
const CLOSE = ['gh', 'issue', 'close', '12', '--repo', 'TeeratP/claude-kanban']
const VERIFY = [
  'gh',
  'issue',
  'view',
  '12',
  '--repo',
  'TeeratP/claude-kanban',
  '--json',
  'state',
  '--jq',
  '.state',
]
const EDIT = ['gh', 'issue', 'edit', '12', '--repo', 'TeeratP/claude-kanban']

test('planMove to Claude sets In progress and adds the ai label', () => {
  expect(planMove(ghCard({ labels: [] }), 'claude', CFG)).toEqual([
    itemEdit('o-progress'),
    [...EDIT, '--add-label', 'ai'],
  ])
})

test('planMove to Claude removes the human label only when the card has it', () => {
  expect(
    planMove(
      ghCard({ labels: ['ai', 'human'], status: 'In review' }),
      'claude',
      CFG,
    ),
  ).toEqual([
    itemEdit('o-progress'),
    [...EDIT, '--add-label', 'ai', '--remove-label', 'human'],
  ])
  expect(planMove(ghCard({ labels: ['ai'] }), 'claude', CFG)[1]).not.toContain(
    '--remove-label',
  )
  expect(
    planMove(ghCard({ labels: undefined }), 'claude', CFG)[1],
  ).not.toContain('--remove-label')
})

test('planMove to Human sets In review and touches no label', () => {
  expect(planMove(ghCard({ status: 'In progress' }), 'human', CFG)).toEqual([
    itemEdit('o-review'),
  ])
})

test('planMove to Backlog skips the edit when the card is already Backlog or Ready', () => {
  expect(planMove(ghCard({ status: 'In progress' }), 'backlog', CFG)).toEqual([
    itemEdit('o-backlog'),
  ])
  expect(planMove(ghCard({ status: 'Backlog' }), 'backlog', CFG)).toEqual([])
  expect(planMove(ghCard({ status: 'Ready' }), 'backlog', CFG)).toEqual([])
  expect(
    planMove(ghCard({ status: 'Backlog', isClosed: true }), 'backlog', CFG),
  ).toEqual([REOPEN])
})

test('planMove to Done sets Done, closes the issue, then reads the state back', () => {
  expect(planMove(ghCard({ status: 'In review' }), 'done', CFG)).toEqual([
    itemEdit('o-done'),
    CLOSE,
    VERIFY,
  ])
})

test('planMove reopens a closed issue first, for every target but Done', () => {
  const closed = ghCard({ status: 'Done', isClosed: true })

  expect(planMove(closed, 'human', CFG)).toEqual([REOPEN, itemEdit('o-review')])
  expect(planMove(closed, 'claude', CFG)[0]).toEqual(REOPEN)
  expect(planMove(closed, 'backlog', CFG)).toEqual([
    REOPEN,
    itemEdit('o-backlog'),
  ])
  expect(planMove(closed, 'done', CFG)).not.toContainEqual(REOPEN)
})

test('planMove needs the card to be on the board', () => {
  const { itemId: _gone, ...unplaced } = ghCard()

  expect(() => planMove(unplaced, 'claude', CFG)).toThrow(
    '#12 is not on the project board.',
  )
})

// What gh 2.74 prints, bodies and all.
const ITEM_LIST = JSON.stringify({
  items: [
    item('PVTI_1', 1, 'In progress', 'TeeratP/claude-kanban'),
    item('PVTI_2', 2, 'Done', 'TeeratP/claude-kanban'),
    item('PVTI_3', 3, 'In review', 'TeeratP/claude-kanban'),
    item('PVTI_4', 4, 'Backlog', 'TeeratP/claude-kanban'),
    item('PVTI_5', 5, 'In progress', 'TeeratP/claude-kanban'),
    item('PVTI_o', 1, 'In progress', 'TeeratP/someone-else'),
    {
      id: 'PVTI_pr',
      title: 'A pull request',
      status: 'In progress',
      content: {
        type: 'PullRequest',
        number: 30,
        repository: 'TeeratP/claude-kanban',
      },
    },
    { id: 'PVTI_draft', title: 'Just a note', content: { type: 'DraftIssue' } },
    item('PVTI_9', 9, 'In progress', 'teeratp/Claude-Kanban'),
    item('PVTI_10', 10, undefined, 'TeeratP/claude-kanban'),
    item('PVTI_11', 11, 'In progress', 'TeeratP/claude-kanban'),
    item('PVTI_12', 12, 'In progress', 'TeeratP/claude-kanban'),
  ],
  totalCount: 12,
})

function item(
  id: string,
  number: number,
  status: string | undefined,
  repository: string,
) {
  return {
    id,
    title: `Item ${number}`,
    ...(status === undefined ? {} : { status }),
    labels: ['stale', 'labels'],
    repository: `https://github.com/${repository}`,
    content: {
      type: 'Issue',
      number,
      title: `Issue ${number}`,
      body: 'A long body that must not matter.',
      url: `https://github.com/${repository}/issues/${number}`,
      repository,
    },
  }
}

function issue(
  number: number,
  fields: { state?: string; labels?: string[]; prs?: unknown[] } = {},
) {
  return {
    number,
    state: fields.state ?? 'OPEN',
    labels: (fields.labels ?? []).map(name => ({
      id: `L_${name}`,
      name,
      color: 'fff',
    })),
    createdAt: `2026-10-0${number % 9}T10:00:00Z`,
    updatedAt: `2026-10-1${number % 9}T10:00:00Z`,
    closedByPullRequestsReferences: fields.prs ?? [],
  }
}

const PR = (number: number, owner = 'TeeratP', name = 'claude-kanban') => ({
  id: `PR_${number}`,
  number,
  url: `https://github.com/${owner}/${name}/pull/${number}`,
  repository: { id: 'R', name, owner: { id: 'O', login: owner } },
})

const ISSUE_LIST = JSON.stringify([
  issue(1, { labels: ['ai'] }),
  issue(2, { state: 'CLOSED', labels: ['ai'] }),
  issue(3, { labels: ['ai'], prs: [PR(21), PR(22, 'TeeratP', 'elsewhere')] }),
  issue(4, { labels: ['human'] }),
  issue(5, { labels: ['ai', 'human'] }),
  issue(9),
  issue(10),
  issue(12, { state: 'CLOSED', labels: ['ai'] }),
])

const LOAD_ROUTES: Route[] = [
  { match: ['gh', 'project', 'item-list'], reply: { stdout: ITEM_LIST } },
  { match: ['gh', 'issue', 'list'], reply: { stdout: ISSUE_LIST } },
]

test("load joins the board items with the issue list and drops what is not this repo's issue", async () => {
  const { $, calls } = fakeEngine(LOAD_ROUTES)

  const cards = await loadGithub($, CFG)

  expect(
    cards.map(card => [card.id, card.column, card.tag, card.order]),
  ).toEqual([
    ['gh:1', 'claude', undefined, 0],
    ['gh:2', 'done', undefined, 1],
    ['gh:3', 'human', 'review', 2],
    ['gh:4', 'backlog', undefined, 3],
    ['gh:5', 'human', 'human', 4],
    ['gh:9', 'claude', undefined, 5],
    ['gh:10', 'backlog', undefined, 6],
    ['gh:12', 'done', undefined, 8],
  ])
  expect(cards[2]).toEqual({
    id: 'gh:3',
    number: 3,
    title: 'Issue 3',
    column: 'human',
    order: 2,
    createdAt: '2026-10-03T10:00:00Z',
    updatedAt: '2026-10-13T10:00:00Z',
    tag: 'review',
    itemId: 'PVTI_3',
    status: 'In review',
    labels: ['ai'],
    isClosed: false,
    url: 'https://github.com/TeeratP/claude-kanban/issues/3',
    prNumbers: [21],
  })
  expect(cards[6]).not.toHaveProperty('status')
  expect(cards[6]).not.toHaveProperty('prNumbers')
  expect(cards[1]?.isClosed).toBe(true)
  expect(calls.map(call => call.argv.slice(0, 9))).toEqual([
    [
      'gh',
      'project',
      'item-list',
      '7',
      '--owner',
      'TeeratP',
      '--format',
      'json',
      '--limit',
    ],
    [
      'gh',
      'issue',
      'list',
      '--repo',
      'TeeratP/claude-kanban',
      '--state',
      'all',
      '--limit',
      '500',
    ],
  ])
  expect(calls[1]?.argv.at(-1)).toContain('closedByPullRequestsReferences')
})

test('load names the failing command when gh exits non-zero', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project'], reply: { stdout: ITEM_LIST } },
    {
      match: ['gh', 'issue', 'list'],
      reply: {
        exitCode: 1,
        stderr: 'HTTP 401: Bad credentials\nrun gh auth login',
      },
    },
  ])

  await expect(loadGithub($, CFG)).rejects.toThrow('HTTP 401: Bad credentials')
})

test('load rejects output that is not the JSON it asked for', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project'], reply: { stdout: 'not json' } },
    { match: ['gh', 'issue'], reply: { stdout: ISSUE_LIST } },
  ])

  await expect(loadGithub($, CFG)).rejects.toThrow(
    'gh returned project items that could not be read',
  )
})

test('moving to Done runs the plan in order and reads the closed state back', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    { match: ['gh', 'issue', 'view'], reply: { stdout: 'CLOSED\n' } },
  ])

  const patch = await moveGithub(
    $,
    CFG,
    ghCard({ status: 'In review' }),
    'done',
  )

  expect(calls.map(call => call.argv)).toEqual([
    itemEdit('o-done'),
    CLOSE,
    VERIFY,
  ])
  expect(patch).toEqual({ status: 'Done', isClosed: true })
})

test('a close that did not take is an error, not a quiet success', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    { match: ['gh', 'issue', 'view'], reply: { stdout: 'OPEN\n' } },
  ])

  await expect(moveGithub($, CFG, ghCard(), 'done')).rejects.toThrow(
    '#12 is still open after gh issue close.',
  )
})

test('the first command that fails stops the move and gives its reason', async () => {
  const { $, calls } = fakeEngine([
    {
      match: ['gh', 'project', 'item-edit'],
      reply: { exitCode: 1, stderr: 'GraphQL: insufficient scopes\nmore' },
    },
    { match: ['gh', 'issue', 'edit'], reply: {} },
  ])

  await expect(
    moveGithub($, CFG, ghCard({ status: 'In review' }), 'claude'),
  ).rejects.toThrow('GraphQL: insufficient scopes')
  expect(calls).toHaveLength(1)
})

test('moving to Claude reports the new status, the ai label and no human label', async () => {
  const { $ } = fakeEngine([{ match: ['gh'], reply: {} }])

  const patch = await moveGithub(
    $,
    CFG,
    ghCard({ status: 'In review', labels: ['p1', 'human'], isClosed: true }),
    'claude',
  )

  expect(patch).toEqual({
    status: 'In progress',
    labels: ['p1', 'ai'],
    isClosed: false,
  })
})

test('moving to Human tags the card review; moving to Backlog from Ready keeps its status', async () => {
  const { $ } = fakeEngine([{ match: ['gh'], reply: {} }])

  expect(
    await moveGithub($, CFG, ghCard({ status: 'In progress' }), 'human'),
  ).toEqual({ status: 'In review', tag: 'review', isClosed: false })
  expect(
    await moveGithub($, CFG, ghCard({ status: 'Ready' }), 'backlog'),
  ).toEqual({
    isClosed: false,
  })
})

test('append posts the section as an issue comment read from stdin', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'issue', 'comment'], reply: {} },
  ])
  const section = '## Handoff (2026-10-25)\n**Did:** it\n**Check:** `a & b`'

  await appendGithub($, CFG, ghCard(), section)

  expect(calls).toEqual([
    {
      argv: [
        'gh',
        'issue',
        'comment',
        '12',
        '--repo',
        'TeeratP/claude-kanban',
        '--body-file',
        '-',
      ],
      stdin: section,
    },
  ])
})

test('detail is the issue body plus its Handoff and Feedback comments, oldest first', async () => {
  const comment = (body: string, createdAt: string) => ({
    body,
    createdAt,
    author: {},
  })
  const { $, calls } = fakeEngine([
    {
      match: ['gh', 'issue', 'view'],
      reply: {
        stdout: JSON.stringify({
          body: '\nThe spec.\n',
          url: 'https://github.com/TeeratP/claude-kanban/issues/12',
          state: 'OPEN',
          comments: [
            comment(
              '## Feedback (2026-10-26)\nAlso handle expiry.',
              '2026-10-26T09:00:00Z',
            ),
            comment('Looks good so far', '2026-10-25T11:00:00Z'),
            comment(
              '## Handoff (2026-10-25)\n**Did:** Fixed\n**Check:** Log in\n**Changed:** a.ts\n**Need from you:** Approve',
              '2026-10-25T12:00:00Z',
            ),
            comment(
              'See ## Handoff (2026-10-24) above',
              '2026-10-24T12:00:00Z',
            ),
          ],
        }),
      },
    },
  ])

  const detail = await detailGithub($, CFG, ghCard())

  expect(calls[0]?.argv).toEqual([
    'gh',
    'issue',
    'view',
    '12',
    '--repo',
    'TeeratP/claude-kanban',
    '--json',
    'body,comments,url,state',
  ])
  expect(detail.body).toBe('The spec.')
  expect(detail.sections).toEqual([
    {
      kind: 'handoff',
      date: '2026-10-25',
      text: expect.any(String),
      fields: {
        did: 'Fixed',
        check: 'Log in',
        changed: 'a.ts',
        need: 'Approve',
      },
    },
    { kind: 'feedback', date: '2026-10-26', text: 'Also handle expiry.' },
  ])
})

test('the diff is the first linked pull request, and absent without one', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'pr', 'diff'], reply: { stdout: 'diff --git a/x b/x\n' } },
  ])

  expect(await diffGithub($, CFG, ghCard({ prNumbers: [21, 22] }))).toBe(
    'diff --git a/x b/x\n',
  )
  expect(calls[0]?.argv).toEqual([
    'gh',
    'pr',
    'diff',
    '21',
    '--repo',
    'TeeratP/claude-kanban',
  ])

  expect(await diffGithub($, CFG, ghCard())).toBeUndefined()
  expect(await readDiff($, CFG, ghCard({ prNumbers: [21] }))).toBe(
    'diff --git a/x b/x\n',
  )
  expect(calls).toHaveLength(2)
})

test('a local board has no diff', async () => {
  const { $, calls } = fakeEngine([])

  expect(
    await readDiff($, { kind: 'local' }, ghCard({ prNumbers: [21] })),
  ).toBeUndefined()
  expect(calls).toHaveLength(0)
})

const AUTH: Route = { match: ['gh', 'auth', 'status'], reply: {} }
const REMOTE: Route = {
  match: ['git', 'remote', 'get-url', 'origin'],
  reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
}

test('detect finds nothing to go on without a CLAUDE.md that names a project', async () => {
  const none = fakeEngine([AUTH, REMOTE])
  const plain = fakeEngine([AUTH, REMOTE], { 'CLAUDE.md': '# Notes\n' })

  expect(await detectBackend(none.$)).toEqual({ kind: 'local' })
  expect(await detectBackend(plain.$)).toEqual({ kind: 'local' })
  expect(none.calls).toHaveLength(0)
  expect(plain.calls).toHaveLength(0)
  expect(none.logs).toEqual([])
})

test('detect uses the ids in CLAUDE.md as they stand, after gh auth and the git remote', async () => {
  const { $, calls } = fakeEngine([AUTH, REMOTE], { 'CLAUDE.md': KANBAN })

  expect(await detectBackend($)).toEqual({
    kind: 'github',
    repo: 'TeeratP/claude-kanban',
    owner: 'TeeratP',
    projectNumber: 7,
    projectId: 'PVT_kwHOAcCsLc4BorgL',
    statusFieldId: 'PVTSSF_lAHOAcCsLc4BorgLzhnKcpg',
    options: {
      backlog: '1a1cd0bb',
      ready: '61b99878',
      inProgress: 'b15c285e',
      inReview: '5f34c9ff',
      done: '201b4a64',
    },
  })
  expect(calls.map(call => call.argv)).toEqual([
    ['gh', 'auth', 'status'],
    ['git', 'remote', 'get-url', 'origin'],
  ])
})

test('detect falls back to .claude/CLAUDE.md when the root file names no project', async () => {
  const { $ } = fakeEngine([AUTH, REMOTE], {
    'CLAUDE.md': '# Notes\n',
    '.claude/CLAUDE.md': KANBAN,
  })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    projectNumber: 7,
  })
})

const FIELDS = JSON.stringify({
  fields: [
    { id: 'PVTF_title', name: 'Title', type: 'ProjectV2Field' },
    {
      id: 'PVTSSF_found',
      name: 'Status',
      type: 'ProjectV2SingleSelectField',
      options: [
        { id: 'f-backlog', name: 'Backlog' },
        { id: 'f-ready', name: 'Ready' },
        { id: 'f-progress', name: 'In progress' },
        { id: 'f-review', name: 'In review' },
        { id: 'f-done', name: 'Done' },
      ],
    },
  ],
  totalCount: 2,
})

test('detect asks gh for the ids a CLAUDE.md leaves out', async () => {
  const { $, calls } = fakeEngine(
    [
      AUTH,
      REMOTE,
      { match: ['gh', 'project', 'field-list'], reply: { stdout: FIELDS } },
      { match: ['gh', 'project', 'view'], reply: { stdout: 'PVT_found\n' } },
    ],
    { 'CLAUDE.md': '- Repo: `TeeratP/claude-kanban`\n- Project board: #7\n' },
  )

  expect(await detectBackend($)).toEqual({
    kind: 'github',
    repo: 'TeeratP/claude-kanban',
    owner: 'TeeratP',
    projectNumber: 7,
    projectId: 'PVT_found',
    statusFieldId: 'PVTSSF_found',
    options: {
      backlog: 'f-backlog',
      ready: 'f-ready',
      inProgress: 'f-progress',
      inReview: 'f-review',
      done: 'f-done',
    },
  })
  expect(calls.slice(2).map(call => call.argv)).toEqual([
    [
      'gh',
      'project',
      'field-list',
      '7',
      '--owner',
      'TeeratP',
      '--format',
      'json',
    ],
    [
      'gh',
      'project',
      'view',
      '7',
      '--owner',
      'TeeratP',
      '--format',
      'json',
      '--jq',
      '.id',
    ],
  ])
})

test('detect keeps the ids CLAUDE.md gives and looks up only the options it lacks', async () => {
  const { $ } = fakeEngine(
    [
      AUTH,
      REMOTE,
      { match: ['gh', 'project', 'field-list'], reply: { stdout: FIELDS } },
    ],
    {
      'CLAUDE.md': [
        '- Repo: `TeeratP/claude-kanban`',
        '- Project board: #7 (project ID `PVT_mine`)',
        '- Status field `PVTSSF_mine` options: Backlog `aaaaaa1` · Done `bbbbbb2`',
      ].join('\n'),
    },
  )

  expect(await detectBackend($)).toMatchObject({
    projectId: 'PVT_mine',
    statusFieldId: 'PVTSSF_mine',
    options: { backlog: 'aaaaaa1', inProgress: 'f-progress', done: 'bbbbbb2' },
  })
})

test('detect leaves a board with no Ready option without one', async () => {
  const noReady = JSON.stringify({
    fields: [
      {
        id: 'PVTSSF_found',
        name: 'Status',
        options: [
          { id: 'f-backlog', name: 'Backlog' },
          { id: 'f-progress', name: 'In progress' },
          { id: 'f-review', name: 'In review' },
          { id: 'f-done', name: 'Done' },
        ],
      },
    ],
  })
  const { $ } = fakeEngine(
    [
      AUTH,
      REMOTE,
      { match: ['gh', 'project', 'field-list'], reply: { stdout: noReady } },
      { match: ['gh', 'project', 'view'], reply: { stdout: 'PVT_found' } },
    ],
    { 'CLAUDE.md': '- Repo: `a/b`\n- Project: #1\n' },
  )

  const info = await detectBackend($)

  expect(info.kind === 'github' && info.options).toEqual({
    backlog: 'f-backlog',
    inProgress: 'f-progress',
    inReview: 'f-review',
    done: 'f-done',
  })
})

test('detect goes local, and says why, when gh is not signed in', async () => {
  const { $, logs } = fakeEngine(
    [
      {
        match: ['gh', 'auth', 'status'],
        reply: {
          exitCode: 1,
          stderr: 'You are not logged into any GitHub hosts.',
        },
      },
      REMOTE,
    ],
    { 'CLAUDE.md': KANBAN },
  )

  expect(await detectBackend($)).toEqual({ kind: 'local' })
  expect(logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: You are not logged into any GitHub hosts.',
  ])
})

test('detect goes local when the directory has no origin remote', async () => {
  const { $, logs } = fakeEngine(
    [
      AUTH,
      {
        match: ['git', 'remote'],
        reply: { exitCode: 2, stderr: "error: No such remote 'origin'" },
      },
    ],
    { 'CLAUDE.md': KANBAN },
  )

  expect(await detectBackend($)).toEqual({ kind: 'local' })
  expect(logs[0]).toContain("No such remote 'origin'")
})

test('detect goes local when the project has no Status option it needs', async () => {
  const { $, logs } = fakeEngine(
    [
      AUTH,
      REMOTE,
      {
        match: ['gh', 'project', 'field-list'],
        reply: {
          stdout: JSON.stringify({
            fields: [
              {
                id: 'PVTSSF_x',
                name: 'Status',
                options: [{ id: 'z', name: 'Todo' }],
              },
            ],
          }),
        },
      },
      { match: ['gh', 'project', 'view'], reply: { stdout: 'PVT_x' } },
    ],
    { 'CLAUDE.md': '- Repo: `a/b`\n- Project: #1\n' },
  )

  expect(await detectBackend($)).toEqual({ kind: 'local' })
  expect(logs[0]).toContain('no "Backlog" option')
})

test('through the board: a CLAUDE.md names the project, cards load from gh, a move runs its plan', async ($, on) => {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = fakeProcess(on, [
    AUTH,
    REMOTE,
    ...LOAD_ROUTES,
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'edit'], reply: {} },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    result: expect.stringContaining('#3 [human] Issue 3 (review)'),
  })
  expect(listed).toMatchObject({
    result: expect.stringContaining('#4 [backlog] Issue 4'),
  })

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 4,
    to: 'claude',
  })

  expect(moved).toMatchObject({ result: 'Moved #4 to Claude.' })
  expect(calls.slice(0, 2).map(call => call.argv)).toEqual([
    ['gh', 'auth', 'status'],
    ['git', 'remote', 'get-url', 'origin'],
  ])
  expect(calls.find(call => call.argv[2] === 'item-edit')?.argv).toEqual([
    'gh',
    'project',
    'item-edit',
    '--id',
    'PVTI_4',
    '--project-id',
    'PVT_kwHOAcCsLc4BorgL',
    '--field-id',
    'PVTSSF_lAHOAcCsLc4BorgLzhnKcpg',
    '--single-select-option-id',
    'b15c285e',
  ])
  expect(calls.find(call => call.argv[2] === 'edit')?.argv).toEqual([
    'gh',
    'issue',
    'edit',
    '4',
    '--repo',
    'TeeratP/claude-kanban',
    '--add-label',
    'ai',
    '--remove-label',
    'human',
  ])
})

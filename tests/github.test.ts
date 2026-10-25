import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanCard, KanbanGithub } from '../types'
import { detectBackend, readDiff } from '../hooks/backend'
import {
  appendGithub,
  columnOf,
  detailGithub,
  diffGithub,
  isRateLimited,
  loadGithub,
  moveGithub,
  parseClaudeMd,
  planMove,
} from '../hooks/github'
import { isHandoffValid } from '../hooks/handoff'
import { NOW, PANE, RUN, SYNC_PAUSE, boot } from './fakes'
import {
  LIVE_RATE_LIMIT,
  boardReply,
  boardRoute,
  cursorOf,
  fakeEngine,
  fakeProcess,
  issueNode,
  queryOf,
} from './fake-gh'
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

test('planMove to Claude edits the labels first, then sets In progress', () => {
  expect(planMove(ghCard({ labels: [] }), 'claude', CFG)).toEqual([
    [...EDIT, '--add-label', 'ai'],
    itemEdit('o-progress'),
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
    [...EDIT, '--add-label', 'ai', '--remove-label', 'human'],
    itemEdit('o-progress'),
  ])
  expect(planMove(ghCard({ labels: ['ai'] }), 'claude', CFG)[0]).not.toContain(
    '--remove-label',
  )
  expect(
    planMove(ghCard({ labels: undefined }), 'claude', CFG)[0],
  ).not.toContain('--remove-label')
})

test('planMove to Claude removes the human label under the spelling the card has it', () => {
  for (const spelling of ['Human', 'HUMAN']) {
    expect(
      planMove(ghCard({ labels: ['ai', spelling] }), 'claude', CFG)[0],
    ).toEqual([...EDIT, '--add-label', 'ai', '--remove-label', spelling])
  }
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

// What `gh api graphql` printed for the board query against board #7 on
// 2026-10-25, three of its sixteen items. `rateLimit.cost` was 2.
const LIVE_PAGE = JSON.stringify({
  data: {
    node: {
      items: {
        pageInfo: {
          hasNextPage: false,
          endCursor: 'Y3Vyc29yOnYyOpKtMDAwMDAwMDAuMDYyNc4Q2eon',
        },
        nodes: [
          {
            id: 'PVTI_lAHOAcCsLc4BorgLzhDZWwk',
            fieldValueByName: { name: 'In progress', optionId: 'b15c285e' },
            content: {
              number: 1,
              title: '[KANB-UIX] Kanban mod v1 (epic)',
              url: 'https://github.com/TeeratP/claude-kanban/issues/1',
              state: 'OPEN',
              createdAt: '2026-10-25T16:44:28Z',
              updatedAt: '2026-10-25T16:44:28Z',
              repository: { nameWithOwner: 'TeeratP/claude-kanban' },
              labels: { nodes: [{ name: 'feature' }, { name: 'ai' }] },
              closedByPullRequestsReferences: { nodes: [] },
            },
          },
          {
            id: 'PVTI_lAHOAcCsLc4BorgLzhDZWxo',
            fieldValueByName: { name: 'Done', optionId: '201b4a64' },
            content: {
              number: 2,
              title: '[KANB-UIX] Foundation: pane, sections, scroll',
              url: 'https://github.com/TeeratP/claude-kanban/issues/2',
              state: 'CLOSED',
              createdAt: '2026-10-25T16:44:30Z',
              updatedAt: '2026-10-25T17:09:15Z',
              repository: { nameWithOwner: 'TeeratP/claude-kanban' },
              labels: { nodes: [{ name: 'feature' }, { name: 'ai' }] },
              closedByPullRequestsReferences: { nodes: [] },
            },
          },
          {
            id: 'PVTI_lAHOAcCsLc4BorgLzhDZWyM',
            fieldValueByName: { name: 'In review', optionId: '5f34c9ff' },
            content: {
              number: 3,
              title: '[KANB-INT] GitHub Issues + Projects backend',
              url: 'https://github.com/TeeratP/claude-kanban/issues/3',
              state: 'OPEN',
              createdAt: '2026-10-25T16:44:32Z',
              updatedAt: '2026-10-25T17:21:16Z',
              repository: { nameWithOwner: 'TeeratP/claude-kanban' },
              labels: { nodes: [{ name: 'feature' }, { name: 'ai' }] },
              closedByPullRequestsReferences: { nodes: [] },
            },
          },
        ],
      },
    },
    rateLimit: LIVE_RATE_LIMIT,
  },
})

const GRAPHQL: readonly string[] = ['gh', 'api', 'graphql']

test('load asks for the board in one GraphQL query and records what it cost', async () => {
  const { $, calls } = fakeEngine([
    { match: GRAPHQL, reply: { stdout: LIVE_PAGE } },
  ])

  const load = await loadGithub($, CFG)

  expect(calls).toHaveLength(1)
  expect(calls[0]?.argv).toEqual([
    ...GRAPHQL,
    '-f',
    queryOf(calls[0]?.argv ?? []),
    '-F',
    'projectId=PVT_proj',
  ])
  const query = queryOf(calls[0]?.argv ?? [])
  expect(query).toContain('node(id: $projectId)')
  expect(query).toContain('items(first: 100, after: $cursor)')
  expect(query).toContain('rateLimit { cost remaining resetAt }')
  // The query names no field a card does not show.
  expect(query).not.toContain('body')

  // Measured live: 2 points a page, where `gh project item-list` cost about 100.
  expect(load.rateLimit).toEqual({
    cost: 2,
    remaining: 4998,
    resetAt: Date.parse('2026-10-25T18:57:38Z'),
  })
  expect(load.rateLimit?.cost).toBeLessThanOrEqual(2)
  expect(load.cards.map(card => [card.id, card.column, card.tag])).toEqual([
    ['gh:1', 'claude', undefined],
    ['gh:2', 'done', undefined],
    ['gh:3', 'human', 'review'],
  ])
  expect(load.cards[2]).toEqual({
    id: 'gh:3',
    number: 3,
    title: '[KANB-INT] GitHub Issues + Projects backend',
    column: 'human',
    order: 2,
    createdAt: '2026-10-25T16:44:32Z',
    updatedAt: '2026-10-25T17:21:16Z',
    tag: 'review',
    itemId: 'PVTI_lAHOAcCsLc4BorgLzhDZWyM',
    status: 'In review',
    labels: ['feature', 'ai'],
    isClosed: false,
    url: 'https://github.com/TeeratP/claude-kanban/issues/3',
  })
  expect(load.cards[1]?.isClosed).toBe(true)
})

const MIXED = [
  issueNode({ number: 1, status: 'In progress', labels: ['ai'] }),
  issueNode({ number: 2, status: 'Done', state: 'CLOSED', labels: ['ai'] }),
  issueNode({
    number: 3,
    status: 'In review',
    labels: ['ai'],
    prs: [{ number: 21 }, { number: 22, repo: 'TeeratP/elsewhere' }],
  }),
  issueNode({ number: 4, status: 'Backlog', labels: ['human'] }),
  issueNode({ number: 5, status: 'In progress', labels: ['ai', 'Human'] }),
  issueNode({ number: 1, status: 'In progress', repo: 'TeeratP/someone-else' }),
  // A pull request and a draft have no issue fields; an item can be unreadable.
  { id: 'PVTI_pr', fieldValueByName: null, content: {} },
  { id: 'PVTI_draft', fieldValueByName: null, content: {} },
  { id: 'PVTI_hidden', fieldValueByName: null, content: null },
  issueNode({
    number: 9,
    status: 'In progress',
    repo: 'teeratp/Claude-Kanban',
  }),
  issueNode({ number: 10 }),
  issueNode({ number: 12, status: 'In progress', state: 'CLOSED' }),
]

const LOAD_ROUTES: Route[] = [boardRoute(MIXED)]

test("load keeps the issues of this repo, in board order, with labels, state and this repo's PRs", async () => {
  const { $ } = fakeEngine(LOAD_ROUTES)

  const { cards } = await loadGithub($, CFG)

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
    ['gh:12', 'done', undefined, 7],
  ])
  expect(cards[2]).toMatchObject({
    itemId: 'PVTI_3',
    status: 'In review',
    labels: ['ai'],
    prNumbers: [21],
    createdAt: '2026-10-03T10:00:00Z',
    updatedAt: '2026-10-13T10:00:00Z',
    url: 'https://github.com/TeeratP/claude-kanban/issues/3',
  })
  expect(cards[6]).not.toHaveProperty('status')
  expect(cards[6]).not.toHaveProperty('prNumbers')
})

test('load pages with the cursor of the page before, one query each', async () => {
  const nodes = Array.from({ length: 250 }, (_, index) =>
    issueNode({ number: index + 1, status: 'Backlog' }),
  )
  const { $, calls } = fakeEngine([boardRoute(nodes)])

  const { cards } = await loadGithub($, CFG)

  expect(calls.map(call => cursorOf(call.argv))).toEqual([
    undefined,
    'c100',
    'c200',
  ])
  expect(new Set(calls.map(call => queryOf(call.argv))).size).toBe(1)
  expect(cards.map(card => card.number)).toEqual(
    Array.from({ length: 250 }, (_, index) => index + 1),
  )
})

test('a board of exactly one page is one query', async () => {
  const nodes = Array.from({ length: 100 }, (_, index) =>
    issueNode({ number: index + 1 }),
  )
  const { $, calls } = fakeEngine([boardRoute(nodes)])

  expect((await loadGithub($, CFG)).cards).toHaveLength(100)
  expect(calls).toHaveLength(1)
})

test('a board past the page cap shows its first 3000 items and says so in the debug log', async () => {
  const nodes = Array.from({ length: 3100 }, (_, index) =>
    issueNode({ number: index + 1 }),
  )
  const { $, calls, logs } = fakeEngine([boardRoute(nodes)])

  const { cards } = await loadGithub($, CFG)

  expect(calls).toHaveLength(30)
  expect(cards).toHaveLength(3000)
  expect(cards.at(-1)?.number).toBe(3000)
  expect(logs).toEqual([
    'kanban: the board has more than 3000 items; only the first 3000 are shown.',
  ])
})

test("a page of 256-character titles, 20 labels and 5 PRs stays far under the engine's 4 MiB stdout cap", async () => {
  const nodes = Array.from({ length: 100 }, (_, index) =>
    issueNode({
      number: index + 1,
      title: 'T'.repeat(256),
      status: 'In progress',
      labels: Array.from({ length: 20 }, (__, i) => `label-number-${i}`),
      prs: Array.from({ length: 5 }, (__, i) => ({ number: i + 1 })),
    }),
  )
  const reply = boardReply(nodes)

  expect(
    new TextEncoder().encode(reply(['gh', 'api', 'graphql']).stdout ?? '')
      .length,
  ).toBeLessThan(1024 * 1024)
})

test('load names the failing command when gh exits non-zero', async () => {
  const { $ } = fakeEngine([
    {
      match: GRAPHQL,
      reply: {
        exitCode: 1,
        stderr: 'HTTP 401: Bad credentials\nrun gh auth login',
      },
    },
  ])

  const failure = await loadGithub($, CFG).catch((error: unknown) => error)

  expect(failure).toEqual(new Error('HTTP 401: Bad credentials'))
  expect(isRateLimited(failure)).toBe(false)
})

test('load rejects output that is not the board it asked for', async () => {
  for (const stdout of [
    'not json',
    '{"data":{"node":null}}',
    '{"data":{"node":{"items":{"nodes":[],"pageInfo":{"hasNextPage":true}}}}}',
  ]) {
    const { $ } = fakeEngine([{ match: GRAPHQL, reply: { stdout } }])

    await expect(loadGithub($, CFG)).rejects.toThrow(
      'gh returned project items that could not be read',
    )
  }
})

const RATE_LIMIT_ENDPOINT = ['gh', 'api', 'rate_limit']
const EXCEEDED = {
  exitCode: 1,
  stderr: 'gh: API rate limit already exceeded for user ID 2940420.\n',
}

test('a rate-limit error from gh says when the budget resets, read from the endpoint that is free', async () => {
  const { $, calls } = fakeEngine([
    { match: GRAPHQL, reply: EXCEEDED },
    {
      match: RATE_LIMIT_ENDPOINT,
      reply: { stdout: '{"remaining":0,"reset":1792953534}' },
    },
  ])

  const failure = await loadGithub($, CFG).catch((error: unknown) => error)

  expect(isRateLimited(failure)).toBe(true)
  expect(failure).toMatchObject({ resetAt: 1792953534000 })
  expect(calls[1]?.argv).toEqual([
    ...RATE_LIMIT_ENDPOINT,
    '--jq',
    '.resources.graphql | {remaining, reset}',
  ])
})

test('a secondary rate limit, or a reset time that cannot be read, leaves the reset unknown', async () => {
  const secondary = fakeEngine([
    {
      match: GRAPHQL,
      reply: {
        exitCode: 1,
        stderr: 'gh: You have exceeded a secondary rate limit. (HTTP 403)',
      },
    },
    {
      match: RATE_LIMIT_ENDPOINT,
      reply: { stdout: '{"remaining":4000,"reset":1792953534}' },
    },
  ])
  const unreadable = fakeEngine([
    { match: GRAPHQL, reply: EXCEEDED },
    { match: RATE_LIMIT_ENDPOINT, reply: { exitCode: 1, stderr: 'offline' } },
  ])

  for (const { $ } of [secondary, unreadable]) {
    const failure = await loadGithub($, CFG).catch((error: unknown) => error)

    expect(isRateLimited(failure)).toBe(true)
    expect(failure).not.toHaveProperty('resetAt')
  }
  expect(unreadable.logs).toEqual([
    'kanban: could not read when the GitHub rate limit resets: offline',
  ])
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
    { match: ['gh', 'issue', 'close'], reply: {} },
  ])

  await expect(
    moveGithub($, CFG, ghCard({ status: 'In review' }), 'done'),
  ).rejects.toThrow('GraphQL: insufficient scopes')
  expect(calls).toHaveLength(1)
})

const LABEL_LIST = [
  'gh',
  'label',
  'list',
  '--repo',
  'TeeratP/claude-kanban',
  '--search',
  'ai',
  '--limit',
  '100',
  '--json',
  'name',
  '--jq',
  '.[].name',
]
const LABEL_CREATE = [
  'gh',
  'label',
  'create',
  'ai',
  '--repo',
  'TeeratP/claude-kanban',
  '--color',
  '5319e7',
  '--description',
  'agent can do end-to-end',
  '--force',
]
const LABEL_EDIT = [...EDIT, '--add-label', 'ai']
const HAS_AI: Route = {
  match: ['gh', 'label', 'list'],
  reply: { stdout: 'bug\nai\n' },
}
const WRITES: Route[] = [
  { match: ['gh', 'issue', 'reopen'], reply: {} },
  { match: ['gh', 'issue', 'edit'], reply: {} },
  { match: ['gh', 'project', 'item-edit'], reply: {} },
]

test('moving to Claude reports the new status, the ai label and no human label', async () => {
  const { $ } = fakeEngine([HAS_AI, ...WRITES])

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

test('moving to Claude drops the human label in any case and keeps an ai label in any case', async () => {
  const { $, calls } = fakeEngine(WRITES)

  const patch = await moveGithub(
    $,
    CFG,
    ghCard({ status: 'In review', labels: ['AI', 'p1', 'Human'] }),
    'claude',
  )

  expect(patch.labels).toEqual(['AI', 'p1'])
  expect(calls[0]?.argv).toEqual([
    ...EDIT,
    '--add-label',
    'ai',
    '--remove-label',
    'Human',
  ])
})

test('a move to Claude edits the labels before the Status', async () => {
  const { $, calls } = fakeEngine([HAS_AI, ...WRITES])

  await moveGithub($, CFG, ghCard({ labels: [], isClosed: true }), 'claude')

  expect(calls.map(call => call.argv)).toEqual([
    LABEL_LIST,
    REOPEN,
    LABEL_EDIT,
    itemEdit('o-progress'),
  ])
})

test('a label edit that fails leaves the Status as it was', async () => {
  const { $, calls } = fakeEngine([
    HAS_AI,
    {
      match: ['gh', 'issue', 'edit'],
      reply: { exitCode: 1, stderr: "'ai' not found" },
    },
    { match: ['gh', 'project', 'item-edit'], reply: {} },
  ])

  await expect(moveGithub($, CFG, ghCard(), 'claude')).rejects.toThrow(
    "'ai' not found",
  )
  expect(calls.some(call => call.argv[2] === 'item-edit')).toBe(false)
})

test('a repo without an ai label gets it created before the first move to Claude', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'bug\nhuman\n' } },
    { match: ['gh', 'label', 'create'], reply: {} },
    ...WRITES,
  ])

  await moveGithub($, CFG, ghCard({ labels: ['human'] }), 'claude')

  expect(calls.map(call => call.argv)).toEqual([
    LABEL_LIST,
    LABEL_CREATE,
    [...EDIT, '--add-label', 'ai', '--remove-label', 'human'],
    itemEdit('o-progress'),
  ])
})

test('the ai label is created once, however many cards move to Claude', async () => {
  const labels = ['bug']
  const { $, calls } = fakeEngine([
    {
      match: ['gh', 'label', 'list'],
      reply: () => ({ stdout: `${labels.join('\n')}\n` }),
    },
    {
      match: ['gh', 'label', 'create'],
      reply: () => {
        labels.push('ai')

        return {}
      },
    },
    ...WRITES,
  ])

  await moveGithub($, CFG, ghCard({ labels: [] }), 'claude')
  await moveGithub($, CFG, ghCard({ labels: [] }), 'claude')

  expect(calls.filter(call => call.argv[2] === 'create')).toHaveLength(1)
})

test('an ai label that exists under another case is left alone', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'AI\n' } },
    ...WRITES,
  ])

  await moveGithub($, CFG, ghCard({ labels: [] }), 'claude')

  expect(calls.some(call => call.argv[2] === 'create')).toBe(false)
})

test('a card that already has the ai label skips the lookup; other moves never look', async () => {
  const { $, calls } = fakeEngine([{ match: ['gh'], reply: {} }])

  await moveGithub($, CFG, ghCard({ labels: ['ai'] }), 'claude')
  await moveGithub($, CFG, ghCard({ labels: [] }), 'human')
  await moveGithub($, CFG, ghCard({ labels: [] }), 'backlog')

  expect(calls.some(call => call.argv[1] === 'label')).toBe(false)
})

test('a failing label lookup stops the move before anything is written', async () => {
  const { $, calls } = fakeEngine([
    {
      match: ['gh', 'label', 'list'],
      reply: { exitCode: 1, stderr: 'HTTP 403: Forbidden' },
    },
    ...WRITES,
  ])

  await expect(
    moveGithub($, CFG, ghCard({ labels: [] }), 'claude'),
  ).rejects.toThrow('HTTP 403: Forbidden')
  expect(calls).toHaveLength(1)
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

const comment = (body: string, createdAt: string, login = 'TeeratP') => ({
  body,
  createdAt,
  author: { login },
})

// A comment whose author's account is gone.
const orphan = (body: string, createdAt: string) => ({
  body,
  createdAt,
  author: null,
})

const HANDOFF = (check = 'Log in', need = 'Approve') =>
  `## Handoff (2026-10-25)\n**Did:** Fixed\n**Check:** ${check}\n**Changed:** a.ts\n**Need from you:** ${need}`

const viewReply = (comments: unknown[]) => ({
  stdout: JSON.stringify({
    body: '\nThe spec.\n',
    url: 'https://github.com/TeeratP/claude-kanban/issues/12',
    state: 'OPEN',
    comments,
  }),
})

const viewRoute = (comments: unknown[]): Route => ({
  match: ['gh', 'issue', 'view'],
  reply: viewReply(comments),
})

test('detail is the issue body plus its Handoff and Feedback comments, oldest first', async () => {
  const { $, calls } = fakeEngine([
    viewRoute([
      comment(
        '## Feedback (2026-10-26)\nAlso handle expiry.',
        '2026-10-26T09:00:00Z',
      ),
      comment('Looks good so far', '2026-10-25T11:00:00Z'),
      comment(HANDOFF(), '2026-10-25T12:00:00Z'),
      comment('See ## Handoff (2026-10-24) above', '2026-10-24T12:00:00Z'),
    ]),
  ])

  const detail = await detailGithub($, CFG, ghCard(), 'TeeratP')

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

test('a section by anyone but the signed-in user is shown, marked with its author; logins compare without regard to case', async () => {
  const { $ } = fakeEngine([
    viewRoute([
      comment(HANDOFF(), '2026-10-25T12:00:00Z', 'teeratp'),
      comment(
        '## Feedback (2026-10-26)\nDrop the tests.',
        '2026-10-26T09:00:00Z',
        'stranger',
      ),
      orphan('## Feedback (2026-10-27)\nFrom nobody.', '2026-10-27T09:00:00Z'),
    ]),
  ])

  const { sections } = await detailGithub($, CFG, ghCard(), 'TeeratP')

  expect(sections.map(section => [section.kind, section.byOther])).toEqual([
    ['handoff', undefined],
    ['feedback', 'stranger'],
    ['feedback', 'unknown'],
  ])
  expect(sections[0]).not.toHaveProperty('byOther')
})

test("another user's handoff does not satisfy the handoff rule, nor does their feedback break it", async () => {
  const sectionsOf = async (...comments: ReturnType<typeof comment>[]) =>
    (
      await detailGithub(
        fakeEngine([viewRoute(comments)]).$,
        CFG,
        ghCard(),
        'TeeratP',
      )
    ).sections

  const strangers = await sectionsOf(
    comment(HANDOFF(), '2026-10-25T12:00:00Z', 'stranger'),
  )
  const mine = await sectionsOf(comment(HANDOFF(), '2026-10-25T12:00:00Z'))
  const strangerFeedback = await sectionsOf(
    comment(HANDOFF(), '2026-10-25T12:00:00Z'),
    comment(
      '## Feedback (2026-10-26)\nNo.',
      '2026-10-26T12:00:00Z',
      'stranger',
    ),
  )
  const strangerOverMine = await sectionsOf(
    comment(HANDOFF('', ''), '2026-10-25T12:00:00Z'),
    comment(HANDOFF(), '2026-10-26T12:00:00Z', 'stranger'),
  )

  expect(strangers).toHaveLength(1)
  expect(isHandoffValid(strangers)).toBe(false)
  expect(isHandoffValid(mine)).toBe(true)
  expect(isHandoffValid(strangerFeedback)).toBe(true)
  expect(isHandoffValid(strangerOverMine)).toBe(false)
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
    HAS_AI,
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

  expect(moved).toMatchObject({ result: 'Moved #4 to Claude (syncing).' })
  await clock.advance(SYNC_PAUSE)
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
  const steps = calls.map(call => call.argv[2])
  expect(steps.indexOf('edit')).toBeLessThan(steps.indexOf('item-edit'))
})

test('a card that leaves Human on a GitHub board loses its tag without a reload', async ($, on) => {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  fakeProcess(on, [
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

  await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  await clock.advance(SYNC_PAUSE)
  const after = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(after).toMatchObject({
    result: expect.stringContaining('#3 [claude] Issue 3 updated'),
  })
  expect(after).not.toMatchObject({
    result: expect.stringContaining('Issue 3 (review)'),
  })
})

test('a card labelled Human moves to Claude with that label removed, and the next load keeps it out of Human', async ($, on) => {
  const { clock, world } = boot(on, { 'CLAUDE.md': KANBAN })
  // GitHub drops the label only when the edit names it as it is spelled.
  const calls = fakeProcess(on, [
    AUTH,
    REMOTE,
    {
      match: GRAPHQL,
      reply: argv => {
        const isRemoved = calls.some(
          call => call.argv[2] === 'edit' && call.argv.at(-1) === 'Human',
        )
        const labels = isRemoved ? ['ai'] : ['ai', 'Human']

        return boardReply([
          issueNode({ number: 6, status: 'In progress', labels }),
        ])(argv)
      },
    },
    ...WRITES,
  ])
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']
  expect(await $.tool.call({ tool: 'mcp__kanban__kanban_list' })).toMatchObject(
    { result: expect.stringContaining('#6 [human] Issue 6') },
  )

  await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 6,
    to: 'claude',
  })
  await clock.advance(SYNC_PAUSE)
  const before = queries(calls)
  await clock.advance(POLL)

  expect(queries(calls)).toBe(before + 1)
  expect(await $.tool.call({ tool: 'mcp__kanban__kanban_list' })).toMatchObject(
    { result: expect.stringContaining('#6 [claude] Issue 6') },
  )
})

const POLL = 45_000
const MINUTE = 60_000

// A GitHub whose budget the test sets: `isExceeded` answers every query with a
// rate-limit error, otherwise the board comes back with `remaining` points left.
type Budget = { isExceeded: boolean; remaining: number; resetAt: number }

function budgetRoutes(budget: Budget): Route[] {
  return [
    AUTH,
    REMOTE,
    {
      match: GRAPHQL,
      reply: argv =>
        budget.isExceeded
          ? EXCEEDED
          : boardReply(MIXED, {
              cost: 2,
              remaining: budget.remaining,
              resetAt: new Date(budget.resetAt).toISOString(),
            })(argv),
    },
    {
      match: RATE_LIMIT_ENDPOINT,
      reply: () => ({
        stdout: JSON.stringify({
          remaining: budget.isExceeded ? 0 : budget.remaining,
          reset: budget.resetAt / 1000,
        }),
      }),
    },
  ]
}

const queries = (calls: readonly { argv: readonly string[] }[]) =>
  calls.filter(call => call.argv[2] === 'graphql').length

async function toolbar($: Engine) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
  await ui.unmount()

  return text
}

async function openPane($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
}

test('a rate-limit error pauses polling until the budget resets, then polling goes on', async ($, on) => {
  const { clock, world } = boot(on, { 'CLAUDE.md': KANBAN })
  const budget = { isExceeded: true, remaining: 0, resetAt: NOW + 10 * MINUTE }
  const calls = fakeProcess(on, budgetRoutes(budget))
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']

  expect(queries(calls)).toBe(1)
  expect(await toolbar($)).toContain('limit hit · paused 10m')

  // Thirteen ticks reach 9 minutes 45 seconds: none of them asks GitHub.
  for (let tick = 0; tick < 13; tick += 1) await clock.advance(POLL)
  expect(queries(calls)).toBe(1)

  budget.isExceeded = false
  budget.remaining = 4000
  await clock.advance(POLL)

  expect(queries(calls)).toBe(2)
  const recovered = await toolbar($)
  expect(recovered).toContain('updated')
  expect(recovered).not.toContain('rate limit')
  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })
  expect(listed).toMatchObject({
    result: expect.stringContaining('#3 [human] Issue 3 (review)'),
  })

  await clock.advance(POLL)
  expect(queries(calls)).toBe(3)
})

test('a low budget pauses polling until it resets, and the toolbar says so', async ($, on) => {
  const { clock, world } = boot(on, { 'CLAUDE.md': KANBAN })
  const budget = {
    isExceeded: false,
    remaining: 50,
    resetAt: NOW + 20 * MINUTE,
  }
  const calls = fakeProcess(on, budgetRoutes(budget))
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']

  expect(queries(calls)).toBe(1)
  const paused = await toolbar($)
  expect(paused).toContain('limit low · paused 20m')
  expect(paused).not.toContain('updated')
  // The cards loaded: a low budget is not an error.
  expect(await $.tool.call({ tool: 'mcp__kanban__kanban_list' })).toMatchObject(
    { result: expect.stringContaining('#1 [claude] Issue 1') },
  )

  for (let tick = 0; tick < 26; tick += 1) await clock.advance(POLL)
  expect(queries(calls)).toBe(1)

  budget.remaining = 4900
  await clock.advance(POLL)

  expect(queries(calls)).toBe(2)
  expect(await toolbar($)).not.toContain('rate limit')
  await clock.advance(POLL)
  expect(queries(calls)).toBe(3)
})

test('a refresh the person asks for while polling is paused still runs, and warns', async ($, on) => {
  const { clock, toasts, world } = boot(on, { 'CLAUDE.md': KANBAN })
  const budget = {
    isExceeded: false,
    remaining: 50,
    resetAt: NOW + 20 * MINUTE,
  }
  const calls = fakeProcess(on, budgetRoutes(budget))
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']
  expect(toasts).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(queries(calls)).toBe(2)
  expect(toasts).toEqual([
    'GitHub rate limit is low and polling is paused for 20m. Refreshing anyway.',
  ])
  await ui.unmount()
})

test('a limit with no reset time pauses polling for five minutes', async ($, on) => {
  const { clock, world } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = fakeProcess(on, [
    AUTH,
    REMOTE,
    {
      match: GRAPHQL,
      reply: {
        exitCode: 1,
        stderr: 'gh: You have exceeded a secondary rate limit. (HTTP 403)',
      },
    },
    {
      match: RATE_LIMIT_ENDPOINT,
      reply: { stdout: '{"remaining":4000,"reset":1792953534}' },
    },
  ])
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']

  expect(await toolbar($)).toContain('limit hit · paused 5m')
  for (let tick = 0; tick < 6; tick += 1) await clock.advance(POLL)
  expect(queries(calls)).toBe(1)

  await clock.advance(POLL)
  expect(queries(calls)).toBe(2)
})

test('an error that is not a rate limit does not pause polling', async ($, on) => {
  const { clock, world } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = fakeProcess(on, [
    AUTH,
    REMOTE,
    { match: GRAPHQL, reply: { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' } },
  ])
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']

  expect(await toolbar($)).toContain('HTTP 502: Bad Gateway')
  await clock.advance(POLL)
  await clock.advance(POLL)
  expect(queries(calls)).toBe(3)
})

test("a handoff comment from another user does not let a card move to Human, and the signed-in user's does", async ($, on) => {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  let comments = [comment(HANDOFF(), '2026-10-25T12:00:00Z', 'stranger')]
  const calls = fakeProcess(on, [
    AUTH,
    REMOTE,
    ...LOAD_ROUTES,
    { match: ['gh', 'api', 'user'], reply: { stdout: 'TeeratP\n' } },
    { match: ['gh', 'issue', 'view'], reply: () => viewReply(comments) },
    { match: ['gh', 'project', 'item-edit'], reply: {} },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const move = () =>
    $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 4, to: 'human' })

  expect(await move()).toMatchObject({
    deny: expect.stringContaining('Card #4 cannot move to Human yet'),
  })

  comments = [
    ...comments,
    comment(HANDOFF(), '2026-10-26T12:00:00Z', 'TeeratP'),
  ]
  const shown = await $.tool.call({ tool: 'mcp__kanban__kanban_show', card: 4 })
  expect(shown).toMatchObject({
    result: expect.stringContaining(
      '## Handoff (2026-10-25) from @stranger, not counted',
    ),
  })
  expect(await move()).toMatchObject({
    result: 'Moved #4 to Human (syncing).',
  })
  await clock.advance(SYNC_PAUSE)

  // The signed-in login is asked for once, then remembered.
  expect(calls.filter(call => call.argv[2] === 'user')).toHaveLength(1)
})

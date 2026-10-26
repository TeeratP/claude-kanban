import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanCard, KanbanGithub } from '../types'
import { detectBackend, readDiff } from '../hooks/backend'
import {
  appendGithub,
  columnOf,
  createGithub,
  detailGithub,
  diffGithub,
  extraOptions,
  isRateLimited,
  loadGithub,
  moveGithub,
  mentionsBoard,
  parseClaudeMd,
  planMove,
  planPosition,
  withStatusOptions,
} from '../hooks/github'
import { isHandoffValid } from '../hooks/handoff'
import { click } from './board-ui'
import { LOTTO, NAE, PUNN_AGENTS, PUNN_CLAUDE } from './configs'
import { CWD, NOW, PANE, RUN, SYNC_PAUSE, boot } from './fakes'
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
import { GH_VERSION, graphql } from './zero'

// Lines copied from the CLAUDE.md files this plugin is meant to read; punn,
// nae and lotto are in configs.ts.
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
    name: 'punn (AGENTS.md behind a CLAUDE.md import, `project number`, a backticked `Status` field)',
    text: [PUNN_CLAUDE, PUNN_AGENTS].join('\n\n'),
    expected: {
      repo: 'TeeratP/attend-baby',
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
    name: 'agentic-framework (`project **2**`, only a `Ready (To Do) option`)',
    text: NAE,
    expected: {
      repo: 'TeeratP/nae',
      owner: 'TeeratP',
      projectNumber: 2,
      projectId: 'PVT_kwHOAcCsLc4Bbjg2',
      statusFieldId: 'PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY',
      options: { ready: '61e4505c' },
    },
  },
  {
    name: 'lotto (`**Board: "..."**`, `project number`, a backticked `Status` field)',
    text: LOTTO,
    expected: {
      repo: 'TeeratP/thai-lotto',
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

const NUMBER_FORMS = [
  ['Project board: #6 "Car Cast"', 6],
  ["Project: #2 `@TeeratP's Kanban`", 2],
  ['- **Project board:** #5', 5],
  ['**Board: "x"** \u2014 project number `2`, owner `a`', 2],
  ['**Board:** "x" \u2014 project **2**, owner `a`', 2],
  ['Board: x, project 3', 3],
  ['PROJECT NUMBER: 4', 4],
  ['See https://github.com/users/TeeratP/projects/5 for the board', 5],
  ['Board: https://github.com/orgs/acme/projects/12', 12],
  ['Kanban board is #9 (owner `a`)', 9],
] as const

for (const [line, number] of NUMBER_FORMS) {
  test(`parseClaudeMd reads the project number ${number} from: ${line}`, () => {
    expect(parseClaudeMd(`- Repo: \`a/b\`\n${line}\n`)?.projectNumber).toBe(
      number,
    )
  })
}

test('parseClaudeMd takes the project number from the clearest form, wherever it is', () => {
  const text = [
    '- Repo: `a/b`',
    'Phase 2 of the project 8 plan; board notes in #44.',
    '- Project board: #7',
  ].join('\n')

  expect(parseClaudeMd(text)?.projectNumber).toBe(7)
})

test('parseClaudeMd does not take an issue number or a version for the project number', () => {
  const none = [
    '- Repo: `a/b`',
    'Fixed in #12; see issue #3.',
    'Project 2.0 ships with the board redesign.',
    'The project id is `PVT_abc`.',
  ].join('\n')

  expect(parseClaudeMd(none)).toBeNull()
})

test('mentionsBoard sees a board that parseClaudeMd cannot read, and nothing in text that has none', () => {
  expect(mentionsBoard('Board id `PVT_kwHOAcCsLc4Bbjg2`')).toBe(true)
  expect(mentionsBoard('Run `gh project item-list 2 --owner a`')).toBe(true)
  expect(mentionsBoard('The Project board lives on GitHub.')).toBe(true)
  expect(mentionsBoard('See https://github.com/users/a/projects/3')).toBe(true)
  expect(mentionsBoard('# Notes\n\nA job board app. Dashboards.')).toBe(false)
  expect(mentionsBoard('Status field `PVTSSF_abc` only')).toBe(false)
})

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

test('columnOf: a closed issue is Cancelled when GitHub closed it as not planned or a duplicate', () => {
  for (const reason of ['NOT_PLANNED', 'DUPLICATE']) {
    expect(columnOf('Done', none, true, reason)).toEqual({
      column: 'cancelled',
    })
    expect(columnOf('In progress', ['ai'], true, reason)).toEqual({
      column: 'cancelled',
    })
  }
  // Completed, reopened or no reason at all (an old issue): Done.
  for (const reason of ['COMPLETED', 'REOPENED', undefined]) {
    expect(columnOf('Done', none, true, reason)).toEqual({ column: 'done' })
  }
})

test('columnOf: a Status named Cancelled puts the card in Cancelled, closed or not', () => {
  for (const status of ['Cancelled', 'canceled', "Won't do", 'Not planned']) {
    expect(columnOf(status, none, false)).toEqual({ column: 'cancelled' })
    expect(columnOf(status, ['ai'], true)).toEqual({ column: 'cancelled' })
  }
})

test('columnOf: a Status named Suspended, or the suspended label, puts an open issue in Suspended', () => {
  for (const status of [
    'Suspended',
    'On hold',
    'on-hold',
    'Paused',
    'Icebox',
  ]) {
    expect(columnOf(status, none, false)).toEqual({ column: 'suspended' })
  }
  // The label wins over the board's own sections, but not over a closed issue.
  expect(columnOf('In progress', ['ai', 'Suspended'], false)).toEqual({
    column: 'suspended',
  })
  expect(columnOf('Backlog', ['suspended'], false)).toEqual({
    column: 'suspended',
  })
  expect(columnOf('In review', ['suspended'], false)).toEqual({
    column: 'suspended',
  })
  expect(columnOf('Done', ['suspended'], true)).toEqual({ column: 'done' })
})

test('columnOf: Blocked is not Suspended; blocked work waits where it is', () => {
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

test("extraOptions finds Cancelled and Suspended among a board's Status options by name", () => {
  expect(
    extraOptions([
      { id: 'a', name: 'Backlog' },
      { id: 'b', name: 'In progress' },
      { id: 'c', name: 'On hold' },
      { id: 'd', name: 'Cancelled' },
      { id: 'e', name: 'Paused' },
    ]),
  ).toEqual({ cancelled: 'd', suspended: 'c' })
  expect(extraOptions([{ id: 'a', name: 'Backlog' }])).toEqual({})
  expect(extraOptions([])).toEqual({})
})

test('withStatusOptions adds the options found, and is the same object when nothing changed', () => {
  const options = [
    { id: 'x-susp', name: 'Suspended' },
    { id: 'x-canc', name: 'Cancelled' },
  ]
  const added = withStatusOptions(CFG, options)

  expect(added.options).toEqual({
    ...CFG.options,
    cancelled: 'x-canc',
    suspended: 'x-susp',
  })
  expect(withStatusOptions(added, options)).toBe(added)
  // A load that did not report the options says nothing.
  expect(withStatusOptions(added, [])).toBe(added)
  // An option taken off the board leaves the info.
  expect(
    withStatusOptions(added, [{ id: 'x-canc', name: 'Cancelled' }]).options,
  ).toEqual({ ...CFG.options, cancelled: 'x-canc' })
})

test('withStatusOptions also keeps the names the board spells the options with', () => {
  const options = [
    { id: 'x-susp', name: 'On hold' },
    { id: 'x-canc', name: "Won't do" },
  ]
  const added = withStatusOptions(CFG, options)

  expect(added.optionNames).toEqual({
    cancelled: "Won't do",
    suspended: 'On hold',
  })
  expect(withStatusOptions(added, options)).toBe(added)
  // The same option renamed on the board is noticed.
  expect(
    withStatusOptions(added, [
      { id: 'x-susp', name: 'On hold' },
      { id: 'x-canc', name: 'Dropped' },
    ]).optionNames,
  ).toEqual({ cancelled: 'Dropped', suspended: 'On hold' })
  // An option taken off the board takes its name too.
  expect(
    withStatusOptions(added, [{ id: 'x-canc', name: "Won't do" }]).optionNames,
  ).toEqual({ cancelled: "Won't do" })
  expect(
    withStatusOptions(added, [{ id: 'a', name: 'Backlog' }]).optionNames,
  ).toBeUndefined()
})

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
const CLOSE = [
  'gh',
  'issue',
  'close',
  '12',
  '--repo',
  'TeeratP/claude-kanban',
  '--reason',
  'completed',
]
const CLOSE_UNPLANNED = [...CLOSE.slice(0, -1), 'not planned']
const VERIFY = [
  'gh',
  'issue',
  'view',
  '12',
  '--repo',
  'TeeratP/claude-kanban',
  '--json',
  'state,stateReason',
  '--jq',
  '.state + " " + (.stateReason // "")',
]
// A board with Cancelled and Suspended among its Status options.
const CFG_FULL: KanbanGithub = {
  ...CFG,
  options: {
    ...CFG.options,
    cancelled: 'o-cancelled',
    suspended: 'o-suspended',
  },
}
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

test('planMove reopens a closed issue first, for every target but the Done it is in', () => {
  const closed = ghCard({ status: 'Done', isClosed: true })

  expect(planMove(closed, 'human', CFG)).toEqual([REOPEN, itemEdit('o-review')])
  expect(planMove(closed, 'claude', CFG)[0]).toEqual(REOPEN)
  expect(planMove(closed, 'backlog', CFG)).toEqual([
    REOPEN,
    itemEdit('o-backlog'),
  ])
  expect(planMove(closed, 'done', CFG)).not.toContainEqual(REOPEN)
  expect(planMove(closed, 'suspended', CFG_FULL)[0]).toEqual(REOPEN)
})

test('planMove to Cancelled sets the Cancelled option, closes as not planned, then reads the reason back', () => {
  expect(
    planMove(ghCard({ status: 'Backlog' }), 'cancelled', CFG_FULL),
  ).toEqual([itemEdit('o-cancelled'), CLOSE_UNPLANNED, VERIFY])
  // A board with no such option keeps closed items where Done is.
  expect(planMove(ghCard({ status: 'Backlog' }), 'cancelled', CFG)).toEqual([
    itemEdit('o-done'),
    CLOSE_UNPLANNED,
    VERIFY,
  ])
})

test('planMove swaps Done and Cancelled by reopening first: closing a closed issue changes nothing', () => {
  const done = ghCard({
    status: 'Done',
    isClosed: true,
    stateReason: 'COMPLETED',
  })
  const cancelled = ghCard({
    status: 'Cancelled',
    isClosed: true,
    stateReason: 'NOT_PLANNED',
  })

  expect(planMove(done, 'cancelled', CFG_FULL)).toEqual([
    REOPEN,
    itemEdit('o-cancelled'),
    CLOSE_UNPLANNED,
    VERIFY,
  ])
  expect(planMove(cancelled, 'done', CFG_FULL)).toEqual([
    REOPEN,
    itemEdit('o-done'),
    CLOSE,
    VERIFY,
  ])
  // A duplicate is cancelled too. An old issue with no reason counts as Done.
  const duplicate = ghCard({ isClosed: true, stateReason: 'DUPLICATE' })
  expect(planMove(duplicate, 'done', CFG_FULL)[0]).toEqual(REOPEN)
  expect(
    planMove(ghCard({ isClosed: true }), 'cancelled', CFG_FULL)[0],
  ).toEqual(REOPEN)
  // Already closed the way it is asked for: nothing to reopen.
  expect(planMove(cancelled, 'cancelled', CFG_FULL)).not.toContainEqual(REOPEN)
  expect(planMove(done, 'done', CFG_FULL)).not.toContainEqual(REOPEN)
})

test('planMove to Suspended sets the Suspended option; without one the card rests in Backlog under the label', () => {
  expect(
    planMove(ghCard({ status: 'In progress' }), 'suspended', CFG_FULL),
  ).toEqual([itemEdit('o-suspended')])
  expect(
    planMove(
      ghCard({ status: 'In progress', labels: ['ai', 'human'] }),
      'suspended',
      CFG_FULL,
    ),
  ).toEqual([[...EDIT, '--remove-label', 'human'], itemEdit('o-suspended')])

  expect(planMove(ghCard({ status: 'In progress' }), 'suspended', CFG)).toEqual(
    [[...EDIT, '--add-label', 'suspended'], itemEdit('o-backlog')],
  )
  // Already parked in Backlog: only the label.
  expect(planMove(ghCard({ status: 'Backlog' }), 'suspended', CFG)).toEqual([
    [...EDIT, '--add-label', 'suspended'],
  ])
})

test('planMove out of Suspended takes the label off, as the repo spells it', () => {
  const held = ghCard({ status: 'Backlog', labels: ['ai', 'Suspended'] })
  const off = [...EDIT, '--remove-label', 'Suspended']

  expect(planMove(held, 'backlog', CFG)).toEqual([off])
  expect(planMove(held, 'human', CFG)).toEqual([off, itemEdit('o-review')])
  expect(planMove(held, 'done', CFG)).toEqual([
    off,
    itemEdit('o-done'),
    CLOSE,
    VERIFY,
  ])
  expect(planMove(held, 'cancelled', CFG)[0]).toEqual(off)
  expect(planMove(held, 'claude', CFG)[0]).toEqual([
    ...EDIT,
    '--add-label',
    'ai',
    '--remove-label',
    'Suspended',
  ])
  // Out of the label's Suspended into another Status of the board's.
  expect(
    planMove(
      ghCard({ status: 'Suspended', labels: ['ai'] }),
      'backlog',
      CFG_FULL,
    ),
  ).toEqual([itemEdit('o-backlog')])
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
  // The query names no field a card does not show; the only text it reads is the
  // newest comments, for an open question.
  expect(query).toContain('comments(last: 5)')
  expect(query).toContain('viewer { login }')
  expect(query.replace(/comments\(last: 5\) \{[^}]*\}\s*\}/, '')).not.toContain(
    'body',
  )

  // The reply is the one captured before the comments joined the query. Measured live
  // with them (2026-10-26): 3 points a page, 2 without; `gh project item-list` cost about 100.
  expect(load.rateLimit).toEqual({
    cost: 2,
    remaining: 4998,
    resetAt: Date.parse('2026-10-25T18:57:38Z'),
  })
  expect(load.rateLimit?.cost).toBeLessThanOrEqual(3)
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

test('load puts an issue closed as not planned in Cancelled, and one on hold in Suspended', async () => {
  const { $ } = fakeEngine([
    boardRoute([
      issueNode({
        number: 1,
        status: 'Done',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
      }),
      issueNode({
        number: 2,
        status: 'Done',
        state: 'CLOSED',
        stateReason: 'NOT_PLANNED',
      }),
      issueNode({
        number: 3,
        status: 'Done',
        state: 'CLOSED',
        stateReason: 'DUPLICATE',
      }),
      issueNode({
        number: 4,
        status: 'In progress',
        labels: ['ai', 'suspended'],
      }),
      issueNode({ number: 5, status: 'On hold' }),
      issueNode({ number: 6, status: 'Cancelled' }),
      issueNode({
        number: 7,
        status: 'In progress',
        state: 'OPEN',
        stateReason: 'REOPENED',
      }),
    ]),
  ])

  const { cards } = await loadGithub($, CFG)

  expect(cards.map(card => [card.number, card.column])).toEqual([
    [1, 'done'],
    [2, 'cancelled'],
    [3, 'cancelled'],
    [4, 'suspended'],
    [5, 'suspended'],
    [6, 'cancelled'],
    [7, 'claude'],
  ])
  expect(cards[1]).toMatchObject({ isClosed: true, stateReason: 'NOT_PLANNED' })
  expect(cards[6]).toMatchObject({ stateReason: 'REOPENED' })
  expect(cards[3]).not.toHaveProperty('stateReason')
})

test('load asks for the close reason and the Status options, and reports the options of the first page', async () => {
  const options = [
    { id: 'o-1', name: 'Backlog' },
    { id: 'o-2', name: 'Suspended' },
  ]
  const nodes = Array.from({ length: 150 }, (_, index) =>
    issueNode({ number: index + 1 }),
  )
  const { $, calls } = fakeEngine([boardRoute(nodes, undefined, options)])

  const load = await loadGithub($, CFG)

  expect(queryOf(calls[0]?.argv ?? [])).toContain('state stateReason')
  expect(queryOf(calls[0]?.argv ?? [])).toContain('field(name: "Status") {')
  expect(calls).toHaveLength(2)
  expect(load.statusOptions).toEqual(options)
  // A board that reports no field says nothing, and a card load still works.
  const bare = fakeEngine([boardRoute([issueNode({ number: 1 })])])
  expect((await loadGithub(bare.$, CFG)).statusOptions).toEqual([])
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
  // The Status options come with the first page's query only.
  const queries = calls.map(call => queryOf(call.argv))
  expect(queries[0]).toContain('field(name: "Status")')
  expect(queries[1]).not.toContain('field(name: "Status")')
  expect(new Set(queries.slice(1)).size).toBe(1)
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
  expect(patch).toEqual({
    status: 'Done',
    isClosed: true,
    stateReason: 'COMPLETED',
  })
})

test('a close that did not take is an error, not a quiet success', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    { match: ['gh', 'issue', 'view'], reply: { stdout: 'OPEN \n' } },
  ])

  await expect(moveGithub($, CFG, ghCard(), 'done')).rejects.toThrow(
    '#12 is not closed as expected after gh issue close.',
  )
})

// What an older `gh` prints for a JSON field it does not know.
const NO_STATE_REASON = {
  exitCode: 1,
  stderr:
    'Unknown JSON field: "stateReason"\nAvailable fields:\n  state\n  title\n',
}
const VERIFY_STATE = [...VERIFY.slice(0, -3), 'state', '--jq', '.state']

test('a gh that does not know stateReason is read back by the state alone, and a closed issue is taken as closed', async () => {
  for (const [config, to] of [
    [CFG, 'done'],
    [CFG_FULL, 'cancelled'],
  ] as const) {
    const { $, calls } = fakeEngine([
      { match: ['gh', 'project', 'item-edit'], reply: {} },
      { match: ['gh', 'issue', 'close'], reply: {} },
      {
        match: ['gh', 'issue', 'view'],
        reply: argv =>
          argv.includes('state,stateReason')
            ? NO_STATE_REASON
            : { stdout: 'CLOSED\n' },
      },
    ])

    const patch = await moveGithub($, config, ghCard(), to)

    expect(calls.map(call => call.argv.slice(0, 3).join(' '))).toEqual([
      'gh project item-edit',
      'gh issue close',
      'gh issue view',
      'gh issue view',
    ])
    expect(calls[3]?.argv).toEqual(VERIFY_STATE)
    expect(patch).toMatchObject({ isClosed: true })
  }
})

test('a gh that does not know stateReason still fails a close that did not take', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: argv =>
        argv.includes('state,stateReason')
          ? NO_STATE_REASON
          : { stdout: 'OPEN\n' },
    },
  ])

  await expect(moveGithub($, CFG, ghCard(), 'done')).rejects.toThrow(
    '#12 is not closed as expected after gh issue close.',
  )
})

test('a read-back that fails for another reason is still an error', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: { exitCode: 1, stderr: 'HTTP 502: Bad Gateway\n' },
    },
  ])

  await expect(moveGithub($, CFG, ghCard(), 'done')).rejects.toThrow(
    'HTTP 502: Bad Gateway',
  )
  expect(calls).toHaveLength(3)
})

test('moving to Done accepts a close the old API reports with no reason, and refuses one closed as not planned', async () => {
  const closed = (readBack: string) =>
    fakeEngine([
      { match: ['gh', 'project', 'item-edit'], reply: {} },
      { match: ['gh', 'issue', 'close'], reply: {} },
      { match: ['gh', 'issue', 'view'], reply: { stdout: readBack } },
    ]).$

  await expect(
    moveGithub(closed('CLOSED \n'), CFG, ghCard(), 'done'),
  ).resolves.toBeDefined()
  await expect(
    moveGithub(closed('CLOSED COMPLETED\n'), CFG, ghCard(), 'done'),
  ).resolves.toBeDefined()
  await expect(
    moveGithub(closed('CLOSED NOT_PLANNED\n'), CFG, ghCard(), 'done'),
  ).rejects.toThrow('#12 is not closed as expected after gh issue close.')
})

test('moving to Cancelled closes as not planned and verifies the reason, reporting it', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: { stdout: 'CLOSED NOT_PLANNED\n' },
    },
  ])

  const patch = await moveGithub($, CFG_FULL, ghCard(), 'cancelled')

  expect(calls.map(call => call.argv)).toEqual([
    itemEdit('o-cancelled'),
    CLOSE_UNPLANNED,
    VERIFY,
  ])
  expect(patch).toEqual({
    status: 'Cancelled',
    isClosed: true,
    stateReason: 'NOT_PLANNED',
  })
})

test('a Cancelled close that GitHub filed as completed is an error', async () => {
  const { $ } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    { match: ['gh', 'issue', 'view'], reply: { stdout: 'CLOSED COMPLETED\n' } },
  ])

  await expect(moveGithub($, CFG_FULL, ghCard(), 'cancelled')).rejects.toThrow(
    '#12 is not closed as expected after gh issue close.',
  )
})

test('moving a Done card to Cancelled reopens it first and ends closed as not planned', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'issue', 'reopen'], reply: {} },
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: { stdout: 'CLOSED NOT_PLANNED\n' },
    },
  ])

  await moveGithub(
    $,
    CFG_FULL,
    ghCard({ status: 'Done', isClosed: true, stateReason: 'COMPLETED' }),
    'cancelled',
  )

  expect(calls.map(call => call.argv.slice(0, 3).join(' '))).toEqual([
    'gh issue reopen',
    'gh project item-edit',
    'gh issue close',
    'gh issue view',
  ])
})

test('moving to Suspended on a board with the option sets it and reports the card open and still', async () => {
  const { $, calls } = fakeEngine([{ match: ['gh'], reply: {} }])

  const patch = await moveGithub(
    $,
    CFG_FULL,
    ghCard({ status: 'In progress', labels: ['ai'] }),
    'suspended',
  )

  expect(calls.map(call => call.argv)).toEqual([itemEdit('o-suspended')])
  expect(patch).toEqual({ status: 'Suspended', isClosed: false })
})

test("moving to Cancelled or Suspended reports the board's own name for the option", async () => {
  const named: KanbanGithub = {
    ...CFG_FULL,
    optionNames: { cancelled: "Won't do", suspended: 'On hold' },
  }
  const { $ } = fakeEngine([
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'close'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: { stdout: 'CLOSED NOT_PLANNED\n' },
    },
  ])

  expect(await moveGithub($, named, ghCard(), 'cancelled')).toMatchObject({
    status: "Won't do",
  })
  expect(
    await moveGithub($, named, ghCard({ status: 'In progress' }), 'suspended'),
  ).toMatchObject({ status: 'On hold' })
})

test('moving to Suspended with no such option makes the suspended label once, labels the issue and rests it in Backlog', async () => {
  const labels = ['bug']
  const { $, calls } = fakeEngine([
    {
      match: ['gh', 'label', 'list'],
      reply: () => ({ stdout: `${labels.join('\n')}\n` }),
    },
    {
      match: ['gh', 'label', 'create'],
      reply: () => {
        labels.push('suspended')

        return {}
      },
    },
    { match: ['gh', 'issue', 'edit'], reply: {} },
    { match: ['gh', 'project', 'item-edit'], reply: {} },
  ])

  const patch = await moveGithub(
    $,
    CFG,
    ghCard({ status: 'In progress', labels: ['ai', 'human'] }),
    'suspended',
  )
  await moveGithub($, CFG, ghCard({ labels: [] }), 'suspended')

  expect(calls.filter(call => call.argv[2] === 'create')).toHaveLength(1)
  expect(calls[0]?.argv.slice(0, 4)).toEqual(['gh', 'label', 'list', '--repo'])
  expect(calls[0]?.argv).toContain('suspended')
  expect(calls.find(call => call.argv[2] === 'create')?.argv).toContain(
    'suspended',
  )
  expect(calls.find(call => call.argv[2] === 'edit')?.argv).toEqual([
    ...EDIT,
    '--add-label',
    'suspended',
    '--remove-label',
    'human',
  ])
  expect(patch).toEqual({
    status: 'Backlog',
    labels: ['ai', 'suspended'],
    isClosed: false,
  })
})

test('the suspended label is never overwritten: one that exists under another case is left alone', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'bug\nSuspended\n' } },
    { match: ['gh', 'issue', 'edit'], reply: {} },
    { match: ['gh', 'project', 'item-edit'], reply: {} },
  ])

  await moveGithub(
    $,
    CFG,
    ghCard({ labels: [], status: 'In progress' }),
    'suspended',
  )

  expect(calls.some(call => call.argv[2] === 'create')).toBe(false)
  expect(calls.map(call => call.argv[2])).toEqual(['list', 'edit', 'item-edit'])
})

test('moving out of Suspended drops the label and reports the labels the card has now', async () => {
  const { $, calls } = fakeEngine([{ match: ['gh'], reply: {} }])

  const patch = await moveGithub(
    $,
    CFG,
    ghCard({ status: 'Backlog', labels: ['p1', 'suspended'] }),
    'backlog',
  )

  expect(calls.map(call => call.argv)).toEqual([
    [...EDIT, '--remove-label', 'suspended'],
  ])
  expect(patch).toEqual({ labels: ['p1'], isClosed: false })
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
    stateReason: 'REOPENED',
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

test('detect without a CLAUDE.md that names a project looks for a board itself, and finds none to go on', async () => {
  const routes = [GH_VERSION, AUTH, REMOTE, graphql({ linked: [] })]
  const none = fakeEngine(routes)
  const plain = fakeEngine(routes, { 'CLAUDE.md': '# Notes\n' })
  const noBoard = { kind: 'local', noBoardFor: 'TeeratP/claude-kanban' }

  expect(await detectBackend(none.$)).toEqual(noBoard)
  expect(await detectBackend(plain.$)).toEqual(noBoard)
  expect(none.calls.map(call => call.argv[0])).toEqual([
    'git',
    'gh',
    'gh',
    'gh',
    'gh',
  ])
  expect(none.logs).toEqual([])
})

test('detect uses the ids in CLAUDE.md as they stand, after gh auth and the git remote', async () => {
  const { $, calls } = fakeEngine([GH_VERSION, AUTH, REMOTE], {
    'CLAUDE.md': KANBAN,
  })

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
    ['gh', '--version'],
    ['gh', 'auth', 'status'],
    ['git', 'remote', 'get-url', 'origin'],
  ])
})

test('detect falls back to .claude/CLAUDE.md when the root file names no project', async () => {
  const { $ } = fakeEngine([GH_VERSION, AUTH, REMOTE], {
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
      GH_VERSION,
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
  expect(calls.slice(3).map(call => call.argv)).toEqual([
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
      GH_VERSION,
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
      GH_VERSION,
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
      GH_VERSION,
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
      GH_VERSION,
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
      GH_VERSION,
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
                options: [{ id: 'z', name: 'Triage' }],
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
    GH_VERSION,
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
  expect(calls.slice(0, 3).map(call => call.argv)).toEqual([
    ['gh', '--version'],
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

test('through the board: the Status options a load reports are kept with the board, and a card the person suspends goes to the Suspended option', async ($, on) => {
  const { clock, saved } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = fakeProcess(on, [
    GH_VERSION,
    AUTH,
    REMOTE,
    boardRoute(MIXED, undefined, [
      { id: 'o-backlog', name: 'Backlog' },
      { id: 'o-hold', name: 'On hold' },
      { id: 'o-dropped', name: "Won't do" },
    ]),
    { match: ['gh', 'project', 'item-edit'], reply: {} },
    { match: ['gh', 'issue', 'edit'], reply: {} },
    { match: ['gh', 'api', 'user'], reply: { stdout: 'TeeratP\n' } },
    {
      match: ['gh', 'issue', 'view'],
      reply: { stdout: '{"body":"","comments":[],"url":"","state":"OPEN"}' },
    },
  ])
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })

  // The CLAUDE.md names only five options; the board's own are learned from the load.
  const cache = JSON.parse(saved.get(`cache:${CWD}`) ?? '{}') as {
    backend?: KanbanGithub
  }
  expect(cache.backend?.options).toMatchObject({
    suspended: 'o-hold',
    cancelled: 'o-dropped',
    done: '201b4a64',
  })

  await click(ui, 'card:gh:4')
  await ui.press({ key: 'move:suspended' })
  await clock.advance(SYNC_PAUSE)

  expect(
    calls.find(call => call.argv[2] === 'item-edit')?.argv.slice(-2),
  ).toEqual(['--single-select-option-id', 'o-hold'])
  // Issue 4 carries the human label, which leaves with it; no suspended label is made.
  expect(calls.find(call => call.argv[2] === 'edit')?.argv.slice(6)).toEqual([
    '--remove-label',
    'human',
  ])
  expect(calls.some(call => call.argv[1] === 'label')).toBe(false)
  await ui.unmount()
})

test('a card that leaves Human on a GitHub board loses its tag without a reload', async ($, on) => {
  const { clock } = boot(on, { 'CLAUDE.md': KANBAN })
  fakeProcess(on, [
    GH_VERSION,
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
    GH_VERSION,
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
    GH_VERSION,
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
    GH_VERSION,
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
    GH_VERSION,
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
    GH_VERSION,
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

const QUESTION = (text = 'Which branch should this target?') =>
  `## Question (2026-10-25)\n${text}`

test("load tags a Human card whose newest section is the signed-in user's question", async () => {
  const { $ } = fakeEngine([
    boardRoute([
      issueNode({
        number: 1,
        status: 'In review',
        comments: [{ body: QUESTION() }],
      }),
      // Remarks after the question do not close it.
      issueNode({
        number: 2,
        status: 'In review',
        comments: [
          { body: QUESTION('Line one\n\nline two') },
          { body: 'Looking now' },
          { body: 'Same here', author: 'stranger' },
        ],
      }),
      // An answer, or any newer section, does.
      issueNode({
        number: 3,
        status: 'In review',
        comments: [
          { body: QUESTION() },
          { body: '## Answer (2026-10-26)\nmain' },
        ],
      }),
      issueNode({
        number: 4,
        status: 'In review',
        comments: [{ body: QUESTION() }, { body: HANDOFF() }],
      }),
      // Not the signed-in user's, or not in Human: nobody is waiting.
      issueNode({
        number: 5,
        status: 'In review',
        comments: [{ body: QUESTION(), author: 'stranger' }],
      }),
      issueNode({
        number: 6,
        status: 'In progress',
        comments: [{ body: QUESTION() }],
      }),
      issueNode({
        number: 7,
        status: 'In progress',
        labels: ['human'],
        comments: [{ body: QUESTION() }, { body: 'x', author: null }],
      }),
      issueNode({
        number: 8,
        status: 'In review',
        comments: [{ body: QUESTION(), author: null }],
      }),
      issueNode({ number: 9, status: 'In review' }),
      // A recorded check run is not an answer.
      issueNode({
        number: 10,
        status: 'In review',
        comments: [
          { body: QUESTION() },
          { body: '## Check run (2026-10-26)\n**Result:** ✓ Passed' },
        ],
      }),
    ]),
  ])

  const { cards } = await loadGithub($, CFG)

  expect(cards.map(card => [card.number, card.tag, card.question])).toEqual([
    [1, 'question', 'Which branch should this target?'],
    [2, 'question', 'Line one line two'],
    [3, 'review', undefined],
    [4, 'review', undefined],
    [5, 'review', undefined],
    [6, undefined, undefined],
    [7, 'question', 'Which branch should this target?'],
    [8, 'review', undefined],
    [9, 'review', undefined],
    [10, 'question', 'Which branch should this target?'],
  ])
})

test('a viewer the board query did not name counts for no question', async () => {
  const { $ } = fakeEngine([
    {
      match: GRAPHQL,
      reply: argv => {
        const reply = boardReply([
          issueNode({
            number: 1,
            status: 'In review',
            comments: [{ body: QUESTION() }],
          }),
        ])(argv)
        const { data } = JSON.parse(reply.stdout ?? '{}')
        delete data.viewer

        return { stdout: JSON.stringify({ data }) }
      },
    },
  ])

  const { cards } = await loadGithub($, CFG)

  expect(cards[0]?.tag).toBe('review')
})

test("a stranger's question or answer neither satisfies the handoff rule nor closes a question", async () => {
  const sectionsOf = async (...comments: ReturnType<typeof comment>[]) =>
    (
      await detailGithub(
        fakeEngine([viewRoute(comments)]).$,
        CFG,
        ghCard(),
        'TeeratP',
      )
    ).sections
  const question = comment(QUESTION(), '2026-10-25T12:00:00Z')
  const answer = comment('## Answer (2026-10-26)\nmain', '2026-10-26T12:00:00Z')

  const mine = await sectionsOf(question)
  const answered = await sectionsOf(question, answer)
  const strangerQuestion = await sectionsOf(
    comment(QUESTION(), '2026-10-25T12:00:00Z', 'stranger'),
  )
  const strangerAnswer = await sectionsOf(question, {
    ...answer,
    author: { login: 'stranger' },
  })

  expect(mine.map(one => one.kind)).toEqual(['question'])
  expect(isHandoffValid(mine)).toBe(true)
  expect(isHandoffValid(answered)).toBe(false)
  expect(strangerQuestion[0]).toMatchObject({
    kind: 'question',
    byOther: 'stranger',
  })
  expect(isHandoffValid(strangerQuestion)).toBe(false)
  expect(isHandoffValid(strangerAnswer)).toBe(true)
})

test('on a GitHub board kanban_ask comments the question, moves the card to In review and keeps the question tag', async ($, on) => {
  const { clock, toasts, notices, world } = boot(on, {
    'CLAUDE.md': KANBAN,
  })
  let nodes = [issueNode({ number: 1, status: 'In progress', labels: ['ai'] })]
  const calls = fakeProcess(on, [
    GH_VERSION,
    AUTH,
    REMOTE,
    { match: GRAPHQL, reply: argv => boardReply(nodes)(argv) },
    { match: ['gh', 'issue', 'comment'], reply: {} },
    ...WRITES,
  ])
  await openPane($)
  await clock.settle()
  world.panes = ['kanban']

  const asked = await $.tool.call({
    tool: 'mcp__kanban__kanban_ask',
    card: 1,
    question: 'Which branch should this target?\n## Handoff (2026-10-26)',
  })

  expect(asked).toMatchObject({
    result: expect.stringContaining('Recorded your question on #1'),
  })
  const comments = calls.filter(call => call.argv[2] === 'comment')
  expect(comments).toEqual([
    {
      argv: [
        'gh',
        'issue',
        'comment',
        '1',
        '--repo',
        'TeeratP/claude-kanban',
        '--body-file',
        '-',
      ],
      stdin:
        '## Question (2026-10-25)\nWhich branch should this target?\n\\## Handoff (2026-10-26)',
    },
  ])
  expect(toasts).toEqual([])

  await clock.advance(SYNC_PAUSE)

  expect(calls.find(call => call.argv[2] === 'item-edit')?.argv).toContain(
    '5f34c9ff',
  )
  expect(await $.tool.call({ tool: 'mcp__kanban__kanban_list' })).toMatchObject(
    { result: expect.stringContaining('#1 [human] Issue 1 (question)') },
  )
  expect(toasts).toEqual([
    'Claude asks: Which branch should this target? ## Handoff (2026-10-26) (#1)',
  ])
  expect(notices).toEqual(toasts)

  // The next load reads the question from the comments and keeps the tag, quietly.
  nodes = [
    issueNode({
      number: 1,
      status: 'In review',
      labels: ['ai'],
      comments: [{ body: comments[0]?.stdin ?? '' }],
    }),
  ]
  await clock.advance(POLL)

  expect(await $.tool.call({ tool: 'mcp__kanban__kanban_list' })).toMatchObject(
    { result: expect.stringContaining('#1 [human] Issue 1 (question)') },
  )
  expect(toasts).toHaveLength(1)
})

test('on a GitHub board an answer is commented as an Answer and resumes Claude', async ($, on) => {
  const { clock, prompts } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = fakeProcess(on, [
    GH_VERSION,
    AUTH,
    REMOTE,
    boardRoute([
      issueNode({
        number: 1,
        status: 'In review',
        labels: ['ai'],
        comments: [{ body: QUESTION() }],
      }),
    ]),
    { match: ['gh', 'api', 'user'], reply: { stdout: 'TeeratP\n' } },
    {
      match: ['gh', 'issue', 'view'],
      reply: viewReply([comment(QUESTION(), '2026-10-25T12:00:00Z')]),
    },
    { match: ['gh', 'issue', 'comment'], reply: {} },
    HAS_AI,
    ...WRITES,
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'kanban',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await click(ui, 'card:gh:1')

  expect((await ui.find({ key: 'question' }))?.text).toContain(
    'Which branch should this target?',
  )
  expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Answer')

  await ui.input({ key: 'feedback', text: 'Target main' })
  await clock.advance(SYNC_PAUSE)

  expect(calls.find(call => call.argv[2] === 'comment')?.stdin).toBe(
    '## Answer (2026-10-25)\nTarget main',
  )
  expect(calls.find(call => call.argv[2] === 'item-edit')?.argv).toContain(
    'b15c285e',
  )
  expect(prompts).toEqual([
    'Resume kanban card #1: the person answered your question; read it with mcp__kanban__kanban_show and continue.',
  ])
  await ui.unmount()
})

const POSITION_ROUTE: Route = {
  match: ['gh', 'api', 'graphql'],
  reply: { stdout: '{"data":{"updateProjectV2ItemPosition":{}}}' },
}

test('the position command puts the item after the other, or first when there is none', () => {
  const after = ghCard({ id: 'gh:9', number: 9, itemId: 'PVTI_9' })
  const [, , , flag, query, ...fields] = planPosition(ghCard(), after, CFG)

  expect(flag).toBe('-f')
  expect(query).toMatch(
    /^query=mutation\(\$projectId: ID!, \$itemId: ID!, \$afterId: ID\)/,
  )
  expect(query).toContain(
    'updateProjectV2ItemPosition(input: {projectId: $projectId, itemId: $itemId, afterId: $afterId})',
  )
  expect(fields).toEqual([
    '-f',
    'projectId=PVT_proj',
    '-f',
    'itemId=PVTI_12',
    '-f',
    'afterId=PVTI_9',
  ])
  // First: no afterId, which GitHub reads as the top.
  expect(planPosition(ghCard(), null, CFG).slice(5)).toEqual([
    '-f',
    'projectId=PVT_proj',
    '-f',
    'itemId=PVTI_12',
  ])
})

test('a card or a neighbour that is not on the board has no position to set', () => {
  expect(() => planPosition(ghCard({ itemId: undefined }), null, CFG)).toThrow(
    '#12 is not on the project board.',
  )
  expect(() =>
    planPosition(ghCard(), ghCard({ number: 9, itemId: undefined }), CFG),
  ).toThrow('#9 is not on the project board.')
})

test('a reorder within a column runs the position mutation and nothing else', async () => {
  const { $, calls } = fakeEngine([POSITION_ROUTE, ...WRITES])
  const after = ghCard({ id: 'gh:9', number: 9, itemId: 'PVTI_9' })

  const patch = await moveGithub($, CFG, ghCard(), 'backlog', after)

  expect(calls.map(call => call.argv)).toEqual([
    planPosition(ghCard(), after, CFG),
  ])
  expect(patch).toEqual({})
})

test('a move with a place sets the status first and the position last, and moving to Claude still checks the label', async () => {
  const { $, calls } = fakeEngine([HAS_AI, POSITION_ROUTE, ...WRITES])

  const patch = await moveGithub($, CFG, ghCard(), 'claude', null)

  expect(calls.map(call => call.argv.slice(0, 3).join(' '))).toEqual([
    'gh issue edit',
    'gh project item-edit',
    'gh api graphql',
  ])
  expect(calls[2]?.argv).toEqual(planPosition(ghCard(), null, CFG))
  expect(patch).toMatchObject({ status: 'In progress', isClosed: false })

  // With no place asked for, nothing is positioned.
  const plain = fakeEngine([HAS_AI, POSITION_ROUTE, ...WRITES])
  await moveGithub(plain.$, CFG, ghCard(), 'claude')
  expect(plain.calls.some(call => call.argv[1] === 'api')).toBe(false)
})

test('a position GitHub refuses fails the move with its reason', async () => {
  const refused = fakeEngine([
    {
      match: ['gh', 'api', 'graphql'],
      reply: { stdout: '{"errors":[{"message":"Could not resolve item"}]}' },
    },
  ])
  await expect(
    moveGithub(refused.$, CFG, ghCard(), 'backlog', null),
  ).rejects.toThrow(
    "GitHub did not accept the card's new position: Could not resolve item",
  )

  const failed = fakeEngine([
    {
      match: ['gh', 'api', 'graphql'],
      reply: { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' },
    },
  ])
  await expect(
    moveGithub(failed.$, CFG, ghCard(), 'backlog', null),
  ).rejects.toThrow('HTTP 502: Bad Gateway')

  const garbled = fakeEngine([
    { match: ['gh', 'api', 'graphql'], reply: { stdout: 'oops' } },
  ])
  await expect(
    moveGithub(garbled.$, CFG, ghCard(), 'backlog', null),
  ).rejects.toThrow('gh returned the new position that could not be read')
})

test('a position nobody asked for is best effort: the move stands and the reason goes to the debug log', async () => {
  const failures: [string, Route['reply']][] = [
    ['HTTP 502: Bad Gateway', { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' }],
    [
      'Could not resolve item',
      { stdout: '{"errors":[{"message":"Could not resolve item"}]}' },
    ],
    ['the new position that could not be read', { stdout: 'oops' }],
  ]
  const skipped =
    'kanban: left #12 where GitHub put it, its position was not set: '

  for (const [reason, reply] of failures) {
    const { $, calls, logs } = fakeEngine([
      { match: ['gh', 'api', 'graphql'], reply },
      ...WRITES,
    ])

    const patch = await moveGithub($, CFG, ghCard(), 'claude', null, false)

    expect(patch).toMatchObject({ status: 'In progress', isClosed: false })
    expect(calls.map(call => call.argv[1])).toContain('api')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(skipped)
    expect(logs[0]).toContain(reason)
  }

  // An anchor that is not on the board has no position to set; the move still stands.
  const gone = fakeEngine([...WRITES])
  const anchor = ghCard({ id: 'gh:9', number: 9, itemId: undefined })
  expect(
    await moveGithub(gone.$, CFG, ghCard(), 'claude', anchor, false),
  ).toMatchObject({ status: 'In progress' })
  expect(gone.logs).toEqual([`${skipped}#9 is not on the project board.`])

  // A place that was asked for still fails the move.
  const asked = fakeEngine([
    { match: ['gh', 'api', 'graphql'], reply: { exitCode: 1, stderr: 'boom' } },
    ...WRITES,
  ])
  await expect(
    moveGithub(asked.$, CFG, ghCard(), 'claude', null, true),
  ).rejects.toThrow('boom')
  await expect(
    moveGithub(asked.$, CFG, ghCard(), 'claude', null),
  ).rejects.toThrow('boom')
  expect(asked.logs).toEqual([])
})

const ISSUE_URL = 'https://github.com/TeeratP/claude-kanban/issues/30'
const TRIAGE_LIST = [
  'gh',
  'label',
  'list',
  '--repo',
  'TeeratP/claude-kanban',
  '--search',
  'triage',
  '--limit',
  '100',
  '--json',
  'name',
  '--jq',
  '.[].name',
]
const TRIAGE_CREATE = [
  'gh',
  'label',
  'create',
  'triage',
  '--repo',
  'TeeratP/claude-kanban',
  '--color',
  'fbca04',
  '--description',
  'needs grooming',
  '--force',
]
const ISSUE_CREATE = (label = 'triage') => [
  'gh',
  'issue',
  'create',
  '--repo',
  'TeeratP/claude-kanban',
  '--title',
  'Fix the login',
  '--body-file',
  '-',
  '--label',
  label,
]
const ITEM_ADD = [
  'gh',
  'project',
  'item-add',
  '7',
  '--owner',
  'TeeratP',
  '--url',
  ISSUE_URL,
  '--format',
  'json',
]
const NEW_ITEM_EDIT = [
  'gh',
  'project',
  'item-edit',
  '--id',
  'PVTI_new',
  '--project-id',
  'PVT_proj',
  '--field-id',
  'PVTSSF_status',
  '--single-select-option-id',
  'o-backlog',
]
const HAS_TRIAGE: Route = {
  match: ['gh', 'label', 'list'],
  reply: { stdout: 'bug\ntriage\n' },
}
const CREATES: Route[] = [
  { match: ['gh', 'issue', 'create'], reply: { stdout: `${ISSUE_URL}\n` } },
  {
    match: ['gh', 'project', 'item-add'],
    reply: { stdout: JSON.stringify({ id: 'PVTI_new', type: 'Issue' }) },
  },
  { match: ['gh', 'project', 'item-edit'], reply: {} },
]

test('create makes the issue with the triage label and the spec on stdin, adds it to the board, sets Backlog', async () => {
  const { $, calls } = fakeEngine([HAS_TRIAGE, ...CREATES])

  const made = await createGithub(
    $,
    CFG,
    'Fix the login',
    'Users loop.',
    'backlog',
  )

  expect(calls.map(call => call.argv)).toEqual([
    TRIAGE_LIST,
    ISSUE_CREATE(),
    ITEM_ADD,
    NEW_ITEM_EDIT,
  ])
  expect(calls[1]?.stdin).toBe('Users loop.')
  expect(made).toEqual({
    id: 'gh:30',
    number: 30,
    title: 'Fix the login',
    column: 'backlog',
    order: 0,
    createdAt: '2026-10-25T12:00:00.000Z',
    updatedAt: '2026-10-25T12:00:00.000Z',
    itemId: 'PVTI_new',
    status: 'Backlog',
    labels: ['triage'],
    isClosed: false,
    url: ISSUE_URL,
  })
})

test('create makes the triage label first when the repo has none, and never overwrites one it has', async () => {
  const missing = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'bug\nhuman\n' } },
    { match: ['gh', 'label', 'create'], reply: {} },
    ...CREATES,
  ])

  await createGithub(missing.$, CFG, 'Fix the login', '', 'backlog')

  expect(missing.calls.map(call => call.argv).slice(0, 3)).toEqual([
    TRIAGE_LIST,
    TRIAGE_CREATE,
    ISSUE_CREATE(),
  ])

  // Another case counts as the label, and is used as the repo spells it.
  const spelled = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'Triage\n' } },
    ...CREATES,
  ])

  const made = await createGithub(
    spelled.$,
    CFG,
    'Fix the login',
    '',
    'backlog',
  )

  expect(
    spelled.calls.some(
      call => call.argv[2] === 'create' && call.argv[1] === 'label',
    ),
  ).toBe(false)
  expect(spelled.calls[1]?.argv).toEqual(ISSUE_CREATE('Triage'))
  expect(made.labels).toEqual(['Triage'])
})

test('create sends an empty spec as an empty body', async () => {
  const { $, calls } = fakeEngine([HAS_TRIAGE, ...CREATES])

  await createGithub($, CFG, 'Fix the login', '', 'backlog')

  expect(calls[1]).toEqual({ argv: ISSUE_CREATE(), stdin: '' })
})

test('create in Claude then moves the new card as a move to Claude does', async () => {
  const { $, calls } = fakeEngine([
    { match: ['gh', 'label', 'list'], reply: { stdout: 'triage\nai\n' } },
    ...CREATES,
    ...WRITES,
  ])

  const made = await createGithub($, CFG, 'Fix the login', '', 'claude')

  expect(calls.map(call => call.argv.slice(0, 3).join(' '))).toEqual([
    'gh label list',
    'gh issue create',
    'gh project item-add',
    'gh project item-edit',
    'gh label list',
    'gh issue edit',
    'gh project item-edit',
  ])
  expect(calls.at(-2)?.argv).toEqual([
    'gh',
    'issue',
    'edit',
    '30',
    '--repo',
    'TeeratP/claude-kanban',
    '--add-label',
    'ai',
  ])
  expect(calls.at(-1)?.argv.at(-1)).toBe('o-progress')
  expect(made).toMatchObject({
    column: 'claude',
    status: 'In progress',
    labels: ['triage', 'ai'],
  })
})

test('a failure before the issue exists says only what failed, and creates nothing', async () => {
  const { $, calls } = fakeEngine([
    HAS_TRIAGE,
    {
      match: ['gh', 'issue', 'create'],
      reply: { exitCode: 1, stderr: 'HTTP 403: Resource not accessible\nmore' },
    },
    ...CREATES,
  ])

  await expect(
    createGithub($, CFG, 'Fix the login', '', 'backlog'),
  ).rejects.toThrow(new Error('HTTP 403: Resource not accessible'))
  expect(calls.some(call => call.argv[1] === 'project')).toBe(false)
})

test('a failure after the issue exists names the issue', async () => {
  const noBoard = fakeEngine([
    HAS_TRIAGE,
    CREATES[0] as Route,
    {
      match: ['gh', 'project', 'item-add'],
      reply: { exitCode: 1, stderr: 'GraphQL: insufficient scopes' },
    },
  ])

  await expect(
    createGithub(noBoard.$, CFG, 'Fix the login', '', 'backlog'),
  ).rejects.toThrow(
    new Error(
      `Created ${ISSUE_URL} but could not finish adding it: GraphQL: insufficient scopes`,
    ),
  )

  const noStatus = fakeEngine([
    HAS_TRIAGE,
    CREATES[0] as Route,
    CREATES[1] as Route,
    {
      match: ['gh', 'project', 'item-edit'],
      reply: { exitCode: 1, stderr: 'GraphQL: nope' },
    },
  ])

  await expect(
    createGithub(noStatus.$, CFG, 'Fix the login', '', 'backlog'),
  ).rejects.toThrow(`Created ${ISSUE_URL} but could not finish adding it`)

  const odd = fakeEngine([
    HAS_TRIAGE,
    { match: ['gh', 'issue', 'create'], reply: { stdout: 'created it\n' } },
  ])

  await expect(
    createGithub(odd.$, CFG, 'Fix the login', '', 'backlog'),
  ).rejects.toThrow('could not finish adding it')
})

import type { On } from 'claude-code'

import { boardReply, fakeProcess, issueNode } from './fake-gh'
import type { Route } from './fake-gh'
import { GH_VERSION } from './zero'

// A GitHub board: the project the repo's CLAUDE.md names, two issues on it, and
// `gh` answering the commands that make a new one.
export const KANBAN = [
  '## Task tracking',
  '- Repo: `TeeratP/claude-kanban` (public).',
  '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
  '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
].join('\n')

export const ISSUE_URL = 'https://github.com/TeeratP/claude-kanban/issues/30'
export const REPO = 'TeeratP/claude-kanban'
export const PROJECT = 'PVT_kwHOAcCsLc4BorgL'
export const FIELD = 'PVTSSF_lAHOAcCsLc4BorgLzhnKcpg'
export const GRAPHQL = ['gh', 'api', 'graphql']

export const LABEL_LIST = [
  'gh',
  'label',
  'list',
  '--repo',
  REPO,
  '--search',
  'triage',
  '--limit',
  '100',
  '--json',
  'name',
  '--jq',
  '.[].name',
]
export const ISSUE_CREATE = [
  'gh',
  'issue',
  'create',
  '--repo',
  REPO,
  '--title',
  'Fix the login loop',
  '--body-file',
  '-',
  '--label',
  'triage',
]
export const ITEM_ADD = [
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
export const ITEM_EDIT = [
  'gh',
  'project',
  'item-edit',
  '--id',
  'PVTI_30',
  '--project-id',
  PROJECT,
  '--field-id',
  FIELD,
  '--single-select-option-id',
  '1a1cd0bb',
]

// The board GitHub holds: the new issue joins it once `gh issue create` ran.
export function github(
  on: On,
  overrides: Route[] = [],
  hold?: (argv: readonly string[]) => Promise<void> | undefined,
) {
  const nodes = [
    issueNode({ number: 4, status: 'Backlog', title: 'Old idea' }),
    issueNode({ number: 5, status: 'In progress', title: 'In flight' }),
  ]
  const calls = fakeProcess(
    on,
    [
      ...overrides,
      GH_VERSION,
      { match: ['gh', 'auth', 'status'], reply: {} },
      {
        match: ['git', 'remote', 'get-url', 'origin'],
        reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
      },
      { match: GRAPHQL, reply: argv => boardReply(nodes)(argv) },
      {
        match: ['gh', 'label', 'list'],
        reply: { stdout: 'bug\ntriage\nai\n' },
      },
      {
        match: ['gh', 'issue', 'create'],
        reply: () => {
          nodes.push(
            issueNode({
              number: 30,
              title: 'Fix the login loop',
              status: 'Backlog',
              labels: ['triage'],
            }),
          )

          return { stdout: `${ISSUE_URL}\n` }
        },
      },
      {
        match: ['gh', 'project', 'item-add'],
        reply: { stdout: JSON.stringify({ id: 'PVTI_30', type: 'Issue' }) },
      },
      { match: ['gh', 'project', 'item-edit'], reply: {} },
      { match: ['gh', 'issue', 'edit'], reply: {} },
    ],
    hold,
  )

  return calls
}

// The commands that are not board loads, in the order they ran.
export const writes = (calls: readonly { argv: readonly string[] }[]) =>
  calls.map(call => call.argv).filter(argv => argv[1] !== 'api')

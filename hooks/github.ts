import type { EngineInterface } from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
  KanbanTag,
} from '../types'
import { parseSections } from './handoff'
import { errorMessage } from './model'
import { S } from './strings'

type Options = KanbanGithub['options']
type OptionKey = keyof Options

/** What a CLAUDE.md says about its GitHub project; ids it leaves out are looked up. */
export type ParsedClaudeMd = {
  repo: string
  owner: string
  projectNumber: number
  projectId?: string
  statusFieldId?: string
  options: Partial<Options>
}

const REQUIRED_OPTIONS = ['backlog', 'inProgress', 'inReview', 'done'] as const

// Status option names as the board spells them, by lower-case name.
const OPTION_KEY: Record<string, OptionKey> = {
  backlog: 'backlog',
  ready: 'ready',
  'in progress': 'inProgress',
  'in review': 'inReview',
  done: 'done',
}

const STATUS_NAME: Record<OptionKey, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  inProgress: 'In progress',
  inReview: 'In review',
  done: 'Done',
}

const REPO = /\brepo(?:sitory)?\b[^`\n:]{0,12}:\**\s*`([\w.-]+\/[\w.-]+)`/i
const PROJECT_NUMBER = /Project(?: board)?\**:?\**\s*#(\d+)/i
const PROJECT_ID = /\bPVT_[A-Za-z0-9_-]+/
const STATUS_FIELD_ID = /PVTSSF_[A-Za-z0-9_-]+/
const STATUS_LINE = /status field/i
const OPTION = /(Backlog|Ready|In progress|In review|Done)\s*`([0-9a-f]{6,})`/gi

/** Reads the repo and project ids a CLAUDE.md records; null without a repo and project number. */
export function parseClaudeMd(text: string): ParsedClaudeMd | null {
  const repo = REPO.exec(text)?.[1]
  const projectNumber = PROJECT_NUMBER.exec(text)?.[1]
  if (repo === undefined || projectNumber === undefined) return null

  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const withId = lines.findIndex(
    line => STATUS_LINE.test(line) && STATUS_FIELD_ID.test(line),
  )
  const at =
    withId >= 0 ? withId : lines.findIndex(line => STATUS_LINE.test(line))
  const projectId = PROJECT_ID.exec(text)?.[0]
  const statusFieldId =
    at < 0 ? undefined : STATUS_FIELD_ID.exec(lines[at] ?? '')?.[0]

  const options: Partial<Options> = {}
  if (at >= 0) {
    for (const match of lines
      .slice(at, at + 3)
      .join('\n')
      .matchAll(OPTION)) {
      const key = OPTION_KEY[(match[1] ?? '').toLowerCase()]
      if (key !== undefined && options[key] === undefined) {
        options[key] = match[2]
      }
    }
  }

  return {
    repo,
    owner: repo.split('/')[0] ?? repo,
    projectNumber: Number(projectNumber),
    ...(projectId === undefined ? {} : { projectId }),
    ...(statusFieldId === undefined ? {} : { statusFieldId }),
    options,
  }
}

/** The column a GitHub card sits in: who holds the ball, not who owns the issue. */
export function columnOf(
  status: string | undefined,
  labels: readonly string[],
  isClosed: boolean,
): { column: KanbanColumn; tag?: KanbanTag } {
  const name = (status ?? '').trim().toLowerCase()
  if (name === 'done' || isClosed) return { column: 'done' }
  if (name === '' || name === 'backlog' || name === 'ready') {
    return { column: 'backlog' }
  }
  if (name === 'in review') return { column: 'human', tag: 'review' }
  if (labels.some(label => label.toLowerCase() === 'human')) {
    return { column: 'human', tag: 'human' }
  }

  return { column: name === 'in progress' ? 'claude' : 'backlog' }
}

const STATUS_OF: Record<KanbanColumn, string> = {
  backlog: STATUS_NAME.backlog,
  claude: STATUS_NAME.inProgress,
  human: STATUS_NAME.inReview,
  done: STATUS_NAME.done,
}

function isParked(card: KanbanCard): boolean {
  const name = (card.status ?? '').trim().toLowerCase()

  return name === '' || name === 'backlog' || name === 'ready'
}

// Read back after `gh issue close`, which can fail without an error.
const verifyClosed = (issue: string, repo: string) => [
  'gh',
  'issue',
  'view',
  issue,
  '--repo',
  repo,
  '--json',
  'state',
  '--jq',
  '.state',
]

/** The `gh` commands, in order, that make the card's issue and board item say `to`. */
export function planMove(
  card: KanbanCard,
  to: KanbanColumn,
  cfg: KanbanGithub,
): string[][] {
  const { itemId } = card
  if (itemId === undefined) throw new Error(S.noBoardItem(card))

  const issue = String(card.number)
  const itemEdit = (option: string) => [
    'gh',
    'project',
    'item-edit',
    '--id',
    itemId,
    '--project-id',
    cfg.projectId,
    '--field-id',
    cfg.statusFieldId,
    '--single-select-option-id',
    option,
  ]
  const reopen =
    card.isClosed === true && to !== 'done'
      ? [['gh', 'issue', 'reopen', issue, '--repo', cfg.repo]]
      : []

  if (to === 'backlog') {
    return [
      ...reopen,
      ...(isParked(card) ? [] : [itemEdit(cfg.options.backlog)]),
    ]
  }
  if (to === 'human') return [...reopen, itemEdit(cfg.options.inReview)]
  if (to === 'claude') {
    const edit = ['gh', 'issue', 'edit', issue, '--repo', cfg.repo]

    return [
      ...reopen,
      itemEdit(cfg.options.inProgress),
      [
        ...edit,
        '--add-label',
        'ai',
        ...(card.labels?.includes('human') === true
          ? ['--remove-label', 'human']
          : []),
      ],
    ]
  }

  return [
    itemEdit(cfg.options.done),
    ['gh', 'issue', 'close', issue, '--repo', cfg.repo],
    verifyClosed(issue, cfg.repo),
  ]
}

const isVerify = (argv: readonly string[]) =>
  argv[1] === 'issue' && argv[2] === 'view'

const firstLine = (text: string) => text.split('\n')[0]?.trim() ?? ''

/** Runs a command and returns its output; a non-zero exit throws with stderr's first line. */
export async function runCommand(
  $: EngineInterface,
  argv: readonly string[],
  init: { stdin?: string; timeoutMs?: number } = {},
): Promise<string> {
  const run = await $.process.run(argv, { timeoutMs: 30000, ...init })
  if (run.exitCode !== 0) {
    throw new Error(
      firstLine(run.stderr) ||
        S.commandExited(argv[0] ?? 'command', run.exitCode),
    )
  }

  return run.stdout
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(S.ghBadJson(what, errorMessage(error)))
  }
}

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

function listOf(value: unknown, what: string): Rec[] {
  if (!Array.isArray(value)) throw new Error(S.ghBadJson(what, ''))

  return value.filter(isRec)
}

type Item = {
  id: string
  number: number
  title: string
  repository: string
  status?: string
  url?: string
}

/** Board items that are issues, as `gh project item-list --format json` prints them. */
function parseItems(stdout: string): Item[] {
  const data = parseJson(stdout, 'project items')
  const items = listOf(isRec(data) ? data.items : undefined, 'project items')

  return items.flatMap(item => {
    const content = isRec(item.content) ? item.content : {}
    const number = content.number
    if (
      content.type !== 'Issue' ||
      typeof number !== 'number' ||
      typeof item.id !== 'string'
    ) {
      return []
    }
    const status = str(item.status)
    const url = str(content.url)

    return [
      {
        id: item.id,
        number,
        title: str(content.title) || str(item.title),
        repository: str(content.repository),
        ...(status === '' ? {} : { status }),
        ...(url === '' ? {} : { url }),
      },
    ]
  })
}

type Issue = {
  number: number
  labels: string[]
  isClosed: boolean
  createdAt: string
  updatedAt: string
  prNumbers: number[]
}

function isSameRepo(ref: unknown, repo: string): boolean {
  if (!isRec(ref) || !isRec(ref.owner)) return true

  return (
    `${str(ref.owner.login)}/${str(ref.name)}`.toLowerCase() ===
    repo.toLowerCase()
  )
}

/** Issues as `gh issue list --json ...` prints them, by number. */
function parseIssues(stdout: string, repo: string): Map<number, Issue> {
  const issues = new Map<number, Issue>()

  for (const row of listOf(parseJson(stdout, 'issues'), 'issues')) {
    if (typeof row.number !== 'number') continue

    const prs = Array.isArray(row.closedByPullRequestsReferences)
      ? row.closedByPullRequestsReferences.filter(isRec)
      : []
    issues.set(row.number, {
      number: row.number,
      labels: (Array.isArray(row.labels) ? row.labels : [])
        .filter(isRec)
        .map(label => str(label.name))
        .filter(name => name !== ''),
      isClosed: row.state === 'CLOSED',
      createdAt: str(row.createdAt),
      updatedAt: str(row.updatedAt),
      prNumbers: prs.flatMap(pr =>
        typeof pr.number === 'number' && isSameRepo(pr.repository, repo)
          ? [pr.number]
          : [],
      ),
    })
  }

  return issues
}

// Trims each entry to the fields read: bodies, label colors and node ids would
// bury a big board in output and past the 4 MiB the engine keeps.
const ITEM_FILTER =
  '{items: [.items[] | {id, title, status, content: (.content | {type, number, title, url, repository})}]}'
const ISSUE_FIELDS =
  'number,labels,state,updatedAt,createdAt,closedByPullRequestsReferences'
const ISSUE_FILTER =
  '[.[] | {number, state, createdAt, updatedAt, labels: [.labels[] | {name}], closedByPullRequestsReferences: [.closedByPullRequestsReferences[] | {number, repository: (.repository | {name, owner: {login: .owner.login}})}]}]'

// gh pages `--limit` on its own, 100 entries per request, so this is a ceiling
// on a board and not a page size. Trimmed, 3000 entries come to about 1.2 MiB.
const LIST_LIMIT = 3000
// A page takes two to three seconds, so the 30 s default gives out near 1000 items.
const LIST_TIMEOUT_MS = 180000

/** Board cards: the project's issues of this repo, with labels, state and PRs from the issue list. */
export async function loadGithub(
  $: EngineInterface,
  info: KanbanGithub,
): Promise<KanbanCard[]> {
  const init = { timeoutMs: LIST_TIMEOUT_MS }
  const [itemsOut, issuesOut] = await Promise.all([
    runCommand(
      $,
      [
        'gh',
        'project',
        'item-list',
        String(info.projectNumber),
        '--owner',
        info.owner,
        '--format',
        'json',
        '--limit',
        String(LIST_LIMIT),
        '--jq',
        ITEM_FILTER,
      ],
      init,
    ),
    runCommand(
      $,
      [
        'gh',
        'issue',
        'list',
        '--repo',
        info.repo,
        '--state',
        'all',
        '--limit',
        String(LIST_LIMIT),
        '--json',
        ISSUE_FIELDS,
        '--jq',
        ISSUE_FILTER,
      ],
      init,
    ),
  ])
  const issues = parseIssues(issuesOut, info.repo)
  const items = parseItems(itemsOut).filter(
    item => item.repository.toLowerCase() === info.repo.toLowerCase(),
  )

  return items.flatMap((item, order): KanbanCard[] => {
    const issue = issues.get(item.number)
    if (issue === undefined) return []

    const { column, tag } = columnOf(item.status, issue.labels, issue.isClosed)

    return [
      {
        id: `gh:${item.number}`,
        number: item.number,
        title: item.title,
        column,
        order,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        ...(tag === undefined ? {} : { tag }),
        itemId: item.id,
        ...(item.status === undefined ? {} : { status: item.status }),
        labels: issue.labels,
        isClosed: issue.isClosed,
        ...(item.url === undefined ? {} : { url: item.url }),
        ...(issue.prNumbers.length === 0 ? {} : { prNumbers: issue.prNumbers }),
      },
    ]
  })
}

/** Moves the card on GitHub; resolves the fields that changed, throws on the first failing command. */
export async function moveGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  to: KanbanColumn,
): Promise<Partial<KanbanCard>> {
  for (const argv of planMove(card, to, info)) {
    const out = await runCommand($, argv)
    if (isVerify(argv) && out.trim() !== 'CLOSED') {
      throw new Error(S.closeNotVerified(card))
    }
  }
  const labels = card.labels ?? []

  return {
    ...(to === 'backlog' && isParked(card) ? {} : { status: STATUS_OF[to] }),
    ...(to === 'claude'
      ? {
          labels: [
            ...labels.filter(label => label !== 'human'),
            ...(labels.includes('ai') ? [] : ['ai']),
          ],
        }
      : {}),
    ...(to === 'human' ? { tag: 'review' as const } : {}),
    isClosed: to === 'done',
  }
}

/** Adds a Handoff or Feedback section to the issue as a comment. */
export async function appendGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  await runCommand(
    $,
    [
      'gh',
      'issue',
      'comment',
      String(card.number),
      '--repo',
      info.repo,
      '--body-file',
      '-',
    ],
    { stdin: markdown },
  )
}

const SECTION_COMMENT = /^## (?:Handoff|Feedback) \(/

/** The issue body as the spec, and its Handoff / Feedback comments as sections, oldest first. */
export async function detailGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  const out = await runCommand($, [
    'gh',
    'issue',
    'view',
    String(card.number),
    '--repo',
    info.repo,
    '--json',
    'body,comments,url,state',
  ])
  const issue = parseJson(out, 'issue')
  if (!isRec(issue)) throw new Error(S.ghBadJson('issue', ''))

  const comments = (Array.isArray(issue.comments) ? issue.comments : [])
    .filter(isRec)
    .map(comment => ({
      body: str(comment.body).trim(),
      createdAt: str(comment.createdAt),
    }))
    .filter(comment => SECTION_COMMENT.test(comment.body))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    body: str(issue.body).trim(),
    sections: comments.flatMap(comment => parseSections(comment.body).sections),
  }
}

/** The diff of the card's first linked pull request; undefined when it has none. */
export async function diffGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
): Promise<string | undefined> {
  const pr = card.prNumbers?.[0]
  if (pr === undefined) return undefined

  return runCommand($, ['gh', 'pr', 'diff', String(pr), '--repo', info.repo])
}

type Field = {
  id: string
  name: string
  options: { id: string; name: string }[]
}

function parseFields(stdout: string): Field[] {
  const data = parseJson(stdout, 'project fields')

  return listOf(
    isRec(data) ? data.fields : undefined,
    'project fields',
  ).flatMap(field => {
    if (typeof field.id !== 'string') return []
    const options = (Array.isArray(field.options) ? field.options : [])
      .filter(isRec)
      .flatMap(option =>
        typeof option.id === 'string'
          ? [{ id: option.id, name: str(option.name) }]
          : [],
      )

    return [{ id: field.id, name: str(field.name), options }]
  })
}

const need = (id: string | undefined, name: string): string => {
  if (id === undefined) throw new Error(S.missingStatusOption(name))

  return id
}

/** Fills in what the CLAUDE.md left out from `gh project field-list` and `gh project view`. */
export async function resolveGithub(
  $: EngineInterface,
  found: ParsedClaudeMd,
): Promise<KanbanGithub> {
  const { owner, repo, projectNumber } = found
  const number = String(projectNumber)
  let { projectId, statusFieldId } = found
  const options: Partial<Options> = { ...found.options }

  if (
    statusFieldId === undefined ||
    REQUIRED_OPTIONS.some(key => options[key] === undefined)
  ) {
    const fields = parseFields(
      await runCommand($, [
        'gh',
        'project',
        'field-list',
        number,
        '--owner',
        owner,
        '--format',
        'json',
      ]),
    )
    const status = fields.find(field => field.name === 'Status')
    if (status === undefined) throw new Error(S.noStatusField(number))

    statusFieldId ??= status.id
    for (const option of status.options) {
      const key = OPTION_KEY[option.name.toLowerCase()]
      if (key !== undefined) options[key] ??= option.id
    }
  }
  projectId ??= (
    await runCommand($, [
      'gh',
      'project',
      'view',
      number,
      '--owner',
      owner,
      '--format',
      'json',
      '--jq',
      '.id',
    ])
  ).trim()

  return {
    kind: 'github',
    repo,
    owner,
    projectNumber,
    projectId,
    statusFieldId: need(statusFieldId, 'Status'),
    options: {
      backlog: need(options.backlog, STATUS_NAME.backlog),
      ...(options.ready === undefined ? {} : { ready: options.ready }),
      inProgress: need(options.inProgress, STATUS_NAME.inProgress),
      inReview: need(options.inReview, STATUS_NAME.inReview),
      done: need(options.done, STATUS_NAME.done),
    },
  }
}

import type { EngineInterface } from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
  KanbanTag,
} from '../types'
import { readViewer, updateViewer } from './atoms'
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

const AI_LABEL = 'ai'

const isHumanLabel = (label: string) => label.toLowerCase() === 'human'
const isAiLabel = (label: string) => label.toLowerCase() === AI_LABEL

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
  if (labels.some(isHumanLabel)) return { column: 'human', tag: 'human' }

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
    const human = card.labels?.find(isHumanLabel)

    // The label first: a failure there leaves the Status as it was.
    return [
      ...reopen,
      [
        ...edit,
        '--add-label',
        AI_LABEL,
        ...(human === undefined ? [] : ['--remove-label', human]),
      ],
      itemEdit(cfg.options.inProgress),
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

/** GitHub's GraphQL budget after a query; `resetAt` is epoch milliseconds. */
export type RateLimit = { cost: number; remaining: number; resetAt: number }

/** What a load found: the cards, and the rate limit as the last page reported it. */
export type GithubLoad = { cards: KanbanCard[]; rateLimit?: RateLimit }

type RateLimitedError = Error & { isRateLimited: true; resetAt?: number }

function rateLimited(
  cause: unknown,
  resetAt: number | undefined,
): RateLimitedError {
  return Object.assign(new Error(errorMessage(cause)), {
    isRateLimited: true as const,
    ...(resetAt === undefined ? {} : { resetAt }),
  })
}

/** Whether a load failed because GitHub's rate limit is used up; `resetAt` is set when known. */
export function isRateLimited(error: unknown): error is RateLimitedError {
  return error instanceof Error && 'isRateLimited' in error
}

const PAGE_SIZE = 100

// One query per page of the project's items: the Status value and, for the
// issues, only the fields a card shows. Measured at 2 points a page (the cost
// follows the `first` values asked for), where `gh project item-list` took about 100.
const BOARD_QUERY = `query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
          }
          content {
            ... on Issue {
              number title url state createdAt updatedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              closedByPullRequestsReferences(first: 5) {
                nodes { number repository { nameWithOwner } }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`

// A board larger than MAX_PAGES pages shows its first 3000 items.
const MAX_PAGES = 30
const RATE_LIMITED = /rate limit/i

type Entry = {
  id: string
  number: number
  title: string
  url: string
  status?: string
  labels: string[]
  isClosed: boolean
  createdAt: string
  updatedAt: string
  prNumbers: number[]
}

type Page = { entries: Entry[]; next?: string; rateLimit?: RateLimit }

const isRepo = (ref: unknown, repo: string) =>
  isRec(ref) && str(ref.nameWithOwner).toLowerCase() === repo.toLowerCase()

const nodesOf = (connection: unknown) =>
  isRec(connection) && Array.isArray(connection.nodes)
    ? connection.nodes.filter(isRec)
    : []

function parseRateLimit(value: unknown): RateLimit | undefined {
  if (!isRec(value)) return undefined
  const { cost, remaining } = value
  const resetAt = Date.parse(str(value.resetAt))
  if (typeof cost !== 'number' || typeof remaining !== 'number') {
    return undefined
  }

  return Number.isNaN(resetAt) ? undefined : { cost, remaining, resetAt }
}

/** One page of the board query: this repo's issues on the board, and the cursor of the next page. */
function parsePage(stdout: string, repo: string): Page {
  const data = parseJson(stdout, 'project items')
  const root = isRec(data) && isRec(data.data) ? data.data : {}
  const node = isRec(root.node) ? root.node : {}
  if (!isRec(node.items)) throw new Error(S.ghBadJson('project items', ''))

  const { endCursor, hasNextPage } = isRec(node.items.pageInfo)
    ? node.items.pageInfo
    : { endCursor: undefined, hasNextPage: false }
  if (hasNextPage === true && str(endCursor) === '') {
    throw new Error(S.ghBadJson('project items', ''))
  }
  const rateLimit = parseRateLimit(root.rateLimit)

  const entries = listOf(node.items.nodes, 'project items').flatMap(item => {
    const content = isRec(item.content) ? item.content : {}
    // Pull requests and drafts come back without issue fields; other repos' issues are not this board's cards.
    if (
      typeof content.number !== 'number' ||
      typeof item.id !== 'string' ||
      !isRepo(content.repository, repo)
    ) {
      return []
    }
    const status = isRec(item.fieldValueByName)
      ? str(item.fieldValueByName.name)
      : ''

    return [
      {
        id: item.id,
        number: content.number,
        title: str(content.title),
        url: str(content.url),
        ...(status === '' ? {} : { status }),
        labels: nodesOf(content.labels)
          .map(label => str(label.name))
          .filter(name => name !== ''),
        isClosed: content.state === 'CLOSED',
        createdAt: str(content.createdAt),
        updatedAt: str(content.updatedAt),
        prNumbers: nodesOf(content.closedByPullRequestsReferences).flatMap(
          pr =>
            typeof pr.number === 'number' && isRepo(pr.repository, repo)
              ? [pr.number]
              : [],
        ),
      },
    ]
  })

  return {
    entries,
    ...(hasNextPage === true ? { next: str(endCursor) } : {}),
    ...(rateLimit === undefined ? {} : { rateLimit }),
  }
}

// The graphql budget's reset time, from the endpoint that does not count against it.
async function resetOf($: EngineInterface): Promise<number | undefined> {
  try {
    const limit = parseJson(
      await runCommand($, [
        'gh',
        'api',
        'rate_limit',
        '--jq',
        '.resources.graphql | {remaining, reset}',
      ]),
      'rate limit',
    )

    // A budget with points left means a secondary limit, which has no reset time.
    return isRec(limit) &&
      limit.remaining === 0 &&
      typeof limit.reset === 'number'
      ? limit.reset * 1000
      : undefined
  } catch (error) {
    $.ui.log(S.rateLimitLookupFailed(errorMessage(error)), { to: 'debug' })

    return undefined
  }
}

async function runPage(
  $: EngineInterface,
  info: KanbanGithub,
  cursor: string | undefined,
): Promise<string> {
  try {
    return await runCommand($, [
      'gh',
      'api',
      'graphql',
      '-f',
      `query=${BOARD_QUERY}`,
      '-F',
      `projectId=${info.projectId}`,
      ...(cursor === undefined ? [] : ['-f', `cursor=${cursor}`]),
    ])
  } catch (error) {
    if (!RATE_LIMITED.test(errorMessage(error))) throw error

    throw rateLimited(error, await resetOf($))
  }
}

/**
 * Board cards: the project's issues of this repo, in one query per 100 items.
 * Throws a rate-limited error (see `isRateLimited`) when GitHub's budget is used up.
 */
export async function loadGithub(
  $: EngineInterface,
  info: KanbanGithub,
): Promise<GithubLoad> {
  const entries: Entry[] = []
  let rateLimit: RateLimit | undefined
  let cursor: string | undefined

  for (let pages = 1; ; pages += 1) {
    const page = parsePage(await runPage($, info, cursor), info.repo)
    entries.push(...page.entries)
    rateLimit = page.rateLimit ?? rateLimit
    if (page.next === undefined) break
    if (pages === MAX_PAGES) {
      $.ui.log(S.pageLimitReached(MAX_PAGES * PAGE_SIZE), { to: 'debug' })
      break
    }
    cursor = page.next
  }

  const cards = entries.map((entry, order): KanbanCard => {
    const { column, tag } = columnOf(entry.status, entry.labels, entry.isClosed)

    return {
      id: `gh:${entry.number}`,
      number: entry.number,
      title: entry.title,
      column,
      order,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(tag === undefined ? {} : { tag }),
      itemId: entry.id,
      ...(entry.status === undefined ? {} : { status: entry.status }),
      labels: entry.labels,
      isClosed: entry.isClosed,
      ...(entry.url === '' ? {} : { url: entry.url }),
      ...(entry.prNumbers.length === 0 ? {} : { prNumbers: entry.prNumbers }),
    }
  })

  return { cards, ...(rateLimit === undefined ? {} : { rateLimit }) }
}

// Labels are repo-wide and not case-sensitive, so any spelling of `ai` will do.
async function ensureAiLabel(
  $: EngineInterface,
  info: KanbanGithub,
): Promise<void> {
  const names = await runCommand($, [
    'gh',
    'label',
    'list',
    '--repo',
    info.repo,
    '--search',
    AI_LABEL,
    '--limit',
    '100',
    '--json',
    'name',
    '--jq',
    '.[].name',
  ])
  if (names.split('\n').some(name => isAiLabel(name.trim()))) return

  await runCommand($, [
    'gh',
    'label',
    'create',
    AI_LABEL,
    '--repo',
    info.repo,
    '--color',
    '5319e7',
    '--description',
    S.aiLabelDescription,
    '--force',
  ])
}

/** Moves the card on GitHub; resolves the fields that changed, throws on the first failing command. */
export async function moveGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  to: KanbanColumn,
): Promise<Partial<KanbanCard>> {
  const labels = card.labels ?? []
  // `--add-label ai` fails on a repo that has no such label.
  if (to === 'claude' && !labels.some(isAiLabel)) await ensureAiLabel($, info)

  for (const argv of planMove(card, to, info)) {
    const out = await runCommand($, argv)
    if (isVerify(argv) && out.trim() !== 'CLOSED') {
      throw new Error(S.closeNotVerified(card))
    }
  }

  return {
    ...(to === 'backlog' && isParked(card) ? {} : { status: STATUS_OF[to] }),
    ...(to === 'claude'
      ? {
          labels: [
            ...labels.filter(label => !isHumanLabel(label)),
            ...(labels.some(isAiLabel) ? [] : [AI_LABEL]),
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

/** The signed-in GitHub login, asked for once per session. */
export async function viewerLogin($: EngineInterface): Promise<string> {
  const known = await readViewer($)
  if (known !== '') return known

  const login = (
    await runCommand($, ['gh', 'api', 'user', '--jq', '.login'])
  ).trim()
  if (login === '') throw new Error(S.ghBadJson('the signed-in user', ''))

  return updateViewer($, () => login)
}

/**
 * The issue body as the spec, and its Handoff / Feedback comments as sections, oldest
 * first. A section written by anyone but `viewer` carries `byOther`: anyone can comment
 * on a public repo, so only the signed-in user's sections count.
 */
export async function detailGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  viewer: string,
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
      author: isRec(comment.author) ? str(comment.author.login) : '',
    }))
    .filter(comment => SECTION_COMMENT.test(comment.body))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    body: str(issue.body).trim(),
    sections: comments.flatMap(comment => {
      const { sections } = parseSections(comment.body)
      if (comment.author.toLowerCase() === viewer.toLowerCase()) return sections

      const byOther = comment.author === '' ? S.unknownAuthor : comment.author

      return sections.map(section => ({ ...section, byOther }))
    }),
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

import type { EngineInterface } from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
  KanbanSection,
  KanbanTag,
} from '../types'
import { readViewer, updateViewer } from './atoms'
import { gistOf, parseSections, questionOf } from './handoff'
import { errorMessage } from './model'
import { S } from './strings'

type Options = KanbanGithub['options']
type OptionKey = keyof Options

/** What a CLAUDE.md or AGENTS.md says about its GitHub project; ids it leaves out are looked up. */
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
// The project number, most explicit form first: a project's URL, then
// `Project board: #7`, then `project number `2``, `project **2**` and
// `project 2`, and last a `#N` shortly after the word project or board.
const PROJECT_NUMBER = [
  /\bgithub\.com\/(?:users|orgs)\/[\w.-]+\/projects\/(\d+)/i,
  /\bProject(?: board)?\**:?\**\s*#(\d+)/i,
  /\bproject(?: board| number)?[^\w\n#]{0,6}(\d+)\b(?!\.\d)/i,
  /\b(?:project|board)\b[^\n#]{0,40}#(\d+)\b/i,
]
const PROJECT_ID = /\bPVT_[A-Za-z0-9_-]+/
const STATUS_FIELD_ID = /PVTSSF_[A-Za-z0-9_-]+/
const STATUS_LINE = /\bstatus\W{0,3}field/i
// A board is mentioned even if the repo and number cannot be read.
const BOARD_MENTION =
  /\bPVT_[A-Za-z0-9_-]+|\bgh project\b|\bproject board\b|\bgithub\.com\/(?:users|orgs)\/[\w.-]+\/projects\/\d+/i
// `Ready `61e4505c``, also `Ready (To Do) option `61e4505c``.
const OPTION =
  /(Backlog|Ready|In progress|In review|Done)(?:\s*\([^)\n]*\))?(?:\s+option)?\s*`([0-9a-f]{6,})`/gi

/** Whether a CLAUDE.md or AGENTS.md text names a GitHub project board, understood or not. */
export function mentionsBoard(text: string): boolean {
  return BOARD_MENTION.test(text)
}

/** Reads the repo and project ids a CLAUDE.md or AGENTS.md records; null without a repo and project number. */
export function parseClaudeMd(text: string): ParsedClaudeMd | null {
  const repo = REPO.exec(text)?.[1]
  const projectNumber = PROJECT_NUMBER.map(
    pattern => pattern.exec(text)?.[1],
  ).find(found => found !== undefined)
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

// Sets the item's Status to the option with this id.
const statusEdit = (itemId: string, cfg: KanbanGithub, option: string) => [
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

/** The `gh` commands, in order, that make the card's issue and board item say `to`. */
export function planMove(
  card: KanbanCard,
  to: KanbanColumn,
  cfg: KanbanGithub,
): string[][] {
  const { itemId } = card
  if (itemId === undefined) throw new Error(S.noBoardItem(card))

  const issue = String(card.number)
  const itemEdit = (option: string) => statusEdit(itemId, cfg, option)
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

const POSITION_MUTATION = `mutation($projectId: ID!, $itemId: ID!, $afterId: ID) {
  updateProjectV2ItemPosition(input: {projectId: $projectId, itemId: $itemId, afterId: $afterId}) {
    clientMutationId
  }
}`

/** The `gh` command that puts the card's board item right after `after`'s, or first when null. */
export function planPosition(
  card: KanbanCard,
  after: KanbanCard | null,
  cfg: KanbanGithub,
): string[] {
  if (card.itemId === undefined) throw new Error(S.noBoardItem(card))
  if (after !== null && after.itemId === undefined) {
    throw new Error(S.noBoardItem(after))
  }

  return [
    'gh',
    'api',
    'graphql',
    '-f',
    `query=${POSITION_MUTATION}`,
    '-f',
    `projectId=${cfg.projectId}`,
    '-f',
    `itemId=${card.itemId}`,
    ...(after === null ? [] : ['-f', `afterId=${after.itemId}`]),
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
// Enough to see past a few remarks to the newest section.
const COMMENTS_SEEN = 5

// One query per page of the project's items: the Status value and, for the
// issues, only the fields a card shows, plus the newest comments to tell an open
// question from the rest. Measured at 3 points a page (the cost follows the
// connections asked for: 2 without the comments), where `gh project item-list`
// took about 100.
const BOARD_QUERY = `query($projectId: ID!, $cursor: String) {
  viewer { login }
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
              comments(last: ${COMMENTS_SEEN}) {
                nodes { body createdAt author { login } }
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
  question?: string
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
  const viewer = isRec(root.viewer) ? str(root.viewer.login) : ''

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
    const ask = questionOf(
      sectionsOf(nodesOf(content.comments).map(commentOf), viewer),
    )

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
        ...(ask === undefined ? {} : { question: gistOf(ask.text) }),
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
    // Only a card in Human is waiting on the person for an answer.
    const question = column === 'human' ? entry.question : undefined
    const shown = question === undefined ? tag : 'question'

    return {
      id: `gh:${entry.number}`,
      number: entry.number,
      title: entry.title,
      column,
      order,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(shown === undefined ? {} : { tag: shown }),
      ...(question === undefined ? {} : { question }),
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

type LabelSpec = { name: string; color: string; description: string }

const AI: LabelSpec = {
  name: AI_LABEL,
  color: '5319e7',
  description: S.aiLabelDescription,
}
// The user's marker for an issue still to be groomed.
const TRIAGE: LabelSpec = {
  name: 'triage',
  color: 'fbca04',
  description: S.triageLabelDescription,
}

// Labels are repo-wide and not case-sensitive, so any spelling of the name will do.
// Resolves the label as the repo spells it; one that exists is never overwritten.
async function ensureLabel(
  $: EngineInterface,
  info: KanbanGithub,
  label: LabelSpec,
): Promise<string> {
  const names = await runCommand($, [
    'gh',
    'label',
    'list',
    '--repo',
    info.repo,
    '--search',
    label.name,
    '--limit',
    '100',
    '--json',
    'name',
    '--jq',
    '.[].name',
  ])
  const found = names
    .split('\n')
    .map(name => name.trim())
    .find(name => name.toLowerCase() === label.name)
  if (found !== undefined) return found

  await runCommand($, [
    'gh',
    'label',
    'create',
    label.name,
    '--repo',
    info.repo,
    '--color',
    label.color,
    '--description',
    label.description,
    '--force',
  ])

  return label.name
}

// Puts the card's board item after `after`'s (first when null); throws when GitHub refuses.
async function setPosition(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  after: KanbanCard | null,
): Promise<void> {
  const out = await runCommand($, planPosition(card, after, info))
  const reply = parseJson(out, 'the new position')
  const [failure] =
    isRec(reply) && Array.isArray(reply.errors) ? reply.errors : []
  if (failure !== undefined) {
    throw new Error(S.positionFailed(str(isRec(failure) && failure.message)))
  }
}

/**
 * Moves the card on GitHub, and puts it after the card `after` (first when
 * null) when one is given; resolves the fields that changed, throws on the
 * first failing command. A card moved within its own column is only placed.
 * With `placeAsked` false the place is only the default: GitHub has the move
 * by then, so a position that fails is logged and the move stands.
 */
export async function moveGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  to: KanbanColumn,
  after?: KanbanCard | null,
  placeAsked = true,
): Promise<Partial<KanbanCard>> {
  const labels = card.labels ?? []
  const isReorder = card.column === to && after !== undefined
  // `--add-label ai` fails on a repo that has no such label.
  if (!isReorder && to === 'claude' && !labels.some(isAiLabel)) {
    await ensureLabel($, info, AI)
  }

  for (const argv of isReorder ? [] : planMove(card, to, info)) {
    const out = await runCommand($, argv)
    if (isVerify(argv) && out.trim() !== 'CLOSED') {
      throw new Error(S.closeNotVerified(card))
    }
  }
  if (after !== undefined) {
    try {
      await setPosition($, info, card, after)
    } catch (error) {
      if (placeAsked) throw error

      $.ui.log(S.positionSkipped(card, errorMessage(error)), { to: 'debug' })
    }
  }
  if (isReorder) return {}

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
    ...(to === 'human'
      ? {
          tag:
            card.tag === 'question'
              ? ('question' as const)
              : ('review' as const),
        }
      : {}),
    isClosed: to === 'done',
  }
}

const ISSUE_URL = /\/issues\/(\d+)$/

/** Puts the issue on the project board; resolves the new item's id. */
async function addToBoard(
  $: EngineInterface,
  info: KanbanGithub,
  url: string,
): Promise<string> {
  const item = parseJson(
    await runCommand($, [
      'gh',
      'project',
      'item-add',
      String(info.projectNumber),
      '--owner',
      info.owner,
      '--url',
      url,
      '--format',
      'json',
    ]),
    'the new board item',
  )
  const id = isRec(item) ? str(item.id) : ''
  if (id === '') throw new Error(S.ghBadJson('the new board item', ''))

  return id
}

/**
 * Creates an issue labeled `triage`, puts it on the board in Backlog and, for any
 * other column, moves it there. Throws on the first failing command; an issue
 * already created stays, and the error names it.
 */
export async function createGithub(
  $: EngineInterface,
  info: KanbanGithub,
  title: string,
  spec: string,
  column: KanbanColumn,
): Promise<KanbanCard> {
  const triage = await ensureLabel($, info, TRIAGE)
  const out = await runCommand(
    $,
    [
      'gh',
      'issue',
      'create',
      '--repo',
      info.repo,
      '--title',
      title,
      '--body-file',
      '-',
      '--label',
      triage,
    ],
    { stdin: spec },
  )
  const url = out.trim().split('\n').pop()?.trim() ?? ''

  try {
    const number = ISSUE_URL.exec(url)?.[1]
    if (number === undefined) throw new Error(S.ghBadJson('the new issue', ''))

    const itemId = await addToBoard($, info, url)
    await runCommand($, statusEdit(itemId, info, info.options.backlog))
    const now = new Date(await $.clock.now()).toISOString()
    const card: KanbanCard = {
      id: `gh:${number}`,
      number: Number(number),
      title,
      column: 'backlog',
      order: 0,
      createdAt: now,
      updatedAt: now,
      itemId,
      status: STATUS_NAME.backlog,
      labels: [triage],
      isClosed: false,
      url,
    }
    if (column === 'backlog') return card

    return { ...card, ...(await moveGithub($, info, card, column)), column }
  } catch (error) {
    throw new Error(S.createdPartly(url, errorMessage(error)))
  }
}

/** Adds a Handoff, Feedback, Question, Answer or Check run section to the issue as a comment. */
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

const SECTION_COMMENT = /^## (?:Handoff|Feedback|Question|Answer|Check run) \(/

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

type Comment = { body: string; createdAt: string; author: string }

const commentOf = (comment: Rec): Comment => ({
  body: str(comment.body).trim(),
  createdAt: str(comment.createdAt),
  author: isRec(comment.author) ? str(comment.author.login) : '',
})

/**
 * The sections in comments, oldest first. A section written by anyone but `viewer`
 * carries `byOther`: anyone can comment on a public repo, so only the signed-in user's
 * sections count.
 */
function sectionsOf(
  comments: readonly Comment[],
  viewer: string,
): KanbanSection[] {
  return comments
    .filter(comment => SECTION_COMMENT.test(comment.body))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap(comment => {
      const { sections } = parseSections(comment.body)
      if (comment.author.toLowerCase() === viewer.toLowerCase()) return sections

      const byOther = comment.author === '' ? S.unknownAuthor : comment.author

      return sections.map(section => ({ ...section, byOther }))
    })
}

/**
 * The issue body as the spec, and its Handoff / Feedback / Question / Answer / Check run
 * comments as sections, oldest first (see `sectionsOf` for whose count).
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
    .map(commentOf)

  return {
    body: str(issue.body).trim(),
    sections: sectionsOf(comments, viewer),
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

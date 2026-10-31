import type { EngineInterface } from 'claude-code'

import type {
  KanbanCard,
  KanbanPeople,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
  KanbanSection,
  KanbanTag,
} from '../types'
import { readViewer, updateViewer } from './atoms'
import { gistOf, parseSections, questionOf } from './handoff'
import { errorMessage } from './model'
import { parsePeople, withName } from './people'
import { S } from './strings'

type Options = KanbanGithub['options']
// The Status options the mod needs to exist; Cancelled and Suspended are optional extras.
type OptionKey = 'backlog' | 'ready' | 'inProgress' | 'inReview' | 'done'

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
const OPTION_KEYS = [
  'backlog',
  'ready',
  'inProgress',
  'inReview',
  'done',
] as const

// Status option names as the board spells them, by lower-case name.
const OPTION_KEY: Record<string, OptionKey> = {
  backlog: 'backlog',
  ready: 'ready',
  'in progress': 'inProgress',
  'in review': 'inReview',
  done: 'done',
}

// The names a board may give a Status option, best first (lower case). Ready
// stands in for Backlog on a board that has neither Backlog nor Todo.
const OPTION_NAMES: Record<OptionKey, readonly string[]> = {
  backlog: ['backlog', 'todo', 'to do', 'ready'],
  ready: ['ready'],
  inProgress: ['in progress', 'doing'],
  inReview: ['in review', 'review'],
  done: ['done', 'closed'],
}

// The option a Status name stands for, by lower-case name.
const KEY_OF_NAME: Record<string, OptionKey> = {
  backlog: 'backlog',
  todo: 'backlog',
  'to do': 'backlog',
  ready: 'ready',
  'in progress': 'inProgress',
  doing: 'inProgress',
  'in review': 'inReview',
  review: 'inReview',
  done: 'done',
  closed: 'done',
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

const HUMAN_LABEL = 'human'

const SUSPENDED_LABEL = 'suspended'

const isHumanLabel = (label: string) => label.toLowerCase() === HUMAN_LABEL
const isAiLabel = (label: string) => label.toLowerCase() === AI_LABEL
const isSuspendedLabel = (label: string) =>
  label.toLowerCase() === SUSPENDED_LABEL

// Status names a board may give to Cancelled and Suspended (lower case). Not
// `blocked`: blocked work is active work that waits, so it stays in Claude or Human.
const CANCELLED_NAME =
  /^(cancel+ed|cancel|won'?t (do|fix)|not planned|dropped|abandoned)$/
const SUSPENDED_NAME =
  /^(suspended?|on[ -]?hold|paused?|ice ?box|someday|deferred)$/

const nameOf = (status: string | undefined) =>
  (status ?? '').trim().toLowerCase()

/** A Status option the board has, by id and name. */
export type StatusOption = { id: string; name: string }

const cancelledOf = (options: readonly StatusOption[]) =>
  options.find(one => CANCELLED_NAME.test(nameOf(one.name)))
const suspendedOf = (options: readonly StatusOption[]) =>
  options.find(one => SUSPENDED_NAME.test(nameOf(one.name)))

/** Cancelled and Suspended among a board's Status options, found by name; the first of each. */
export function extraOptions(options: readonly StatusOption[]): {
  cancelled?: string
  suspended?: string
} {
  const cancelled = cancelledOf(options)
  const suspended = suspendedOf(options)

  return {
    ...(cancelled === undefined ? {} : { cancelled: cancelled.id }),
    ...(suspended === undefined ? {} : { suspended: suspended.id }),
  }
}

// The names `extraOptions`' options go by on the board, as the board spells them.
function extraNames(options: readonly StatusOption[]): {
  cancelled?: string
  suspended?: string
} {
  const cancelled = cancelledOf(options)
  const suspended = suspendedOf(options)

  return {
    ...(cancelled === undefined ? {} : { cancelled: cancelled.name }),
    ...(suspended === undefined ? {} : { suspended: suspended.name }),
  }
}

/**
 * The board's info with its Cancelled and Suspended options, and the names they
 * go by, as `options` lists them; the same object when nothing changed, and when
 * `options` is empty (a load that did not report them says nothing).
 */
export function withStatusOptions(
  info: KanbanGithub,
  options: readonly StatusOption[],
): KanbanGithub {
  if (options.length === 0) return info

  const { cancelled: _cancelled, suspended: _suspended, ...rest } = info.options
  const { optionNames: known, ...bare } = info
  const found = extraOptions(options)
  const names = extraNames(options)
  if (
    found.cancelled === info.options.cancelled &&
    found.suspended === info.options.suspended &&
    names.cancelled === known?.cancelled &&
    names.suspended === known?.suspended
  ) {
    return info
  }

  return {
    ...bare,
    options: { ...rest, ...found },
    ...(Object.keys(names).length === 0 ? {} : { optionNames: names }),
  }
}

// Closed as not planned (or as a duplicate): the way GitHub says cancelled.
const isCancelledReason = (reason: string | undefined) =>
  reason === 'NOT_PLANNED' || reason === 'DUPLICATE'

/**
 * The column a GitHub card sits in: who holds the ball, not who owns the issue.
 * A closed issue is Done, or Cancelled when GitHub's close reason (`stateReason`)
 * says not planned; an open one is Cancelled or Suspended by a Status named so
 * (Suspended also by the `suspended` label).
 */
export function columnOf(
  status: string | undefined,
  labels: readonly string[],
  isClosed: boolean,
  stateReason?: string,
): { column: KanbanColumn; tag?: KanbanTag } {
  const name = nameOf(status)
  const key = KEY_OF_NAME[name]
  const isCancelledName = CANCELLED_NAME.test(name)
  if (isClosed) {
    return {
      column:
        isCancelledReason(stateReason) || isCancelledName
          ? 'cancelled'
          : 'done',
    }
  }
  if (isCancelledName) return { column: 'cancelled' }
  if (SUSPENDED_NAME.test(name) || labels.some(isSuspendedLabel)) {
    return { column: 'suspended' }
  }
  if (key === 'done') return { column: 'done' }
  if (name === '' || key === 'backlog' || key === 'ready') {
    return { column: 'backlog' }
  }
  if (key === 'inReview') return { column: 'human', tag: 'review' }
  if (labels.some(isHumanLabel)) return { column: 'human', tag: 'human' }

  return { column: key === 'inProgress' ? 'claude' : 'backlog' }
}

function isParked(card: KanbanCard): boolean {
  const name = (card.status ?? '').trim().toLowerCase()
  const key = KEY_OF_NAME[name]

  return name === '' || key === 'backlog' || key === 'ready'
}

const isInProgress = (card: KanbanCard) =>
  KEY_OF_NAME[(card.status ?? '').trim().toLowerCase()] === 'inProgress'

// Read back after `gh issue close`, which can fail without an error: the state
// and the reason the issue was closed for, as `CLOSED NOT_PLANNED`. An older gh
// does not know the reason and can be asked for the state alone, as `CLOSED`.
const verifyClosed = (issue: string, repo: string, isReasonKnown = true) => [
  'gh',
  'issue',
  'view',
  issue,
  '--repo',
  repo,
  '--json',
  isReasonKnown ? 'state,stateReason' : 'state',
  '--jq',
  isReasonKnown ? '.state + " " + (.stateReason // "")' : '.state',
]

// Whether the read-back says the issue is closed the way `to` closes it. Done
// takes an issue with no reason too (an old one); Cancelled needs not planned.
function isClosedAs(readBack: string, to: KanbanColumn): boolean {
  const [state, reason = ''] = readBack.trim().split(' ')

  return (
    state === 'CLOSED' &&
    (to === 'cancelled'
      ? reason === 'NOT_PLANNED'
      : reason === '' || reason === 'COMPLETED')
  )
}

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
  claim?: string,
): string[][] {
  const { itemId } = card
  if (itemId === undefined) throw new Error(S.noBoardItem(card))

  const issue = String(card.number)
  const itemEdit = (option: string) => statusEdit(itemId, cfg, option)
  const edit = ['gh', 'issue', 'edit', issue, '--repo', cfg.repo]
  const close = (reason: string) => [
    'gh',
    'issue',
    'close',
    issue,
    '--repo',
    cfg.repo,
    '--reason',
    reason,
  ]
  // A closed issue is reopened first, unless it is to be closed again the way
  // it is: `gh issue close` on a closed issue changes nothing and exits 0, so
  // Done and Cancelled would never swap.
  const isCancelledClose =
    card.isClosed === true && isCancelledReason(card.stateReason)
  const isReopened =
    card.isClosed === true &&
    (to === 'done'
      ? isCancelledClose
      : to === 'cancelled'
        ? !isCancelledClose
        : true)
  const reopen = isReopened
    ? [['gh', 'issue', 'reopen', issue, '--repo', cfg.repo]]
    : []
  // Leaving Suspended takes the label with it, as the repo spells it.
  const suspended = card.labels?.find(isSuspendedLabel)
  const unsuspend = suspended === undefined ? [] : ['--remove-label', suspended]
  const unsuspendEdit = suspended === undefined ? [] : [[...edit, ...unsuspend]]

  if (to === 'backlog') {
    return [
      ...reopen,
      ...unsuspendEdit,
      ...(isParked(card) ? [] : [itemEdit(cfg.options.backlog)]),
    ]
  }
  if (to === 'human') {
    const review = cfg.options.inReview
    if (review !== undefined)
      return [...reopen, ...unsuspendEdit, itemEdit(review)]

    // A board without In review: Human is the label on a card in progress.
    return [
      ...reopen,
      [...edit, '--add-label', HUMAN_LABEL, ...unsuspend],
      ...(isInProgress(card) ? [] : [itemEdit(cfg.options.inProgress)]),
    ]
  }
  if (to === 'claude') {
    const human = card.labels?.find(isHumanLabel)

    // The label first: a failure there leaves the Status as it was.
    return [
      ...reopen,
      [
        ...edit,
        '--add-label',
        AI_LABEL,
        ...(human === undefined ? [] : ['--remove-label', human]),
        ...unsuspend,
        // Taking up a card nobody has makes it the person's.
        ...(claim === undefined ? [] : ['--add-assignee', claim]),
      ],
      itemEdit(cfg.options.inProgress),
    ]
  }
  if (to === 'suspended') {
    const human = card.labels?.find(isHumanLabel)
    const unhuman = human === undefined ? [] : ['--remove-label', human]
    const option = cfg.options.suspended
    if (option !== undefined) {
      return [
        ...reopen,
        ...(human === undefined ? [] : [[...edit, ...unhuman]]),
        itemEdit(option),
      ]
    }

    // No such option on the board: the label says so, and the item rests in Backlog.
    return [
      ...reopen,
      [...edit, '--add-label', SUSPENDED_LABEL, ...unhuman],
      ...(isParked(card) ? [] : [itemEdit(cfg.options.backlog)]),
    ]
  }
  if (to === 'cancelled') {
    // Without a Cancelled option the item stays in Done, where the board keeps closed items.
    return [
      ...reopen,
      ...unsuspendEdit,
      itemEdit(cfg.options.cancelled ?? cfg.options.done),
      close('not planned'),
      verifyClosed(issue, cfg.repo),
    ]
  }

  return [
    ...reopen,
    ...unsuspendEdit,
    itemEdit(cfg.options.done),
    close('completed'),
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

// What an older gh says of a JSON field it has not got.
const NO_STATE_REASON = /unknown json field.*stateReason/i

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

/** Parses a `gh` reply; a text that is not JSON throws, naming `what` was asked for. */
export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(S.ghBadJson(what, errorMessage(error)))
  }
}

export type Rec = Record<string, unknown>

/** Whether a parsed JSON value is an object (not an array, not null). */
export function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string field of parsed JSON; '' when it is anything else. */
export const str = (value: unknown) => (typeof value === 'string' ? value : '')

function listOf(value: unknown, what: string): Rec[] {
  if (!Array.isArray(value)) throw new Error(S.ghBadJson(what, ''))

  return value.filter(isRec)
}

/** GitHub's GraphQL budget after a query; `resetAt` is epoch milliseconds. */
export type RateLimit = { cost: number; remaining: number; resetAt: number }

/**
 * What a load found: the cards, the rate limit as the last page reported it,
 * and the board's Status options (none when the load did not report them).
 */
export type GithubLoad = {
  cards: KanbanCard[]
  rateLimit?: RateLimit
  statusOptions: StatusOption[]
  /** The signed-in login; empty when GitHub did not say. */
  viewer: string
  /** The names in the board's README; none when it has no people block. */
  people: KanbanPeople
}

/** A failure from GitHub's rate limit; `resetAt` is epoch milliseconds when known. */
export type RateLimitedError = Error & {
  isRateLimited: true
  resetAt?: number
}

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

// The Status field's options: how a board's Cancelled and Suspended are found
// even when a CLAUDE.md names only the options it uses. Asked on the first page
// only, and a list, so it adds no connection to the cost: measured on board #7
// (2026-10-26), a page costs 3 points with it and without.
// With the first page: the Status options, and the README that holds the names people go by.
const STATUS_OPTIONS_FIELD = `field(name: "Status") {
        ... on ProjectV2SingleSelectField { options { id name } }
      }
      readme`

// One query per page of the project's items: the Status value and, for the
// issues, only the fields a card shows, plus the newest comments to tell an open
// question from the rest. Measured at 3 points a page (the cost follows the
// connections asked for: 2 without the comments), where `gh project item-list`
// took about 100.
const boardQuery = (
  withOptions: boolean,
) => `query($projectId: ID!, $cursor: String) {
  viewer { login }
  node(id: $projectId) {
    ... on ProjectV2 {
      ${withOptions ? STATUS_OPTIONS_FIELD : ''}
      items(first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
          }
          content {
            ... on Issue {
              number title url state stateReason createdAt updatedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              assignees(first: 10) { nodes { login } }
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
  stateReason?: NonNullable<KanbanCard['stateReason']>
  createdAt: string
  updatedAt: string
  prNumbers: number[]
  assignees: string[]
  question?: string
}

type Page = {
  entries: Entry[]
  next?: string
  rateLimit?: RateLimit
  statusOptions: StatusOption[]
  viewer: string
  /** The board's README, which the first page carries. */
  readme?: string
}

const STATE_REASONS = [
  'COMPLETED',
  'NOT_PLANNED',
  'DUPLICATE',
  'REOPENED',
] as const

const reasonOf = (value: unknown) =>
  STATE_REASONS.find(reason => reason === value)

/** Whether a GraphQL `repository { nameWithOwner }` reference is this repo (any case). */
export const isRepo = (ref: unknown, repo: string) =>
  isRec(ref) && str(ref.nameWithOwner).toLowerCase() === repo.toLowerCase()

/** The records of a GraphQL connection's `nodes`; none when it is not one. */
export const nodesOf = (connection: unknown) =>
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
        ...(reasonOf(content.stateReason) === undefined
          ? {}
          : { stateReason: reasonOf(content.stateReason) }),
        createdAt: str(content.createdAt),
        updatedAt: str(content.updatedAt),
        assignees: nodesOf(content.assignees)
          .map(user => str(user.login))
          .filter(login => login !== ''),
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

  const statusOptions = (
    isRec(node.field) && Array.isArray(node.field.options)
      ? node.field.options
      : []
  )
    .filter(isRec)
    .flatMap(option =>
      str(option.id) === ''
        ? []
        : [{ id: str(option.id), name: str(option.name) }],
    )

  return {
    entries,
    ...(hasNextPage === true ? { next: str(endCursor) } : {}),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    statusOptions,
    viewer,
    ...(typeof node.readme === 'string' ? { readme: node.readme } : {}),
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

/**
 * Runs a GraphQL query with `gh api graphql` and returns its output. A failure
 * from the rate limit throws a rate-limited error (see `isRateLimited`).
 */
export async function graphql(
  $: EngineInterface,
  query: string,
  variables: readonly string[],
): Promise<string> {
  try {
    return await runCommand($, [
      'gh',
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      ...variables,
    ])
  } catch (error) {
    if (!RATE_LIMITED.test(errorMessage(error))) throw error

    throw rateLimited(error, await resetOf($))
  }
}

function runPage(
  $: EngineInterface,
  info: KanbanGithub,
  cursor: string | undefined,
): Promise<string> {
  return graphql($, boardQuery(cursor === undefined), [
    '-F',
    `projectId=${info.projectId}`,
    ...(cursor === undefined ? [] : ['-f', `cursor=${cursor}`]),
  ])
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
  let statusOptions: StatusOption[] = []
  let viewer = ''
  let readme = ''
  let cursor: string | undefined

  for (let pages = 1; ; pages += 1) {
    const page = parsePage(await runPage($, info, cursor), info.repo)
    entries.push(...page.entries)
    rateLimit = page.rateLimit ?? rateLimit
    if (pages === 1) {
      statusOptions = page.statusOptions
      viewer = page.viewer
      readme = page.readme ?? ''
    }
    if (page.next === undefined) break
    if (pages === MAX_PAGES) {
      $.ui.log(S.pageLimitReached(MAX_PAGES * PAGE_SIZE), { to: 'debug' })
      break
    }
    cursor = page.next
  }

  const cards = entries.map((entry, order): KanbanCard => {
    const { column, tag } = columnOf(
      entry.status,
      entry.labels,
      entry.isClosed,
      entry.stateReason,
    )
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
      ...(entry.stateReason === undefined
        ? {}
        : { stateReason: entry.stateReason }),
      ...(entry.url === '' ? {} : { url: entry.url }),
      ...(entry.prNumbers.length === 0 ? {} : { prNumbers: entry.prNumbers }),
      assignees: entry.assignees,
    }
  })

  return {
    cards,
    ...(rateLimit === undefined ? {} : { rateLimit }),
    statusOptions,
    viewer,
    people: parsePeople(readme),
  }
}

type LabelSpec = { name: string; color: string; description: string }

const AI: LabelSpec = {
  name: AI_LABEL,
  color: '5319e7',
  description: S.aiLabelDescription,
}
const HUMAN: LabelSpec = {
  name: HUMAN_LABEL,
  color: 'b60205',
  description: S.humanLabelDescription,
}
// Marks an issue the person put on hold, on a board with no Suspended status.
const SUSPENDED: LabelSpec = {
  name: SUSPENDED_LABEL,
  color: 'cfd3d7',
  description: S.suspendedLabelDescription,
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

// The labels a card has after a move to `to`: Claude's work carries `ai` and not
// `human`; Human on a board without In review is the `human` label; Suspended
// without an option is the `suspended` label and any other section has none.
function labelsAfter(
  labels: readonly string[],
  to: KanbanColumn,
  isLabelOnly: boolean,
  hasSuspendedOption: boolean,
): string[] {
  const rest = labels.filter(label => !isSuspendedLabel(label))
  const unhumaned = rest.filter(label => !isHumanLabel(label))

  switch (to) {
    case 'claude':
      return [...unhumaned, ...(labels.some(isAiLabel) ? [] : [AI_LABEL])]
    case 'human':
      return isLabelOnly ? [...unhumaned, HUMAN_LABEL] : rest
    case 'suspended':
      return hasSuspendedOption
        ? [...labels.filter(label => !isHumanLabel(label))]
        : [
            ...labels.filter(label => !isHumanLabel(label)),
            ...(labels.some(isSuspendedLabel) ? [] : [SUSPENDED_LABEL]),
          ]
    default:
      return rest
  }
}

// Reads the issue back after its close; resolves whether it is closed the way `to`
// closes it. An older gh rejects the `stateReason` field though the close took:
// the state is all it can then say, and a closed issue is taken as closed as asked.
async function isCloseVerified(
  $: EngineInterface,
  argv: readonly string[],
  card: KanbanCard,
  to: KanbanColumn,
  info: KanbanGithub,
): Promise<boolean> {
  try {
    return isClosedAs(await runCommand($, argv), to)
  } catch (error) {
    if (!NO_STATE_REASON.test(errorMessage(error))) throw error

    const state = await runCommand(
      $,
      verifyClosed(String(card.number), info.repo, false),
    )

    return state.trim() === 'CLOSED'
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
  // Without an In review status, Human is the label.
  const isLabelOnly = to === 'human' && info.options.inReview === undefined
  if (!isReorder && isLabelOnly && !labels.some(isHumanLabel)) {
    await ensureLabel($, info, HUMAN)
  }
  // Without a Suspended status, so is Suspended.
  const hasSuspendedOption = info.options.suspended !== undefined
  if (
    !isReorder &&
    to === 'suspended' &&
    !hasSuspendedOption &&
    !labels.some(isSuspendedLabel)
  ) {
    await ensureLabel($, info, SUSPENDED)
  }

  // A card nobody has becomes the person's when it goes to Claude. One whose
  // assignees were not read is left as it is.
  const claim =
    !isReorder && to === 'claude' && card.assignees?.length === 0
      ? await viewerLogin($)
      : undefined

  for (const argv of isReorder ? [] : planMove(card, to, info, claim)) {
    if (!isVerify(argv)) {
      await runCommand($, argv)
    } else if (!(await isCloseVerified($, argv, card, to, info))) {
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

  const next = labelsAfter(labels, to, isLabelOnly, hasSuspendedOption)
  const isRelabelled =
    to === 'claude' ||
    isLabelOnly ||
    next.length !== labels.length ||
    next.some((label, index) => label !== labels[index])
  const status = statusAfter(card, to, info, isLabelOnly)
  const reason = reasonAfter(card, to)

  return {
    ...(status === undefined ? {} : { status }),
    ...(isRelabelled ? { labels: next } : {}),
    ...(claim === undefined ? {} : { assignees: [claim] }),
    ...(to === 'human'
      ? {
          tag:
            card.tag === 'question'
              ? ('question' as const)
              : isLabelOnly
                ? ('human' as const)
                : ('review' as const),
        }
      : {}),
    isClosed: to === 'done' || to === 'cancelled',
    ...(reason === undefined ? {} : { stateReason: reason }),
  }
}

// The Status the item has after the move, as the board names it; none when it keeps its own.
function statusAfter(
  card: KanbanCard,
  to: KanbanColumn,
  info: KanbanGithub,
  isLabelOnly: boolean,
): string | undefined {
  switch (to) {
    case 'backlog':
      return isParked(card) ? undefined : STATUS_NAME.backlog
    case 'human':
      return isLabelOnly ? STATUS_NAME.inProgress : STATUS_NAME.inReview
    case 'claude':
      return STATUS_NAME.inProgress
    case 'done':
      return STATUS_NAME.done
    case 'cancelled':
      return info.options.cancelled === undefined
        ? STATUS_NAME.done
        : (info.optionNames?.cancelled ?? S.col.cancelled)
    case 'suspended':
      if (info.options.suspended !== undefined) {
        return info.optionNames?.suspended ?? S.col.suspended
      }

      return isParked(card) ? undefined : STATUS_NAME.backlog
  }
}

// Why the issue is closed (or reopened) after the move; none for an issue that was never closed.
function reasonAfter(
  card: KanbanCard,
  to: KanbanColumn,
): KanbanCard['stateReason'] {
  if (to === 'done') return 'COMPLETED'
  if (to === 'cancelled') return 'NOT_PLANNED'

  return card.isClosed === true ? 'REOPENED' : undefined
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
 * other column, moves it there, after the card `after` (first when null) when
 * one is given; that place is only the default, so one GitHub refuses is logged
 * and the card stays. Throws on the first failing command; an issue already
 * created stays, and the error names it.
 */
export async function createGithub(
  $: EngineInterface,
  info: KanbanGithub,
  title: string,
  spec: string,
  column: KanbanColumn,
  after?: KanbanCard | null,
): Promise<KanbanCard> {
  const triage = await ensureLabel($, info, TRIAGE)
  // A card someone makes is theirs, whether they or their Claude made it.
  const viewer = await viewerLogin($)
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
      '--assignee',
      viewer,
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
      assignees: [viewer],
    }
    if (column === 'backlog') return card

    const moved = await moveGithub($, info, card, column, after, false)

    return { ...card, ...moved, column }
  } catch (error) {
    throw new Error(S.createdPartly(url, errorMessage(error)))
  }
}

/**
 * Makes `login` the issue's one assignee, or nobody's with null: the others it
 * had are taken off. Resolves the assignees it has now.
 */
export async function assignGithub(
  $: EngineInterface,
  info: KanbanGithub,
  card: KanbanCard,
  login: string | null,
): Promise<string[]> {
  const others = (card.assignees ?? []).filter(
    one => login === null || one.toLowerCase() !== login.toLowerCase(),
  )
  const isKept = login !== null && others.length !== (card.assignees ?? []).length
  const argv = [
    'gh',
    'issue',
    'edit',
    String(card.number),
    '--repo',
    info.repo,
    ...(login === null || isKept ? [] : ['--add-assignee', login]),
    ...others.flatMap(one => ['--remove-assignee', one]),
  ]
  if (argv.length > 6) await runCommand($, argv)

  return login === null ? [] : [login]
}

/**
 * Sets the name `login` goes by in the board's README, read fresh so another
 * person's change since the last load is kept. Resolves the names it holds now.
 */
export async function saveNameGithub(
  $: EngineInterface,
  info: KanbanGithub,
  login: string,
  name: string,
): Promise<KanbanPeople> {
  const board = [String(info.projectNumber), '--owner', info.owner]
  const readme = await runCommand($, [
    'gh',
    'project',
    'view',
    ...board,
    '--format',
    'json',
    '--jq',
    '.readme',
  ])
  const next = withName(readme.replace(/\n$/, ''), login, name)
  await runCommand($, ['gh', 'project', 'edit', ...board, '--readme', next])

  return parsePeople(next)
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

/**
 * Fills in what the CLAUDE.md left out from `gh project field-list` and `gh project view`.
 * A detected board (`isDetected`) may lack In review: Human is then the `human` label.
 */
export async function resolveGithub(
  $: EngineInterface,
  found: ParsedClaudeMd,
  isDetected = false,
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
    for (const key of OPTION_KEYS) {
      const named = OPTION_NAMES[key]
        .map(name =>
          status.options.find(option => option.name.toLowerCase() === name),
        )
        .find(option => option !== undefined)
      if (named !== undefined) options[key] ??= named.id
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
      ...(isDetected && options.inReview === undefined
        ? {}
        : { inReview: need(options.inReview, STATUS_NAME.inReview) }),
      done: need(options.done, STATUS_NAME.done),
    },
  }
}

import type { EngineInterface } from 'claude-code'

import type { KanbanChoice, KanbanGithub } from '../types'
import {
  graphql,
  isRateLimited,
  isRec,
  isRepo,
  nodesOf,
  parseJson,
  resolveGithub,
  runCommand,
  str,
} from './github'
import { errorMessage } from './model'
import { S } from './strings'

// Finds the GitHub board of a repo from `git` and `gh` alone: the projects
// linked to the origin's repo, else the viewer's and the owner's projects that
// hold its issues. Everything here only reads.

const CHECK_MS = 10_000
// Projects asked for per list, and the items counted on each one's first page.
const PROJECTS = 20
const COUNTED = 100
const SHAPE = 'detect-1'

/** What a failed check says: `auto` logs the reason as it is, `github` adds how to fix it. */
export type Explain = {
  gh: (reason: string) => string
  auth: (reason: string) => string
  remote: (reason: string) => string
  lookup: (repo: string, reason: string) => string
  board: (number: number, reason: string) => string
}

const AS_IS = (reason: string) => reason

/** The reasons exactly as the commands gave them. */
export const PLAIN: Explain = {
  gh: AS_IS,
  auth: AS_IS,
  remote: AS_IS,
  lookup: (_repo, reason) => reason,
  board: (_number, reason) => reason,
}

/** Reasons that name the failing check and how to fix it. */
export const NAMED: Explain = {
  gh: S.githubNoGh,
  auth: S.githubSignedOut,
  remote: S.githubNoRemote,
  lookup: S.githubLookupFailed,
  board: S.githubDetectedFailed,
}

/** Runs the work; a failure is thrown again with the reason `explain` gives. */
export async function check<T>(
  work: () => Promise<T>,
  explain: (reason: string) => string,
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new Error(explain(errorMessage(error)))
  }
}

// `https://github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com[:22]/o/r`, `git://…`.
const ORIGIN =
  /^(?:(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/|[^@/\s]+@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i

/** `owner/name` from a github.com remote URL in any of its forms; undefined for any other. */
export function parseOrigin(url: string): string | undefined {
  const match = ORIGIN.exec(url.trim())

  return match === null ? undefined : `${match[1]}/${match[2]}`
}

/** The origin remote's URL. */
export async function readOrigin($: EngineInterface): Promise<string> {
  const url = await runCommand($, ['git', 'remote', 'get-url', 'origin'], {
    timeoutMs: CHECK_MS,
  })

  return url.trim()
}

/** `owner/name` of an origin URL; throws when it is not on github.com. */
export function repoOf(origin: string): string {
  const repo = parseOrigin(origin)
  if (repo === undefined) throw new Error(S.originNotGithub(origin))

  return repo
}

// The project fields a lookup reads, with the repo of each item on its first
// page: counting costs nothing extra (1 point a query, measured).
const PROJECT_NODES = `nodes {
  id number title closed
  owner { ... on User { login } ... on Organization { login } }
  items(first: ${COUNTED}) {
    nodes {
      content {
        ... on Issue { repository { nameWithOwner } }
        ... on PullRequest { repository { nameWithOwner } }
      }
    }
  }
}`

const LINKED_QUERY = `query($o: String!, $n: String!) {
  repository(owner: $o, name: $n) {
    projectsV2(first: ${PROJECTS}) { ${PROJECT_NODES} }
  }
}`

const SCAN_QUERY = `query($o: String!) {
  viewer { projectsV2(first: ${PROJECTS}) { ${PROJECT_NODES} } }
  repositoryOwner(login: $o) {
    ... on User { projectsV2(first: ${PROJECTS}) { ${PROJECT_NODES} } }
    ... on Organization { projectsV2(first: ${PROJECTS}) { ${PROJECT_NODES} } }
  }
}`

// A project and how many of the items counted are this repo's.
type Found = KanbanChoice & { count: number }

function foundIn(connection: unknown, repo: string): Found[] {
  return nodesOf(connection).flatMap(node => {
    const owner = isRec(node.owner) ? str(node.owner.login) : ''
    const id = str(node.id)
    if (
      node.closed === true ||
      typeof node.number !== 'number' ||
      id === '' ||
      owner === ''
    ) {
      return []
    }
    const count = nodesOf(node.items).filter(
      item => isRec(item.content) && isRepo(item.content.repository, repo),
    ).length

    return [{ id, number: node.number, title: str(node.title), owner, count }]
  })
}

async function ask(
  $: EngineInterface,
  query: string,
  variables: readonly string[],
  repo: string,
  explain: Explain,
): Promise<Record<string, unknown>> {
  let out: string
  try {
    out = await graphql($, query, variables)
  } catch (error) {
    // A rate limit is no verdict on the repo: it must not look like "no board".
    if (isRateLimited(error)) throw error

    throw new Error(explain.lookup(repo, errorMessage(error)))
  }
  const data = parseJson(out, 'the repo’s projects')
  const root = isRec(data) && isRec(data.data) ? data.data : undefined
  if (root === undefined)
    throw new Error(S.ghBadJson('the repo’s projects', ''))

  return root
}

const projectsOf = (owner: unknown) =>
  isRec(owner) ? owner.projectsV2 : undefined

// The open projects linked to the repo.
async function linkedTo(
  $: EngineInterface,
  repo: string,
  explain: Explain,
): Promise<Found[]> {
  const [owner, name] = repo.split('/')
  const root = await ask(
    $,
    LINKED_QUERY,
    ['-f', `o=${owner}`, '-f', `n=${name}`],
    repo,
    explain,
  )
  if (!isRec(root.repository)) {
    throw new Error(
      explain.lookup(repo, S.ghBadJson('the repo’s projects', '')),
    )
  }

  return foundIn(projectsOf(root.repository), repo)
}

// The viewer's and the repo owner's open projects, each once.
async function ownedBy(
  $: EngineInterface,
  repo: string,
  explain: Explain,
): Promise<Found[]> {
  const root = await ask(
    $,
    SCAN_QUERY,
    ['-f', `o=${repo.split('/')[0]}`],
    repo,
    explain,
  )
  const all = [
    ...foundIn(projectsOf(root.viewer), repo),
    ...foundIn(projectsOf(root.repositoryOwner), repo),
  ]

  return all.filter((one, at) => all.findIndex(see => see.id === one.id) === at)
}

// Linked projects are all candidates; a scan only counts projects holding the repo's items.
type Search = { found: Found[]; isLinked: boolean }

async function search(
  $: EngineInterface,
  repo: string,
  explain: Explain,
): Promise<Search> {
  const linked = await linkedTo($, repo, explain)
  if (linked.length > 0) return { found: linked, isLinked: true }

  return { found: await ownedBy($, repo, explain), isLinked: false }
}

// The candidates, most items from the repo first.
function pool({ found, isLinked }: Search): Found[] {
  return found
    .filter(one => isLinked || one.count > 0)
    .sort((a, b) => b.count - a.count || a.number - b.number)
}

const plain = ({ id, number, title, owner }: Found): KanbanChoice => ({
  id,
  number,
  title,
  owner,
})

type PickNeeded = Error & { choices: KanbanChoice[] }

function pickNeeded(repo: string, choices: KanbanChoice[]): PickNeeded {
  return Object.assign(new Error(S.githubPick(repo)), { choices })
}

/** The boards the person has to pick from when detection could not decide; undefined for any other error. */
export function choicesOf(error: unknown): KanbanChoice[] | undefined {
  return error instanceof Error && 'choices' in error
    ? (error as PickNeeded).choices
    : undefined
}

/** The boards the person may choose between for a repo: the linked ones, else those holding its items. */
export async function boardsFor(
  $: EngineInterface,
  repo: string,
  explain: Explain = PLAIN,
): Promise<KanbanChoice[]> {
  return pool(await search($, repo, explain)).map(plain)
}

/**
 * Makes the board of a choice ready to use: its Status options come from `gh
 * project field-list`. A board without In review still works (Human is then the
 * label), and the person is told once.
 */
export async function resolveChoice(
  $: EngineInterface,
  repo: string,
  choice: KanbanChoice,
  explain: Explain = PLAIN,
): Promise<KanbanGithub> {
  const info = await check(
    () =>
      resolveGithub(
        $,
        {
          repo,
          owner: choice.owner,
          projectNumber: choice.number,
          projectId: choice.id,
          options: {},
        },
        true,
      ),
    reason => explain.board(choice.number, reason),
  )
  if (info.options.inReview === undefined) $.ui.toast(S.noReviewStatus)

  return { ...info, title: choice.title, isDetected: true }
}

type Saved = { shape: typeof SHAPE; origin: string; info: KanbanGithub }

async function savedKey($: EngineInterface): Promise<string> {
  return `detect:${await $.session.cwd()}`
}

function isSaved(value: unknown): value is Saved {
  if (!isRec(value) || value.shape !== SHAPE) return false
  const { info } = value

  return (
    typeof value.origin === 'string' &&
    isRec(info) &&
    info.kind === 'github' &&
    info.isDetected === true &&
    typeof info.projectId === 'string'
  )
}

async function readSaved(
  $: EngineInterface,
  origin: string,
): Promise<KanbanGithub | undefined> {
  try {
    const saved = await $.store.get(await savedKey($))

    return isSaved(saved) && saved.origin === origin ? saved.info : undefined
  } catch (error) {
    $.ui.log(S.cacheFailed(errorMessage(error)), { to: 'debug' })

    return undefined
  }
}

/** Remembers the board found for this directory and origin, so later sessions skip the search. */
export async function saveDetected(
  $: EngineInterface,
  origin: string,
  info: KanbanGithub,
): Promise<void> {
  try {
    const saved: Saved = { shape: SHAPE, origin, info }
    await $.store.set(await savedKey($), saved)
  } catch (error) {
    $.ui.log(S.detectSaveFailed(errorMessage(error)), { to: 'debug' })
  }
}

/** Drops the remembered board, so the next detection searches again. */
export async function forgetDetected($: EngineInterface): Promise<void> {
  try {
    await $.store.delete(await savedKey($))
  } catch (error) {
    $.ui.log(S.detectSaveFailed(errorMessage(error)), { to: 'debug' })
  }
}

/** Auto found no board for this repo. */
export type NoBoard = { kind: 'local'; noBoardFor: string }

/**
 * Finds the board with no config. The origin comes first, and costs no call to
 * gh: a board remembered for it is used as it is, and an origin that is not on
 * github.com ends the search before gh is asked anything. Otherwise gh must be
 * installed and signed in. One board is used; several go by the most items from
 * this repo, and a tie throws a request to pick (see `choicesOf`). None gives
 * `NoBoard`. A found board is remembered per directory.
 */
export async function detectZero(
  $: EngineInterface,
  explain: Explain,
): Promise<KanbanGithub | NoBoard> {
  const origin = await check(() => readOrigin($), explain.remote)
  const saved = await readSaved($, origin)
  if (saved !== undefined) return saved

  const repo = repoOf(origin)
  await check(
    () => runCommand($, ['gh', '--version'], { timeoutMs: CHECK_MS }),
    explain.gh,
  )
  await check(
    () => runCommand($, ['gh', 'auth', 'status'], { timeoutMs: CHECK_MS }),
    explain.auth,
  )

  const found = pool(await search($, repo, explain))
  const [first, second] = found
  if (first === undefined) return { kind: 'local', noBoardFor: repo }
  if (second !== undefined && second.count === first.count) {
    throw pickNeeded(repo, found.map(plain))
  }

  const info = await resolveChoice($, repo, plain(first), explain)
  await saveDetected($, origin, info)

  return info
}

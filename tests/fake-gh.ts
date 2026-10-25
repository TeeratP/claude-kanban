import type { EngineInterface, On } from 'claude-code'

export type Reply = { exitCode?: number; stdout?: string; stderr?: string }

// A route answers every command that starts with `match`; the first one wins.
export type Route = {
  match: readonly string[]
  reply: Reply | ((argv: readonly string[]) => Reply)
}

export type Call = { argv: readonly string[]; stdin?: string }

function answer(routes: readonly Route[], call: Call) {
  const route = routes.find(one =>
    one.match.every((part, index) => call.argv[index] === part),
  )
  // A command nobody routed fails the test: nothing reaches a real `gh`.
  if (route === undefined) {
    throw new Error(`fake gh: no route for ${call.argv.join(' ')}`)
  }
  const reply =
    typeof route.reply === 'function' ? route.reply(call.argv) : route.reply

  return {
    exitCode: reply.exitCode ?? 0,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  }
}

/** A stand-in `$` for the plain functions: `process.run` from routes, `fs` from a map, a fixed clock. */
export function fakeEngine(
  routes: readonly Route[],
  files: Record<string, string> = {},
) {
  const calls: Call[] = []
  const logs: string[] = []
  const toasts: string[] = []
  const $ = {
    fs: {
      exists: async (file: string) => file in files,
      read: async (file: string) => {
        const text = files[file]
        if (text === undefined) throw new Error(`ENOENT: ${file}`)

        return text
      },
    },
    clock: { now: async () => Date.parse('2026-10-25T12:00:00Z') },
    ui: {
      log: (text: string) => {
        logs.push(text)
      },
      toast: (text: string) => {
        toasts.push(text)
      },
    },
    process: {
      run: async (
        argv: readonly string[],
        init?: { stdin?: string; timeoutMs?: number },
      ) => {
        const call = {
          argv,
          ...(init?.stdin === undefined ? {} : { stdin: init.stdin }),
        }
        calls.push(call)

        return answer(routes, call)
      },
    },
  } as unknown as EngineInterface

  return { $, calls, logs, toasts }
}

/**
 * Answers the engine's `process.run` event from routes and records each command.
 * Every answer waits for `hold`, when given: the first load stays unanswered. A
 * function holds only the commands it returns a promise for.
 */
export function fakeProcess(
  on: On,
  routes: readonly Route[],
  hold?:
    Promise<void> | ((argv: readonly string[]) => Promise<void> | undefined),
) {
  const calls: Call[] = []
  on('process.run', async (_, e) => {
    await (typeof hold === 'function' ? hold(e.argv) : hold)
    const call = {
      argv: e.argv,
      ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }),
    }
    calls.push(call)

    return { value: answer(routes, call) }
  })

  return calls
}

// What `gh api graphql` printed for the board query against TeeratP/claude-kanban
// board #7 on 2026-10-25: 16 items, `rateLimit.cost` 2. A page costs the same
// 2 points however many items it holds.
export const LIVE_RATE_LIMIT = {
  cost: 2,
  remaining: 4998,
  resetAt: '2026-10-25T18:57:38Z',
}

export type FakeIssue = {
  number: number
  title?: string
  status?: string
  state?: 'OPEN' | 'CLOSED'
  labels?: string[]
  prs?: { number: number; repo?: string }[]
  repo?: string
}

const REPO = 'TeeratP/claude-kanban'

/** A board item that is an issue, in the shape the board query returns. */
export function issueNode(issue: FakeIssue) {
  const repo = issue.repo ?? REPO

  return {
    id: `PVTI_${issue.number}`,
    fieldValueByName:
      issue.status === undefined
        ? null
        : { name: issue.status, optionId: `o-${issue.status}` },
    content: {
      number: issue.number,
      title: issue.title ?? `Issue ${issue.number}`,
      url: `https://github.com/${repo}/issues/${issue.number}`,
      state: issue.state ?? 'OPEN',
      createdAt: `2026-10-0${issue.number % 9}T10:00:00Z`,
      updatedAt: `2026-10-1${issue.number % 9}T10:00:00Z`,
      repository: { nameWithOwner: repo },
      labels: { nodes: (issue.labels ?? []).map(name => ({ name })) },
      closedByPullRequestsReferences: {
        nodes: (issue.prs ?? []).map(pr => ({
          number: pr.number,
          repository: { nameWithOwner: pr.repo ?? REPO },
        })),
      },
    },
  }
}

const PAGE = 100

/** How a `gh api graphql` answers: the nodes 100 at a time by cursor, like the real one. */
export function boardReply(
  nodes: readonly unknown[],
  rateLimit: Record<string, unknown> = LIVE_RATE_LIMIT,
) {
  return (argv: readonly string[]): Reply => {
    const cursor = argv.find(part => part.startsWith('cursor='))
    const from =
      cursor === undefined ? 0 : Number(cursor.slice('cursor=c'.length))
    const to = Math.min(from + PAGE, nodes.length)

    return {
      stdout: JSON.stringify({
        data: {
          node: {
            items: {
              pageInfo: { hasNextPage: to < nodes.length, endCursor: `c${to}` },
              nodes: nodes.slice(from, to),
            },
          },
          rateLimit,
        },
      }),
    }
  }
}

/** A `gh api graphql` route that serves the board's nodes. */
export function boardRoute(
  nodes: readonly unknown[],
  rateLimit: Record<string, unknown> = LIVE_RATE_LIMIT,
): Route {
  return {
    match: ['gh', 'api', 'graphql'],
    reply: boardReply(nodes, rateLimit),
  }
}

/** The query text of a `gh api graphql` command. */
export const queryOf = (argv: readonly string[]) =>
  argv.find(part => part.startsWith('query=')) ?? ''

/** The cursor a `gh api graphql` command sends, if any. */
export const cursorOf = (argv: readonly string[]) =>
  argv.find(part => part.startsWith('cursor='))?.slice('cursor='.length)

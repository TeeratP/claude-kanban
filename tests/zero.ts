import { boardReply } from './fake-gh'
import type { Reply, Route } from './fake-gh'

// Fakes for zero-config detection: what `gh` and `git` answer to the checks and
// the GraphQL lookups, with the shapes measured live (cost 1 each) on
// TeeratP/attend-baby and TeeratP/nae on 2026-10-26.

export const GH_VERSION: Route = {
  match: ['gh', '--version'],
  reply: { stdout: 'gh version 2.62.0 (2026-09-01)\n' },
}
export const NO_GH: Route = {
  match: ['gh', '--version'],
  reply: { exitCode: 127, stderr: 'gh: command not found' },
}
export const SIGNED_IN: Route = { match: ['gh', 'auth', 'status'], reply: {} }
export const SIGNED_OUT: Route = {
  match: ['gh', 'auth', 'status'],
  reply: { exitCode: 1, stderr: 'You are not logged into any GitHub hosts.' },
}

export const remote = (url: string): Route => ({
  match: ['git', 'remote', 'get-url', 'origin'],
  reply: { stdout: `${url}\n` },
})

export const BABY = 'TeeratP/attend-baby'

export type FakeProject = {
  number: number
  title?: string
  closed?: boolean
  /** The login of the project's owner. */
  owner?: string
  /** The items on the first page, as a count per repo. */
  items?: Record<string, number>
}

const projectNode = (project: FakeProject) => ({
  id: `PVT_${project.number}`,
  number: project.number,
  title: project.title ?? `Board ${project.number}`,
  closed: project.closed ?? false,
  owner: { __typename: 'User', login: project.owner ?? 'TeeratP' },
  items: {
    nodes: Object.entries(project.items ?? {}).flatMap(([repo, count]) =>
      Array.from({ length: count }, () => ({
        content: { __typename: 'Issue', repository: { nameWithOwner: repo } },
      })),
    ),
  },
})

const nodes = (projects: readonly FakeProject[]) => ({
  projectsV2: { nodes: projects.map(projectNode) },
})

export type Lookup = {
  /** The projects linked to the repo. */
  linked?: readonly FakeProject[]
  /** The signed-in user's projects. */
  viewer?: readonly FakeProject[]
  /** The repo owner's projects. */
  owner?: readonly FakeProject[]
  /** What the board query answers, once a board is chosen. */
  load?: (argv: readonly string[]) => Reply
  /** Makes the lookups fail with this stderr instead. */
  failure?: string
}

export const isLookup = (argv: readonly string[]) =>
  argv.some(part => part.startsWith('query=') && part.includes('projectsV2'))

/** A `gh api graphql` route answering the linked-projects lookup, the scan and the board query. */
export function graphql(lookup: Lookup = {}): Route {
  return {
    match: ['gh', 'api', 'graphql'],
    reply: argv => {
      const query = argv.find(part => part.startsWith('query=')) ?? ''
      if (!query.includes('projectsV2')) {
        return lookup.load === undefined
          ? boardReply([])(argv)
          : lookup.load(argv)
      }
      if (lookup.failure !== undefined) {
        return { exitCode: 1, stderr: lookup.failure }
      }
      const data = query.includes('repositoryOwner(')
        ? {
            viewer: { login: 'TeeratP', ...nodes(lookup.viewer ?? []) },
            repositoryOwner: {
              __typename: 'User',
              ...nodes(lookup.owner ?? []),
            },
          }
        : { repository: nodes(lookup.linked ?? []) }

      return { stdout: JSON.stringify({ data }) }
    },
  }
}

export const STATUS_FIELD = {
  id: 'PVTSSF_zero',
  name: 'Status',
}

/** `gh project field-list` for a Status field with these option names (ids are `o-<name>`). */
export function fieldList(names: readonly string[]): Route {
  return {
    match: ['gh', 'project', 'field-list'],
    reply: {
      stdout: JSON.stringify({
        fields: [
          { id: 'PVTF_title', name: 'Title' },
          {
            ...STATUS_FIELD,
            options: names.map(name => ({ id: `o-${name}`, name })),
          },
        ],
      }),
    },
  }
}

export const ALL_STATUSES = [
  'Backlog',
  'Ready',
  'In progress',
  'In review',
  'Done',
]

/** The commands that ran, as space-joined text. */
export const lines = (calls: readonly { argv: readonly string[] }[]) =>
  calls.map(call =>
    call.argv
      .map(part => (part.startsWith('query=') ? 'query=…' : part))
      .join(' '),
  )

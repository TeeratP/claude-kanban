import type { On } from 'claude-code'

import { boot } from './fakes'
import type { Call, FakeOption, Reply } from './fake-gh'
import { boardReply, issueNode, queryOf } from './fake-gh'
import { KANBAN } from './github-board'

// A GitHub board the plugin works against as it would the real one: the issues
// on the project in board order, each with its Status, state, labels and
// comments. Every `gh` command the plugin runs reads or changes them, so a test
// looks at `world.issues` after a move as it would at the board on GitHub.

const REPO = 'TeeratP/claude-kanban'
const VIEWER = 'TeeratP'

/** The Status options of the board CLAUDE.md names, by name, and the two a board may add. */
export const OPTION = {
  Backlog: '1a1cd0bb',
  Ready: '61b99878',
  'In progress': 'b15c285e',
  'In review': '5f34c9ff',
  Done: '201b4a64',
  Cancelled: 'c4nce11d',
  Suspended: '5u5pend3',
} as const

export type StatusName = keyof typeof OPTION

const NAME_OF: Record<string, StatusName> = Object.fromEntries(
  Object.entries(OPTION).map(([name, id]) => [id, name as StatusName]),
)

/** The options the board query reports: all seven, so every section has a Status of its own. */
export const OPTIONS: readonly FakeOption[] = Object.entries(OPTION).map(
  ([name, id]) => ({ id, name }),
)

export type FakeComment = { body: string; createdAt: string; author: string }

export type FakeCard = {
  number: number
  title: string
  status?: StatusName
  state: 'OPEN' | 'CLOSED'
  stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED'
  labels: string[]
  /** The issue's text: the card's spec. */
  body: string
  comments: FakeComment[]
  prs: number[]
  assignees: string[]
}

type Column = 'backlog' | 'claude' | 'human' | 'done' | 'cancelled' | 'suspended'

/** How a section is held on the board: its Status, and for Done and Cancelled the issue closed. */
const HELD: Record<Column, Partial<FakeCard>> = {
  backlog: { status: 'Backlog' },
  claude: { status: 'In progress', labels: ['ai'] },
  human: { status: 'In review' },
  done: { status: 'Done', state: 'CLOSED', stateReason: 'COMPLETED' },
  cancelled: { status: 'Cancelled', state: 'CLOSED', stateReason: 'NOT_PLANNED' },
  suspended: { status: 'Suspended' },
}

/**
 * A card as an issue on the board, by the section it sits in (`backlog` by
 * default). `sections` are comments: a handoff, feedback, a question.
 */
export function issue(
  number: number,
  fields: {
    column?: Column
    title?: string
    labels?: string[]
    assignees?: string[]
    prs?: number[]
    /** Comments, oldest first, each the plugin's own unless an author is given. */
    comments?: (string | Partial<FakeComment>)[]
  } = {},
  body = 'Spec text.',
): FakeCard {
  const held = HELD[fields.column ?? 'backlog']

  return {
    number,
    title: fields.title ?? `Card ${number}`,
    state: 'OPEN',
    ...held,
    labels: [...(held.labels ?? []), ...(fields.labels ?? [])],
    body,
    comments: (fields.comments ?? []).map((one, index) => ({
      body: typeof one === 'string' ? one : (one.body ?? ''),
      createdAt:
        (typeof one === 'string' ? undefined : one.createdAt) ??
        `2026-10-25T0${index}:00:00Z`,
      author: (typeof one === 'string' ? undefined : one.author) ?? VIEWER,
    })),
    prs: fields.prs ?? [],
    assignees: fields.assignees ?? [],
  }
}

/** A comment holding a valid handoff, which a card needs before it moves to Human or Done. */
export const HANDOFF = [
  '## Handoff (2026-10-25)',
  '**Did:** Wrote the docs',
  '**Check:** Read the README',
  '**Changed:** README.md',
  '**Need from you:** Approve',
].join('\n')

const flag = (argv: readonly string[], name: string) => {
  const at = argv.indexOf(name)

  return at < 0 ? undefined : argv[at + 1]
}

const field = (argv: readonly string[], name: string) =>
  argv.find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)

const POSITION = 'updateProjectV2ItemPosition'

/**
 * Answers every `gh` and `git` command the plugin runs from `cards`, which it
 * changes as GitHub would. `fail` answers a command that starts with its key
 * (`'issue close'`, `'project item-edit'`) with a failure instead. `hold`
 * makes every command that changes GitHub wait for it, `holdReads` every one
 * that reads it (the board, an issue).
 */
export function fakeGithub(
  on: On,
  cards: FakeCard[],
  opts: {
    viewer?: string
    options?: readonly FakeOption[]
    readme?: string
  } = {},
) {
  const viewer = opts.viewer ?? VIEWER
  const options = opts.options ?? OPTIONS
  // Each comment is a second after the last, so they keep their order.
  let clock = Date.parse('2026-10-25T12:00:00Z')
  const stamp = () => {
    clock += 1000

    return new Date(clock).toISOString()
  }
  const world = {
    cards,
    commands: [] as Call[],
    fail: {} as Record<string, Reply>,
    hold: undefined as Promise<void> | undefined,
    holdReads: undefined as Promise<void> | undefined,
    viewer,
    /** The project board's README, where the names people go by are kept. */
    readme: opts.readme ?? '',
    /** The card numbered `n`, which the test expects to be there. */
    card(n: number): FakeCard {
      const found = cards.find(one => one.number === n)
      if (found === undefined) throw new Error(`fake github: no issue #${n}`)

      return found
    },
    /** The bodies of the comments on `n`, oldest first. */
    comments(n: number): string[] {
      return world.card(n).comments.map(one => one.body)
    },
    /** How many times the board was read: the board queries sent, a page each. */
    loads(): number {
      return world.commands.filter(
        call =>
          call.argv[1] === 'api' &&
          call.argv[2] === 'graphql' &&
          queryOf(call.argv).includes('items(first:'),
      ).length
    },
    /** The issues' numbers in board order with their Status, as a test reads the board. */
    board(): string[] {
      return cards.map(one => `#${one.number} ${one.status ?? '-'}`)
    },
  }

  const node = (card: FakeCard) => {
    const made = issueNode({
      number: card.number,
      title: card.title,
      ...(card.status === undefined ? {} : { status: card.status }),
      state: card.state,
      ...(card.stateReason === undefined
        ? {}
        : { stateReason: card.stateReason }),
      labels: card.labels,
      prs: card.prs.map(number => ({ number })),
      comments: card.comments,
    })

    return {
      ...made,
      content: {
        ...made.content,
        assignees: { nodes: card.assignees.map(login => ({ login })) },
      },
    }
  }

  const answer = (argv: readonly string[], stdin?: string): Reply => {
    const [tool, one, two] = argv
    const key = argv.slice(1, 3).join(' ')
    const failure = world.fail[key] ?? world.fail[String(one)]
    if (failure !== undefined) return failure

    if (tool === 'git') {
      return { stdout: `git@github.com:${REPO}.git\n` }
    }
    if (one === '--version') return { stdout: 'gh version 2.62.0\n' }
    if (one === 'auth') return {}
    if (one === 'api' && two === 'user') return { stdout: `${viewer}\n` }
    if (one === 'api' && two === 'rate_limit') {
      return { stdout: '{"remaining":4998,"reset":0}' }
    }
    if (one === 'api' && two === 'graphql') {
      if (!queryOf(argv).includes(POSITION)) {
        const reply = boardReply(cards.map(node), undefined, viewer, options)(argv)
        if (!queryOf(argv).includes('readme')) return reply

        // The first page carries the board's README.
        const data = JSON.parse(reply.stdout ?? '{}')
        data.data.node.readme = world.readme

        return { stdout: JSON.stringify(data) }
      }
      const at = cards.findIndex(
        card => `PVTI_${card.number}` === field(argv, 'itemId'),
      )
      const [moved] = cards.splice(at, 1)
      const after = field(argv, 'afterId')
      if (moved !== undefined) {
        cards.splice(
          after === undefined
            ? 0
            : cards.findIndex(card => `PVTI_${card.number}` === after) + 1,
          0,
          moved,
        )
      }

      return { stdout: `{"data":{"${POSITION}":{}}}` }
    }
    if (one === 'project' && two === 'item-edit') {
      const card = cards.find(c => `PVTI_${c.number}` === flag(argv, '--id'))
      const status = NAME_OF[flag(argv, '--single-select-option-id') ?? '']
      if (card !== undefined && status !== undefined) card.status = status

      return {}
    }
    if (one === 'project' && two === 'view') return { stdout: `${world.readme}\n` }
    if (one === 'project' && two === 'edit') {
      world.readme = flag(argv, '--readme') ?? world.readme

      return {}
    }
    if (one === 'project' && two === 'item-add') {
      const number = Number(/\/issues\/(\d+)$/.exec(flag(argv, '--url') ?? '')?.[1])

      return { stdout: JSON.stringify({ id: `PVTI_${number}`, type: 'Issue' }) }
    }
    if (one === 'label' && two === 'list') {
      return { stdout: 'ai\nhuman\ntriage\nsuspended\n' }
    }
    if (one === 'label') return {}
    if (one === 'pr' && two === 'diff') {
      return { stdout: `diff --git a/README.md b/README.md\n+pr ${argv[3]}\n` }
    }

    if (one === 'issue') {
      if (two === 'create') {
        const number = Math.max(0, ...cards.map(card => card.number)) + 1
        const assignee = flag(argv, '--assignee')
        cards.push({
          ...issue(number, { title: flag(argv, '--title') ?? '' }, stdin ?? ''),
          labels: [flag(argv, '--label') ?? 'triage'],
          status: undefined,
          assignees: assignee === undefined ? [] : [assignee],
        })

        return { stdout: `https://github.com/${REPO}/issues/${number}\n` }
      }

      const card = world.card(Number(argv[3]))
      switch (two) {
        case 'view': {
          const json = flag(argv, '--json') ?? ''
          if (json.startsWith('state')) {
            return {
              stdout: json.includes('stateReason')
                ? `${card.state} ${card.stateReason ?? ''}\n`
                : `${card.state}\n`,
            }
          }

          return {
            stdout: JSON.stringify({
              body: card.body,
              comments: card.comments.map(comment => ({
                body: comment.body,
                createdAt: comment.createdAt,
                author: { login: comment.author },
              })),
              url: `https://github.com/${REPO}/issues/${card.number}`,
              state: card.state,
            }),
          }
        }
        case 'comment':
          card.comments.push({
            body: stdin ?? '',
            createdAt: stamp(),
            author: viewer,
          })

          return {}
        case 'close':
          card.state = 'CLOSED'
          card.stateReason =
            flag(argv, '--reason') === 'not planned' ? 'NOT_PLANNED' : 'COMPLETED'

          return {}
        case 'reopen':
          card.state = 'OPEN'
          card.stateReason = 'REOPENED'

          return {}
        case 'edit': {
          argv.forEach((part, index) => {
            const label = argv[index + 1]
            if (label === undefined) return
            if (part === '--add-label' && !card.labels.includes(label))
              card.labels.push(label)
            if (part === '--remove-label')
              card.labels = card.labels.filter(
                one => one.toLowerCase() !== label.toLowerCase(),
              )
            if (part === '--add-assignee' && !card.assignees.includes(label))
              card.assignees.push(label)
            if (part === '--remove-assignee')
              card.assignees = card.assignees.filter(one => one !== label)
          })

          return {}
        }
      }
    }

    throw new Error(`fake github: no answer for ${argv.join(' ')}`)
  }

  // A read leaves GitHub as it is: the board query, an issue viewed, a lookup.
  const isRead = (argv: readonly string[]) =>
    argv[0] === 'git' ||
    (argv[1] === 'api' && !queryOf(argv).includes(POSITION)) ||
    argv[2] === 'view' ||
    argv[2] === 'list' ||
    argv[2] === 'diff' ||
    argv[1] === '--version' ||
    argv[1] === 'auth'

  on('process.run', async (_, e) => {
    await (isRead(e.argv) ? world.holdReads : world.hold)
    const call = {
      argv: e.argv,
      ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }),
    }
    world.commands.push(call)
    const reply = answer(e.argv, e.init?.stdin)

    return {
      value: {
        exitCode: reply.exitCode ?? 0,
        stdout: reply.stdout ?? '',
        stderr: reply.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  return world
}

/**
 * The engine beneath the plugin, as `boot` makes it, over a repo whose
 * CLAUDE.md names the board and a GitHub that holds `cards`.
 */
export function bootGithub(
  on: On,
  cards: FakeCard[],
  store?: Record<string, unknown>,
  opts?: Parameters<typeof fakeGithub>[2],
) {
  const engine = boot(on, { 'CLAUDE.md': KANBAN }, store)
  const github = fakeGithub(on, cards, opts)

  return { ...engine, github }
}

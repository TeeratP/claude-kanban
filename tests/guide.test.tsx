import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, boot, card, path } from './fakes'
import { boardReply, fakeProcess, issueNode } from './fake-gh'
import type { Route } from './fake-gh'
import { KANBAN, github } from './github-board'
import {
  ALL_STATUSES,
  BABY,
  GH_VERSION,
  SIGNED_IN,
  fieldList,
  graphql,
  lines,
  remote,
} from './zero'
import type { FakeProject } from './zero'

const LIST = 'mcp__kanban__kanban_list'
const COMPOSE = {
  model: 'model',
  promptModel: 'model',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const RULES = [
  'Keep it current with the kanban tools:',
  '- Asked to work the backlog, or given no task: take the top Backlog card (kanban_list) and kanban_move it to claude before writing code.',
  '- When the work a card tracks is done, record kanban_handoff, then kanban_move it to human. Never move a card to done: the person approves it.',
  '- Blocked on a decision only the person can make: kanban_ask.',
  '- Follow-ups: kanban_suggest. Use kanban_create only when asked.',
  '- Never move cards into or out of Suspended or Cancelled.',
  '- Use the kanban tools, not raw gh issue/gh project edits or hand edits of .kanban files, so the board stays in sync.',
].join('\n')

const cards = () => ({
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
})

const ORIGIN = 'https://github.com/TeeratP/attend-baby.git'
const SHARED: FakeProject = {
  number: 2,
  title: "@TeeratP's Kanban",
  items: { [BABY]: 50 },
}
const LIMITED = 'GraphQL: API rate limit already exceeded for user ID 1.'
const GITHUB_2 = {
  kind: 'github',
  repo: BABY,
  owner: 'TeeratP',
  projectNumber: 2,
  projectId: 'PVT_2',
  statusFieldId: 'PVTSSF_zero',
  options: {
    backlog: 'o-Backlog',
    inProgress: 'o-In progress',
    inReview: 'o-In review',
    done: 'o-Done',
  },
  title: "@TeeratP's Kanban",
} as const
// What an earlier session left in the store.
const DETECTED = {
  [`detect:${CWD}`]: {
    shape: 'detect-1',
    origin: ORIGIN,
    info: { ...GITHUB_2, isDetected: true },
  },
}
const savedBoard = (mode: string, backend: object) => ({
  [`cache:${CWD}`]: { shape: 'cache-2', mode, backend, cards: [] },
})

// Zero-config detection finds the shared board, which holds one issue.
const found: Route[] = [
  GH_VERSION,
  SIGNED_IN,
  remote(ORIGIN),
  graphql({
    linked: [SHARED],
    load: boardReply([issueNode({ number: 20, repo: BABY })]),
  }),
  fieldList(ALL_STATUSES),
]

// Holds every command until `go` is called: the detection stays in flight.
function gate() {
  let go = () => {}
  const held = new Promise<void>(resolve => {
    go = resolve
  })

  return { held, go }
}

const lookups = (commands: readonly { argv: readonly string[] }[]) =>
  lines(commands).filter(
    line => line.startsWith('gh api graphql') && line.includes('-f o='),
  )

// The engine's own sections, which the plugin's follow.
function fakeCompose(on: On) {
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' as const },
    ],
  }))
}

async function backlogSection($: Engine, traits: readonly string[] = []) {
  const { sections } = await $.prompt.compose({
    ...COMPOSE,
    traits: traits as typeof COMPOSE.traits,
  })

  return sections.find(one => one.id === 'kanban:backlog')
}

test('on GitHub the section names the board and states the rules', async ($, on) => {
  boot(on, { 'CLAUDE.md': KANBAN })
  github(on)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: LIST })

  const section = await backlogSection($)

  expect(section).toEqual({
    id: 'kanban:backlog',
    text: `This project's backlog is GitHub Issues on board TeeratP/#7. ${RULES}`,
    scope: 'session',
  })
})

test('on local cards the section names the card files', async ($, on) => {
  boot(on, cards())
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: LIST })

  const section = await backlogSection($)

  expect(section?.text).toBe(
    `This project's backlog is the .kanban/*.md cards. ${RULES}`,
  )
})

test('while the backend is still being found the section says only that there is a board', async ($, on) => {
  const { held, go } = gate()
  boot(on, cards())
  fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const section = await backlogSection($)
  go()

  expect(section?.text).toBe(
    `This project's backlog is a kanban board. ${RULES}`,
  )
})

test('the section follows the backend as it is found', async ($, on) => {
  const { held, go } = gate()
  const { clock } = boot(on, cards())
  fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await backlogSection($)
  go()
  await clock.settle()
  const after = await backlogSection($)

  expect(before?.text).toContain('a kanban board.')
  expect(after?.text).toContain('GitHub Issues on board TeeratP/#2.')
})

test('a board a detection saved names the section with no call to gh', async ($, on) => {
  const { clock } = boot(on, cards(), DETECTED)
  const commands = fakeProcess(on, [])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const section = await backlogSection($)

  expect(section?.text).toBe(
    `This project's backlog is GitHub Issues on board TeeratP/#2. ${RULES}`,
  )
  expect(commands).toEqual([])
})

test('the backend the last load saved names the section: a GitHub board', async ($, on) => {
  const { clock } = boot(on, cards(), savedBoard('auto', GITHUB_2))
  const commands = fakeProcess(on, [])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toContain(
    'GitHub Issues on board TeeratP/#2.',
  )
  expect(commands).toEqual([])
})

test('the backend the last load saved names the section: local cards', async ($, on) => {
  const { clock } = boot(on, cards(), savedBoard('auto', { kind: 'local' }))
  const commands = fakeProcess(on, [])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toBe(
    `This project's backlog is the .kanban/*.md cards. ${RULES}`,
  )
  expect(commands).toEqual([])
})

test('a board saved under another setting names nothing, and the backend is found again', async ($, on) => {
  const { held, go } = gate()
  const { clock } = boot(on, cards(), savedBoard('github', GITHUB_2))
  const commands = fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await backlogSection($)
  go()
  await clock.settle()

  expect(before?.text).toContain('a kanban board.')
  expect(lookups(commands)).toHaveLength(1)
})

test('with nothing saved, auto finds the backend once at the session start, quietly, and saves it', async ($, on) => {
  const { clock, toasts, world, saved } = boot(on, cards())
  const commands = fakeProcess(on, found)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toContain(
    'GitHub Issues on board TeeratP/#2.',
  )
  expect(lookups(commands)).toHaveLength(1)
  expect(world.opened).toEqual([])
  expect(toasts).toEqual([])
  expect(saved.has(`detect:${CWD}`)).toBe(true)
  expect(saved.has(`cache:${CWD}`)).toBe(true)

  // The board the pane or a tool loads next detects nothing again.
  await $.tool.call({ tool: LIST })
  expect(lookups(commands)).toHaveLength(1)
  expect(lines(commands).filter(line => line === 'gh --version')).toHaveLength(
    1,
  )
})

test('a tool called while the session-start detection runs shares it', async ($, on) => {
  const { held, go } = gate()
  const { clock } = boot(on, cards())
  const commands = fakeProcess(on, found, held)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const listed = $.tool.call({ tool: LIST })
  go()
  await listed
  await clock.settle()

  expect(lookups(commands)).toHaveLength(1)
})

test('a rate limit while finding the backend is silent, and leaves it to be found later', async ($, on) => {
  const { clock, toasts, world, saved } = boot(on, cards())
  const commands = fakeProcess(on, [
    GH_VERSION,
    SIGNED_IN,
    remote(ORIGIN),
    graphql({ failure: LIMITED }),
    {
      match: ['gh', 'api', 'rate_limit'],
      reply: { stdout: '{"remaining":0,"reset":1793000000}' },
    },
  ])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toContain('a kanban board.')
  expect(toasts).toEqual([])
  expect(world.opened).toEqual([])
  expect(lookups(commands)).toHaveLength(1)
  expect(saved.has(`detect:${CWD}`)).toBe(false)
  expect(saved.has(`cache:${CWD}`)).toBe(false)
})

test(
  'the local setting says .kanban at once and finds nothing',
  { options: { backend: 'local' } },
  async ($, on) => {
    const { clock } = boot(on, cards())
    const commands = fakeProcess(on, [])
    fakeCompose(on)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })

    const early = await backlogSection($)
    await clock.settle()

    expect(early?.text).toBe(
      `This project's backlog is the .kanban/*.md cards. ${RULES}`,
    )
    expect(commands).toEqual([])
  },
)

test(
  'the github setting says GitHub at once and finds nothing',
  { options: { backend: 'github' } },
  async ($, on) => {
    const { clock } = boot(on, cards())
    const commands = fakeProcess(on, [])
    fakeCompose(on)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })

    const early = await backlogSection($)
    await clock.settle()

    expect(early?.text).toBe(
      `This project's backlog is GitHub Issues. ${RULES}`,
    )
    expect(commands).toEqual([])
  },
)

test(
  'the github setting names the board once one is saved',
  { options: { backend: 'github' } },
  async ($, on) => {
    const { clock } = boot(on, cards(), DETECTED)
    fakeProcess(on, [])
    fakeCompose(on)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await clock.settle()

    expect((await backlogSection($))?.text).toContain(
      'GitHub Issues on board TeeratP/#2.',
    )
  },
)

test('the section comes once, after the engine and the suggest section, and is short', async ($, on) => {
  boot(on, cards())
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const first = await $.prompt.compose(COMPOSE)
  const second = await $.prompt.compose(COMPOSE)

  expect(first.sections.map(one => one.id)).toEqual([
    'intro',
    'kanban:suggest',
    'kanban:backlog',
  ])
  expect(second.sections.map(one => one.id)).toEqual(
    first.sections.map(one => one.id),
  )
  expect(first.sections[2]?.text.length).toBeLessThan(900)
})

test('the one-line bare prompt gets no section', async ($, on) => {
  boot(on, cards())
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await backlogSection($, ['bare'])).toBeUndefined()
})

test('a prompt that already holds the section is not given a second', async ($, on) => {
  boot(on, cards())
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' as const },
      {
        id: 'kanban:backlog',
        text: 'Already here.',
        scope: 'session' as const,
      },
    ],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const { sections } = await $.prompt.compose(COMPOSE)

  expect(
    sections.filter(one => one.id === 'kanban:backlog').map(one => one.text),
  ).toEqual(['Already here.'])
})

test(
  'the reconcile option turns off the turn-end check, not the section',
  { options: { reconcile: false } },
  async ($, on) => {
    boot(on, cards())
    fakeCompose(on)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })

    expect(await backlogSection($)).toBeDefined()
  },
)

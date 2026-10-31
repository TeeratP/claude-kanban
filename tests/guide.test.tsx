import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, boot } from './fakes'
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
  '- When the work a card tracks is finished: record kanban_handoff (what you did, how to check it), then kanban_move it to done, which closes the issue.',
  "- Move a card to human only when it needs the person: an approval the card asks for, or something only they can do or verify. Record a handoff that says what you need first.",
  '- Blocked on a decision only the person can make: kanban_ask.',
  '- Create cards with kanban_create only when asked.',
  '- Never move cards into or out of Suspended or Cancelled.',
  '- Use the kanban tools, not raw gh issue/gh project edits, so the board stays in sync.',
].join('\n')

// No CLAUDE.md names a board: the plugin finds one from the origin.
const NO_CONFIG = {}

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
const savedBoard = (backend: object) => ({
  [`cache:${CWD}`]: { shape: 'cache-3', backend, cards: [] },
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

test('while the board is still being found the section says only that the backlog is GitHub Issues', async ($, on) => {
  const { held, go } = gate()
  boot(on, NO_CONFIG)
  fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const section = await backlogSection($)
  go()

  expect(section?.text).toBe(`This project's backlog is GitHub Issues. ${RULES}`)
})

test('the section follows the board as it is found', async ($, on) => {
  const { held, go } = gate()
  const { clock } = boot(on, NO_CONFIG)
  fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await backlogSection($)
  go()
  await clock.settle()
  const after = await backlogSection($)

  expect(before?.text).toContain('GitHub Issues. ')
  expect(after?.text).toContain('GitHub Issues on board TeeratP/#2.')
})

test('a board a detection saved names the section with no call to gh', async ($, on) => {
  const { clock } = boot(on, NO_CONFIG, DETECTED)
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

test('the board the last load saved names the section', async ($, on) => {
  const { clock } = boot(on, NO_CONFIG, savedBoard(GITHUB_2))
  const commands = fakeProcess(on, [])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toContain(
    'GitHub Issues on board TeeratP/#2.',
  )
  expect(commands).toEqual([])
})

test('a board saved by an older version names nothing, and the board is found again', async ($, on) => {
  const { held, go } = gate()
  // The shape before the backend setting went: it carried the setting's mode.
  const { clock } = boot(on, NO_CONFIG, {
    [`cache:${CWD}`]: {
      shape: 'cache-2',
      mode: 'auto',
      backend: GITHUB_2,
      cards: [],
    },
  })
  const commands = fakeProcess(on, found, held)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await backlogSection($)
  go()
  await clock.settle()

  expect(before?.text).toBe(`This project's backlog is GitHub Issues. ${RULES}`)
  expect(lookups(commands)).toHaveLength(1)
})

test('with nothing saved, the board is found once at the session start, quietly, and saves it', async ($, on) => {
  const { clock, toasts, world, saved } = boot(on, NO_CONFIG)
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

test('a session-start detection that finds no board names GitHub Issues and saves nothing', async ($, on) => {
  const { clock, saved } = boot(on, NO_CONFIG)
  fakeProcess(on, [])
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect((await backlogSection($))?.text).toBe(
    `This project's backlog is GitHub Issues. ${RULES}`,
  )
  expect(saved.has(`detect:${CWD}`)).toBe(false)
  expect(saved.has(`cache:${CWD}`)).toBe(false)
})

test('a tool called while the session-start detection runs shares it', async ($, on) => {
  const { held, go } = gate()
  const { clock } = boot(on, NO_CONFIG)
  const commands = fakeProcess(on, found, held)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const listed = $.tool.call({ tool: LIST })
  go()
  await listed
  await clock.settle()

  expect(lookups(commands)).toHaveLength(1)
})

test('a rate limit while finding the board is silent, and leaves it to be found later', async ($, on) => {
  const { clock, toasts, world, saved } = boot(on, NO_CONFIG)
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

  expect((await backlogSection($))?.text).toBe(
    `This project's backlog is GitHub Issues. ${RULES}`,
  )
  expect(toasts).toEqual([])
  expect(world.opened).toEqual([])
  expect(lookups(commands)).toHaveLength(1)
  expect(saved.has(`detect:${CWD}`)).toBe(false)
  expect(saved.has(`cache:${CWD}`)).toBe(false)
})

test('the section tells Claude to close finished cards and send only what needs the person to Human', async ($, on) => {
  boot(on, NO_CONFIG)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const text = (await backlogSection($))?.text ?? ''

  expect(text).toContain(
    'record kanban_handoff (what you did, how to check it), then kanban_move it to done, which closes the issue.',
  )
  expect(text).toContain(
    'Move a card to human only when it needs the person: an approval the card asks for, or something only they can do or verify.',
  )
  expect(text).not.toContain('Never move a card to done')
  expect(text).not.toContain('.kanban')
})

test('the section comes once, after the engine section, and is short', async ($, on) => {
  boot(on, NO_CONFIG)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const first = await $.prompt.compose(COMPOSE)
  const second = await $.prompt.compose(COMPOSE)

  expect(first.sections.map(one => one.id)).toEqual([
    'intro',
    'kanban:backlog',
  ])
  expect(second.sections.map(one => one.id)).toEqual(
    first.sections.map(one => one.id),
  )
  expect(first.sections[1]?.text.length).toBeLessThan(900)
})

test('the one-line bare prompt gets no section', async ($, on) => {
  boot(on, NO_CONFIG)
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await backlogSection($, ['bare'])).toBeUndefined()
})

test('a prompt that already holds the section is not given a second', async ($, on) => {
  boot(on, NO_CONFIG)
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
    boot(on, NO_CONFIG)
    fakeCompose(on)
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })

    expect(await backlogSection($)).toBeDefined()
  },
)

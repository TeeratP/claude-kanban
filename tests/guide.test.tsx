import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { boot, card, path } from './fakes'
import { KANBAN, github } from './github-board'

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
  boot(on, cards())
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const section = await backlogSection($)

  expect(section?.text).toBe(
    `This project's backlog is a kanban board. ${RULES}`,
  )
})

test('the section follows the backend as it is found', async ($, on) => {
  boot(on, cards())
  fakeCompose(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await backlogSection($)
  await $.tool.call({ tool: LIST })
  const after = await backlogSection($)

  expect(before?.text).toContain('a kanban board.')
  expect(after?.text).toContain('the .kanban/*.md cards.')
})

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

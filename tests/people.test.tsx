import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanCard } from '../types'
import {
  cleanName,
  nameOf,
  nextWho,
  ownerOf,
  parsePeople,
  whoCards,
  withName,
} from '../hooks/people'
import { click, row, rowKeys, toolbar, under } from './board-ui'
import { PANE, RUN, SYNC_PAUSE } from './fakes'
import { bootGithub, issue } from './fake-github'
import type { FakeCard } from './fake-github'

const README = [
  'Our team board.',
  '',
  '<!-- kanban:people',
  'TeeratP: Teerat',
  'alice: Alice Smith',
  '-->',
].join('\n')

// Mine (TeeratP), Alice's, and nobody's, across the three active sections.
const cards = (): FakeCard[] => [
  issue(1, { column: 'backlog', title: 'Mine to do', assignees: ['TeeratP'] }),
  issue(2, { column: 'backlog', title: 'Up for grabs', assignees: [] }),
  issue(3, { column: 'backlog', title: 'Alice to do', assignees: ['alice'] }),
  issue(4, { column: 'human', title: 'Alice reviews', assignees: ['alice'] }),
  issue(5, { column: 'human', title: 'I review', assignees: ['TeeratP'] }),
]

async function open($: Engine, on: On, readme = README, list = cards()) {
  const world = bootGithub(on, list, undefined, { readme })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, ui }
}

const cardOf = (number: number, assignees?: string[]): KanbanCard => ({
  id: `gh:${number}`,
  number,
  title: `Card ${number}`,
  column: 'backlog',
  order: number,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
  ...(assignees === undefined ? {} : { assignees }),
})

test('the people block is read by login, and other README text is no name', () => {
  expect(parsePeople(README)).toEqual({ TeeratP: 'Teerat', alice: 'Alice Smith' })
  expect(parsePeople('No block here.\nTeeratP: Teerat')).toEqual({})
  expect(
    parsePeople('<!-- kanban:people\nnot a login!: x\nbob:   \n  carol :  Carol  \n-->'),
  ).toEqual({ carol: 'Carol' })
})

test('a new name changes one line of the block and leaves the rest of the README', () => {
  const renamed = withName(README, 'TeeratP', 'Tee')

  expect(renamed.startsWith('Our team board.\n\n<!-- kanban:people\n')).toBe(true)
  expect(parsePeople(renamed)).toEqual({ alice: 'Alice Smith', TeeratP: 'Tee' })
  // A login's case does not make a second line.
  expect(parsePeople(withName(README, 'teeratp', 'T'))).toEqual({
    alice: 'Alice Smith',
    teeratp: 'T',
  })
  // An empty name goes back to the login.
  expect(parsePeople(withName(README, 'alice', '  '))).toEqual({
    TeeratP: 'Teerat',
  })
  // A README with no block gets one at the end; an empty one is only the block.
  expect(withName('Notes.', 'bob', 'Bob')).toBe(
    'Notes.\n\n<!-- kanban:people\nbob: Bob\n-->',
  )
  expect(withName('', 'bob', 'Bob')).toBe('<!-- kanban:people\nbob: Bob\n-->')
})

test('a name is one trimmed line of at most 40 characters', () => {
  expect(cleanName('  Teerat \n P ')).toBe('Teerat P')
  expect(cleanName('x'.repeat(60))).toHaveLength(40)
})

test('a name falls back to the login, matched without regard to case', () => {
  const people = parsePeople(README)

  expect(nameOf(people, 'ALICE')).toBe('Alice Smith')
  expect(nameOf(people, 'bob')).toBe('bob')
  expect(nameOf(undefined, 'bob')).toBe('bob')
})

test('the views keep my cards, mine and nobody’s, or all; no viewer known keeps all', () => {
  const list = [cardOf(1, ['TeeratP']), cardOf(2), cardOf(3, ['alice']), cardOf(4, ['alice', 'teeratp'])]
  const numbers = (shown: readonly KanbanCard[]) => shown.map(one => one.number)

  expect(numbers(whoCards(list, 'mine', 'TeeratP'))).toEqual([1, 4])
  expect(numbers(whoCards(list, 'open', 'TeeratP'))).toEqual([1, 2, 4])
  expect(numbers(whoCards(list, 'all', 'TeeratP'))).toEqual([1, 2, 3, 4])
  expect(numbers(whoCards(list, 'mine', undefined))).toEqual([1, 2, 3, 4])
  expect(nextWho('mine')).toBe('open')
  expect(nextWho('open')).toBe('all')
  expect(nextWho('all')).toBe('mine')
})

test('a row names whose card it is only when it is someone else’s', () => {
  const people = parsePeople(README)

  expect(ownerOf(cardOf(1, ['TeeratP']), 'TeeratP', people)).toBe('')
  expect(ownerOf(cardOf(2), 'TeeratP', people)).toBe('')
  expect(ownerOf(cardOf(3, ['alice']), 'TeeratP', people)).toBe('Alice Smith')
  expect(ownerOf(cardOf(4, ['alice', 'TeeratP']), 'TeeratP', people)).toBe('')
})

test('the pane opens on my cards and v steps to mine and nobody’s, then everyone’s', async ($, on) => {
  const { ui } = await open($, on)

  expect((await toolbar(ui))[1]).toContain('v: Mine')
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:1'])
  expect(await under(ui, 'hdr:human')).toEqual(['card:gh:5'])

  await ui.press({ key: 'who' })
  expect((await toolbar(ui))[1]).toContain('v: Mine + open')
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:1', 'card:gh:2'])

  await ui.press({ key: 'who' })
  expect((await toolbar(ui))[1]).toContain('v: Everyone')
  expect(await under(ui, 'hdr:backlog')).toEqual([
    'card:gh:1',
    'card:gh:2',
    'card:gh:3',
  ])
  // Someone else's card says whose it is, by the name they picked; mine and nobody's do not.
  expect((await row(ui, 'card:gh:3'))?.text).toMatch(/Alice to do Alice S… +12d$/)
  expect((await row(ui, 'card:gh:1'))?.text).not.toContain('Teerat')

  await ui.press({ key: 'who' })
  expect((await toolbar(ui))[1]).toContain('v: Mine')
  await ui.unmount()
})

test('only my cards and nobody’s count as waiting on me', async ($, on) => {
  const { statuses, ui } = await open($, on)

  // Card 4 in Human is Alice's.
  expect(statuses.at(-1)).toBe('1 card waiting on you')
  await ui.unmount()
})

test('the Owner row gives the card to someone, to me or to nobody, by login', async ($, on) => {
  const { clock, github, ui } = await open($, on)
  await click(ui, 'card:gh:1')

  expect(await ui.find({ type: 'Text', text: '✓ Teerat' })).toBeDefined()
  expect(await ui.find({ key: 'owner:TeeratP' })).toBeUndefined()
  await ui.press({ key: 'owner:alice' })
  await clock.settle()
  expect(github.card(1).assignees).toEqual(['alice'])
  expect(github.commands.at(-1)?.argv).toEqual([
    'gh',
    'issue',
    'edit',
    '1',
    '--repo',
    'TeeratP/claude-kanban',
    '--add-assignee',
    'alice',
    '--remove-assignee',
    'TeeratP',
  ])

  await ui.press({ key: 'owner:nobody' })
  await clock.settle()
  expect(github.card(1).assignees).toEqual([])
  await ui.unmount()
})

test('a new name is saved to the board README for everyone, and no issue changes', async ($, on) => {
  const { clock, github, toasts, ui } = await open($, on)
  const before = github.cards.map(one => [...one.assignees])
  await ui.press({ key: 'settings' })

  expect((await ui.find({ key: 'name:change' }))?.text).toBe('Change')
  await ui.press({ key: 'name:change' })
  await ui.input({ key: 'name:field', text: 'Tee' })
  await clock.settle()

  expect(parsePeople(github.readme)).toEqual({
    TeeratP: 'Tee',
    alice: 'Alice Smith',
  })
  expect(github.readme.startsWith('Our team board.')).toBe(true)
  expect(github.cards.map(one => one.assignees)).toEqual(before)
  expect(toasts).toContain('Your name is now Tee.')
  expect(await ui.find({ key: 'name:field' })).toBeUndefined()
  await ui.unmount()
})

test('a card I add is mine, and a card nobody has becomes mine when it goes to Claude', async ($, on) => {
  const { clock, github, ui } = await open($, on)

  await ui.press({ key: 'add' })
  await ui.input({ key: 'add:title', text: 'Fresh work' })
  await clock.settle()
  expect(github.card(6).assignees).toEqual(['TeeratP'])

  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 2, to: 'claude' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  expect(github.card(2).assignees).toEqual(['TeeratP'])
  // Alice's card stays hers.
  await $.tool.call({ tool: 'mcp__kanban__kanban_move', card: 3, to: 'claude' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  expect(github.card(3).assignees).toEqual(['alice'])
  await ui.unmount()
})

test('Claude’s list leaves out other people’s cards unless it asks for all', async ($, on) => {
  const { ui } = await open($, on)

  const mine = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })
  expect(mine).toMatchObject({
    result: expect.stringContaining('#2 [backlog] Up for grabs'),
  })
  expect(JSON.stringify(mine)).not.toContain('Alice to do')
  expect(JSON.stringify(mine)).toContain(
    '2 cards assigned to other people are left out',
  )

  const all = await $.tool.call({ tool: 'mcp__kanban__kanban_list', all: true })
  expect(all).toMatchObject({
    result: expect.stringContaining('#3 [backlog] Alice to do @alice'),
  })
  expect((await rowKeys(ui)).length).toBeGreaterThan(0)
  await ui.unmount()
})

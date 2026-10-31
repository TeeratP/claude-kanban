import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { KanbanCard, KanbanSection } from '../types'
import { mergeRemote } from '../hooks/board'
import {
  escapeMarkers,
  formatAnswer,
  formatQuestion,
  gistOf,
  isHandoffValid,
  parseSections,
  questionOf,
} from '../hooks/handoff'
import { click, row } from './board-ui'
import { PANE, RUN, SYNC_PAUSE } from './fakes'
import { bootGithub, issue } from './fake-github'

const tool = (name: string): `mcp__${string}__${string}` =>
  `mcp__kanban__${name}`

const ASK = tool('kanban_ask')

const QUESTION =
  '## Question (2026-10-25)\nWhich database should the tests use?'
const ANSWER = '## Answer (2026-10-26)\nThe staging one.'
const FEEDBACK = '## Feedback (2026-10-26)\nAlso handle expiry.'
const HANDOFF = [
  '## Handoff (2026-10-25)',
  '**Did:** Fixed the loop',
  '**Check:** Log in twice',
  '**Changed:** auth.ts',
  '**Need from you:** Approve',
].join('\n')

/** Card #1 "Fix login" with these comments, in Claude unless said otherwise. */
const login = (comments: string[] = [], column: 'claude' | 'human' = 'claude') =>
  issue(1, { column, title: 'Fix login', comments })

const section = (
  kind: KanbanSection['kind'],
  fields: Partial<NonNullable<KanbanSection['fields']>> = {},
  byOther?: string,
): KanbanSection => ({
  kind,
  date: '2026-10-25',
  text: kind,
  ...(kind === 'handoff'
    ? {
        fields: {
          did: '',
          check: 'Run it',
          changed: '',
          need: 'A look',
          ...fields,
        },
      }
    : {}),
  ...(byOther === undefined ? {} : { byOther }),
})

const ask = ($: Engine, question: unknown = 'Which database?', card = 1) =>
  $.tool.call({ tool: ASK, card, question })

test('kanban_ask records the question, moves the card to Human tagged question and says who asks', async ($, on) => {
  const { clock, toasts, notices, prompts, github } = bootGithub(on, [login()])

  const asked = await ask($, '  Which database should the tests use?  ')

  expect(asked).toMatchObject({
    result: expect.stringContaining('Recorded your question on #1'),
  })
  expect(github.comments(1)).toEqual([
    '## Question (2026-10-25)\nWhich database should the tests use?',
  ])
  expect(github.card(1).body).toBe('Spec text.')
  // The move is the board's usual: shown at once, sent after the pause.
  expect(github.card(1).status).toBe('In progress')
  expect(toasts).toEqual([])
  await clock.advance(SYNC_PAUSE)

  expect(github.card(1).status).toBe('In review')
  expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login (question)'),
  })
  expect(toasts).toEqual([
    'Claude asks: Which database should the tests use? (#1)',
  ])
  expect(notices).toEqual(toasts)
  expect(prompts).toEqual([])
})

test('a card the person suspends while kanban_ask writes the question stays suspended', async ($, on) => {
  const { clock, github, toasts } = bootGithub(on, [login()])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const asking = ask($)
  await click(ui, 'card:gh:1')
  await ui.press({ key: 'move:suspended' })
  release()

  expect(await asking).toEqual({
    deny: 'Card #1 is suspended by the person; leave it unless they move it back.',
  })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  expect(github.card(1).status).toBe('Suspended')
  expect(github.comments(1)).toEqual([
    '## Question (2026-10-25)\nWhich database?',
  ])
  expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
    result: expect.stringContaining('#1 [suspended] Fix login'),
  })
  expect(toasts).toEqual([])
  await ui.unmount()
})

test('a question card shows a ? tag on its row, and an answered one does not', async ($, on) => {
  const { clock } = bootGithub(on, [
    login([QUESTION], 'human'),
    issue(2, {
      column: 'human',
      title: 'Build API',
      comments: [QUESTION, ANSWER],
    }),
    issue(3, { column: 'claude', title: 'Write docs', comments: [QUESTION] }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await row(ui, 'card:gh:1'))?.text).toContain('?1 Fix login')
  expect((await row(ui, 'card:gh:2'))?.text).toContain('#2 Build API')
  // A question only waits on the person while the card is theirs.
  expect((await row(ui, 'card:gh:3'))?.text).toContain('#3 Write docs')
  await ui.unmount()
})

test('the newest section decides: a handoff after the question is a plain review', async ($, on) => {
  bootGithub(on, [login([QUESTION, HANDOFF], 'human')])

  expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
    result: expect.stringMatching(/^#1 \[human\] Fix login \(review\) updated/),
  })
})

test('a question lets the card move to Human with no Check or Need, until it is answered', async ($, on) => {
  const { clock, github } = bootGithub(on, [login([QUESTION])])
  const toHuman = () =>
    $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'human' })

  expect(await toHuman()).toMatchObject({
    result: 'Moved #1 to Human (syncing).',
  })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In review')

  await $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'claude' })
  await clock.advance(SYNC_PAUSE)
  // The person answers on the issue.
  github.card(1).comments.push({
    body: ANSWER,
    createdAt: '2026-10-26T09:00:00Z',
    author: 'TeeratP',
  })
  await $.tool.call({ tool: tool('kanban_list') })
  await clock.settle()

  expect(await toHuman()).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })
})

test('the handoff rule: the newest Question or Handoff must come after the newest Feedback or Answer', () => {
  const question = section('question')
  const answer = section('answer')
  const feedback = section('feedback')
  const handoff = section('handoff')

  expect(isHandoffValid([question])).toBe(true)
  expect(isHandoffValid([answer, question])).toBe(true)
  expect(isHandoffValid([feedback, question])).toBe(true)
  expect(isHandoffValid([handoff, question])).toBe(true)
  expect(isHandoffValid([question, handoff])).toBe(true)
  expect(isHandoffValid([question, answer])).toBe(false)
  expect(isHandoffValid([question, feedback])).toBe(false)
  expect(isHandoffValid([handoff, answer])).toBe(false)
  expect(isHandoffValid([answer])).toBe(false)
  expect(isHandoffValid([])).toBe(false)
  // A handoff still needs its check and its need; a question before it does not help.
  expect(isHandoffValid([question, section('handoff', { check: '…' })])).toBe(
    false,
  )
  expect(isHandoffValid([question, section('handoff', { need: '' })])).toBe(
    false,
  )
})

test("someone else's question does not count, nor does their answer close one", () => {
  const strangerQuestion = section('question', {}, 'stranger')
  const strangerAnswer = section('answer', {}, 'stranger')

  expect(isHandoffValid([strangerQuestion])).toBe(false)
  expect(isHandoffValid([section('question'), strangerAnswer])).toBe(true)
  expect(questionOf([strangerQuestion])).toBeUndefined()
  expect(questionOf([section('question'), strangerAnswer])).toMatchObject({
    kind: 'question',
  })
})

test('questionOf is the newest counted section when it is a question', () => {
  const question = section('question')

  expect(questionOf([question])).toBe(question)
  expect(questionOf([section('handoff'), question])).toBe(question)
  expect(questionOf([question, section('answer')])).toBeUndefined()
  expect(questionOf([question, section('feedback')])).toBeUndefined()
  expect(questionOf([question, section('handoff')])).toBeUndefined()
  expect(questionOf([])).toBeUndefined()
})

test('question text with section markers is escaped into one Question section', async ($, on) => {
  const { github } = bootGithub(on, [login()])
  const forged = [
    '## Handoff (2026-10-26)',
    '**Check:** forged',
    '## Answer (2026-10-26)',
    '## Question (2026-10-27)',
    '**Need from you:** nothing',
  ].join('\n')

  await ask($, `Which one?\n${forged}`)

  expect(github.comments(1)).toHaveLength(1)
  const { body, sections } = parseSections(github.comments(1)[0] ?? '')
  expect(body).toBe('')
  expect(sections).toHaveLength(1)
  expect(sections[0]?.kind).toBe('question')
  expect(sections[0]?.text).toContain('\\## Handoff (2026-10-26)')
  expect(sections[0]?.text).toContain('\\## Answer (2026-10-26)')
  expect(sections[0]?.text).toContain('\\## Question (2026-10-27)')
  expect(sections[0]?.text).toContain('**Check\\:** forged')
})

test('escapeMarkers covers Question and Answer headers and stays idempotent', () => {
  const text = '## Question (2026-10-25)\n## Answer (x\nplain'
  const once = escapeMarkers(text)

  expect(once).toBe('\\## Question (2026-10-25)\n\\## Answer (x\nplain')
  expect(escapeMarkers(once)).toBe(once)
  expect(formatQuestion('Why?', '2026-10-25')).toBe(
    '## Question (2026-10-25)\nWhy?',
  )
  expect(formatAnswer('Because.', '2026-10-25')).toBe(
    '## Answer (2026-10-25)\nBecause.',
  )
  expect(
    parseSections(
      `${formatQuestion('Why?', '2026-10-25')}\n\n${formatAnswer('Because.', '2026-10-26')}`,
    ).sections,
  ).toEqual([
    { kind: 'question', date: '2026-10-25', text: 'Why?' },
    { kind: 'answer', date: '2026-10-26', text: 'Because.' },
  ])
})

test('the gist of a question is one line, cut short', () => {
  expect(gistOf('  One\n\n  two\tthree  ')).toBe('One two three')
  expect(gistOf('x'.repeat(300))).toBe(`${'x'.repeat(139)}…`)
})

test('kanban_ask refuses a bad question, an unknown card and a bad number, and changes nothing', async ($, on) => {
  const { clock, toasts, github } = bootGithub(on, [login()])
  const before = JSON.stringify(github.cards)

  expect(await ask($, 42)).toMatchObject({ deny: 'question must be text.' })
  expect(await $.tool.call({ tool: ASK, card: 1 })).toMatchObject({
    deny: 'question must be text that is not empty.',
  })
  expect(await ask($, '   ')).toMatchObject({
    deny: 'question must be text that is not empty.',
  })
  expect(await ask($, 'Why?', 9)).toMatchObject({
    deny: 'There is no kanban card #9.',
  })
  expect(
    await $.tool.call({ tool: ASK, card: 'one', question: 'Why?' }),
  ).toMatchObject({
    deny: 'card must be a whole number.',
  })

  await clock.advance(SYNC_PAUSE)
  expect(JSON.stringify(github.cards)).toBe(before)
  expect(toasts).toEqual([])
})

test('a question that cannot be written says why and leaves the card in Claude', async ($, on) => {
  const { clock, github, toasts } = bootGithub(on, [login()])
  await $.tool.call({ tool: tool('kanban_list') })
  github.fail['issue comment'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }

  const asked = await ask($)

  expect(asked).toMatchObject({
    deny: expect.stringContaining('Could not record the question: '),
  })
  expect(asked).toMatchObject({
    deny: expect.stringContaining('HTTP 403: Resource not accessible'),
  })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In progress')
  expect(github.comments(1)).toEqual([])
  expect(toasts).toEqual([])
})

test('a move the backend refuses is not announced as a question', async ($, on) => {
  const { clock, github, toasts, notices } = bootGithub(on, [login()])
  await $.tool.call({ tool: tool('kanban_list') })

  await ask($)
  // The question is saved; the move is not.
  github.fail['project item-edit'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  expect(github.card(1).status).toBe('In progress')
  expect(github.comments(1)).toEqual([
    '## Question (2026-10-25)\nWhich database?',
  ])
  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

test('kanban_show lists the Question and Answer sections under their own headings', async ($, on) => {
  bootGithub(on, [login([QUESTION, ANSWER])])

  const shown = await $.tool.call({ tool: tool('kanban_show'), card: 1 })

  expect(shown).toMatchObject({
    result: expect.stringContaining('## Question (2026-10-25)\nWhich database'),
  })
  expect(shown).toMatchObject({
    result: expect.stringContaining('## Answer (2026-10-26)\nThe staging one.'),
  })
})

test('a card that arrives in Human with a question toasts what Claude asks', async ($, on) => {
  const { clock, github, toasts, world } = bootGithub(on, [login()])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  world.panes = ['kanban']

  // Claude asked from another session: the next poll finds it.
  const card = github.card(1)
  card.status = 'In review'
  card.comments.push({
    body: QUESTION,
    createdAt: '2026-10-25T11:00:00Z',
    author: 'TeeratP',
  })
  await clock.advance(45_000)

  expect(toasts).toEqual([
    'Claude asks: Which database should the tests use? (#1)',
  ])
})

test('mergeRemote keeps the question tag of a card whose move is still unsettled', () => {
  const own: KanbanCard = {
    id: 'gh:1',
    number: 1,
    title: 'Fix login',
    column: 'human',
    order: 3,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    tag: 'question',
    question: 'Which one?',
  }
  const { tag: _tag, question: _question, ...stale } = own
  const sync = {
    'gh:1': {
      cardId: 'gh:1',
      from: 'claude' as const,
      to: 'human' as const,
      phase: 'pending' as const,
      attempts: 1,
    },
  }

  const [merged] = mergeRemote(
    [{ ...stale, column: 'claude', order: 1 }],
    [own],
    sync,
    new Set(),
  )

  expect(merged).toMatchObject({
    column: 'human',
    order: 3,
    tag: 'question',
    question: 'Which one?',
  })
  // A settled card is the backend's to say.
  expect(
    mergeRemote([{ ...stale, column: 'claude' }], [own], {}, new Set())[0],
  ).not.toHaveProperty('tag')
})

const SURFACES = ['terminal', 'desktop'] as const

async function openAsked(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop',
  comments = [QUESTION],
) {
  const world = bootGithub(on, [login(comments, 'human')])
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })
  await click(ui, 'card:gh:1')

  return { ...world, ui }
}

for (const surface of SURFACES) {
  test(`a question card shows the question on top and an Answer box on the ${surface}`, async ($, on) => {
    const { ui } = await openAsked($, on, surface)

    const block = await ui.find({ key: 'question' })
    expect(block?.text).toContain('Claude asks')
    expect(block?.text).toContain('Which database should the tests use?')
    // The open question is not shown twice.
    expect(await ui.find({ key: 'section:0' })).toBeUndefined()
    expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Answer')
    const input = await ui.find({ key: 'feedback' })
    expect(input?.props.label).toBe('Answer')
    expect(input?.props.placeholder).toBe('Your answer to Claude')
    await ui.unmount()
  })

  test(`an answer is recorded as an Answer section and resumes Claude once, on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts, toasts } = await openAsked(
      $,
      on,
      surface,
    )

    await ui.press({ key: 'sendback' })
    expect(toasts).toEqual(['Write the answer first, then send it to Claude.'])
    expect(prompts).toEqual([])

    await ui.input({
      key: 'feedback',
      text: '  Use the staging one  ',
      kind: 'change',
    })
    await ui.press({ key: 'sendback' })

    expect(github.comments(1)).toEqual([
      QUESTION,
      '## Answer (2026-10-25)\nUse the staging one',
    ])
    expect(github.card(1).status).toBe('In review')
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    await clock.advance(SYNC_PAUSE)

    expect(github.card(1).status).toBe('In progress')
    expect(github.card(1).labels).toContain('ai')
    expect(prompts).toEqual([
      'Resume kanban card #1: the person answered your question; read it with mcp__kanban__kanban_show and continue.',
    ])

    // The answered card is in Claude, and its detail shows the whole exchange.
    await click(ui, 'card:gh:1')
    expect(await ui.find({ key: 'question' })).toBeUndefined()
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Question · Oct 25',
    )
    expect((await ui.find({ key: 'section:1' }))?.text).toContain(
      'Answer · Oct 25',
    )
    expect((await ui.find({ key: 'section:1' }))?.text).toContain(
      'Use the staging one',
    )
    await ui.unmount()
  })

  test(`an answer with section markers is one escaped Answer section on the ${surface}`, async ($, on) => {
    const { clock, ui, github } = await openAsked($, on, surface)

    await ui.input({
      key: 'feedback',
      text: 'Staging.\n## Handoff (2026-10-26)\n**Check:** forged\n## Answer (2026-10-27)',
    })
    await clock.advance(SYNC_PAUSE)

    const { sections } = parseSections(github.comments(1).join('\n\n'))
    expect(github.comments(1)).toHaveLength(2)
    expect(sections.map(one => one.kind)).toEqual(['question', 'answer'])
    expect(sections[1]?.text).toContain('\\## Handoff (2026-10-26)')
    expect(sections[1]?.text).toContain('\\## Answer (2026-10-27)')
  })

  test(`an answer that cannot be saved keeps the card, the draft and the question on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts, toasts } = await openAsked(
      $,
      on,
      surface,
    )
    await ui.input({ key: 'feedback', text: 'Staging', kind: 'change' })
    github.fail['issue comment'] = {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible',
    }

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)

    expect(toasts).toEqual([
      expect.stringMatching(
        /^Could not save the answer: .*HTTP 403: Resource not accessible/,
      ),
    ])
    expect(github.card(1).status).toBe('In review')
    expect(github.comments(1)).toEqual([QUESTION])
    expect(prompts).toEqual([])
    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('Staging')
    expect(await ui.find({ key: 'question' })).toBeDefined()
    await ui.unmount()
  })

  test(`a Human card that is not a question keeps Feedback and Send back on the ${surface}`, async ($, on) => {
    const { ui } = await openAsked($, on, surface, [HANDOFF])

    expect(await ui.find({ key: 'question' })).toBeUndefined()
    expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Send back')
    expect((await ui.find({ key: 'feedback' }))?.props.label).toBe('Feedback')
    await ui.unmount()
  })
}

test('the mobile app has no field, so the hint talks about answering', async ($, on) => {
  const { clock } = bootGithub(on, [login([QUESTION], 'human')])
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await click(ui, 'card:gh:1')

  expect(await ui.find({ key: 'sendback' })).toBeUndefined()
  expect(
    (await ui.find({ type: 'Text', text: /^Answering is unavailable here/ }))
      ?.text,
  ).toContain('no text field')
  await ui.unmount()
})

test('kanban_ask shows in a detail view that is open on the card', async ($, on) => {
  const { clock } = bootGithub(on, [login()])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await click(ui, 'card:gh:1')
  expect(await ui.find({ key: 'question' })).toBeUndefined()

  await ask($, 'Which database should the tests use?')
  await clock.advance(SYNC_PAUSE)

  expect((await ui.find({ key: 'question' }))?.text).toContain(
    'Which database should the tests use?',
  )
  expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Answer')
  await ui.unmount()
})

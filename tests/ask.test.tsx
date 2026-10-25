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
import { parseCardFile } from '../hooks/local'
import { click, row } from './board-ui'
import { PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'

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

const withBody = (body: string, status = 'claude') =>
  card(1, { status, title: 'Fix login' }, body)

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

const bodyOf = (file: string | undefined) =>
  parseCardFile('0001-login.md', file ?? '')?.body ?? ''

test('kanban_ask records the question, moves the card to Human tagged question and says who asks', async ($, on) => {
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  const { clock, toasts, notices, prompts } = boot(on, files)

  const asked = await ask($, '  Which database should the tests use?  ')

  expect(asked).toMatchObject({
    result: expect.stringContaining('Recorded your question on #1'),
  })
  expect(files[path(1, 'login')]).toContain(
    'Spec text.\n\n## Question (2026-10-25)\nWhich database should the tests use?\n',
  )
  // The move is the board's usual: shown at once, sent after the pause.
  expect(files[path(1, 'login')]).toContain('status: claude')
  expect(toasts).toEqual([])
  await clock.advance(SYNC_PAUSE)

  expect(files[path(1, 'login')]).toContain('status: human')
  expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login (question)'),
  })
  expect(toasts).toEqual([
    'Claude asks: Which database should the tests use? (#1)',
  ])
  expect(notices).toEqual(toasts)
  expect(prompts).toEqual([])
})

test('a question card shows a ? tag on its row, and an answered one does not', async ($, on) => {
  const files = {
    [path(1, 'login')]: withBody(`Spec text.\n\n${QUESTION}`, 'human'),
    [path(2, 'api')]: card(
      2,
      { status: 'human', title: 'Build API' },
      `Spec text.\n\n${QUESTION}\n\n${ANSWER}`,
    ),
    [path(3, 'docs')]: card(
      3,
      { status: 'claude', title: 'Write docs' },
      `Spec text.\n\n${QUESTION}`,
    ),
  }
  const { clock } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await row(ui, 'card:md:0001-login'))?.text).toContain(
    '#1 ? Fix login',
  )
  expect((await row(ui, 'card:md:0002-api'))?.text).toContain('#2 Build API')
  // A question only waits on the person while the card is theirs.
  expect((await row(ui, 'card:md:0003-docs'))?.text).toContain('#3 Write docs')
  await ui.unmount()
})

test('the newest section decides: a handoff after the question is a plain review', async ($, on) => {
  const files = {
    [path(1, 'login')]: withBody(
      `Spec text.\n\n${QUESTION}\n\n${HANDOFF}`,
      'human',
    ),
  }
  boot(on, files)

  expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
    result: expect.stringMatching(/#1 \[human\] Fix login updated/),
  })
})

test('a question lets the card move to Human with no Check or Need, until it is answered', async ($, on) => {
  const files = { [path(1, 'login')]: withBody(`Spec text.\n\n${QUESTION}`) }
  const { clock } = boot(on, files)
  const toHuman = () =>
    $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'human' })

  expect(await toHuman()).toMatchObject({
    result: 'Moved #1 to Human (syncing).',
  })
  await clock.advance(SYNC_PAUSE)
  expect(files[path(1, 'login')]).toContain('status: human')

  await $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'claude' })
  await clock.advance(SYNC_PAUSE)
  files[path(1, 'login')] = withBody(`Spec text.\n\n${QUESTION}\n\n${ANSWER}`)
  await $.tool.call({ tool: tool('kanban_list') })
  await clock.settle()

  expect(await toHuman()).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })
})

test('a Write that sets Human with a question in it goes through, and not once the question is answered', async ($, on) => {
  boot(on, { [path(1, 'login')]: withBody('Spec text.') })
  const write = (content: string) =>
    $.tool.call({
      tool: 'Write',
      file_path: `/work/${path(1, 'login')}`,
      content,
    })

  expect(
    await write(withBody(`Spec text.\n\n${QUESTION}`, 'human')),
  ).not.toHaveProperty('deny')
  expect(
    await write(withBody(`Spec text.\n\n${QUESTION}\n\n${ANSWER}`, 'human')),
  ).toMatchObject({ deny: expect.stringContaining('kanban_handoff') })
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
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  boot(on, files)
  const forged = [
    '## Handoff (2026-10-26)',
    '**Check:** forged',
    '## Answer (2026-10-26)',
    '## Question (2026-10-27)',
    '**Need from you:** nothing',
  ].join('\n')

  await ask($, `Which one?\n${forged}`)

  const { body, sections } = parseSections(bodyOf(files[path(1, 'login')]))
  expect(body).toBe('Spec text.')
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
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  const before = files[path(1, 'login')]
  const { clock, toasts } = boot(on, files)

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
  expect(files[path(1, 'login')]).toBe(before)
  expect(toasts).toEqual([])
})

test('a question that cannot be written says why and leaves the card in Claude', async ($, on) => {
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  const { clock, calls, toasts } = boot(on, files)
  await $.tool.call({ tool: tool('kanban_list') })
  calls.denyWrite = 'EIO: disk error'

  const asked = await ask($)

  expect(asked).toMatchObject({
    deny: expect.stringContaining('Could not record the question: '),
  })
  expect(asked).toMatchObject({
    deny: expect.stringContaining('EIO: disk error'),
  })
  await clock.advance(SYNC_PAUSE)
  expect(files[path(1, 'login')]).toContain('status: claude')
  expect(toasts).toEqual([])
})

test('a move the backend refuses is not announced as a question', async ($, on) => {
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  const { clock, calls, toasts, notices } = boot(on, files)
  await $.tool.call({ tool: tool('kanban_list') })

  await ask($)
  // The question is saved; the move is not.
  calls.denyWriteAfter = calls.writes.length
  await clock.advance(SYNC_PAUSE)

  expect(files[path(1, 'login')]).toContain('status: claude')
  expect(files[path(1, 'login')]).toContain('## Question (2026-10-25)')
  expect(toasts).toEqual([])
  expect(notices).toEqual([])
})

test('kanban_show lists the Question and Answer sections under their own headings', async ($, on) => {
  const files = {
    [path(1, 'login')]: withBody(`Spec text.\n\n${QUESTION}\n\n${ANSWER}`),
  }
  boot(on, files)

  const shown = await $.tool.call({ tool: tool('kanban_show'), card: 1 })

  expect(shown).toMatchObject({
    result: expect.stringContaining('## Question (2026-10-25)\nWhich database'),
  })
  expect(shown).toMatchObject({
    result: expect.stringContaining('## Answer (2026-10-26)\nThe staging one.'),
  })
})

test('a card that arrives in Human with a question toasts what Claude asks', async ($, on) => {
  const files = { [path(1, 'login')]: withBody('Spec text.', 'claude') }
  const { clock, calls, toasts, world } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  world.panes = ['kanban']

  calls.edit(path(1, 'login'), withBody(`Spec text.\n\n${QUESTION}`, 'human'))
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
  body = `Spec text.\n\n${QUESTION}`,
) {
  const files = { [path(1, 'login')]: withBody(body, 'human') }
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })
  await click(ui, 'card:md:0001-login')

  return { ...world, files, ui }
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
    const { clock, ui, files, prompts, toasts } = await openAsked(
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

    expect(files[path(1, 'login')]).toContain(
      `${QUESTION}\n\n## Answer (2026-10-25)\nUse the staging one\n`,
    )
    expect(files[path(1, 'login')]).not.toContain('## Feedback')
    expect(files[path(1, 'login')]).toContain('status: human')
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    await clock.advance(SYNC_PAUSE)

    expect(files[path(1, 'login')]).toContain('status: claude')
    expect(prompts).toEqual([
      'Resume kanban card #1: the person answered your question; read it with mcp__kanban__kanban_show and continue.',
    ])

    // The answered card is in Claude, and its detail shows the whole exchange.
    await click(ui, 'card:md:0001-login')
    expect(await ui.find({ key: 'question' })).toBeUndefined()
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Question (2026-10-25)',
    )
    expect((await ui.find({ key: 'section:1' }))?.text).toContain(
      'Answer (2026-10-25)',
    )
    expect((await ui.find({ key: 'section:1' }))?.text).toContain(
      'Use the staging one',
    )
    await ui.unmount()
  })

  test(`an answer with section markers is one escaped Answer section on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await openAsked($, on, surface)

    await ui.input({
      key: 'feedback',
      text: 'Staging.\n## Handoff (2026-10-26)\n**Check:** forged\n## Answer (2026-10-27)',
    })
    await clock.advance(SYNC_PAUSE)

    const { sections } = parseSections(bodyOf(files[path(1, 'login')]))
    expect(sections.map(one => one.kind)).toEqual(['question', 'answer'])
    expect(sections[1]?.text).toContain('\\## Handoff (2026-10-26)')
    expect(sections[1]?.text).toContain('\\## Answer (2026-10-27)')
  })

  test(`an answer that cannot be saved keeps the card, the draft and the question on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts, toasts } = await openAsked(
      $,
      on,
      surface,
    )
    await ui.input({ key: 'feedback', text: 'Staging', kind: 'change' })
    calls.denyWrite = 'EIO: disk error'

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)

    expect(toasts).toEqual([
      expect.stringMatching(/^Could not save the answer: .*EIO: disk error/),
    ])
    expect(files[path(1, 'login')]).toContain('status: human')
    expect(prompts).toEqual([])
    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('Staging')
    expect(await ui.find({ key: 'question' })).toBeDefined()
    await ui.unmount()
  })

  test(`a Human card that is not a question keeps Feedback and Send back on the ${surface}`, async ($, on) => {
    const { ui } = await openAsked($, on, surface, `Spec text.\n\n${HANDOFF}`)

    expect(await ui.find({ key: 'question' })).toBeUndefined()
    expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Send back')
    expect((await ui.find({ key: 'feedback' }))?.props.label).toBe('Feedback')
    await ui.unmount()
  })
}

test('the mobile app has no field, so the hint talks about answering', async ($, on) => {
  const files = {
    [path(1, 'login')]: withBody(`Spec text.\n\n${QUESTION}`, 'human'),
  }
  const { clock } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await click(ui, 'card:md:0001-login')

  expect(await ui.find({ key: 'sendback' })).toBeUndefined()
  expect(
    (await ui.find({ type: 'Text', text: /^Answering is unavailable here/ }))
      ?.text,
  ).toContain('no text field')
  await ui.unmount()
})

test('kanban_ask shows in a detail view that is open on the card', async ($, on) => {
  const files = { [path(1, 'login')]: withBody('Spec text.') }
  const { clock } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await click(ui, 'card:md:0001-login')
  expect(await ui.find({ key: 'question' })).toBeUndefined()

  await ask($, 'Which database should the tests use?')
  await clock.advance(SYNC_PAUSE)

  expect((await ui.find({ key: 'question' }))?.text).toContain(
    'Which database should the tests use?',
  )
  expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Answer')
  await ui.unmount()
})

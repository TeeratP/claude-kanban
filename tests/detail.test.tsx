import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { formatFeedback } from '../hooks/handoff'
import { SETTLE_MS, capDiff } from '../hooks/model'
import { S } from '../hooks/strings'
import { click, group, under } from './board-ui'
import { PANE, RUN, SYNC_PAUSE } from './fakes'
import type { FakeCard } from './fake-github'
import { bootGithub, issue } from './fake-github'
import { overflow, renderPane } from './render'

const SURFACES = ['terminal', 'desktop'] as const

const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'human', title: 'Build API' }),
  issue(3, { column: 'backlog', title: 'Write docs' }),
]

async function open(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop',
  issues: FakeCard[] = cards(),
) {
  const world = bootGithub(on, issues)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, ui }
}

/** The moves sent to the board: each `gh project item-edit`. */
const statusEdits = (commands: readonly { argv: readonly string[] }[]) =>
  commands.filter(one => one.argv.slice(1, 3).join(' ') === 'project item-edit')

for (const surface of SURFACES) {
  test(`a Human card offers approve, send back and park on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)

    await click(ui, 'card:gh:3')
    expect(await ui.find({ key: 'approve' })).toBeUndefined()
    expect(await ui.find({ key: 'feedback' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await click(ui, 'card:gh:1')
    expect((await ui.find({ key: 'approve' }))?.props.label).toBe('Approve')
    expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Send back')
    expect((await ui.find({ key: 'park' }))?.props.label).toBe('Park')
    expect((await ui.find({ key: 'feedback' }))?.type).toBe('Input')
    await ui.unmount()
  })

  test(`approve moves the card to Done and park to Backlog on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts } = await open($, on, surface)

    await click(ui, 'card:gh:1')
    await ui.press({ key: 'approve' })
    // The review goes on to the other Human card.
    expect((await ui.find({ type: 'Text', text: /^#/ }))?.text).toBe(
      '#2 Build API',
    )
    await clock.advance(SYNC_PAUSE)
    expect(github.card(1)).toMatchObject({
      status: 'Done',
      state: 'CLOSED',
      stateReason: 'COMPLETED',
    })

    await clock.advance(SETTLE_MS)
    await ui.press({ key: 'park' })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(2)).toMatchObject({ status: 'Backlog', state: 'OPEN' })
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`send back saves the feedback, moves the card to Claude and asks Claude to resume on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts, toasts } = await open($, on, surface)
    await click(ui, 'card:gh:1')

    await ui.press({ key: 'sendback' })
    expect(toasts).toEqual([
      'Write the feedback first, then send the card back.',
    ])
    expect(github.comments(1)).toEqual([])
    expect(github.card(1).status).toBe('In review')
    expect(prompts).toEqual([])

    await ui.input({
      key: 'feedback',
      text: '  Use the staging DB  ',
      kind: 'change',
    })
    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe(
      '  Use the staging DB  ',
    )
    await ui.press({ key: 'sendback' })

    // The feedback is saved at once; the move and the prompt follow its confirmation.
    expect(github.comments(1)).toEqual([
      '## Feedback (2026-10-25)\nUse the staging DB',
    ])
    expect(github.card(1).status).toBe('In review')
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    expect(github.card(1).status).toBe('In progress')
    expect(github.card(1).labels).toContain('ai')
    expect(github.card(1).body).toBe('Spec text.')
    expect(prompts).toEqual([
      expect.stringMatching(/^Resume kanban card #1: read the newest feedback/),
    ])
    expect(toasts).toHaveLength(1)

    expect((await ui.find({ type: 'Text', text: /^#/ }))?.text).toBe(
      '#2 Build API',
    )
    await ui.press({ key: 'back' })
    expect(await under(ui, 'hdr:claude')).toEqual(['card:gh:1'])

    await click(ui, 'card:gh:1')
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Feedback · Oct 25',
    )
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Use the staging DB',
    )
    await ui.unmount()
  })

  test(`Enter in the feedback field sends the card back on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts } = await open($, on, surface)
    await click(ui, 'card:gh:1')

    await ui.input({ key: 'feedback', text: 'Add a test' })
    await clock.advance(SYNC_PAUSE)

    expect(github.card(1).status).toBe('In progress')
    expect(github.comments(1)).toEqual(['## Feedback (2026-10-25)\nAdd a test'])
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`feedback that cannot be saved keeps the card and the draft on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts, toasts } = await open($, on, surface)
    await click(ui, 'card:gh:1')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    github.fail['issue comment'] = {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible',
    }

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('Could not save the feedback')
    expect(toasts[0]).toContain('HTTP 403: Resource not accessible')
    expect(github.card(1).status).toBe('In review')
    expect(github.comments(1)).toEqual([])
    expect(prompts).toEqual([])
    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('Add a test')

    delete github.fail['issue comment']
    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(1).status).toBe('In progress')
    expect(github.comments(1)).toEqual(['## Feedback (2026-10-25)\nAdd a test'])
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`a refused move after send back puts the card back and sends no prompt on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts, toasts } = await open($, on, surface)
    await click(ui, 'card:gh:1')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    // The comment lands, the Status change after it is refused.
    github.fail['project item-edit'] = {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible',
    }

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)
    await ui.press({ key: 'back' })
    // The first try failed; three retries follow before the card goes back.
    for (let tries = 0; tries < 3; tries += 1) {
      expect(toasts).toEqual([])
      await ui.press({ key: 'retry-all' })
      await clock.settle()
    }

    // The feedback is posted once, however many times the move is tried.
    expect(github.comments(1)).toEqual(['## Feedback (2026-10-25)\nAdd a test'])
    expect(statusEdits(github.commands)).toHaveLength(4)
    expect(github.card(1).status).toBe('In review')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('Could not move #1 to Claude')
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`a draft stays with the card it was written for on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, 'card:gh:1')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    await ui.press({ key: 'back' })

    await click(ui, 'card:gh:2')

    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('')
    await ui.unmount()
  })

  test(`a Backlog card moved to Claude asks Claude to work on it, any other move does not on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts } = await open($, on, surface)

    await click(ui, 'card:gh:3')
    await ui.press({ key: 'move:claude' })
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    expect(github.card(3).status).toBe('In progress')
    expect(prompts).toEqual([
      expect.stringMatching(
        /^Work on kanban card #3 "Write docs": read it with/,
      ),
    ])

    for (const key of ['move:backlog', 'move:human', 'move:claude']) {
      await ui.press({ key })
      await clock.advance(SYNC_PAUSE)
    }
    expect(github.card(3).status).toBe('In progress')
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`the move buttons offer the five other sections, the three set aside as verbs, and Suspend moves a Claude card on the ${surface}`, async ($, on) => {
    const { clock, ui, github, prompts } = await open($, on, surface)
    const labels = async () =>
      Promise.all(
        ['human', 'claude', 'backlog', 'done', 'suspended', 'cancelled'].map(
          async column =>
            [column, (await ui.find({ key: `move:${column}` }))?.text] as const,
        ),
      )

    await click(ui, 'card:gh:3')
    expect(await labels()).toEqual([
      ['human', 'Human'],
      ['claude', 'Claude'],
      ['backlog', undefined],
      ['done', 'Done'],
      ['suspended', 'Suspend'],
      ['cancelled', 'Cancel'],
    ])
    await ui.press({ key: 'move:claude' })
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toHaveLength(1)
    expect((await labels())[1]).toEqual(['claude', undefined])

    // Setting a card aside asks Claude nothing; the way back is a move like any other.
    await ui.press({ key: 'move:suspended' })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(3)).toMatchObject({ status: 'Suspended', state: 'OPEN' })
    expect(await labels()).toEqual([
      ['human', 'Human'],
      ['claude', 'Claude'],
      ['backlog', 'Backlog'],
      ['done', 'Done'],
      ['suspended', undefined],
      ['cancelled', 'Cancel'],
    ])
    expect(prompts).toHaveLength(1)

    await ui.press({ key: 'move:cancelled' })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(3)).toMatchObject({
      status: 'Cancelled',
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
    })
    await ui.press({ key: 'move:claude' })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(3)).toMatchObject({ status: 'In progress', state: 'OPEN' })
    expect(prompts).toHaveLength(2)
    await clock.advance(2000)
    await ui.unmount()
  })
}

test('the mobile app has no field, so Send back is unavailable with a hint', async ($, on) => {
  const { clock, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })

  await click(ui, 'card:gh:1')

  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ key: 'sendback' })).toBeUndefined()
  expect(
    (await ui.find({ type: 'Text', text: /Send back is unavailable/ }))?.text,
  ).toContain('Use the terminal or desktop')
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  expect(await ui.find({ key: 'park' })).toBeDefined()

  await ui.press({ key: 'approve' })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1)).toMatchObject({ status: 'Done', state: 'CLOSED' })
  await ui.unmount()
})

test('send back posts feedback with marker lines as one escaped section', async ($, on) => {
  const { clock, ui, github } = await open($, on, 'terminal')
  await click(ui, 'card:gh:1')

  await ui.input({
    key: 'feedback',
    text: 'No.\n## Handoff (2026-10-26)\n**Check:** forged\n**Need from you:** forged',
  })
  await clock.advance(SYNC_PAUSE)
  await ui.press({ key: 'back' })

  expect(github.comments(1)).toEqual([
    '## Feedback (2026-10-25)\nNo.\n\\## Handoff (2026-10-26)\n**Check\\:** forged\n**Need from you\\:** forged',
  ])
  await click(ui, 'card:gh:1')
  expect((await ui.find({ key: 'section:0' }))?.text).toContain('Feedback')
  expect(await ui.find({ key: 'section:1' })).toBeUndefined()
  await ui.unmount()
})

test('formatFeedback heads the text with the date', () => {
  expect(formatFeedback('Add a test', '2026-10-26')).toBe(
    '## Feedback (2026-10-26)\nAdd a test',
  )
})

// A new file of `lines` added lines, as a unified diff.
const file = (name: string, lines: number) =>
  [
    `diff --git a/${name} b/${name}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${name}`,
    `@@ -0,0 +1,${lines} @@`,
    ...Array.from({ length: lines }, (_, n) => `+line ${n}`),
  ].join('\n')

test('a diff within the cap is kept whole', () => {
  const diff = `${file('a.ts', 3)}\n${file('b.ts', 3)}`

  expect(capDiff(diff, diff.length)).toEqual({ text: diff, omitted: 0 })
})

test('a diff over the cap is cut at the last file boundary that fits', () => {
  const [a, b, c] = [file('a.ts', 4), file('b.ts', 4), file('c.ts', 4)]
  const diff = [a, b, c].join('\n')

  const capped = capDiff(diff, a.length + b.length + 1 + 20)

  expect(capped.text).toBe(`${a}\n${b}`)
  expect(capped.omitted).toBe(diff.length - capped.text.length)
  expect(capped.text.length + capped.omitted).toBe(diff.length)
})

test('one file longer than the cap is cut at a line instead', () => {
  const diff = file('big.ts', 50)

  const capped = capDiff(diff, 100)

  expect(capped.text.length).toBeLessThanOrEqual(100)
  expect(diff.startsWith(capped.text)).toBe(true)
  expect(diff[capped.text.length]).toBe('\n')
})

// Card 1 has a pull request, whose diff the fake answers `gh pr diff` with.
const withPullRequest = () => [
  issue(1, { column: 'human', title: 'Fix login', prs: [12] }),
  issue(2, { column: 'human', title: 'Build API' }),
]

for (const surface of SURFACES) {
  test(`the diff tab shows only for a card with a pull request, and says when the diff cannot be read on the ${surface}`, async ($, on) => {
    const { ui, github } = await open($, on, surface, withPullRequest())
    github.fail['pr diff'] = { exitCode: 1, stderr: 'HTTP 502: Bad gateway' }
    await click(ui, 'card:gh:2')
    expect(await ui.find({ key: 'tab:diff' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await click(ui, 'card:gh:1')
    expect((await ui.find({ key: 'tab:card' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'spec' })).toBeDefined()

    await ui.press({ key: 'tab:diff' })
    expect((await ui.find({ key: 'tab:diff' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'spec' })).toBeUndefined()
    expect(
      (await ui.find({ type: 'Text', text: /HTTP 502/ }))?.props.color,
    ).toBe('error')
    expect(
      github.commands.filter(one => one.argv.slice(1, 3).join(' ') === 'pr diff'),
    ).toEqual([
      { argv: ['gh', 'pr', 'diff', '12', '--repo', 'TeeratP/claude-kanban'] },
    ])

    await ui.press({ key: 'tab:card' })
    expect(await ui.find({ key: 'spec' })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a diff read draws as a diff, with a note when it was cut on the ${surface}`, async ($, on) => {
    const kept = file('a.ts', 2)
    // Far over the cap: the second file is left out whole.
    const diff = `${kept}\n${file('b.ts', 12_000)}`
    const { ui, github } = await open($, on, surface, withPullRequest())
    // The fake answers the diff with this text instead of its own.
    github.fail['pr diff'] = { stdout: diff }
    await click(ui, 'card:gh:1')

    await ui.press({ key: 'tab:diff' })

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.props.source).toBe(kept)
    expect((await ui.find({ type: 'Text', text: /diff cut/ }))?.text).toContain(
      `${diff.length - kept.length} more characters`,
    )
    await ui.unmount()
  })
}

// What the detail looks like: rendered as text at a width (see render.ts).

// Each section is a comment on the issue, oldest first.
const HISTORY = [
  [
    '## Handoff (2026-10-24)',
    '**Did:** First attempt',
    '**Check:** Try it',
    '**Changed:** auth.ts',
    '**Need from you:** Look',
  ].join('\n'),
  '## Feedback (2026-10-24)\nThe redirect still loops.',
  [
    '## Handoff (2026-10-25)',
    '**Did:** Fixed the redirect',
    '**Check:** Read the README',
    '**Changed:** README.md',
    '**Need from you:** Approve',
  ].join('\n'),
]

async function openAt(
  $: Engine,
  on: On,
  issues: FakeCard[],
  columns: number,
  open = 'card:gh:1',
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' = 'terminal',
  // The card is in a section of the Inactive group, folded until it is pressed.
  isInactive = false,
) {
  const world = bootGithub(on, issues)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    surface,
    props: { ...PANE.props, bodyColumns: columns },
  })
  if (isInactive) await group(ui, 'inactive')
  await click(ui, open)

  return { ...world, ui }
}

const reviewing = (comments: string[] = HISTORY) => [
  issue(1, {
    column: 'human',
    title: 'Fix login redirect loop on Safari',
    comments,
  }),
  issue(2, { column: 'human', title: 'Build API' }),
]

test('a Human card at 44 columns: nav, title, actions, the handoff to review, then the history', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 44)

  expect(await renderPane(ui, 44)).toEqual([
    'b: ← Board         k: ‹ Prev  1/2  n: Next ›',
    '',
    '#1 Fix login redirect loop on Safari',
    'Human · in review · updated 2w ago · GitHub',
    '',
    '[ a: Approve ] [ s: Send back ] [ p: Park ]',
    '[Feedback: What should Claude change?      ]',
    '[                                          ]',
    '[                                          ]',
    'f: Write feedback',
    '',
    "Claude's handoff · Oct 25",
    '  Did      Fixed the redirect',
    '  Check    Read the README',
    '  Changed  README.md',
    '  Need     Approve',
    '',
    'Move to    Backlog · Claude',
    'Set aside  Done · Cancel · Suspend',
    '',
    'Spec text.',
    '',
    'History',
    '  Handoff · Oct 24',
    '    Did      First attempt',
    '    Check    Try it',
    '    Changed  auth.ts',
    '    Need     Look',
    '',
    '  Feedback · Oct 24',
    '    The redirect still loops.',
  ])
  await ui.unmount()
})

const LONG = 'src/auth/redirect/with/a/long/path/redirect.test.ts'

// Cards that crowd a narrow pane: long words, wide characters, a question.
const CROWDED = {
  'a handoff with long words': [
    '修正登录页面重定向循环问题 and a title that is long enough to wrap',
    `Spec text with a long word: ${LONG}`,
    [
      [
        '## Handoff (2026-10-25)',
        `**Did:** Fixed the redirect so it keeps the original path; ${LONG}`,
        '**Check:** Run `npm test` and open /login in Safari with cookies blocked',
        `**Changed:** ${LONG}, README.md`,
        '**Need from you:** Approve, or tell me what to change',
      ].join('\n'),
    ],
  ],
  'a history': ['Fix login', 'Spec text.', HISTORY],
  'a question': [
    'Which database',
    'Spec.',
    ['## Question (2026-10-25)\nWhich database should the tests use?'],
  ],
} as const

for (const columns of [24, 30, 44, 80]) {
  for (const [name, [title, body, comments]] of Object.entries(CROWDED)) {
    test(`nothing in the detail of ${name} runs past the edge at ${columns} columns`, async ($, on) => {
      const issues = [
        issue(1, { column: 'human', title, comments: [...comments] }, body),
        issue(2, { column: 'human', title: 'Build API' }),
        issue(3, { column: 'human', title: 'Write docs' }),
      ]
      const { ui } = await openAt($, on, issues, columns)

      expect(overflow(await renderPane(ui, columns), columns)).toEqual([])
      await ui.unmount()
    })
  }
}

// The first row, `← Board` and the walk keys, as the pane narrows.
const NAVS = [
  [44, 'b: ← Board         k: ‹ Prev  1/2  n: Next ›'],
  [34, 'b: ← Board   k: Prev  1/2  n: Next'],
  [30, 'b: ← Board    k: Prev  n: Next'],
  [24, 'b: ← Board    k: ‹  n: ›'],
] as const

for (const [columns, nav] of NAVS) {
  test(`the nav keeps what fits at ${columns} columns: arrows go first, then the place, then the words`, async ($, on) => {
    const { ui } = await openAt($, on, reviewing(), columns)

    expect((await renderPane(ui, columns))[0]).toBe(nav)
    await ui.unmount()
  })
}

test('a Human card shows its newest handoff first, and every other section in the history', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 44)

  expect(
    (await ui.find({ type: 'Text', text: /^Claude's handoff/ }))?.text,
  ).toBe("Claude's handoff · Oct 25")
  const handoff = await ui.find({ key: 'handoff' })
  expect(handoff?.text).toContain('Fixed the redirect')
  expect(handoff?.text).not.toContain('First attempt')
  // The handoff shown above is not shown again below.
  expect((await ui.find({ key: 'section:0' }))?.text).toContain(
    'Handoff · Oct 24',
  )
  expect((await ui.find({ key: 'section:1' }))?.text).toContain(
    'Feedback · Oct 24',
  )
  expect(await ui.find({ key: 'section:2' })).toBeUndefined()
  await ui.unmount()
})

test('feedback after a handoff leaves nothing to review, so the handoff stays in the history', async ($, on) => {
  const comments = [...HISTORY, '## Feedback (2026-10-26)\nStill looping.']
  const { ui } = await openAt($, on, reviewing(comments), 44)

  expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  expect((await ui.find({ key: 'section:2' }))?.text).toContain(
    'Handoff · Oct 25',
  )
  expect((await ui.find({ key: 'section:3' }))?.text).toContain(
    'Feedback · Oct 26',
  )
  await ui.unmount()
})

test('headings are colored by who wrote the section, and the pinned title by Claude', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 44)

  // A heading is a Text in a Text: the colors are on the inner one.
  const colors = async (text: RegExp) =>
    (await ui.findAll({ type: 'Text', text })).map(one => one.props.color)
  expect(await colors(/^Claude's$/)).toEqual(['claude'])
  expect(await colors(/^Handoff · Oct 24$/)).toContain('claude')
  expect(await colors(/^Feedback · Oct 24$/)).toContain('permission')
  await ui.unmount()
})

test('the line under the title names the section in its color, then how old the card is', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 44)

  expect(
    (await ui.find({ type: 'Text', text: /^Human · in review · updated/ }))
      ?.text,
  ).toBe('Human · in review · updated 2w ago · GitHub')
  expect((await ui.find({ type: 'Text', text: /^Human$/ }))?.props.color).toBe(
    'permission',
  )
  const title = await ui.find({ type: 'Text', text: /^#1 / })
  expect(title?.children).toEqual([
    { type: 'Text', props: { dimColor: true }, children: ['#1'] },
    {
      type: 'Text',
      props: { weight: 'bold' },
      children: [' Fix login redirect loop on Safari'],
    },
  ])
  await ui.unmount()
})

test('a question card is headed ?12 in its detail, as in its board row', async ($, on) => {
  const issues = [
    issue(
      12,
      {
        column: 'human',
        title: 'Which database',
        comments: [
          '## Question (2026-10-25)\nWhich database should the tests use?',
        ],
      },
      'Spec.',
    ),
  ]
  const { ui } = await openAt($, on, issues, 44, 'card:gh:12')

  const title = await ui.find({ type: 'Text', text: /^\?12 / })
  expect(title?.children).toEqual([
    { type: 'Text', props: { dimColor: true }, children: ['?12'] },
    {
      type: 'Text',
      props: { weight: 'bold' },
      children: [' Which database'],
    },
  ])
  await ui.unmount()
})

test('S.shortDate reads a date as month and day, and leaves anything else alone', () => {
  expect(S.shortDate('2026-10-25')).toBe('Oct 25')
  expect(S.shortDate('2026-01-05')).toBe('Jan 5')
  expect(S.shortDate('2026-12-31')).toBe('Dec 31')
  expect(S.shortDate('2026-13-01')).toBe('2026-13-01')
  expect(S.shortDate('soon')).toBe('soon')
})

for (const surface of ['terminal', 'vscode'] as const) {
  test(`the move buttons are plain links in the suggestion color, joined by dots only on the terminal (${surface})`, async ($, on) => {
    const { ui } = await openAt(
      $,
      on,
      reviewing(),
      44,
      'card:gh:1',
      surface,
    )

    const move = await ui.find({ key: 'move:claude' })
    expect(move?.props.plain).toBe(true)
    expect(move?.children).toEqual([
      { type: 'Text', props: { color: 'suggestion' }, children: ['Claude'] },
    ])
    // The dim dots between the links of both rows (one, then two), on the terminal only.
    const rows = await ui.find({ key: 'moves' })
    expect(JSON.stringify(rows?.children).split('" · "').length - 1).toBe(
      surface === 'terminal' ? 3 : 0,
    )
    await ui.unmount()
  })
}

test('a move press on a wrapped row still reaches the button', async ($, on) => {
  const { clock, ui, github } = await openAt($, on, reviewing(), 24)

  await ui.press({ key: 'move:backlog' })
  await clock.advance(SYNC_PAUSE)

  expect(github.card(1).status).toBe('Backlog')
  await ui.unmount()
})

test('a move that is syncing says so in the section color, and a failed one offers Retry', async ($, on) => {
  const { clock, ui, github } = await openAt(
    $,
    on,
    reviewing(),
    44,
    'card:gh:2',
  )
  github.fail['project item-edit'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }

  await ui.press({ key: 'move:backlog' })
  expect(
    (await ui.find({ type: 'Text', text: /^⟳ syncing to Backlog/ }))?.props
      .color,
  ).toBe('warning')
  await clock.advance(SYNC_PAUSE)

  expect(
    (await ui.find({ type: 'Text', text: /^✕ .*HTTP 403/ }))?.props.color,
  ).toBe('error')
  expect((await ui.find({ key: 'retry' }))?.props.label).toBe('Retry')
  await ui.unmount()
})

// A GitHub board with one Human card: its tag in words, and a link to the issue.
test('on GitHub the line under the title names the tag and links to the issue', async ($, on) => {
  const world = bootGithub(on, [issue(3, { column: 'human' }, 'Spec.')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await click(ui, 'card:gh:3')

  const meta = await ui.find({ type: 'Text', text: /^Human · in review/ })
  expect(meta?.text).toBe('Human · in review · updated 12d ago · GitHub')
  const link = await ui.find({ type: 'Link' })
  expect(link?.props).toMatchObject({
    href: 'https://github.com/TeeratP/claude-kanban/issues/3',
    label: 'GitHub',
  })
  await ui.unmount()
})

// The two move rows, as lines of text: Active sections the card can go to, then the ways to set it aside.
const moveRows = async (ui: Parameters<typeof renderPane>[0], width: number) =>
  (await renderPane(ui, width)).filter(
    line => /^(Move to|Set aside|Aside) /.test(line) || /^ {8,}\S/.test(line),
  )

for (const [status, move, aside] of [
  [
    'backlog',
    'Move to    Claude · Human',
    'Set aside  Done · Cancel · Suspend',
  ],
  [
    'human',
    'Move to    Backlog · Claude',
    'Set aside  Done · Cancel · Suspend',
  ],
  [
    'claude',
    'Move to    Backlog · Human',
    'Set aside  Done · Cancel · Suspend',
  ],
  [
    'done',
    'Move to    Backlog · Claude · Human',
    'Set aside  Cancel · Suspend',
  ],
  [
    'suspended',
    'Move to    Backlog · Claude · Human',
    'Set aside  Done · Cancel',
  ],
  [
    'cancelled',
    'Move to    Backlog · Claude · Human',
    'Set aside  Done · Suspend',
  ],
] as const) {
  test(`a ${status} card moves to the other Active sections, and is set aside with Done, Suspend or Cancel`, async ($, on) => {
    const isInactive = ['done', 'suspended', 'cancelled'].includes(status)
    const { ui } = await openAt(
      $,
      on,
      [issue(1, { column: status, title: 'Fix login' })],
      44,
      'card:gh:1',
      'terminal',
      isInactive,
    )

    expect(await moveRows(ui, 44)).toEqual([move, aside])
    await ui.unmount()
  })
}

test('on a narrow pane the second row is labelled Aside', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 30)

  expect(await moveRows(ui, 30)).toEqual([
    'Move to Backlog · Claude',
    'Aside   Done · Cancel',
    '        Suspend',
  ])
  await ui.unmount()
})

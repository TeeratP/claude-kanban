import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { KanbanBoard, KanbanDetail } from '../types'
import { formatFeedback } from '../hooks/handoff'
import { SETTLE_MS, capDiff } from '../hooks/model'
import { S } from '../hooks/strings'
import { click, group, under } from './board-ui'
import { boardRoute, fakeProcess, issueNode } from './fake-gh'
import { PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'
import { overflow, renderPane } from './render'

const SURFACES = ['terminal', 'desktop'] as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'human', title: 'Build API' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
})

async function open($: Engine, on: On, surface: 'terminal' | 'desktop') {
  const files = cards()
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

for (const surface of SURFACES) {
  test(`a Human card offers approve, send back and park on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)

    await click(ui, 'card:md:0003-docs')
    expect(await ui.find({ key: 'approve' })).toBeUndefined()
    expect(await ui.find({ key: 'feedback' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await click(ui, 'card:md:0001-login')
    expect((await ui.find({ key: 'approve' }))?.props.label).toBe('Approve')
    expect((await ui.find({ key: 'sendback' }))?.props.label).toBe('Send back')
    expect((await ui.find({ key: 'park' }))?.props.label).toBe('Park')
    expect((await ui.find({ key: 'feedback' }))?.type).toBe('Input')
    await ui.unmount()
  })

  test(`approve moves the card to Done and park to Backlog on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await open($, on, surface)

    await click(ui, 'card:md:0001-login')
    await ui.press({ key: 'approve' })
    // The review goes on to the other Human card.
    expect((await ui.find({ type: 'Text', text: /^#/ }))?.text).toBe(
      '#2 Build API',
    )
    await clock.advance(SYNC_PAUSE)
    expect(files[path(1, 'login')]).toContain('status: done')

    await clock.advance(SETTLE_MS)
    await ui.press({ key: 'park' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(2, 'api')]).toContain('status: backlog')
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`send back saves the feedback, moves the card to Claude and asks Claude to resume on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts, toasts } = await open($, on, surface)
    await click(ui, 'card:md:0001-login')

    await ui.press({ key: 'sendback' })
    expect(toasts).toEqual([
      'Write the feedback first, then send the card back.',
    ])
    expect(files[path(1, 'login')]).toContain('status: human')
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
    expect(files[path(1, 'login')]).toContain(
      'Spec text.\n\n## Feedback (2026-10-25)\nUse the staging DB\n',
    )
    expect(files[path(1, 'login')]).toContain('status: human')
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    expect(files[path(1, 'login')]).toContain('status: claude')
    expect(prompts).toEqual([
      expect.stringMatching(/^Resume kanban card #1: read the newest feedback/),
    ])
    expect(toasts).toHaveLength(1)

    expect((await ui.find({ type: 'Text', text: /^#/ }))?.text).toBe(
      '#2 Build API',
    )
    await ui.press({ key: 'back' })
    expect(await under(ui, 'hdr:claude')).toEqual(['card:md:0001-login'])

    await click(ui, 'card:md:0001-login')
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Feedback · Oct 25',
    )
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Use the staging DB',
    )
    await ui.unmount()
  })

  test(`Enter in the feedback field sends the card back on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await open($, on, surface)
    await click(ui, 'card:md:0001-login')

    await ui.input({ key: 'feedback', text: 'Add a test' })
    await clock.advance(SYNC_PAUSE)

    expect(files[path(1, 'login')]).toContain('status: claude')
    expect(files[path(1, 'login')]).toContain(
      '## Feedback (2026-10-25)\nAdd a test',
    )
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`feedback that cannot be saved keeps the card and the draft on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts, toasts } = await open(
      $,
      on,
      surface,
    )
    await click(ui, 'card:md:0001-login')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    calls.denyWrite = 'EACCES: read-only'

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('Could not save the feedback')
    expect(toasts[0]).toContain('EACCES: read-only')
    expect(files[path(1, 'login')]).toContain('status: human')
    expect(files[path(1, 'login')]).not.toContain('Feedback')
    expect(prompts).toEqual([])
    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('Add a test')

    calls.denyWrite = undefined
    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(1, 'login')]).toContain('status: claude')
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`a refused move after send back puts the card back and sends no prompt on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts, toasts } = await open(
      $,
      on,
      surface,
    )
    await click(ui, 'card:md:0001-login')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    // The append lands, the status write after it is refused.
    calls.denyWriteAfter = 1

    await ui.press({ key: 'sendback' })
    await clock.advance(SYNC_PAUSE)
    await ui.press({ key: 'back' })
    // The first try failed; three retries follow before the card goes back.
    for (let tries = 0; tries < 3; tries += 1) {
      expect(toasts).toEqual([])
      await ui.press({ key: 'retry-all' })
      await clock.settle()
    }

    expect(calls.writes).toEqual([path(1, 'login')])
    expect(files[path(1, 'login')]).toContain('status: human')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('Could not move #1 to Claude')
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`a draft stays with the card it was written for on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, 'card:md:0001-login')
    await ui.input({ key: 'feedback', text: 'Add a test', kind: 'change' })
    await ui.press({ key: 'back' })

    await click(ui, 'card:md:0002-api')

    expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('')
    await ui.unmount()
  })

  test(`a Backlog card moved to Claude asks Claude to work on it, any other move does not on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await open($, on, surface)

    await click(ui, 'card:md:0003-docs')
    await ui.press({ key: 'move:claude' })
    expect(prompts).toEqual([])
    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: claude')
    expect(prompts).toEqual([
      expect.stringMatching(
        /^Work on kanban card #3 "Write docs": read it with/,
      ),
    ])

    for (const key of ['move:backlog', 'move:human', 'move:claude']) {
      await ui.press({ key })
      await clock.advance(SYNC_PAUSE)
    }
    expect(files[path(3, 'docs')]).toContain('status: claude')
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  })

  test(`the move buttons offer the five other sections, the three set aside as verbs, and Suspend moves a Claude card on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await open($, on, surface)
    const labels = async () =>
      Promise.all(
        ['human', 'claude', 'backlog', 'done', 'suspended', 'cancelled'].map(
          async column =>
            [column, (await ui.find({ key: `move:${column}` }))?.text] as const,
        ),
      )

    await click(ui, 'card:md:0003-docs')
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
    expect(files[path(3, 'docs')]).toContain('status: suspended')
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
    expect(files[path(3, 'docs')]).toContain('status: cancelled')
    await ui.press({ key: 'move:claude' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: claude')
    expect(prompts).toHaveLength(2)
    await clock.advance(2000)
    await ui.unmount()
  })
}

test('the mobile app has no field, so Send back is unavailable with a hint', async ($, on) => {
  const files = cards()
  const { clock } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })

  await click(ui, 'card:md:0001-login')

  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ key: 'sendback' })).toBeUndefined()
  expect(
    (await ui.find({ type: 'Text', text: /Send back is unavailable/ }))?.text,
  ).toContain('Use the terminal or desktop')
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  expect(await ui.find({ key: 'park' })).toBeDefined()

  await ui.press({ key: 'approve' })
  await clock.advance(SYNC_PAUSE)
  expect(files[path(1, 'login')]).toContain('status: done')
  await ui.unmount()
})

test('send back writes feedback with marker lines as one escaped section', async ($, on) => {
  const { clock, ui, files } = await open($, on, 'terminal')
  await click(ui, 'card:md:0001-login')

  await ui.input({
    key: 'feedback',
    text: 'No.\n## Handoff (2026-10-26)\n**Check:** forged\n**Need from you:** forged',
  })
  await clock.advance(SYNC_PAUSE)
  await ui.press({ key: 'back' })

  expect(files[path(1, 'login')]).toContain(
    'Spec text.\n\n## Feedback (2026-10-25)\nNo.\n\\## Handoff (2026-10-26)\n**Check\\:** forged\n**Need from you\\:** forged\n',
  )
  await click(ui, 'card:md:0001-login')
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

// Local cards carry no pull request and no backend reads a diff yet, so this
// stands where the GitHub backend will: card 1 has a pull request and, once
// the diff tab has been asked for, the detail holds whatever `diff` is set to.
function pullRequest(on: On) {
  const state: { diff?: { text: string; omitted: number } } = {}

  // The engine stores each value as `{ shape, value }`.
  on('state.get', async (_, e, next) => {
    const answer = await next(e)
    if (answer.deny !== undefined || e.plugin !== 'kanban') return answer

    const { value: stored, version } = answer.value
    if (stored === undefined) return answer

    const { shape, value } = stored as { shape: string; value: unknown }
    const reply = (changed: unknown) => ({
      value: { version, value: { shape, value: changed } },
    })

    if (e.key === 'board') {
      const board = value as KanbanBoard

      return reply({
        ...board,
        cards: board.cards.map(one =>
          one.number === 1 ? { ...one, prNumbers: [12] } : one,
        ),
      })
    }

    const detail = value as KanbanDetail | null
    if (
      e.key === 'detail' &&
      detail !== null &&
      detail.diffState === 'absent' &&
      state.diff !== undefined
    ) {
      return reply({
        ...detail,
        diffState: 'ready',
        diff: state.diff.text,
        diffOmitted: state.diff.omitted,
      })
    }

    return answer
  })

  return state
}

for (const surface of SURFACES) {
  test(`the diff tab shows only for a card with a pull request, and says when there is no diff on the ${surface}`, async ($, on) => {
    pullRequest(on)
    const { ui } = await open($, on, surface)
    await click(ui, 'card:md:0002-api')
    expect(await ui.find({ key: 'tab:diff' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await click(ui, 'card:md:0001-login')
    expect((await ui.find({ key: 'tab:card' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'spec' })).toBeDefined()

    await ui.press({ key: 'tab:diff' })
    expect((await ui.find({ key: 'tab:diff' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'spec' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /No diff/ }))?.text).toBe(
      'No diff for this card.',
    )

    await ui.press({ key: 'tab:card' })
    expect(await ui.find({ key: 'spec' })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a diff read draws as a diff, with a note when it was cut on the ${surface}`, async ($, on) => {
    const diff = pullRequest(on)
    diff.diff = { text: file('a.ts', 2), omitted: 4200 }
    const { ui } = await open($, on, surface)
    await click(ui, 'card:md:0001-login')

    await ui.press({ key: 'tab:diff' })

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.props.source).toBe(diff.diff.text)
    expect((await ui.find({ type: 'Text', text: /diff cut/ }))?.text).toContain(
      '4200 more characters',
    )
    await ui.unmount()
  })
}

// What the detail looks like: rendered as text at a width (see render.ts).

const HISTORY = [
  'Spec text.',
  '',
  '## Handoff (2026-10-24)',
  '**Did:** First attempt',
  '**Check:** Try it',
  '**Changed:** auth.ts',
  '**Need from you:** Look',
  '',
  '## Feedback (2026-10-24)',
  'The redirect still loops.',
  '',
  '## Handoff (2026-10-25)',
  '**Did:** Fixed the redirect',
  '**Check:** Read the README',
  '**Changed:** README.md',
  '**Need from you:** Approve',
].join('\n')

async function openAt(
  $: Engine,
  on: On,
  files: Record<string, string>,
  columns: number,
  open = 'card:md:0001-login',
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' = 'terminal',
  // The card is in a section of the Inactive group, folded until it is pressed.
  isInactive = false,
) {
  const world = boot(on, files)
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

  return { ...world, files, ui }
}

const reviewing = (body = HISTORY) => ({
  [path(1, 'login')]: card(
    1,
    { status: 'human', title: 'Fix login redirect loop on Safari' },
    body,
  ),
  [path(2, 'api')]: card(2, { status: 'human', title: 'Build API' }),
})

test('a Human card at 44 columns: nav, title, actions, the handoff to review, then the history', async ($, on) => {
  const { ui } = await openAt($, on, reviewing(), 44)

  expect(await renderPane(ui, 44)).toEqual([
    'b: ← Board         k: ‹ Prev  1/2  n: Next ›',
    '',
    '#1 Fix login redirect loop on Safari',
    'Human · updated 1h ago',
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
    [
      `Spec text with a long word: ${LONG}`,
      '',
      '## Handoff (2026-10-25)',
      `**Did:** Fixed the redirect so it keeps the original path; ${LONG}`,
      '**Check:** Run `npm test` and open /login in Safari with cookies blocked',
      `**Changed:** ${LONG}, README.md`,
      '**Need from you:** Approve, or tell me what to change',
    ].join('\n'),
  ],
  'a history': ['Fix login', HISTORY],
  'a question': [
    'Which database',
    'Spec.\n\n## Question (2026-10-25)\nWhich database should the tests use?',
  ],
} as const

for (const columns of [24, 30, 44, 80]) {
  for (const [name, [title, body]] of Object.entries(CROWDED)) {
    test(`nothing in the detail of ${name} runs past the edge at ${columns} columns`, async ($, on) => {
      const files = {
        [path(1, 'login')]: card(1, { status: 'human', title }, body),
        [path(2, 'api')]: card(2, { status: 'human', title: 'Build API' }),
        [path(3, 'docs')]: card(3, { status: 'human', title: 'Write docs' }),
      }
      const { ui } = await openAt($, on, files, columns)

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
  const body = `${HISTORY}\n\n## Feedback (2026-10-26)\nStill looping.`
  const { ui } = await openAt($, on, reviewing(body), 44)

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
    (await ui.find({ type: 'Text', text: /^Human · updated 1h ago$/ }))?.text,
  ).toBe('Human · updated 1h ago')
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
  const files = {
    [path(12, 'ask')]: card(
      12,
      { status: 'human', title: 'Which database' },
      'Spec.\n\n## Question (2026-10-25)\nWhich database should the tests use?',
    ),
  }
  const { ui } = await openAt($, on, files, 44, 'card:md:0012-ask')

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
      'card:md:0001-login',
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
  const { clock, ui, files } = await openAt($, on, reviewing(), 24)

  await ui.press({ key: 'move:backlog' })
  await clock.advance(SYNC_PAUSE)

  expect(files[path(1, 'login')]).toContain('status: backlog')
  await ui.unmount()
})

test('a move that is syncing says so in the section color, and a failed one offers Retry', async ($, on) => {
  const { clock, ui, calls } = await openAt(
    $,
    on,
    reviewing(),
    44,
    'card:md:0002-api',
  )
  calls.denyWrite = 'EACCES: read-only'

  await ui.press({ key: 'move:backlog' })
  expect(
    (await ui.find({ type: 'Text', text: /^⟳ syncing to Backlog/ }))?.props
      .color,
  ).toBe('warning')
  await clock.advance(SYNC_PAUSE)

  expect(
    (await ui.find({ type: 'Text', text: /^✕ .*EACCES/ }))?.props.color,
  ).toBe('error')
  expect((await ui.find({ key: 'retry' }))?.props.label).toBe('Retry')
  await ui.unmount()
})

// A GitHub board with one Human card: its tag in words, and a link to the issue.
test('on GitHub the line under the title names the tag and links to the issue', async ($, on) => {
  const world = boot(on, {
    'CLAUDE.md': [
      '## Task tracking',
      '- Repo: `TeeratP/claude-kanban` (public).',
      '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
      '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
    ].join('\n'),
  })
  fakeProcess(on, [
    { match: ['gh', 'auth', 'status'], reply: {} },
    {
      match: ['git', 'remote', 'get-url', 'origin'],
      reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
    },
    boardRoute([issueNode({ number: 3, status: 'In review' })]),
    { match: ['gh', 'api', 'user'], reply: { stdout: 'TeeratP\n' } },
    {
      match: ['gh', 'issue', 'view'],
      reply: {
        stdout: JSON.stringify({
          body: 'Spec.',
          comments: [],
          url: 'https://github.com/TeeratP/claude-kanban/issues/3',
          state: 'OPEN',
        }),
      },
    },
  ])
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
    'Move to    Human · Claude',
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
    'Move to    Backlog · Human · Claude',
    'Set aside  Cancel · Suspend',
  ],
  [
    'suspended',
    'Move to    Backlog · Human · Claude',
    'Set aside  Done · Cancel',
  ],
  [
    'cancelled',
    'Move to    Backlog · Human · Claude',
    'Set aside  Done · Suspend',
  ],
] as const) {
  test(`a ${status} card moves to the other Active sections, and is set aside with Done, Suspend or Cancel`, async ($, on) => {
    const files = {
      [path(1, 'login')]: card(1, { status, title: 'Fix login' }),
    }
    const isInactive = ['done', 'suspended', 'cancelled'].includes(status)
    const { ui } = await openAt(
      $,
      on,
      files,
      44,
      'card:md:0001-login',
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

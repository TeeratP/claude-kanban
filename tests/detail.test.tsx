import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { KanbanBoard, KanbanDetail } from '../types'
import { formatFeedback } from '../hooks/handoff'
import { capDiff } from '../hooks/model'
import { click, rowKeys } from './board-ui'
import { PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'

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
    expect(await ui.find({ key: 'approve' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Done/ }))?.text).toMatch(
      /^Done/,
    )
    await clock.advance(SYNC_PAUSE)
    expect(files[path(1, 'login')]).toContain('status: done')

    await ui.press({ key: 'back' })
    await click(ui, 'card:md:0002-api')
    await ui.press({ key: 'park' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(2, 'api')]).toContain('status: backlog')
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

    expect(await ui.find({ key: 'back' })).toBeUndefined()
    const keys = await rowKeys(ui)
    expect(
      keys.slice(keys.indexOf('hdr:claude'), keys.indexOf('hdr:backlog')),
    ).toEqual(['hdr:claude', 'card:md:0001-login'])

    await click(ui, 'card:md:0001-login')
    expect((await ui.find({ key: 'section:0' }))?.text).toContain(
      'Feedback (2026-10-25)',
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

import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import type { KanbanCard } from '../types'
import { queueAfter, queueAt, queueStep } from '../hooks/layout'
import { SETTLE_MS } from '../hooks/model'
import { focusFeedback } from '../hooks/view-detail'
import { click, rowKeys } from './board-ui'
import { PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'

const SURFACES = ['terminal', 'desktop'] as const
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const

// The Human queue runs by order, not by number: Build API, Write docs, Fix login.
const cards = () => ({
  [path(1, 'login')]: card(1, {
    status: 'human',
    title: 'Fix login',
    order: 3,
  }),
  [path(2, 'api')]: card(2, { status: 'human', title: 'Build API', order: 1 }),
  [path(3, 'docs')]: card(3, {
    status: 'human',
    title: 'Write docs',
    order: 2,
  }),
  [path(4, 'tests')]: card(4, { status: 'claude', title: 'Add tests' }),
})

const LOGIN = 'card:md:0001-login'
const API = 'card:md:0002-api'
const TESTS = 'card:md:0004-tests'

async function open<P extends 'terminal' | 'desktop' | 'mobile'>(
  $: Engine,
  on: On,
  surface: P,
  files: Record<string, string> = cards(),
) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

type Ui = Pick<Mounted, 'find'>

// The open card as the detail draws it: its title, its section, and its place in the Human queue.
async function shown(ui: Ui) {
  const title = (await ui.find({ type: 'Text', text: /^#\d/ }))?.text
  const meta = (await ui.find({ type: 'Text', text: /^(Human|Claude)/ }))?.text
  const place = (await ui.find({ type: 'Text', text: /^\d+\/\d+$/ }))?.text

  return { title, section: meta?.split(' · ')[0], place }
}

// The line of key names the buttons used to be repeated in.
const hint = async (ui: Ui) =>
  (await ui.find({ type: 'Text', text: /· b board$/ }))?.text

for (const surface of SURFACES) {
  test(`the header shows the place in the Human queue, in the section's order, on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)

    await click(ui, API)
    expect(await shown(ui)).toEqual({
      title: '#2 Build API',
      section: 'Human',
      place: '1/3',
    })
    await ui.press({ key: 'next' })
    expect(await shown(ui)).toEqual({
      title: '#3 Write docs',
      section: 'Human',
      place: '2/3',
    })
    await ui.unmount()
  })

  test(`n walks the queue and wraps, k walks back and wraps on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)

    const walked: (string | undefined)[] = []
    for (const key of ['next', 'next', 'next', 'prev', 'prev', 'prev']) {
      await ui.press({ key })
      walked.push((await shown(ui)).place)
    }

    expect(walked).toEqual(['2/3', '3/3', '1/3', '3/3', '2/3', '1/3'])
    await ui.unmount()
  })

  test(`the keys are on the buttons, with no hint line repeating them, on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)

    const hotkeys = async (...keys: string[]) =>
      Promise.all(keys.map(async key => (await ui.find({ key }))?.props.hotkey))
    expect(
      await hotkeys('approve', 'sendback', 'park', 'focus', 'next', 'prev'),
    ).toEqual(['a', 's', 'p', 'f', 'n', 'k'])
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')

    // The nav and the feedback key are plain Buttons, drawn `k: ‹ Prev`; Approve leads.
    const plain = async (...keys: string[]) =>
      Promise.all(keys.map(async key => (await ui.find({ key }))?.props.plain))
    expect(await plain('back', 'prev', 'next', 'focus')).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect((await ui.find({ key: 'approve' }))?.props.variant).toBe('primary')
    expect(await hint(ui)).toBeUndefined()
    await ui.unmount()
  })

  test(`approve and park open the next Human card, and the last one returns to the board on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await open($, on, surface)
    await click(ui, API)

    await ui.press({ key: 'approve' })
    expect(await shown(ui)).toEqual({
      title: '#3 Write docs',
      section: 'Human',
      place: '1/2',
    })
    await clock.advance(SETTLE_MS)
    await ui.press({ key: 'park' })
    expect(await shown(ui)).toEqual({
      title: '#1 Fix login',
      section: 'Human',
    })
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    expect(await ui.find({ key: 'prev' })).toBeUndefined()
    await clock.advance(SETTLE_MS)
    await ui.press({ key: 'approve' })

    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect(await rowKeys(ui)).toContain('hdr:human')
    await clock.advance(SYNC_PAUSE)
    expect(files[path(2, 'api')]).toContain('status: done')
    expect(files[path(3, 'docs')]).toContain('status: backlog')
    expect(files[path(1, 'login')]).toContain('status: done')
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`a decision pressed again as the review moves on is ignored for a moment, and the keys that walk are not on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await open($, on, surface)
    await click(ui, API)

    await ui.press({ key: 'approve' })
    await ui.press({ key: 'approve' })
    await ui.press({ key: 'park' })
    await ui.input({ key: 'feedback', text: 'Too soon' })
    expect(await shown(ui)).toEqual({
      title: '#3 Write docs',
      section: 'Human',
      place: '1/2',
    })

    await clock.advance(SETTLE_MS - 1)
    await ui.press({ key: 'approve' })
    expect((await shown(ui)).title).toBe('#3 Write docs')
    await ui.press({ key: 'next' })
    expect((await shown(ui)).title).toBe('#1 Fix login')
    await ui.press({ key: 'prev' })
    expect((await shown(ui)).title).toBe('#3 Write docs')

    await clock.advance(1)
    await ui.press({ key: 'approve' })
    expect((await shown(ui)).title).toBe('#1 Fix login')
    await clock.advance(SYNC_PAUSE)
    expect(files[path(2, 'api')]).toContain('status: done')
    expect(files[path(3, 'docs')]).toContain('status: done')
    expect(files[path(3, 'docs')]).not.toContain('Too soon')
    expect(files[path(1, 'login')]).toContain('status: human')
    await ui.unmount()
  })

  test(`a decision on a card opened by hand is never held back on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)

    await ui.press({ key: 'next' })
    await ui.press({ key: 'approve' })

    expect((await shown(ui)).title).toBe('#1 Fix login')
    await ui.unmount()
  })

  test(`an action on the last card of the queue goes on to the first on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)
    await ui.press({ key: 'prev' })
    expect((await shown(ui)).place).toBe('3/3')

    await ui.press({ key: 'approve' })

    expect(await shown(ui)).toEqual({
      title: '#2 Build API',
      section: 'Human',
      place: '1/2',
    })
    await ui.unmount()
  })

  test(
    `send back opens the next Human card with an empty draft on the ${surface}`,
    // Add tests is already in Claude: at the default limit of one the prompt would be held.
    { options: { claudeLimit: 0 } },
    async ($, on) => {
      const { clock, ui, files, prompts } = await open($, on, surface)
      await click(ui, API)

      await ui.input({ key: 'feedback', text: 'Use the staging DB' })

      expect(await shown(ui)).toEqual({
        title: '#3 Write docs',
        section: 'Human',
        place: '1/2',
      })
      expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('')
      await clock.advance(SYNC_PAUSE)
      expect(files[path(2, 'api')]).toContain('status: claude')
      expect(files[path(2, 'api')]).toContain('Use the staging DB')
      expect(prompts).toHaveLength(1)
      await ui.unmount()
    },
  )

  test(`a send back that fails stays on the card on the ${surface}`, async ($, on) => {
    const { ui, calls, toasts } = await open($, on, surface)
    await click(ui, API)
    calls.denyWrite = 'EACCES: read-only'

    await ui.input({ key: 'feedback', text: 'Use the staging DB' })

    expect((await shown(ui)).title).toBe('#2 Build API')
    expect(toasts).toHaveLength(1)
    await ui.unmount()
  })

  test(`f is the key of a button that leads to the feedback field on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)

    const button = await ui.find({ key: 'focus' })
    expect(button?.props.hotkey).toBe('f')
    expect(button?.props.label).toBe('Write feedback')
    expect((await ui.find({ key: 'feedback' }))?.type).toBe('Input')
    await ui.unmount()
  })

  test(`cards that leave Human while one is open change the place and the next card on the ${surface}`, async ($, on) => {
    const { clock, ui } = await open($, on, surface)
    await click(ui, API)

    await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
    expect((await shown(ui)).place).toBe('1/2')
    await ui.press({ key: 'next' })
    expect(await shown(ui)).toEqual({
      title: '#1 Fix login',
      section: 'Human',
      place: '2/2',
    })
    await ui.press({ key: 'next' })
    expect((await shown(ui)).title).toBe('#2 Build API')

    // The card on show leaves too: no place, no walking, no keys for a decision.
    await $.tool.call({ ...MOVE, card: 2, to: 'claude' })
    expect((await shown(ui)).section).toBe('Claude')
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    expect(await ui.find({ key: 'approve' })).toBeUndefined()
    await clock.advance(SYNC_PAUSE)
    await ui.unmount()
  })

  test(`the last card left in Human returns to the board when decided on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await click(ui, API)
    await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
    await $.tool.call({ ...MOVE, card: 1, to: 'claude' })

    expect(await shown(ui)).toMatchObject({ section: 'Human' })
    expect((await shown(ui)).place).toBeUndefined()
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    await ui.press({ key: 'approve' })

    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a card that is not in Human has no queue keys on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)

    await click(ui, TESTS)

    expect((await shown(ui)).section).toBe('Claude')
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    expect(await ui.find({ key: 'prev' })).toBeUndefined()
    expect(await ui.find({ key: 'focus' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a decision does not move the person on from a card they have since left on the ${surface}`, async ($, on) => {
    const { clock, ui, calls, files } = await open($, on, surface)
    await click(ui, API)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    // The feedback is still being saved when the person goes to another card.
    const sending = ui.input({ key: 'feedback', text: 'Use the staging DB' })
    await ui.press({ key: 'back' })
    await click(ui, LOGIN)
    release()
    await sending
    await clock.advance(SYNC_PAUSE)

    expect(files[path(2, 'api')]).toContain('status: claude')
    expect((await shown(ui)).title).toBe('#1 Fix login')
    await ui.unmount()
  })
}

// Card 2 is a question Claude asked; answering it is a decision like Send back.
const withQuestion = () => ({
  ...cards(),
  [path(2, 'api')]: card(
    2,
    { status: 'human', title: 'Build API', order: 1 },
    'Spec text.\n\n## Question (2026-10-25)\nWhich database?',
  ),
})

for (const surface of SURFACES) {
  test(
    `answering a question opens the next Human card like a send back does on the ${surface}`,
    // Add tests is already in Claude: at the default limit of one the prompt would be held.
    { options: { claudeLimit: 0 } },
    async ($, on) => {
      const { clock, ui, files, prompts } = await open(
        $,
        on,
        surface,
        withQuestion(),
      )
      await click(ui, API)
      expect((await ui.find({ key: 'sendback' }))?.props.hotkey).toBe('s')
      expect((await ui.find({ key: 'focus' }))?.props.label).toBe(
        'Write answer',
      )

      await ui.input({ key: 'feedback', text: 'The staging one' })

      expect(await shown(ui)).toEqual({
        title: '#3 Write docs',
        section: 'Human',
        place: '1/2',
      })
      expect((await ui.find({ key: 'feedback' }))?.props.value).toBe('')
      await clock.advance(SYNC_PAUSE)
      await clock.advance(SYNC_PAUSE)
      expect(files[path(2, 'api')]).toContain(
        '## Answer (2026-10-25)\nThe staging one',
      )
      expect(files[path(2, 'api')]).toContain('status: claude')
      expect(prompts).toEqual([
        expect.stringMatching(/^Resume kanban card #2: the person answered/),
      ])
      await ui.unmount()
    },
  )
}

test('the mobile app walks and decides the queue without a field', async ($, on) => {
  const { clock, ui, files } = await open($, on, 'mobile')
  await click(ui, API)

  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ key: 'focus' })).toBeUndefined()
  expect(await ui.find({ key: 'sendback' })).toBeUndefined()
  expect(await hint(ui)).toBeUndefined()

  await ui.press({ key: 'next' })
  expect((await shown(ui)).place).toBe('2/3')
  await ui.press({ key: 'approve' })
  expect(await shown(ui)).toEqual({
    title: '#1 Fix login',
    section: 'Human',
    place: '2/2',
  })
  await clock.advance(SYNC_PAUSE)
  expect(files[path(3, 'docs')]).toContain('status: done')
  await ui.unmount()
})

const at = (
  id: number,
  column: KanbanCard['column'],
  order: number,
): KanbanCard => ({
  id: `md:${id}`,
  number: id,
  title: `Card ${id}`,
  column,
  order,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T11:00:00Z',
})

test('the queue is the Human section: by order, then number', () => {
  const board = [
    at(1, 'human', 2),
    at(2, 'claude', 1),
    at(3, 'human', 1),
    at(4, 'human', 2),
  ]

  expect(queueAt(board, 'md:3')).toEqual({ index: 0, total: 3 })
  expect(queueAt(board, 'md:4')).toEqual({ index: 2, total: 3 })
  expect(queueAt(board, 'md:2')).toBeUndefined()
  expect(queueStep(board, 'md:3', 1)).toBe('md:1')
  expect(queueStep(board, 'md:4', 1)).toBe('md:3')
  expect(queueStep(board, 'md:3', -1)).toBe('md:4')
  expect(queueStep(board, 'md:2', 1)).toBeUndefined()
})

test('a queue of one has no other card to step to', () => {
  const board = [at(1, 'human', 1), at(2, 'done', 1)]

  expect(queueStep(board, 'md:1', 1)).toBeUndefined()
  expect(queueStep(board, 'md:1', -1)).toBeUndefined()
})

test('the card after a decided one is found even though it has left Human', () => {
  const board = [at(1, 'human', 1), at(2, 'done', 2), at(3, 'human', 3)]

  expect(queueAfter(board, at(2, 'human', 2))).toBe('md:3')
  expect(queueAfter(board, at(3, 'human', 3))).toBe('md:1')
  expect(queueAfter(board, at(1, 'human', 1))).toBe('md:3')
  expect(queueAfter([at(2, 'done', 2)], at(2, 'human', 2))).toBeUndefined()
})

// The kit has no focus ring to answer a plugin's `$.ui.focus`, so the call is
// checked against a hand-made `$`.
function focusStub(deny?: string) {
  const asked: unknown[] = []
  const toasts: string[] = []
  const $ = {
    ui: {
      focus: async (args: unknown) => {
        asked.push(args)

        return deny === undefined ? {} : { deny }
      },
      toast: (text: string) => {
        toasts.push(text)
      },
    },
  } as unknown as EngineInterface

  return { $, asked, toasts }
}

test('f asks the engine to focus the feedback field of the pane', async () => {
  const { $, asked, toasts } = focusStub()

  await focusFeedback($)

  expect(asked).toEqual([{ requestId: 'kanban', key: 'feedback' }])
  expect(toasts).toEqual([])
})

test('a focus the engine refuses is said, not dropped', async () => {
  const { $, toasts } = focusStub('the pane does not hold the keys')

  await focusFeedback($)

  expect(toasts).toEqual([
    'Could not move to the feedback box: the pane does not hold the keys',
  ])
})

for (const surface of SURFACES) {
  test(`no two buttons of the review detail share a key, and the Check buttons take none on the ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface, {
      ...cards(),
      [path(2, 'api')]: card(
        2,
        { status: 'human', title: 'Build API', order: 1 },
        [
          'Spec text.',
          '',
          '## Handoff (2026-10-25)',
          '**Did:** Wrote the API',
          '**Check:** Run `npm test` and read the output',
          '**Changed:** api.ts',
          '**Need from you:** Approve',
        ].join('\n'),
      ),
    })
    await click(ui, API)

    const run = await ui.find({ key: 'check:run:0' })
    expect(run?.props.label).toBe('Run check: npm test')
    expect(run?.props.hotkey).toBeUndefined()

    const keys = (await ui.findAll({ type: 'Button' }))
      .map(button => button.props.hotkey)
      .filter(hotkey => hotkey !== undefined)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(['a', 'b', 'f', 'k', 'n', 'p', 's'])
    await ui.unmount()
  })
}

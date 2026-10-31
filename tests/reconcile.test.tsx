import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { rowIndex } from './board-ui'
import { PANE, RUN, SYNC_PAUSE } from './fakes'
import { HANDOFF, bootGithub, issue } from './fake-github'
import type { FakeCard } from './fake-github'

const KANBAN = (name: string) => `mcp__kanban__kanban_${name}` as const
const ASKED = (n: number) =>
  `Card #${n} is still in Claude. If the work is done, record a handoff and move it to Done (or to Human if it needs the person's approval); if you need a decision, kanban_ask; if you are still working, say so and continue.`
const UNTRACKED =
  'This turn changed files with no card in Claude. If it is backlog work, move or create its card.'

// Card 2 is in Claude with a handoff to move on with; card 3 waits in Backlog.
const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'claude', title: 'Build API', comments: [HANDOFF] }),
  issue(3, { column: 'backlog', title: 'Write docs' }),
]

// Nothing is in Claude.
const idle = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(3, { column: 'backlog', title: 'Write docs' }),
]

// A session with the board loaded and no pane.
async function quiet(
  $: Engine,
  on: On,
  issues: FakeCard[] = cards(),
  refuse?: 'Edit',
) {
  // The tool a test has fail, answered ahead of the engine's own.
  if (refuse !== undefined)
    on('tool.call', { tool: refuse }, () => ({ deny: 'no' }))
  const world = bootGithub(on, issues)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: KANBAN('list') })
  await world.clock.settle()

  return world
}

// The same with the pane open, which cards are dragged on.
async function open($: Engine, on: On) {
  const world = await quiet($, on)
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, ui }
}

type Ended = 'answer' | 'aborted' | 'error'

const call = ($: Engine, name: string, input: Record<string, unknown>) =>
  $.tool.call({ tool: KANBAN(name), ...input })

const finish = ($: Engine, n: number, reason: Ended = 'answer') =>
  $.turn.complete({
    answer: 'done',
    durationMs: 0,
    isAborted: reason === 'aborted',
    turnId: `t${n}`,
    reason,
  })

// A turn from `text` that does `during` and ends as `reason` says.
async function turn(
  $: Engine,
  n: number,
  during: () => Promise<unknown>,
  { text = 'go', reason = 'answer' }: { text?: string; reason?: Ended } = {},
) {
  await $.turn.start({ text, turnId: `t${n}` })
  await during()
  await finish($, n, reason)
}

// The person drags card 3 to Claude; the move reaches the backend after a pause.
async function dragToClaude(ui: Mounted<'terminal', 'Pane'>) {
  const from = await rowIndex(ui, 'card:gh:3')
  const to = await rowIndex(ui, 'hdr:claude')
  await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
  await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
  await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })
}

const edit = ($: Engine, tool: string, file: string) =>
  $.tool.call(
    tool === 'NotebookEdit'
      ? {
          tool: 'NotebookEdit',
          notebook_path: file,
          new_source: 'x',
          edit_mode: 'replace',
        }
      : tool === 'Write'
        ? { tool: 'Write', file_path: file, content: 'x' }
        : { tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' },
  )

test(
  'a turn from a card prompt that ends with no handoff is asked about once',
  async ($, on) => {
    const { clock, prompts, ui } = await open($, on)
    await dragToClaude(ui)
    await clock.advance(SYNC_PAUSE)
    const work = prompts[0] ?? ''
    expect(work).toMatch(/^Work on kanban card #3 /)

    await turn($, 1, async () => undefined, { text: work })
    await clock.settle()

    expect(prompts).toEqual([work, ASKED(3)])
    await ui.unmount()
  },
)

test('a reconcile turn is never asked about, whatever it leaves in Claude', async ($, on) => {
  const { clock, prompts } = await quiet($, on)
  await turn($, 1, () => call($, 'show', { card: 2 }))
  await clock.settle()
  expect(prompts).toEqual([ASKED(2)])

  // Claude says it is still working, and takes up another card without a word on it.
  await turn(
    $,
    2,
    async () => {
      await call($, 'show', { card: 2 })
      await call($, 'move', { card: 3, to: 'claude' })
    },
    { text: ASKED(2) },
  )
  await clock.settle()

  expect(prompts).toEqual([ASKED(2)])
})

test('a card is asked about once in a round, however many turns it has', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await turn($, 1, () => call($, 'show', { card: 2 }))
  await clock.settle()
  await turn($, 2, () => call($, 'show', { card: 2 }))
  await clock.settle()
  await turn($, 3, () => call($, 'show', { card: 2 }))
  await clock.settle()

  expect(prompts).toEqual([ASKED(2)])
})

test('a card that leaves Claude and comes back is asked about again', async ($, on) => {
  const { clock, prompts } = await quiet($, on)
  await turn($, 1, () => call($, 'show', { card: 2 }))
  await clock.settle()
  expect(prompts).toEqual([ASKED(2)])

  await turn($, 2, () => call($, 'move', { card: 2, to: 'backlog' }), {
    text: ASKED(2),
  })
  await clock.settle()
  await turn($, 3, () => call($, 'move', { card: 2, to: 'claude' }))
  await clock.settle()

  expect(prompts).toEqual([ASKED(2), ASKED(2)])
})

for (const [name, then] of [
  [
    'a handoff',
    ($: Engine) =>
      call($, 'handoff', {
        card: 2,
        did: 'Built it',
        check: 'Run it',
        need: 'Approve',
      }),
  ],
  [
    'a handoff that needs nothing',
    ($: Engine) =>
      call($, 'handoff', { card: 2, did: 'Built it', check: 'Run it' }),
  ],
  [
    'a question',
    ($: Engine) => call($, 'ask', { card: 2, question: 'Which?' }),
  ],
  ['a move to Human', ($: Engine) => call($, 'move', { card: 2, to: 'human' })],
  ['a move to Done', ($: Engine) => call($, 'move', { card: 2, to: 'done' })],
  [
    'a move to Backlog',
    ($: Engine) => call($, 'move', { card: 2, to: 'backlog' }),
  ],
] as const) {
  test(`a turn with ${name} on its card is not asked about`, async ($, on) => {
    const { clock, prompts } = await quiet($, on)

    await turn($, 1, async () => {
      await call($, 'show', { card: 2 })
      expect(await then($)).toHaveProperty('result')
    })
    await clock.settle()

    expect(prompts).toEqual([])
  })
}

test('a handoff the tool refused leaves the card to be asked about', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await turn($, 1, async () => {
    const refused = await call($, 'handoff', {
      card: 2,
      did: '',
      check: '',
    })
    expect(refused).toHaveProperty('deny')
  })
  await clock.settle()

  expect(prompts).toEqual([ASKED(2)])
})

test('a move into Claude is not a word on the card: the turn is asked about it', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await turn($, 1, async () => {
    await call($, 'move', { card: 3, to: 'claude' })
  })
  await clock.settle()

  expect(prompts).toEqual([ASKED(3)])
})

test('each card of the turn that is still in Claude is asked about', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await turn($, 1, async () => {
    await call($, 'show', { card: 2 })
    await call($, 'move', { card: 3, to: 'claude' })
  })
  await clock.settle()

  expect(prompts).toEqual([ASKED(2), ASKED(3)])
})

test('a card that is no longer in Claude when the turn ends is not asked about', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await turn($, 1, async () => {
    await call($, 'show', { card: 3 })
    await call($, 'show', { card: 1 })
  })
  await clock.settle()

  expect(prompts).toEqual([])
})

for (const reason of ['aborted', 'error'] as const) {
  test(`a turn that ended ${reason} is not asked about`, async ($, on) => {
    const { clock, prompts } = await quiet($, on)

    await turn($, 1, () => call($, 'show', { card: 2 }), { reason })
    await clock.settle()

    expect(prompts).toEqual([])
  })
}

test('a turn the model refused is not asked about', async ($, on) => {
  const { clock, prompts } = await quiet($, on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await call($, 'show', { card: 2 })
  await $.turn.complete({
    answer: '',
    durationMs: 0,
    isAborted: false,
    turnId: 't1',
    reason: 'refusal',
    refusal: { category: null, explanation: null },
  })
  await clock.settle()

  expect(prompts).toEqual([])
})

test('a subagent turn is not asked about, and does not end the main turn', async ($, on) => {
  const { clock, prompts } = await quiet($, on)
  const ended = (n: number, agentId: string) =>
    $.turn.complete({
      answer: 'report',
      durationMs: 0,
      isAborted: false,
      turnId: `t${n}`,
      agentId,
      reason: 'answer',
    })

  await ended(9, 'agent-1')
  await clock.settle()
  expect(prompts).toEqual([])

  await $.turn.start({ text: 'go', turnId: 't1' })
  await call($, 'show', { card: 2 })
  await ended(9, 'agent-1')
  await clock.settle()
  expect(prompts).toEqual([])

  await finish($, 1)
  await clock.settle()
  expect(prompts).toEqual([ASKED(2)])
})

test('the turn keeps the answer it had', async ($, on) => {
  await quiet($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })

  expect(await finish($, 1)).toEqual({ text: '' })
})

test(
  'no question is asked while a prompt that starts work is on its way',
  async ($, on) => {
    const { clock, prompts, ui } = await open($, on)
    // Card 3 is in Claude on the board, its move not yet at the backend.
    await dragToClaude(ui)

    await turn($, 1, () => call($, 'show', { card: 2 }))
    await clock.settle()
    expect(prompts).toEqual([])

    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([expect.stringMatching(/^Work on kanban card #3 /)])

    // The question was held back, not given up: the next turn of the round asks.
    await turn($, 2, () => call($, 'show', { card: 2 }))
    await clock.settle()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toBe(ASKED(2))
    await ui.unmount()
  },
)

test(
  'a move into Claude that failed does not hold the question back',
  async ($, on) => {
    const { github, clock, prompts, ui } = await open($, on)
    github.fail['project item-edit'] = {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible',
    }
    await dragToClaude(ui)
    await clock.advance(SYNC_PAUSE)

    await turn($, 1, () => call($, 'show', { card: 2 }))
    await clock.settle()

    expect(prompts).toEqual([ASKED(2)])
    await ui.unmount()
  },
)

test('changed files and no card at all are noted once a session', async ($, on) => {
  const { clock, toasts, prompts } = await quiet($, on, idle())

  await turn($, 1, () => edit($, 'Edit', '/work/src/auth.ts'))
  await clock.settle()
  expect(toasts).toEqual([UNTRACKED])

  await turn($, 2, () => edit($, 'Edit', '/work/src/auth.ts'))
  await clock.settle()
  expect(toasts).toEqual([UNTRACKED])
  expect(prompts).toEqual([])
})

for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
  test(`a ${tool} counts as changing files`, async ($, on) => {
    const { clock, toasts } = await quiet($, on, idle())

    await turn($, 1, () => edit($, tool, '/work/src/auth.ts'))
    await clock.settle()

    expect(toasts).toEqual([UNTRACKED])
  })
}

test('work that is not noted: a card in play, a card in Claude, no edits', async ($, on) => {
  const { clock, toasts } = await quiet($, on, idle())

  await turn($, 1, async () => {
    await call($, 'show', { card: 3 })
    await edit($, 'Edit', '/work/src/auth.ts')
  })
  await turn($, 2, () => call($, 'show', { card: 3 }))
  await clock.settle()

  expect(toasts).toEqual([])
})

test('an edit under .kanban is a changed file like any other', async ($, on) => {
  const { clock, toasts } = await quiet($, on, idle())

  await turn($, 1, () => edit($, 'Edit', '/work/.kanban/0003-docs.md'))
  await clock.settle()

  expect(toasts).toEqual([UNTRACKED])
})

test('an edit the tool refused changed nothing', async ($, on) => {
  const { clock, toasts } = await quiet($, on, idle(), 'Edit')

  await turn($, 1, async () => {
    const refused = await edit($, 'Edit', '/work/src/auth.ts')
    expect(refused).toHaveProperty('deny')
  })
  await clock.settle()

  expect(toasts).toEqual([])
})

test('files changed while a card is in Claude are not noted', async ($, on) => {
  const { clock, toasts } = await quiet($, on)

  await turn($, 1, () => edit($, 'Edit', '/work/src/auth.ts'))
  await clock.settle()

  expect(toasts).toEqual([])
})

test('a turn that ended early is not noted for its edits', async ($, on) => {
  const { clock, toasts } = await quiet($, on, idle())

  await turn($, 1, () => edit($, 'Edit', '/work/src/auth.ts'), {
    reason: 'aborted',
  })
  await clock.settle()

  expect(toasts).toEqual([])
})

test(
  'the reconcile option off asks about no card',
  { options: { reconcile: false } },
  async ($, on) => {
    const { clock, prompts } = await quiet($, on)

    await turn($, 1, () => call($, 'show', { card: 2 }))
    await clock.settle()

    expect(prompts).toEqual([])
  },
)

test(
  'the reconcile option off notes no work without a card',
  { options: { reconcile: false } },
  async ($, on) => {
    const { clock, toasts } = await quiet($, on, idle())

    await turn($, 1, () => edit($, 'Edit', '/work/src/auth.ts'))
    await clock.settle()

    expect(toasts).toEqual([])
  },
)

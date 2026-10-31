import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import { moveOptions } from '../hooks/sync'
import { click, group, marks, row, under } from './board-ui'
import { PANE, RUN } from './fakes'
import type { FakeCard } from './fake-github'
import { HANDOFF, OPTION, bootGithub, issue } from './fake-github'
import type { fakeGithub } from './fake-github'

const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'claude', title: 'Build API' }),
  // Card 3 is moved to Human by these tests, which needs a handoff.
  issue(3, { column: 'backlog', title: 'Write docs', comments: [HANDOFF] }),
]

const DOCS = 'card:gh:3'
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const
const DENIED = { exitCode: 1, stderr: 'GraphQL: Resource not accessible by integration' }

/** Every Status the board was told to set, as `#n Status`: one per move sent. */
function edits(github: ReturnType<typeof fakeGithub>): string[] {
  return github.commands
    .filter(call => call.argv[1] === 'project' && call.argv[2] === 'item-edit')
    .map(call => {
      const { argv } = call
      const item = argv[argv.indexOf('--id') + 1] ?? ''
      const option = argv[argv.indexOf('--single-select-option-id') + 1]
      const name = Object.entries(OPTION).find(([, id]) => id === option)?.[0]

      return `#${item.replace('PVTI_', '')} ${name ?? option}`
    })
}

/** The session, the loaded board and a mounted pane. */
async function open(
  $: Engine,
  on: Parameters<typeof bootGithub>[0],
  issues: FakeCard[],
) {
  const kit = bootGithub(on, issues)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await kit.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  return { ...kit, ui }
}

test('a move is pending, then confirmed, then gone after two seconds', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  expect((await row(ui, DOCS))?.text).toContain('⟳')
  expect(await under(ui, 'hdr:claude')).toContain(DOCS)
  expect(github.card(3).status).toBe('Backlog')

  await clock.advance(300)
  expect(github.card(3).status).toBe('In progress')
  expect((await row(ui, DOCS))?.text).toContain('✓')
  const bright = (await marks(ui, '✓'))[0]?.props
  expect(bright).toMatchObject({ color: 'success' })
  expect(bright?.dimColor ?? false).toBe(false)

  // The ticker redraws every 400 ms, so the fade lands on the first beat past a second.
  await clock.advance(1300)
  expect((await marks(ui, '✓'))[0]?.props).toMatchObject({
    color: 'success',
    dimColor: true,
  })

  await clock.advance(1000)
  expect((await row(ui, DOCS))?.text).not.toMatch(/[⟳✓✕]/)
  expect(await under(ui, 'hdr:claude')).toContain(DOCS)
  await ui.unmount()
})

test('the pending mark pulses with the ticker', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  const pulse = async () => (await marks(ui, '⟳'))[0]?.props.dimColor ?? false
  const seen = [await pulse()]
  for (let beat = 0; beat < 4; beat += 1) {
    await clock.advance(400)
    seen.push(await pulse())
  }

  expect((await marks(ui, '⟳'))[0]?.props.color).toBe('warning')
  expect(seen).toEqual([false, true, false, true, false])

  release()
  await clock.advance(5000)
  await ui.unmount()
})

test('the ticker stops itself once nothing is syncing', async ($, on) => {
  const ticks: number[] = []
  on('state.set', ($, e, next) => {
    if (e.key === 'tick') ticks.push(1)

    return next(e)
  })
  const { clock, ui, github } = await open($, on, cards())

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(2800)
  const during = ticks.length
  await clock.advance(10_000)

  expect(during).toBeGreaterThan(0)
  expect(ticks.length).toBe(during)
  await ui.unmount()
})

test('a move made as the ticker reads that nothing shows keeps the ticker going', async ($, on) => {
  const ticks: number[] = []
  const gate: { hold?: Promise<void>; isHeld: boolean } = { isHeld: false }
  on('state.set', ($, e, next) => {
    if (e.key === 'tick') ticks.push(1)

    return next(e)
  })
  // The read is answered, then the answer waits: the beat acts on a moment already past.
  on('state.get', async ($, e, next) => {
    const read = await next(e)
    const hold = gate.hold
    if (e.key === 'sync' && hold !== undefined) {
      gate.hold = undefined
      gate.isHeld = true
      await hold
    }

    return read
  })
  const { clock, ui, github } = await open($, on, cards())
  let release = () => {}

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  // The mark is gone at 2300 ms; the beat at 2400 ms finds nothing showing.
  await clock.advance(2399)
  gate.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await clock.advance(1)
  expect(gate.isHeld).toBe(true)

  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  release()
  await clock.settle()
  const before = ticks.length
  await clock.advance(1000)

  expect(ticks.length).toBeGreaterThan(before)
  await clock.advance(3000)
  await ui.unmount()
})

test('a refused move shows a cross and a Retry that sends it again', async ($, on) => {
  const { clock, toasts, ui, github } = await open($, on, cards())
  github.fail['project item-edit'] = DENIED

  await click(ui, DOCS)
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)

  expect(toasts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toContain(
    'GraphQL: Resource not accessible by integration (attempt 1/4)',
  )
  expect(await ui.find({ key: 'retry' })).toBeDefined()

  delete github.fail['project item-edit']
  await ui.press({ key: 'retry' })
  await clock.settle()

  expect(github.card(3).status).toBe('In progress')
  expect(await ui.find({ key: 'retry' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toContain(
    '✓ saved',
  )
  await clock.advance(2000)
  await ui.unmount()
})

test('the toolbar counts failed moves and retries them all', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())
  github.fail['project item-edit'] = DENIED

  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await clock.advance(300)

  expect((await ui.find({ key: 'retry-all' }))?.text).toContain('✕2 retry')
  expect((await marks(ui, '✕')).map(mark => mark.props.color)).toEqual([
    'error',
    'error',
  ])

  const toolbar = [
    await ui.find({ key: 'refresh' }),
    await ui.find({ type: 'Text', text: /GitHub/ }),
    await ui.find({ key: 'retry-all' }),
  ]
  expect(
    toolbar.reduce((width, part) => width + cellWidth(part?.text ?? ''), 0),
  ).toBeLessThanOrEqual(PANE.props.bodyColumns)

  await ui.press({ key: 'retry-all' })
  await clock.settle()
  expect((await ui.find({ key: 'retry-all' }))?.text).toContain('✕2 retry')

  delete github.fail['project item-edit']
  await ui.press({ key: 'retry-all' })
  await clock.settle()

  expect(await ui.find({ key: 'retry-all' })).toBeUndefined()
  expect(github.card(3).status).toBe('In review')
  expect(github.card(1).status).toBe('In progress')
  await clock.advance(2000)
  await ui.unmount()
})

test('after the first try and three retries the card goes back, with the reason', async ($, on) => {
  const { clock, toasts, ui, github } = await open($, on, cards())
  github.fail['project item-edit'] = DENIED

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 2; tries += 1) {
    expect(toasts).toEqual([])
    await ui.press({ key: 'retry-all' })
    await clock.settle()
  }
  expect(toasts).toEqual([])
  expect(await under(ui, 'hdr:claude')).toContain(DOCS)

  await ui.press({ key: 'retry-all' })
  await clock.settle()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(
    /^Could not move #3 to Claude, so it is back in Backlog: .*Resource not accessible by integration$/,
  )
  expect(await under(ui, 'hdr:claude')).not.toContain(DOCS)
  expect(await under(ui, 'hdr:backlog')).toEqual([DOCS])
  expect(await ui.find({ key: 'retry-all' })).toBeUndefined()
  expect((await row(ui, DOCS))?.text).not.toMatch(/[⟳✓✕]/)
  await ui.unmount()
})

test('a card that went back returns to its old place, not the bottom', async ($, on) => {
  // Docs sits between One and Two on the board.
  const { clock, ui, github } = await open($, on, [
    issue(4, { title: 'One' }),
    issue(3, { title: 'Write docs' }),
    issue(5, { title: 'Two' }),
  ])
  const backlog = () => under(ui, 'hdr:backlog')
  const before = await backlog()
  github.fail['project item-edit'] = DENIED

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry-all' })
    await clock.settle()
  }

  expect(before).toEqual(['card:gh:4', DOCS, 'card:gh:5'])
  expect(await backlog()).toEqual(before)
  await ui.unmount()
})

test('three moves within the pause send one, to the last column', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.advance(100)
  await $.tool.call({ ...MOVE, card: 3, to: 'done' })
  await clock.advance(299)
  expect(edits(github)).toEqual([])

  await clock.advance(1)
  expect(edits(github)).toEqual(['#3 Done'])
  expect(github.card(3).status).toBe('Done')
  await clock.advance(2000)
  await ui.unmount()
})

test('a move made while one is out is sent after it, once', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'done' })
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.advance(1000)
  expect(edits(github)).toEqual([])
  expect((await row(ui, DOCS))?.text).toContain('⟳')
  expect(await under(ui, 'hdr:human')).toContain(DOCS)

  release()
  await clock.settle()

  expect(edits(github)).toEqual(['#3 In progress', '#3 In review'])
  expect(github.card(3).status).toBe('In review')
  expect(await under(ui, 'hdr:human')).toContain(DOCS)
  await clock.advance(2000)
  await ui.unmount()
})

test('moving back to the column a call is already sending to sends nothing more', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  release()
  await clock.settle()

  expect(edits(github)).toEqual(['#3 In progress'])
  expect(github.card(3).status).toBe('In progress')
  await clock.advance(2000)
  await ui.unmount()
})

test('a move undone before it is sent makes no call', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  expect((await row(ui, DOCS))?.text).toContain('⟳')
  await $.tool.call({ ...MOVE, card: 3, to: 'backlog' })
  await clock.advance(1000)

  expect(edits(github)).toEqual([])
  expect(github.card(3).status).toBe('Backlog')
  expect((await row(ui, DOCS))?.text).not.toMatch(/[⟳✓✕]/)
  expect(await under(ui, 'hdr:backlog')).toEqual([DOCS])
  await ui.unmount()
})

test('a move that fails after another was asked for sends the newer one', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })
  github.fail['project item-edit'] = DENIED

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  release()
  await clock.settle()
  delete github.fail['project item-edit']

  await click(ui, DOCS)
  expect((await ui.find({ type: 'Text', text: /^Me/ }))?.text).toContain(
    'GraphQL: Resource not accessible by integration (attempt 1/4)',
  )
  await ui.press({ key: 'retry' })
  await clock.settle()

  expect(github.card(3).status).toBe('In review')
  await clock.advance(2000)
  await ui.unmount()
})

test(
  'the work prompt goes out only once the backend has confirmed',
  async ($, on) => {
    const { clock, prompts, ui, github } = await open($, on, cards())
    let release = () => {}
    github.hold = new Promise<void>(resolve => {
      release = resolve
    })

    await click(ui, DOCS)
    await ui.press({ key: 'move:claude' })
    await clock.advance(300)
    expect(prompts).toEqual([])

    release()
    await clock.settle()

    expect(prompts).toEqual([
      'Work on kanban card #3 "Write docs": read it with mcp__kanban__kanban_show, do the work, then record a handoff with mcp__kanban__kanban_handoff and move it with mcp__kanban__kanban_move: to done when finished, to human only if it needs the person\'s approval or input.',
    ])
    await clock.advance(2000)
    await ui.unmount()
  },
)

test('moveOptions asks Claude to work on a card taken up from Backlog, Suspended, Cancelled or Done, not from Human or Claude', () => {
  for (const from of ['backlog', 'suspended', 'cancelled', 'done'] as const) {
    expect(moveOptions(from, 'claude')).toEqual({ onConfirm: 'work' })
  }
  // Human to Claude is Send back, which has its own prompt; Claude to Claude is a reorder.
  expect(moveOptions('human', 'claude')).toEqual({})
  expect(moveOptions('claude', 'claude')).toEqual({})
  for (const to of [
    'backlog',
    'human',
    'done',
    'suspended',
    'cancelled',
  ] as const) {
    expect(moveOptions('backlog', to)).toEqual({})
    expect(moveOptions('claude', to)).toEqual({})
  }
})

for (const status of ['suspended', 'cancelled', 'done'] as const) {
  test(
    `a card the person takes up from ${status} gets the work prompt once the backend confirms`,
    async ($, on) => {
      const { clock, prompts, ui, github } = await open($, on, [
        issue(1, { column: status, title: 'Old idea', comments: [HANDOFF] }),
      ])
      let release = () => {}
      github.hold = new Promise<void>(resolve => {
        release = resolve
      })

      await group(ui, 'inactive')
      await click(ui, 'card:gh:1')
      await ui.press({ key: 'move:claude' })
      await clock.advance(300)
      expect(prompts).toEqual([])

      release()
      await clock.settle()

      expect(github.card(1)).toMatchObject({
        status: 'In progress',
        state: 'OPEN',
        labels: ['ai'],
      })
      expect(prompts).toEqual([
        expect.stringMatching(/^Work on kanban card #1 "Old idea"/),
      ])
      await clock.advance(2000)
      expect(prompts).toHaveLength(1)
      await ui.unmount()
    },
  )
}

test('a refused move submits no prompt, and nor does a move by Claude', async ($, on) => {
  const { clock, prompts, ui, github } = await open($, on, cards())
  github.fail['project item-edit'] = DENIED

  await click(ui, DOCS)
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry' })
    await clock.settle()
  }
  // The card is back in Backlog; the same move by the person would send the work prompt.
  delete github.fail['project item-edit']
  expect(
    await $.tool.call({ tool: 'mcp__kanban__kanban_list', column: 'backlog' }),
  ).toMatchObject({ result: expect.stringContaining('#3 [backlog]') })
  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)

  expect(github.card(3).status).toBe('In progress')
  expect(prompts).toEqual([])
  await clock.advance(2000)
  await ui.unmount()
})

test('a move the session start finds still waiting is sent at once', async ($, on) => {
  const { clock, ui, github } = await open($, on, cards())

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  expect(edits(github)).toEqual([])

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(edits(github)).toEqual(['#3 In progress'])
  expect(github.card(3).status).toBe('In progress')
  await clock.advance(2000)
  await ui.unmount()
})

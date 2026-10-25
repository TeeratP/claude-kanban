import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import { HANDED_OFF, PANE, RUN, boot, card, path } from './fakes'

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  // Card 3 is moved to Human by these tests, which needs a handoff.
  [path(3, 'docs')]: card(
    3,
    { status: 'backlog', title: 'Write docs' },
    HANDED_OFF,
  ),
})

const DOCS = 'card:md:0003-docs'
const MOVE = { tool: 'mcp__kanban__kanban_move' } as const

/** The session, the loaded board and a mounted pane. */
async function open(
  $: Engine,
  on: Parameters<typeof boot>[0],
  files: Record<string, string>,
) {
  const kit = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await kit.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...kit, ui }
}

const keysBetween = async (
  ui: Mounted<'terminal', 'Pane'>,
  header: string,
  next: string,
) => {
  const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key)

  return keys.slice(keys.indexOf(header) + 1, keys.indexOf(next))
}

test('a move is pending, then confirmed, then gone after two seconds', async ($, on) => {
  const files = cards()
  const { clock, ui } = await open($, on, files)

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  expect((await ui.find({ key: DOCS }))?.text).toContain('⟳')
  expect(await keysBetween(ui, 'hdr:claude', 'hdr:backlog')).toContain(DOCS)
  expect(files[path(3, 'docs')]).toContain('status: backlog')

  await clock.advance(300)
  expect(files[path(3, 'docs')]).toContain('status: claude')
  expect((await ui.find({ key: DOCS }))?.text).toContain('✓')
  expect((await ui.find({ type: 'Text', text: '✓' }))?.props).toMatchObject({
    color: 'success',
    dimColor: false,
  })

  // The ticker redraws every 400 ms, so the fade lands on the first beat past a second.
  await clock.advance(1300)
  expect((await ui.find({ type: 'Text', text: '✓' }))?.props).toMatchObject({
    color: 'success',
    dimColor: true,
  })

  await clock.advance(1000)
  expect((await ui.find({ key: DOCS }))?.text).not.toMatch(/[⟳✓✕]/)
  expect(await keysBetween(ui, 'hdr:claude', 'hdr:backlog')).toContain(DOCS)
  await ui.unmount()
})

test('the pending mark pulses with the ticker', async ($, on) => {
  const { clock, calls, ui } = await open($, on, cards())
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  const pulse = async () =>
    (await ui.find({ type: 'Text', text: '⟳' }))?.props.dimColor
  const seen = [await pulse()]
  for (let beat = 0; beat < 4; beat += 1) {
    await clock.advance(400)
    seen.push(await pulse())
  }

  expect((await ui.find({ type: 'Text', text: '⟳' }))?.props.color).toBe(
    'warning',
  )
  expect(seen).toEqual([false, true, false, true, false])

  release()
  await clock.advance(5000)
  await ui.unmount()
})

test('the ticker stops itself once nothing is syncing', async ($, on) => {
  const files = cards()
  const ticks: number[] = []
  on('state.set', ($, e, next) => {
    if (e.key === 'tick') ticks.push(1)

    return next(e)
  })
  const { clock, ui } = await open($, on, files)

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(2800)
  const during = ticks.length
  await clock.advance(10_000)

  expect(during).toBeGreaterThan(0)
  expect(ticks.length).toBe(during)
  await ui.unmount()
})

test('a refused move shows a cross and a Retry that sends it again', async ($, on) => {
  const files = cards()
  const { clock, calls, toasts, ui } = await open($, on, files)
  calls.denyWrite = 'EACCES: read-only'

  await ui.press({ key: DOCS })
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)

  expect(toasts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toContain(
    'EACCES: read-only (attempt 1/4)',
  )
  expect(await ui.find({ key: 'retry' })).toBeDefined()

  calls.denyWrite = undefined
  await ui.press({ key: 'retry' })
  await clock.settle()

  expect(files[path(3, 'docs')]).toContain('status: claude')
  expect(await ui.find({ key: 'retry' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toContain(
    '✓ saved',
  )
  await clock.advance(2000)
  await ui.unmount()
})

test('the toolbar counts failed moves and retries them all', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)
  calls.denyWrite = 'EIO: disk error'

  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await clock.advance(300)

  expect((await ui.find({ key: 'retry-all' }))?.text).toContain('✕2 retry')
  expect(
    (await ui.findAll({ type: 'Text', text: /^✕$/ })).map(
      mark => mark.props.color,
    ),
  ).toEqual(['error', 'error'])

  const toolbar = [
    await ui.find({ key: 'refresh' }),
    await ui.find({ type: 'Text', text: /local/ }),
    await ui.find({ key: 'retry-all' }),
  ]
  expect(
    toolbar.reduce((width, part) => width + cellWidth(part?.text ?? ''), 0),
  ).toBeLessThanOrEqual(PANE.props.bodyColumns)

  await ui.press({ key: 'retry-all' })
  await clock.settle()
  expect((await ui.find({ key: 'retry-all' }))?.text).toContain('✕2 retry')

  calls.denyWrite = undefined
  await ui.press({ key: 'retry-all' })
  await clock.settle()

  expect(await ui.find({ key: 'retry-all' })).toBeUndefined()
  expect(files[path(3, 'docs')]).toContain('status: human')
  expect(files[path(1, 'login')]).toContain('status: claude')
  await clock.advance(2000)
  await ui.unmount()
})

test('after the first try and three retries the card goes back, with the reason', async ($, on) => {
  const { clock, calls, toasts, ui } = await open($, on, cards())
  calls.denyWrite = 'EACCES: read-only'

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 2; tries += 1) {
    expect(toasts).toEqual([])
    await ui.press({ key: 'retry-all' })
    await clock.settle()
  }
  expect(toasts).toEqual([])
  expect(await keysBetween(ui, 'hdr:claude', 'hdr:backlog')).toContain(DOCS)

  await ui.press({ key: 'retry-all' })
  await clock.settle()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(
    /^Could not move #3 to Claude, so it is back in Backlog: .*EACCES: read-only$/,
  )
  expect(await keysBetween(ui, 'hdr:claude', 'hdr:backlog')).not.toContain(DOCS)
  expect(await keysBetween(ui, 'hdr:backlog', 'hdr:done')).toEqual([DOCS])
  expect(await ui.find({ key: 'retry-all' })).toBeUndefined()
  expect((await ui.find({ key: DOCS }))?.text).not.toMatch(/[⟳✓✕]/)
  await ui.unmount()
})

test('a card that went back returns to its old place, not the bottom', async ($, on) => {
  const files = {
    ...cards(),
    [path(4, 'one')]: card(4, { status: 'backlog', title: 'One', order: 1 }),
    [path(5, 'two')]: card(5, { status: 'backlog', title: 'Two', order: 9 }),
  }
  const { clock, calls, ui } = await open($, on, files)
  const backlog = () => keysBetween(ui, 'hdr:backlog', 'hdr:done')
  const before = await backlog()
  calls.denyWrite = 'EACCES: read-only'

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry-all' })
    await clock.settle()
  }

  expect(before).toEqual(['card:md:0004-one', DOCS, 'card:md:0005-two'])
  expect(await backlog()).toEqual(before)
  await ui.unmount()
})

test('three moves within the pause send one, to the last column', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.advance(100)
  await $.tool.call({ ...MOVE, card: 3, to: 'done' })
  await clock.advance(299)
  expect(calls.writes).toEqual([])

  await clock.advance(1)
  expect(calls.writes).toEqual([path(3, 'docs')])
  expect(files[path(3, 'docs')]).toContain('status: done')
  await clock.advance(2000)
  await ui.unmount()
})

test('a move made while one is out is sent after it, once', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'done' })
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await clock.advance(1000)
  expect(calls.writes).toEqual([])
  expect((await ui.find({ key: DOCS }))?.text).toContain('⟳')
  expect(await keysBetween(ui, 'hdr:human', 'hdr:claude')).toContain(DOCS)

  release()
  await clock.settle()

  expect(calls.writes).toEqual([path(3, 'docs'), path(3, 'docs')])
  expect(files[path(3, 'docs')]).toContain('status: human')
  expect(await keysBetween(ui, 'hdr:human', 'hdr:claude')).toContain(DOCS)
  await clock.advance(2000)
  await ui.unmount()
})

test('moving back to the column a call is already sending to sends nothing more', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  release()
  await clock.settle()

  expect(calls.writes).toEqual([path(3, 'docs')])
  expect(files[path(3, 'docs')]).toContain('status: claude')
  await clock.advance(2000)
  await ui.unmount()
})

test('a move undone before it is sent makes no call', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  expect((await ui.find({ key: DOCS }))?.text).toContain('⟳')
  await $.tool.call({ ...MOVE, card: 3, to: 'backlog' })
  await clock.advance(1000)

  expect(calls.writes).toEqual([])
  expect(files[path(3, 'docs')]).toContain('status: backlog')
  expect((await ui.find({ key: DOCS }))?.text).not.toMatch(/[⟳✓✕]/)
  expect(await keysBetween(ui, 'hdr:backlog', 'hdr:done')).toEqual([DOCS])
  await ui.unmount()
})

test('a move that fails after another was asked for sends the newer one', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })
  calls.denyWrite = 'EACCES: read-only'

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(300)
  await $.tool.call({ ...MOVE, card: 3, to: 'human' })
  release()
  await clock.settle()
  calls.denyWrite = undefined

  await ui.press({ key: DOCS })
  expect((await ui.find({ type: 'Text', text: /^Human/ }))?.text).toContain(
    'EACCES: read-only (attempt 1/4)',
  )
  await ui.press({ key: 'retry' })
  await clock.settle()

  expect(files[path(3, 'docs')]).toContain('status: human')
  await clock.advance(2000)
  await ui.unmount()
})

test('the work prompt goes out only once the backend has confirmed', async ($, on) => {
  const { clock, calls, prompts, ui } = await open($, on, cards())
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await ui.press({ key: DOCS })
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)
  expect(prompts).toEqual([])

  release()
  await clock.settle()

  expect(prompts).toEqual([
    'Work on kanban card #3 "Write docs": read it with mcp__kanban__kanban_show, do the work, then record a handoff with mcp__kanban__kanban_handoff and move it to human with mcp__kanban__kanban_move.',
  ])
  await clock.advance(2000)
  await ui.unmount()
})

test('a refused move submits no prompt, and nor does a move by Claude', async ($, on) => {
  const { clock, calls, prompts, ui } = await open($, on, cards())
  calls.denyWrite = 'EACCES: read-only'

  await ui.press({ key: DOCS })
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry' })
    await clock.settle()
  }
  calls.denyWrite = undefined
  await $.tool.call({ ...MOVE, card: 1, to: 'claude' })
  await clock.advance(300)

  expect(prompts).toEqual([])
  await clock.advance(2000)
  await ui.unmount()
})

test('a move the session start finds still waiting is sent at once', async ($, on) => {
  const files = cards()
  const { clock, calls, ui } = await open($, on, files)

  await $.tool.call({ ...MOVE, card: 3, to: 'claude' })
  await clock.advance(100)
  expect(calls.writes).toEqual([])

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(calls.writes).toEqual([path(3, 'docs')])
  expect(files[path(3, 'docs')]).toContain('status: claude')
  await clock.advance(2000)
  await ui.unmount()
})

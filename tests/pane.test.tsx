import { expect, test } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import { click, group, listRows, row, rowKeys } from './board-ui'
import { PANE, RUN, boot, card, path } from './fakes'

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
  [path(4, 'old')]: card(4, { status: 'done', title: 'Old thing' }),
})

test('the session start registers the command and every tool', async ($, on) => {
  const { registered } = boot(on, cards())

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual([
    'kanban_list',
    'kanban_show',
    'kanban_handoff',
    'kanban_move',
    'kanban_create',
    'kanban_ask',
    'kanban_suggest',
  ])
})

test('/kanban opens the pane and loads the cards', async ($, on) => {
  const { clock, world, calls } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ ...RUN })
  await clock.settle()

  expect(ran.text).toBe('Kanban pane opened.')
  expect(world.opened).toEqual(['kanban'])
  expect(calls.lists).toBe(1)
})

test('a tool call while the first load runs waits for it', async ($, on) => {
  const { calls } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })

  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login'),
  })
  expect(calls.lists).toBeGreaterThanOrEqual(1)
})

test('a pane left open across a reload is refreshed at the session start', async ($, on) => {
  const { clock, world, calls } = boot(on, cards())
  world.panes = ['kanban']

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(calls.lists).toBe(1)
})

for (const surface of EVERY_SURFACE) {
  test(`the board lists, opens and moves a card on the ${surface}`, async ($, on) => {
    const files = cards()
    const { clock } = boot(on, files)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await row(ui, 'card:md:0001-login'))?.text).toContain(
      '#1 Fix login',
    )
    // The first open: Active is open and Inactive is a header with a summary.
    expect((await row(ui, 'grp:active'))?.text).toBe('▾ Active')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+1 Done$/,
    )
    expect(await row(ui, 'card:md:0004-old')).toBeUndefined()

    // Opening Inactive folds Active.
    await group(ui, 'inactive')
    expect((await row(ui, 'grp:inactive'))?.text).toBe('▾ Inactive')
    expect((await row(ui, 'grp:active'))?.text).toMatch(
      /^▸ Active\s+1 Backlog · 1 Human · 1 Claude$/,
    )
    expect((await row(ui, 'card:md:0004-old'))?.text).toContain('#4 Old thing')
    expect(await row(ui, 'card:md:0003-docs')).toBeUndefined()

    // Pressing the open group folds both.
    await group(ui, 'inactive')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(/^▸ Inactive/)
    expect(await row(ui, 'card:md:0004-old')).toBeUndefined()
    expect(await row(ui, 'card:md:0003-docs')).toBeUndefined()
    await group(ui, 'active')

    await click(ui, 'card:md:0003-docs')
    expect((await ui.find({ type: 'Text', text: '#3 Write docs' }))?.text).toBe(
      '#3 Write docs',
    )
    expect((await ui.find({ key: 'spec' }))?.text).toBe('Spec text.')
    expect(await ui.find({ key: 'move:backlog' })).toBeUndefined()

    await ui.press({ key: 'move:claude' })
    await clock.advance(300)
    expect(files[path(3, 'docs')]).toContain('status: claude')
    expect(files[path(3, 'docs')]).toContain('Spec text.')
    expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toMatch(
      /^Claude/,
    )

    await ui.press({ key: 'back' })
    const keys = await rowKeys(ui)
    expect(
      keys.slice(
        keys.indexOf('card:md:0002-api'),
        keys.indexOf('grp:inactive'),
      ),
    ).toEqual(['card:md:0002-api', 'card:md:0003-docs'])
    await ui.unmount()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`on the ${surface} a section header is a label, and only the group headers press`, async ($, on) => {
    const { clock } = boot(on, cards())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })

    for (const label of ['Backlog', 'Human', 'Claude']) {
      const header = new RegExp(`^ {2}${label} 1 ─+`)

      expect(await ui.find({ type: 'Text', text: header })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: header })).toBeUndefined()
    }
    expect(await ui.find({ type: 'Button', key: 'grp:active' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'grp:inactive' })).toBeDefined()
    await ui.unmount()
  })
}

test('a move shows at once with a syncing mark, and a refresh does not undo it', async ($, on) => {
  const { clock, calls } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The rows from a header to the next (Claude is the last section of Active).
  const under = async (header: string, next: string) => {
    const keys = await rowKeys(ui)

    return keys.slice(keys.indexOf(header) + 1, keys.indexOf(next))
  }
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  await clock.advance(300)

  expect(moved).toMatchObject({ result: 'Moved #3 to Claude (syncing).' })
  expect(await under('hdr:claude', 'grp:inactive')).toEqual([
    'card:md:0002-api',
    'card:md:0003-docs',
  ])
  expect((await row(ui, 'card:md:0003-docs'))?.text).toContain('⟳')

  await ui.press({ key: 'refresh' })
  expect(await under('hdr:claude', 'grp:inactive')).toEqual([
    'card:md:0002-api',
    'card:md:0003-docs',
  ])

  release()
  await clock.settle()
  expect((await row(ui, 'card:md:0003-docs'))?.text).toContain('✓')
  expect(await under('hdr:claude', 'grp:inactive')).toEqual([
    'card:md:0002-api',
    'card:md:0003-docs',
  ])
  await clock.advance(2000)
  await ui.unmount()
})

test('a refused move waits for a retry and, out of retries, goes back with the reason', async ($, on) => {
  const { clock, calls, toasts } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  calls.denyWrite = 'EACCES: read-only'

  await click(ui, 'card:md:0003-docs')
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)

  expect(toasts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /EACCES/ }))?.text).toContain(
    '(attempt 1/4)',
  )
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry' })
    await clock.settle()
  }

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Could not move #3 to Claude')
  expect(toasts[0]).toContain('EACCES: read-only')
  expect((await ui.find({ type: 'Text', text: /^Backlog/ }))?.text).toMatch(
    /^Backlog/,
  )
  expect(await ui.find({ key: 'retry' })).toBeUndefined()
  await ui.press({ key: 'back' })
  const keys = await rowKeys(ui)
  expect(
    keys.slice(keys.indexOf('hdr:backlog'), keys.indexOf('hdr:human')),
  ).toEqual(['hdr:backlog', 'card:md:0003-docs'])
  await ui.unmount()
})

test('the toolbar refresh button reloads the cards from disk', async ($, on) => {
  const { clock, calls } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await row(ui, 'card:md:0005-new')).toBeUndefined()

  calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))
  await ui.press({ key: 'refresh' })

  expect(calls.lists).toBe(2)
  expect((await row(ui, 'card:md:0005-new'))?.text).toContain('Fresh')
  await ui.unmount()
})

test('a card file Claude writes shows on the board, any other write does not', async ($, on) => {
  const { clock, calls } = boot(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = calls.lists

  await $.tool.call({
    tool: 'Write',
    file_path: '/work/README.md',
    content: 'x',
  })
  await clock.settle()
  expect(calls.lists).toBe(before)

  calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))
  await $.tool.call({
    tool: 'Write',
    file_path: '/work/.kanban/0005-new.md',
    content: 'x',
  })
  await clock.settle()
  expect(calls.lists).toBe(before + 1)
  expect((await row(ui, 'card:md:0005-new'))?.text).toContain('Fresh')

  await $.tool.call({
    tool: 'Edit',
    file_path: '/work/.kanban/0005-new.md',
    old_string: 'a',
    new_string: 'b',
  })
  await clock.settle()
  expect(calls.lists).toBe(before + 2)
  await ui.unmount()
})

test('an empty board explains where cards go', async ($, on) => {
  const { clock } = boot(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await row(ui, 'note'))?.text).toContain('.kanban/0001-title.md')
  expect(
    (await rowKeys(ui)).filter(key => key.startsWith('empty:')),
  ).toHaveLength(3)
  await ui.unmount()
})

test('a card whose file is gone leaves the board on refresh', async ($, on) => {
  const files = cards()
  const { clock } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await row(ui, 'card:md:0002-api')).toBeDefined()

  delete files[path(2, 'api')]
  await ui.press({ key: 'refresh' })

  expect(await row(ui, 'card:md:0002-api')).toBeUndefined()
  expect(await row(ui, 'card:md:0001-login')).toBeDefined()
  await ui.unmount()
})

test('a read that fails shows its reason in the toolbar and keeps the cards', async ($, on) => {
  const files = cards()
  const { clock, calls } = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  calls.edit(path(1, 'login'), card(1, { status: 'human', title: 'Edited' }))
  calls.denyRead = 'EIO: disk error'
  await ui.press({ key: 'refresh' })

  const toolbar = await ui.find({ type: 'Text', text: /EIO/ })
  expect(toolbar?.props.color).toBe('error')
  expect((await row(ui, 'card:md:0001-login'))?.text).toContain('Fix login')

  calls.denyRead = undefined
  await ui.press({ key: 'refresh' })
  expect((await row(ui, 'card:md:0001-login'))?.text).toContain('Edited')
  expect(await ui.find({ type: 'Text', text: /EIO/ })).toBeUndefined()
  await ui.unmount()
})

for (const surface of EVERY_SURFACE) {
  test(`every row is one line and the board draws on the ${surface}`, async ($, on) => {
    const files = {
      ...cards(),
      [path(5, 'jp')]: card(5, {
        status: 'human',
        title:
          '日本語のとても長いタイトルがここに入ります日本語のとても長いタイトル',
      }),
      [path(6, 'th')]: card(6, {
        status: 'claude',
        title: 'ผู้ใช้ไม่สามารถเข้าสู่ระบบได้เมื่อรหัสผ่านหมดอายุแล้ว',
      }),
    }
    const { clock } = boot(on, files)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface })
    const rows = [
      ...(await ui.findAll({ type: 'Button' })),
      ...(await ui.findAll({ type: 'Text' })),
      ...(await listRows(ui)),
    ]

    expect(rows.length).toBeGreaterThan(8)
    for (const one of rows) {
      expect(cellWidth(one.text)).toBeLessThanOrEqual(PANE.props.bodyColumns)
    }
    expect((await row(ui, 'card:md:0005-jp'))?.text).toContain('…')
    await ui.unmount()
  })
}

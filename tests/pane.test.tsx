import { expect, test } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import { click, group, keys, listRows, row, rowKeys } from './board-ui'
import { PANE, RUN } from './fakes'
import { bootGithub, issue } from './fake-github'
import { renderPane } from './render'

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'claude', title: 'Build API' }),
  issue(3, { column: 'backlog', title: 'Write docs' }),
  issue(4, { column: 'done', title: 'Old thing' }),
]

test('the session start registers the command and every tool', async ($, on) => {
  const { registered } = bootGithub(on, cards())

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual([
    'kanban_list',
    'kanban_show',
    'kanban_handoff',
    'kanban_move',
    'kanban_create',
    'kanban_ask',
  ])
})

test('/kanban opens the pane and loads the cards', async ($, on) => {
  const { clock, world, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ ...RUN })
  await clock.settle()

  expect(ran.text).toBe('Kanban pane opened.')
  expect(world.opened).toEqual(['kanban'])
  expect(github.loads()).toBe(1)
})

test('a tool call while the first load runs waits for it', async ($, on) => {
  const { github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })

  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    result: expect.stringContaining('#1 [human] Fix login'),
  })
  expect(github.loads()).toBeGreaterThanOrEqual(1)
})

test('a pane left open across a reload is refreshed at the session start', async ($, on) => {
  const { clock, world, github } = bootGithub(on, cards())
  world.panes = ['kanban']

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(github.loads()).toBe(1)
})

for (const surface of EVERY_SURFACE) {
  test(`the board lists, opens and moves a card on the ${surface}`, async ($, on) => {
    const { clock, github } = bootGithub(on, cards())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await row(ui, 'card:gh:1'))?.text).toContain(
      '#1 Fix login',
    )
    // The first open: Active is open and Inactive is a header with a summary.
    expect((await row(ui, 'grp:active'))?.text).toBe('▾ Active')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+1 Done$/,
    )
    expect(await row(ui, 'card:gh:4')).toBeUndefined()

    // Opening Inactive folds Active.
    await group(ui, 'inactive')
    expect((await row(ui, 'grp:inactive'))?.text).toBe('▾ Inactive')
    expect((await row(ui, 'grp:active'))?.text).toMatch(
      /^▸ Active\s+1 Backlog · 1 Claude · 1 Me$/,
    )
    expect((await row(ui, 'card:gh:4'))?.text).toContain('#4 Old thing')
    expect(await row(ui, 'card:gh:3')).toBeUndefined()

    // Pressing the open group folds both.
    await group(ui, 'inactive')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(/^▸ Inactive/)
    expect(await row(ui, 'card:gh:4')).toBeUndefined()
    expect(await row(ui, 'card:gh:3')).toBeUndefined()
    await group(ui, 'active')

    await click(ui, 'card:gh:3')
    expect((await ui.find({ type: 'Text', text: '#3 Write docs' }))?.text).toBe(
      '#3 Write docs',
    )
    expect((await ui.find({ key: 'spec' }))?.text).toBe('Spec text.')
    expect(await ui.find({ key: 'move:backlog' })).toBeUndefined()

    await ui.press({ key: 'move:claude' })
    await clock.advance(300)
    expect(github.card(3).status).toBe('In progress')
    expect(github.card(3).labels).toContain('ai')
    expect((await ui.find({ type: 'Text', text: /^Claude/ }))?.text).toMatch(
      /^Claude/,
    )

    await ui.press({ key: 'back' })
    const keys = await rowKeys(ui)
    expect(
      keys.slice(keys.indexOf('card:gh:2'), keys.indexOf('hdr:human')),
    ).toEqual(['card:gh:2', 'card:gh:3'])
    await ui.unmount()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`on the ${surface} a section header is a label, and only the group headers press`, async ($, on) => {
    const { clock } = bootGithub(on, cards())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })

    for (const label of ['Backlog', 'Me', 'Claude']) {
      const header = new RegExp(`^ {2}${label} 1 mine · 1 all ─+`)

      expect(await ui.find({ type: 'Text', text: header })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: header })).toBeUndefined()
    }
    expect(await ui.find({ type: 'Button', key: 'grp:active' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'grp:inactive' })).toBeDefined()
    await ui.unmount()
  })
}

test('a move shows at once with a syncing mark, and a refresh does not undo it', async ($, on) => {
  const { clock, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The rows from a header to the next (Me follows Claude).
  const under = async (header: string, next: string) => {
    const keys = await rowKeys(ui)

    return keys.slice(keys.indexOf(header) + 1, keys.indexOf(next))
  }
  let release = () => {}
  github.hold = new Promise<void>(resolve => {
    release = resolve
  })

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  await clock.advance(300)

  expect(moved).toMatchObject({ result: 'Moved #3 to Claude (syncing).' })
  expect(await under('hdr:claude', 'hdr:human')).toEqual([
    'card:gh:2',
    'card:gh:3',
  ])
  expect((await row(ui, 'card:gh:3'))?.text).toContain('⟳')

  await ui.press({ key: 'refresh' })
  expect(await under('hdr:claude', 'hdr:human')).toEqual([
    'card:gh:2',
    'card:gh:3',
  ])

  release()
  await clock.settle()
  expect((await row(ui, 'card:gh:3'))?.text).toContain('✓')
  expect(await under('hdr:claude', 'hdr:human')).toEqual([
    'card:gh:2',
    'card:gh:3',
  ])
  await clock.advance(2000)
  await ui.unmount()
})

test('a refused move waits for a retry and, out of retries, goes back with the reason', async ($, on) => {
  const { clock, github, toasts } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  github.fail['project item-edit'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }

  await click(ui, 'card:gh:3')
  await ui.press({ key: 'move:claude' })
  await clock.advance(300)

  expect(toasts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /HTTP 403/ }))?.text).toContain(
    '(attempt 1/4)',
  )
  for (let tries = 0; tries < 3; tries += 1) {
    await ui.press({ key: 'retry' })
    await clock.settle()
  }

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Could not move #3 to Claude')
  expect(toasts[0]).toContain('HTTP 403: Resource not accessible')
  expect((await ui.find({ type: 'Text', text: /^Backlog/ }))?.text).toMatch(
    /^Backlog/,
  )
  expect(await ui.find({ key: 'retry' })).toBeUndefined()
  await ui.press({ key: 'back' })
  const keys = await rowKeys(ui)
  expect(
    keys.slice(keys.indexOf('hdr:backlog'), keys.indexOf('hdr:claude')),
  ).toEqual(['hdr:backlog', 'card:gh:3'])
  await ui.unmount()
})

test('the toolbar refresh button reloads the cards from GitHub', async ($, on) => {
  const { clock, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await row(ui, 'card:gh:5')).toBeUndefined()

  github.cards.push(issue(5, { column: 'human', title: 'Fresh' }))
  await ui.press({ key: 'refresh' })

  expect(github.loads()).toBe(2)
  expect((await row(ui, 'card:gh:5'))?.text).toContain('Fresh')
  await ui.unmount()
})

test('an empty board says it has no issues yet', async ($, on) => {
  const { clock } = bootGithub(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await row(ui, 'note'))?.text).toContain(
    'No issues on this board yet.',
  )
  expect(
    (await rowKeys(ui)).filter(key => key.startsWith('empty:')),
  ).toHaveLength(3)
  await ui.unmount()
})

for (const surface of EVERY_SURFACE) {
  test(`the first load draws bars for the cards, not an empty board, on the ${surface}`, async ($, on) => {
    const world = bootGithub(on, cards())
    world.github.holdReads = new Promise(() => {})
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })
    const lines = await renderPane(ui, 44)

    // Three sections of bars, titles aligned and nothing about an empty board.
    expect(lines.filter(line => /^ {7}─+$/.test(line))).toHaveLength(9)
    expect(lines.join('\n')).not.toMatch(/No issues|All clear|Idle/)
    expect(
      lines.filter(line => /^ {2}(Backlog|Me|Claude) ─+$/.test(line)),
    ).toHaveLength(3)
    expect(lines[0]).toMatch(/loading…/)
    // No cards to press yet.
    expect(await row(ui, 'card:gh:1')).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the legend lists the cursor's keys after the first key on the ${surface}`, async ($, on) => {
    const { clock } = bootGithub(on, cards())
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await row(ui, 'legend'))?.text).toBe(
      '  ⏎ open · m move · ⇧J/K reorder',
    )
    await keys(ui, 'down')
    expect((await row(ui, 'legend'))?.text).toBe(
      '  ↑↓ walk · ⏎ open · m+key move',
    )
    await ui.unmount()
  })
}

test('a card taken off the board leaves it on refresh', async ($, on) => {
  const { clock, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await row(ui, 'card:gh:2')).toBeDefined()

  github.cards.splice(
    github.cards.findIndex(one => one.number === 2),
    1,
  )
  await ui.press({ key: 'refresh' })

  expect(await row(ui, 'card:gh:2')).toBeUndefined()
  expect(await row(ui, 'card:gh:1')).toBeDefined()
  await ui.unmount()
})

test('a read that fails shows its reason in the toolbar and keeps the cards', async ($, on) => {
  const { clock, github } = bootGithub(on, cards())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  github.card(1).title = 'Edited'
  github.fail['api graphql'] = { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' }
  await ui.press({ key: 'refresh' })

  const toolbar = await ui.find({ type: 'Text', text: /HTTP 502/ })
  expect(toolbar?.props.color).toBe('error')
  expect((await row(ui, 'card:gh:1'))?.text).toContain('Fix login')

  delete github.fail['api graphql']
  await ui.press({ key: 'refresh' })
  expect((await row(ui, 'card:gh:1'))?.text).toContain('Edited')
  expect(await ui.find({ type: 'Text', text: /HTTP 502/ })).toBeUndefined()
  await ui.unmount()
})

for (const surface of EVERY_SURFACE) {
  test(`every row is one line and the board draws on the ${surface}`, async ($, on) => {
    const { clock } = bootGithub(on, [
      ...cards(),
      issue(5, {
        column: 'human',
        title:
          '日本語のとても長いタイトルがここに入ります日本語のとても長いタイトル',
      }),
      issue(6, {
        column: 'claude',
        title: 'ผู้ใช้ไม่สามารถเข้าสู่ระบบได้เมื่อรหัสผ่านหมดอายุแล้ว',
      }),
    ])
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
    expect((await row(ui, 'card:gh:5'))?.text).toContain('…')
    await ui.unmount()
  })
}

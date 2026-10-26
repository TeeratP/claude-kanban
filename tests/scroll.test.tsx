import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { click, row, rowKeys } from './board-ui'
import { PANE, RUN, SCROLL, boot, card, path } from './fakes'

const board = () => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 7; n += 1) {
    files[path(n, 'h')] = card(n, { status: 'human', title: `Human ${n}` })
  }
  for (let n = 11; n <= 18; n += 1) {
    files[path(n, 'b')] = card(n, { status: 'backlog', title: `Backlog ${n}` })
  }

  return files
}

// Tree rows with 7 Human and 8 Backlog cards, Done collapsed, 30 body rows:
// 0-1 toolbar, 2 Human header, 3-7 its cards, 8 its more row, 9 Claude header,
// 10 (empty), 11 Backlog header, 12-16 its cards, 17 its more row, 18 Done header.
const HUMAN_HEADER = 2
const BACKLOG_CARD = 12
const DONE_HEADER = 18

async function start($: Engine, on: On) {
  const world = boot(on, board())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, ui }
}

test('the wheel over a section scrolls that section and nothing else', async ($, on) => {
  const { ui, scrolls } = await start($, on)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 3 more')

  const result = await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: BACKLOG_CARD },
  })

  expect(result).toEqual({})
  expect(scrolls).toHaveLength(0)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')
  expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 2 more')
  expect(await row(ui, 'card:md:0011-b')).toBeUndefined()
  expect(await row(ui, 'card:md:0012-b')).toBeDefined()
  expect(await row(ui, 'more:human:up')).toBeUndefined()
  expect((await row(ui, 'more:human:down'))?.text).toBe('  ↓ 2 more')
  await ui.unmount()
})

test("the wheel finds a section by its tree row, under the toolbar's two rows", async ($, on) => {
  const { ui, scrolls } = await start($, on)

  // Row 9 is Claude's header and Claude is empty: the engine's. One row up is
  // Human's more row, and 17 is Backlog's.
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 9 } })
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'more:human:up')).toBeUndefined()

  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 8 } })
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:human:up'))?.text).toBe('  ↑ 1 more')
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()

  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 17 } })
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')
  await ui.unmount()
})

test('the wheel stops at the ends of the list', async ($, on) => {
  const { ui } = await start($, on)
  const pointer = { column: 3, row: BACKLOG_CARD }

  await $.ui.scroll({ ...SCROLL, by: 40, pointer })
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 3 more')
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await $.ui.scroll({ ...SCROLL, by: -40, pointer })
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 3 more')
  await ui.unmount()
})

test('the wheel over a header scrolls its section too', async ($, on) => {
  const { ui, scrolls } = await start($, on)

  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: HUMAN_HEADER },
  })

  expect(scrolls).toHaveLength(0)
  expect((await row(ui, 'more:human:up'))?.text).toBe('  ↑ 1 more')
  await ui.unmount()
})

test("the wheel over the toolbar's two rows, a collapsed section or nothing is the engine's", async ($, on) => {
  const { ui, scrolls } = await start($, on)
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 0 } })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 1 } })
  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: DONE_HEADER },
  })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 29 } })

  expect(scrolls).toHaveLength(4)
  expect(await row(ui, 'more:human:up')).toBeUndefined()
  await ui.unmount()
})

test("scroll keys, which carry no pointer, are the engine's", async ($, on) => {
  const { ui, scrolls } = await start($, on)

  await $.ui.scroll({ ...SCROLL, by: 1 })

  expect(scrolls).toEqual([{ by: 1 }])
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  await ui.unmount()
})

test("in the detail view the wheel is the engine's", async ($, on) => {
  const { ui, scrolls } = await start($, on)
  await click(ui, 'card:md:0011-b')

  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 3 } })

  expect(scrolls).toEqual([{ by: 1 }])
  await ui.unmount()
})

test('the more rows page a section by a screenful', async ($, on) => {
  const { ui } = await start($, on)

  await click(ui, 'more:backlog:down')
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 3 more')
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await click(ui, 'more:backlog:up')
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 3 more')
  await ui.unmount()
})

test('a smaller pane shows fewer cards per section', async ($, on) => {
  const { clock } = boot(on, board())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } },
    surface: 'terminal',
  })

  expect((await rowKeys(ui)).filter(key => /-b$/.test(key))).toHaveLength(1)
  expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 7 more')
  await ui.unmount()
})

test("at the end of a section the wheel is the engine's, so a short pane can scroll", async ($, on) => {
  const { clock, scrolls } = boot(on, board())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } },
    surface: 'terminal',
  })
  // Every section open, one card each: the tree is taller than the pane.
  await click(ui, 'hdr:done')
  expect((await rowKeys(ui)).filter(key => key.startsWith('card:'))).toEqual([
    'card:md:0001-h',
    'card:md:0011-b',
  ])
  // 0-1 toolbar, 2 Human, 3 its card, 4 its more row, 5 Claude, 6 (empty), 7 Backlog.
  const pointer = { column: 3, row: 7 }
  const wheel = (by: number) =>
    $.ui.scroll({ ...SCROLL, bodyRows: 16, by, pointer })

  await wheel(-1)
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()

  await wheel(1)
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')

  await wheel(40)
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 7 more')
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await wheel(1)
  expect(scrolls).toHaveLength(2)
  expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 7 more')
  await ui.unmount()
})

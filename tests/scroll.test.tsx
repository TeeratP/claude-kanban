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
// 0 toolbar, 1 Human header, 2-6 its cards, 7 its more row, 8 Claude header,
// 9 (empty), 10 Backlog header, 11-15 its cards, 16 its more row, 17 Done header.
const HUMAN_HEADER = 1
const BACKLOG_CARD = 11
const DONE_HEADER = 17

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

test("the wheel over the toolbar, a collapsed section or nothing is the engine's", async ($, on) => {
  const { ui, scrolls } = await start($, on)
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 0 } })
  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: DONE_HEADER },
  })
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: 29 } })

  expect(scrolls).toHaveLength(3)
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

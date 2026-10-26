import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { click, group, row, rowKeys } from './board-ui'
import { PANE, RUN, SCROLL, boot, card, path } from './fakes'

const board = () => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 9; n += 1) {
    files[path(n, 'h')] = card(n, { status: 'human', title: `Human ${n}` })
  }
  for (let n = 11; n <= 18; n += 1) {
    files[path(n, 'b')] = card(n, { status: 'backlog', title: `Backlog ${n}` })
  }

  return files
}

// Tree rows with 9 Human and 8 Backlog cards, 30 body rows (seven rows under
// each section's header): 0-1 toolbar, 2 Active, 3 Backlog header, 4-9 its
// cards, 10 its more row, 11 Claude header, 12 (empty), 13-18 filler,
// 19 Human header, 20-25 its cards, 26 its more row, 27 Inactive, 28 the legend, 29 filler.
const BACKLOG_HEADER = 3
const BACKLOG_CARD = 4
const BACKLOG_MORE = 10
const CLAUDE_HEADER = 11
const HUMAN_HEADER = 19
const HUMAN_MORE = 26
const INACTIVE = 27
const SLACK = 29

async function start($: Engine, on: On, files = board()) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, ui }
}

test('the wheel over a section scrolls that section and nothing else', async ($, on) => {
  const { ui, scrolls } = await start($, on)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 2 more$/)

  const result = await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: BACKLOG_CARD },
  })

  expect(result).toEqual({})
  expect(scrolls).toHaveLength(0)
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 1 more$/)
  expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 2 more$/)
  expect(await row(ui, 'card:md:0011-b')).toBeUndefined()
  expect(await row(ui, 'card:md:0012-b')).toBeDefined()
  expect(await row(ui, 'more:human:up')).toBeUndefined()
  expect((await row(ui, 'more:human:down'))?.text).toMatch(/^ +↓ 3 more$/)
  await ui.unmount()
})

test("the wheel finds a section by its tree row, under the toolbar's two rows", async ($, on) => {
  const { ui, scrolls } = await start($, on)

  // Claude's header is Claude's and Claude is empty, so there is nothing to
  // scroll: the engine's. Human's more row is Human's, Backlog's is Backlog's.
  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: CLAUDE_HEADER },
  })
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'more:human:up')).toBeUndefined()

  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: HUMAN_MORE },
  })
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:human:up'))?.text).toMatch(/^ +↑ 1 more$/)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()

  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: BACKLOG_MORE },
  })
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 1 more$/)
  await ui.unmount()
})

test('the wheel stops at the ends of the list', async ($, on) => {
  const { ui } = await start($, on)
  const pointer = { column: 3, row: BACKLOG_CARD }

  await $.ui.scroll({ ...SCROLL, by: 40, pointer })
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 2 more$/)
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await $.ui.scroll({ ...SCROLL, by: -40, pointer })
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 2 more$/)
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
  expect((await row(ui, 'more:human:up'))?.text).toMatch(/^ +↑ 1 more$/)
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  await ui.unmount()
})

test('the wheel over a blank row belongs to its section: with nothing to scroll it is the engine, and the leftover rows under no section are too', async ($, on) => {
  // One card in Backlog leaves the rest of its seven rows blank.
  const files: Record<string, string> = {}
  for (let n = 1; n <= 8; n += 1) {
    files[path(n, 'h')] = card(n, { status: 'human', title: `Human ${n}` })
  }
  files[path(11, 'b')] = card(11, { status: 'backlog', title: 'Only one' })
  const { ui, scrolls } = await start($, on, files)
  // A spare row of a section is marked with a quiet dot under the numbers.
  expect((await row(ui, 'blank:backlog:3'))?.text).toMatch(/^ +·$/)

  // Backlog has one card: a blank row of it cannot scroll it.
  await $.ui.scroll({
    ...SCROLL,
    by: 1,
    pointer: { column: 3, row: BACKLOG_CARD + 3 },
  })
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'more:human:up')).toBeUndefined()

  // The slack row at the bottom belongs to no section.
  await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row: SLACK } })
  expect(scrolls).toHaveLength(2)
  await ui.unmount()
})

test("the wheel over the toolbar's two rows, a group header, the legend or filler under every section is the engine's", async ($, on) => {
  const { ui, scrolls } = await start($, on)
  for (const row of [0, 1, 2, INACTIVE, INACTIVE + 1, SLACK]) {
    await $.ui.scroll({ ...SCROLL, by: 1, pointer: { column: 3, row } })
  }

  expect(scrolls).toHaveLength(6)
  expect(await row(ui, 'more:human:up')).toBeUndefined()
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  await ui.unmount()
})

test('every section of the Inactive group scrolls on its own, from its own offset', async ($, on) => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 12; n += 1) {
    files[path(n, 'd')] = card(n, { status: 'done', title: `Done ${n}` })
    files[path(20 + n, 'c')] = card(20 + n, {
      status: 'cancelled',
      title: `Cancelled ${n}`,
    })
    files[path(40 + n, 's')] = card(40 + n, {
      status: 'suspended',
      title: `Suspended ${n}`,
    })
  }
  const { ui, scrolls } = await start($, on, files)
  await group(ui, 'inactive')
  // 0-1 toolbar, 2 Active (folded), 3 Inactive, 4 Done, 5-10 cards, 11 more,
  // 12 Cancelled, 13-18 cards, 19 more, 20 Suspended, 21-26 cards, 27 more.
  const wheel = (at: number, by: number) =>
    $.ui.scroll({ ...SCROLL, by, pointer: { column: 3, row: at } })

  expect((await row(ui, 'more:done:down'))?.text).toMatch(/^ +↓ 4 more$/)
  expect((await row(ui, 'more:suspended:down'))?.text).toMatch(/^ +↓ 6 more$/)

  await wheel(14, 2)
  expect((await row(ui, 'more:cancelled:up'))?.text).toMatch(/^ +↑ 2 more$/)
  expect(await row(ui, 'more:done:up')).toBeUndefined()
  expect(await row(ui, 'more:suspended:up')).toBeUndefined()

  await wheel(22, 3)
  expect((await row(ui, 'more:suspended:up'))?.text).toMatch(/^ +↑ 3 more$/)
  expect((await row(ui, 'more:cancelled:up'))?.text).toMatch(/^ +↑ 2 more$/)

  // Done lists its newest ten, so it ends before Suspended does.
  await wheel(6, 40)
  expect((await row(ui, 'more:done:up'))?.text).toMatch(/^ +↑ 4 more$/)
  expect(await row(ui, 'more:done:down')).toBeUndefined()
  expect(scrolls).toHaveLength(0)
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
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 2 more$/)
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await click(ui, 'more:backlog:up')
  expect(await row(ui, 'more:backlog:up')).toBeUndefined()
  expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 2 more$/)
  await ui.unmount()
})

test('a smaller pane gives every section fewer rows, and the same to each', async ($, on) => {
  const { clock } = boot(on, board())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } },
    surface: 'terminal',
  })

  // Three rows under each header: two cards and the count of the rest.
  expect((await rowKeys(ui)).filter(key => /-b$/.test(key))).toHaveLength(2)
  expect((await rowKeys(ui)).filter(key => /-h$/.test(key))).toHaveLength(2)
  expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 6 more$/)
  expect((await row(ui, 'more:human:down'))?.text).toMatch(/^ +↓ 7 more$/)
  await ui.unmount()
})

test("at the end of a section the wheel is the engine's, so a short pane can scroll", async ($, on) => {
  const { clock, scrolls } = boot(on, board())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } },
    surface: 'terminal',
  })
  // Two rows under each header, the least: one card and a count. The tree is
  // taller than the pane.
  expect((await rowKeys(ui)).filter(key => key.startsWith('card:'))).toEqual([
    'card:md:0011-b',
    'card:md:0001-h',
  ])
  // 0-1 toolbar, 2 Active, 3 Backlog, 4 its card, 5 its more row, 6 Human, 7 its card.
  const pointer = { column: 3, row: 4 }
  const wheel = (by: number) =>
    $.ui.scroll({ ...SCROLL, bodyRows: 10, by, pointer })

  await wheel(-1)
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'card:md:0011-b')).toBeDefined()

  await wheel(1)
  expect(scrolls).toHaveLength(1)
  expect(await row(ui, 'card:md:0011-b')).toBeUndefined()
  expect(await row(ui, 'card:md:0012-b')).toBeDefined()

  // The last card, under the count of the rest above it.
  await wheel(40)
  expect(scrolls).toHaveLength(1)
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 7 more$/)
  expect(await row(ui, 'more:backlog:down')).toBeUndefined()

  await wheel(1)
  expect(scrolls).toHaveLength(2)
  expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 7 more$/)
  await ui.unmount()
})

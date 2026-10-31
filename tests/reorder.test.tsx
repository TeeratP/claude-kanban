import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import {
  click,
  group,
  keys,
  lineRows,
  litRows,
  row,
  rowIndex,
  rowKeys,
  under,
} from './board-ui'
import type { BoardUi } from './board-ui'
import { boardReply, fakeProcess, issueNode, queryOf } from './fake-gh'
import type { FakeIssue, Route } from './fake-gh'
import { HANDED_OFF, PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'
import type { Files } from './fakes'
import { GH_VERSION } from './zero'

const WITH_CLIENT = ['terminal', 'desktop'] as const
const WITHOUT_CLIENT = ['vscode', 'mobile'] as const

// Orders ten apart, so a card dropped between two takes a number of its own.
// Human is empty.
const board = (): Files => ({
  [path(2, 'api')]: card(2, {
    status: 'claude',
    title: 'Build API',
    order: 20,
  }),
  [path(3, 'tests')]: card(3, {
    status: 'claude',
    title: 'Add tests',
    order: 30,
  }),
  [path(4, 'docs')]: card(4, {
    status: 'backlog',
    title: 'Write docs',
    order: 40,
  }),
  [path(5, 'lint')]: card(5, {
    status: 'backlog',
    title: 'Fix lint',
    order: 50,
  }),
  [path(6, 'deps')]: card(6, {
    status: 'backlog',
    title: 'Bump deps',
    order: 60,
  }),
  [path(7, 'old')]: card(7, { status: 'done', title: 'Old thing' }),
})

const API = 'card:md:0002-api'
const TESTS = 'card:md:0003-tests'
const DOCS = 'card:md:0004-docs'
const LINT = 'card:md:0005-lint'
const DEPS = 'card:md:0006-deps'
const OLD = 'card:md:0007-old'

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  files: Files = board(),
) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

const orderOf = (files: Files, id: number, slug: string) =>
  Number(/\norder: (\S+)\n/.exec(files[path(id, slug)] ?? '')?.[1])

type Pointer = Mounted<'terminal'>['pointer']

// Drags `from` onto `to`. (The test kit hands a Client no sub-cell position,
// so a drop in a card's lower half is tried in client-fine.test.tsx.)
async function drag(ui: BoardUi, from: string, to: string) {
  const { pointer } = ui as unknown as { pointer: Pointer }
  const start = await rowIndex(ui, from)
  const end = await rowIndex(ui, to)

  await pointer({ type: 'down', x: 3, y: start, button: 'left' })
  await pointer({ type: 'move', x: 3, y: end, button: 'left' })
  await pointer({ type: 'up', x: 3, y: end, button: 'left' })
}

// At 44 columns the closed Inactive group draws `▸ Inactive` then its chips:
// Done over cells 10-16, Cancelled 16-27, Suspended 27-38.
async function chipDrop(ui: BoardUi, from: string, x: number) {
  const { pointer } = ui as unknown as { pointer: Pointer }
  const start = await rowIndex(ui, from)
  const end = await rowIndex(ui, 'grp:inactive')

  await pointer({ type: 'down', x: 3, y: start, button: 'left' })
  await pointer({ type: 'move', x, y: end, button: 'left' })
  await pointer({ type: 'up', x, y: end, button: 'left' })
}

// Drops a card where the Client would post it.
const place = (
  ui: { post: (data: never) => Promise<void> },
  cardId: string,
  column: string,
  at: unknown,
) => ui.post({ type: 'drop', cardId, column, place: at } as never)

// Brings the cursor up and walks it, up or down, to `key`.
async function walkTo(ui: BoardUi, key: string) {
  for (let step = 0; step < 40; step += 1) {
    const [lit] = await litRows(ui)
    if (lit === key) return

    const all = await rowKeys(ui)
    await keys(
      ui,
      lit === undefined || all.indexOf(lit) < all.indexOf(key) ? 'down' : 'up',
    )
  }
  expect(await litRows(ui)).toEqual([key])
}

// Eight Backlog cards, ten apart: six show, a `more` row pages to the rest.
const long = (): Files => {
  const files: Files = {
    [path(20, 'api')]: card(20, { status: 'claude', title: 'Build API' }),
  }
  for (let n = 1; n <= 8; n += 1) {
    files[path(n, 'b')] = card(n, { title: `Backlog ${n}`, order: n * 10 })
  }

  return files
}

const B = (n: number) => `card:md:000${n}-b`

for (const surface of WITH_CLIENT) {
  test(
    `a card dropped on a card of the section below lands after it, and the work prompt follows a Backlog card to Claude on the ${surface}`,
    // Claude already has a card; at the default limit of one the prompt would be held.
    async ($, on) => {
      const { clock, ui, files, calls, prompts } = await start($, on, surface)

      await drag(ui, DOCS, API)

      expect(await under(ui, 'hdr:claude')).toEqual([API, DOCS, TESTS])
      expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DEPS])
      await clock.advance(SYNC_PAUSE)
      // In the gap between 20 and 30: no other card is written.
      expect(files[path(4, 'docs')]).toContain('status: claude')
      expect(orderOf(files, 4, 'docs')).toBe(25)
      expect(calls.writes).toEqual([path(4, 'docs')])
      expect(prompts).toEqual([
        expect.stringMatching(/^Work on kanban card #4 "Write docs"/),
      ])
      await ui.unmount()
    },
  )

  test(`a card dropped on a header, or on an empty section, lands first on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    await drag(ui, LINT, 'hdr:claude')
    expect(await under(ui, 'hdr:claude')).toEqual([LINT, API, TESTS])

    await drag(ui, API, 'empty:human')
    expect(await under(ui, 'hdr:human')).toEqual([API])
    expect(await row(ui, 'empty:human')).toBeUndefined()

    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 5, 'lint')).toBe(10)
    expect(files[path(5, 'lint')]).toContain('status: claude')
    expect(files[path(2, 'api')]).toContain('status: human')
    await ui.unmount()
  })

  test(`a card dropped after a card, or before it, lands there on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    // What a drop in the lower half of a card posts.
    await place(ui, 'md:0006-deps', 'backlog', {
      at: 'after',
      cardId: 'md:0004-docs',
    })
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, DEPS, LINT])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 6, 'deps')).toBe(45)

    await place(ui, 'md:0005-lint', 'backlog', {
      at: 'before',
      cardId: 'md:0004-docs',
    })
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DOCS, DEPS])
    // The last place, which a drag reaches only below the last card.
    await place(ui, 'md:0005-lint', 'backlog', {
      at: 'after',
      cardId: 'md:0006-deps',
    })
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, DEPS, LINT])
    await clock.advance(SYNC_PAUSE)
    // It was after Deps on disk already, so the file is left as it was.
    expect(orderOf(files, 5, 'lint')).toBeGreaterThan(orderOf(files, 6, 'deps'))
    await ui.unmount()
  })

  test(`dragged down onto a card in its own section a card lands after it, dragged up it lands before on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts } = await start($, on, surface)

    // Onto the last card: the end of the section, reachable without a finer pointer.
    await drag(ui, DOCS, DEPS)
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DEPS, DOCS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 4, 'docs')).toBe(61)
    expect(calls.writes).toEqual([path(4, 'docs')])

    // Up onto the first: before it.
    await drag(ui, DOCS, LINT)
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, DEPS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 4, 'docs')).toBe(25)

    // Down onto a card in the middle: after it, before the next.
    await drag(ui, DOCS, LINT)
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DOCS, DEPS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 4, 'docs')).toBe(55)
    expect(prompts).toEqual([])
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`dragged down onto a card in another section a card lands after it, dragged up it lands before on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    // Backlog is above Claude: up onto one of its cards puts the card before it.
    await drag(ui, API, DEPS)
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, API, DEPS])
    await clock.advance(SYNC_PAUSE)
    expect(files[path(2, 'api')]).toContain('status: backlog')
    expect(orderOf(files, 2, 'api')).toBe(55)

    // Claude is below Backlog: down onto its last card puts the card last there.
    await drag(ui, DOCS, TESTS)
    expect(await under(ui, 'hdr:claude')).toEqual([TESTS, DOCS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 4, 'docs')).toBe(31)

    // Up onto the first card of the section above, from the section below.
    await drag(ui, DOCS, LINT)
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, API, DEPS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 4, 'docs')).toBe(25)
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`a card dragged within its section is reordered, written once and never prompts on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts } = await start($, on, surface)

    await drag(ui, DEPS, DOCS)

    expect(await under(ui, 'hdr:backlog')).toEqual([DEPS, DOCS, LINT])
    expect((await row(ui, DEPS))?.text).toContain('⟳')
    await clock.advance(SYNC_PAUSE)

    expect(calls.writes).toEqual([path(6, 'deps')])
    expect(orderOf(files, 6, 'deps')).toBe(20)
    // A reorder is not an update: the card keeps its status and its age.
    expect(files[path(6, 'deps')]).toContain('status: backlog')
    expect(files[path(6, 'deps')]).toContain('updated: 2026-10-25T11:00:00Z')
    expect((await row(ui, DEPS))?.text).toContain('✓')
    expect(prompts).toEqual([])

    // Within Claude too, and a card sent back from Human is not a work prompt.
    await drag(ui, TESTS, API)
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 3, 'tests')).toBeLessThan(orderOf(files, 2, 'api'))
    expect(prompts).toEqual([])
    await clock.advance(2000)
    expect(await under(ui, 'hdr:claude')).toEqual([TESTS, API])
    await ui.unmount()
  })

  test(`a drop with no gap renumbers the section by tens and writes only the cards that changed on the ${surface}`, async ($, on) => {
    const files = {
      [path(1, 'a')]: card(1, { title: 'A', order: 10 }),
      // A neighbour that is rewritten keeps its body and the fields the board does not own.
      [path(2, 'b')]: card(2, { title: 'B', order: 11 }, 'Keep me.').replace(
        '\n---\nKeep',
        '\nowner: someone\n---\nKeep',
      ),
      [path(3, 'c')]: card(3, { title: 'C', order: 12 }),
    }
    const { clock, ui, calls } = await start($, on, surface, files)

    await drag(ui, 'card:md:0003-c', 'card:md:0002-b')
    expect(await under(ui, 'hdr:backlog')).toEqual([
      'card:md:0001-a',
      'card:md:0003-c',
      'card:md:0002-b',
    ])
    await clock.advance(SYNC_PAUSE)

    expect([orderOf(files, 1, 'a'), orderOf(files, 3, 'c')]).toEqual([10, 20])
    expect(orderOf(files, 2, 'b')).toBe(30)
    expect(files[path(2, 'b')]).toContain('owner: someone\n---\nKeep me.\n')
    expect(files[path(2, 'b')]).toContain('updated: 2026-10-25T11:00:00Z')
    // A keeps its 10 and is not written; the neighbour goes first, the card itself last.
    expect(calls.writes).toEqual([path(2, 'b'), path(3, 'c')])
    await ui.unmount()
  })

  test(`the board draws a line under the row above where the card would land on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    const down = async (key: string) =>
      ui.pointer({
        type: 'down',
        x: 3,
        y: await rowIndex(ui, key),
        button: 'left',
      })
    const over = async (key: string) =>
      ui.pointer({
        type: 'move',
        x: 3,
        y: await rowIndex(ui, key),
        button: 'left',
      })

    await down(DEPS)
    expect(await lineRows(ui)).toEqual([])

    await over(DOCS)
    expect(await lineRows(ui)).toEqual(['hdr:backlog'])
    await over('hdr:claude')
    expect(await lineRows(ui)).toEqual(['hdr:claude'])
    // Down onto a card: after it. Up onto one: before it.
    await over(TESTS)
    expect(await lineRows(ui)).toEqual([TESTS])
    await over(API)
    expect(await lineRows(ui)).toEqual(['hdr:claude'])
    await over(TESTS)
    expect(await lineRows(ui)).toEqual([TESTS])
    await over('empty:human')
    expect(await lineRows(ui)).toEqual(['hdr:human'])

    // Where it already is, nothing.
    await over(DEPS)
    expect(await lineRows(ui)).toEqual([])
    await over(LINT)
    expect(await lineRows(ui)).toEqual([DOCS])
    // Done keeps no order: its chip lights instead of a line.
    await ui.pointer({
      type: 'move',
      x: 12,
      y: await rowIndex(ui, 'grp:inactive'),
      button: 'left',
    })
    expect(await lineRows(ui)).toEqual([])
    expect(
      (await ui.find({ type: 'Text', in: 'board', text: /^ Done $/ }))?.props
        .inverse,
    ).toBe(true)

    await ui.pointer({
      type: 'up',
      x: 3,
      y: await rowIndex(ui, DEPS),
      button: 'left',
    })
    expect(await lineRows(ui)).toEqual([])
    await ui.unmount()
  })

  test(`Suspended keeps a manual order that a drag and shift-J change, and Cancelled keeps none on the ${surface}`, async ($, on) => {
    const files: Files = {
      [path(31, 's')]: card(31, { status: 'suspended', order: 30 }),
      [path(32, 's')]: card(32, { status: 'suspended', order: 40 }),
      [path(33, 's')]: card(33, { status: 'suspended', order: 50 }),
      [path(41, 'c')]: card(41, { status: 'cancelled' }),
      [path(42, 'c')]: card(42, { status: 'cancelled' }),
    }
    const { clock, ui, calls } = await start($, on, surface, files)
    const S = (n: number) => `card:md:00${n}-s`
    const C = (n: number) => `card:md:00${n}-c`
    await group(ui, 'inactive')

    await drag(ui, S(33), S(31))
    expect(await under(ui, 'hdr:suspended')).toEqual([S(33), S(31), S(32)])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 33, 's')).toBe(15)
    expect(files[path(33, 's')]).toContain('status: suspended')

    await walkTo(ui, S(31))
    await keys(ui, 'J')
    expect(await under(ui, 'hdr:suspended')).toEqual([S(33), S(32), S(31)])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 31, 's')).toBe(41)

    // Cancelled lists by update time: shift-J does nothing and a drag within it nothing.
    calls.writes.length = 0
    const cancelled = await under(ui, 'hdr:cancelled')
    await walkTo(ui, C(41))
    await keys(ui, 'J', 'K')
    await drag(ui, C(41), C(42))
    await clock.advance(SYNC_PAUSE)
    expect(calls.writes).toEqual([])
    expect(await under(ui, 'hdr:cancelled')).toEqual(cancelled)

    // A card dropped on a card of Suspended from Cancelled takes its place there.
    await drag(ui, C(41), S(32))
    await clock.advance(SYNC_PAUSE)
    expect(files[path(41, 'c')]).toContain('status: suspended')
    expect(await under(ui, 'hdr:suspended')).toContain(C(41))
    await ui.unmount()
  })

  test(`a card dropped on the Done chip goes to Done, and one dropped in its own Done stays on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)

    await chipDrop(ui, LINT, 12)
    await clock.advance(SYNC_PAUSE)
    expect(files[path(5, 'lint')]).toContain('status: done')
    expect(calls.writes).toEqual([path(5, 'lint')])

    await chipDrop(ui, DEPS, 12)
    await clock.advance(SYNC_PAUSE)
    expect(files[path(6, 'deps')]).toContain('status: done')

    await group(ui, 'inactive')
    expect((await under(ui, 'hdr:done')).sort()).toEqual([LINT, DEPS, OLD])

    calls.writes.length = 0
    await drag(ui, OLD, LINT)
    await drag(ui, LINT, 'hdr:done')
    await clock.advance(SYNC_PAUSE)
    expect(calls.writes).toEqual([])
    await ui.unmount()
  })

  test(`a drop on a more row lands at that edge of the window shown, and on a header at the very top on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface, long())
    expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 2 more$/)

    // Down: after the last card shown, before the two hidden.
    await drag(ui, 'card:md:0020-api', 'more:backlog:down')
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 20, 'api')).toBe(65)
    expect(await under(ui, 'hdr:backlog')).toEqual([
      B(1),
      B(2),
      B(3),
      B(4),
      B(5),
      B(6),
      'more:backlog:down',
    ])
    expect((await row(ui, 'more:backlog:down'))?.text).toMatch(/^ +↓ 3 more$/)

    // Up: the window pages to the end (six cards of nine), and the card goes
    // before the first of them, after the three hidden above.
    await click(ui, 'more:backlog:down')
    await clock.advance(2000)
    expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 3 more$/)
    await drag(ui, B(8), 'more:backlog:up')
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 8, 'b')).toBe(35)
    expect(await under(ui, 'hdr:backlog')).toEqual([
      'more:backlog:up',
      B(8),
      B(4),
      B(5),
      B(6),
      'card:md:0020-api',
      B(7),
    ])

    // The header is the top of the whole section, past the cards hidden above.
    await drag(ui, B(6), 'hdr:backlog')
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 6, 'b')).toBe(5)
    await ui.unmount()
  })

  test(`shift-K and shift-J move the card under the cursor a place up or down on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts } = await start($, on, surface)
    await walkTo(ui, LINT)

    await keys(ui, 'J')
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, DEPS, LINT])
    // The cursor goes with the card.
    expect(await litRows(ui)).toEqual([LINT])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 5, 'lint')).toBe(61)

    await keys(ui, 'J')
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, DEPS, LINT])

    await keys(ui, 'K', 'K')
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DOCS, DEPS])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 5, 'lint')).toBe(20)
    expect(files[path(5, 'lint')]).toContain('status: backlog')

    // At the top there is nowhere to go.
    await keys(ui, 'K')
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DOCS, DEPS])

    // A terminal that reports the shift apart from the letter works the same.
    await ui.key({ key: 'j', shift: true })
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, DEPS])
    await ui.key({ key: 'k', shift: true })
    expect(await under(ui, 'hdr:backlog')).toEqual([LINT, DOCS, DEPS])

    // Claude has two cards; a card moved up there prompts nothing.
    await walkTo(ui, TESTS)
    await keys(ui, 'K')
    await clock.advance(SYNC_PAUSE)
    expect(await under(ui, 'hdr:claude')).toEqual([TESTS, API])
    expect(prompts).toEqual([])
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`shift-J and shift-K do nothing on a header, in Done or with a ctrl held on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    const before = { ...files }

    await walkTo(ui, 'grp:inactive')
    await keys(ui, 'J', 'K')
    await walkTo(ui, LINT)
    await ui.key({ key: 'J', ctrl: true })
    await ui.key({ key: 'K', meta: true })
    await group(ui, 'inactive')
    await walkTo(ui, OLD)
    await keys(ui, 'J', 'K')
    await group(ui, 'active')

    await clock.advance(SYNC_PAUSE)
    expect(calls.writes).toEqual([])
    expect(files).toEqual(before)
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, DEPS])
    await ui.unmount()
  })

  test(`the section's window follows a card moved past its edge by shift-J and shift-K on the ${surface}`, async ($, on) => {
    const { clock, ui } = await start($, on, surface, long())

    // The sixth card moving down leaves the six shown; the window follows it,
    // with a `more` row either side.
    await walkTo(ui, B(6))
    await keys(ui, 'J')
    expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 2 more$/)
    expect(await row(ui, B(6))).toBeDefined()
    expect(await litRows(ui)).toEqual([B(6)])

    // And back up past the top of the window.
    await keys(ui, 'K', 'K', 'K', 'K', 'K', 'K')
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()
    expect(await row(ui, B(6))).toBeDefined()
    expect(await under(ui, 'hdr:backlog')).toEqual([
      B(6),
      B(1),
      B(2),
      B(3),
      B(4),
      B(5),
      'more:backlog:down',
    ])
    await clock.advance(SYNC_PAUSE)
    await ui.unmount()
  })

  test(`a drop naming a card that is gone lands last, and a drop in Done ignores its place on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    await ui.post({
      type: 'drop',
      cardId: 'md:0004-docs',
      column: 'claude',
      place: { at: 'before', cardId: 'md:9999-gone' },
    })
    expect(await under(ui, 'hdr:claude')).toEqual([API, TESTS, DOCS])
    await ui.post({
      type: 'drop',
      cardId: 'md:0005-lint',
      column: 'done',
      place: { at: 'top' },
    })
    await clock.advance(SYNC_PAUSE)

    expect(orderOf(files, 4, 'docs')).toBe(31)
    expect(files[path(5, 'lint')]).toContain('status: done')
    // Its own section with no place, or a place it has: nothing to do.
    const before = { ...files }
    await ui.post({ type: 'drop', cardId: 'md:0002-api', column: 'claude' })
    await ui.post({
      type: 'drop',
      cardId: 'md:0002-api',
      column: 'claude',
      place: { at: 'before', cardId: 'md:0003-tests' },
    })
    await ui.post({ type: 'shift', cardId: 'md:0002-api', dir: 'sideways' })
    await ui.post({ type: 'shift', cardId: 'md:9999-gone', dir: 'up' })
    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`two reorders within the pause send one, to the last place, on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)

    await drag(ui, DEPS, 'hdr:backlog')
    await clock.advance(100)
    await drag(ui, DEPS, DOCS)
    await clock.advance(SYNC_PAUSE - 1)
    expect(calls.writes).toEqual([])

    await clock.advance(1)
    expect(calls.writes).toEqual([path(6, 'deps')])
    expect(orderOf(files, 6, 'deps')).toBe(45)
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, DEPS, LINT])
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`a reorder back to the place a call is sending to sends nothing more, and one asked for while it is out follows it on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    await drag(ui, DEPS, 'hdr:backlog')
    await clock.advance(SYNC_PAUSE)
    // The call is out; two more reorders are asked for, the last of them what the call is sending.
    await drag(ui, DEPS, LINT)
    await drag(ui, DEPS, 'hdr:backlog')
    release()
    await clock.settle()
    expect(calls.writes).toEqual([path(6, 'deps')])
    expect(orderOf(files, 6, 'deps')).toBe(20)

    // Out again: this time a different place is asked for, and sent after it.
    calls.writes.length = 0
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })
    await drag(ui, LINT, 'hdr:backlog')
    await clock.advance(SYNC_PAUSE)
    await place(ui, 'md:0005-lint', 'backlog', {
      at: 'after',
      cardId: 'md:0004-docs',
    })
    expect(await under(ui, 'hdr:backlog')).toEqual([DEPS, DOCS, LINT])
    release()
    await clock.settle()

    expect(calls.writes).toEqual([path(5, 'lint'), path(5, 'lint')])
    expect(orderOf(files, 5, 'lint')).toBeGreaterThan(orderOf(files, 4, 'docs'))
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`a refused reorder waits for a retry and, out of tries, the card goes back with the reason on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, toasts } = await start($, on, surface)
    calls.denyWrite = 'EACCES: read-only'
    const before = { ...files }

    await drag(ui, DEPS, 'hdr:backlog')
    await clock.advance(SYNC_PAUSE)
    expect(await ui.find({ key: 'retry-all' })).toBeDefined()
    expect(await under(ui, 'hdr:backlog')).toEqual([DEPS, DOCS, LINT])

    // A reload while it is refused keeps the card where the person put it.
    await ui.press({ key: 'refresh' })
    await clock.settle()
    expect(await under(ui, 'hdr:backlog')).toEqual([DEPS, DOCS, LINT])

    for (let tries = 0; tries < 3; tries += 1) {
      expect(toasts).toEqual([])
      await ui.press({ key: 'retry-all' })
      await clock.settle()
    }

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(
      /^Could not reorder #6 in Backlog, so it is back where it was: .*EACCES: read-only$/,
    )
    expect(await under(ui, 'hdr:backlog')).toEqual([DOCS, LINT, DEPS])
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`the terminal and the desktop leave the reorder buttons to the board on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await click(ui, LINT)
    expect(await ui.find({ key: 'move:claude' })).toBeDefined()
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    expect(await ui.find({ key: 'reorder:down' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a reload while a reorder is pending keeps the card among the cards the reload brings on the ${surface}`, async ($, on) => {
    const { clock, ui, calls } = await start($, on, surface)
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    // Dense orders in the files, shifted here: the reload brings them back.
    await drag(ui, DEPS, 'hdr:backlog')
    await clock.advance(SYNC_PAUSE)
    calls.edit(path(4, 'docs'), card(4, { title: 'Write docs', order: 1 }))
    calls.edit(path(5, 'lint'), card(5, { title: 'Fix lint', order: 2 }))
    await ui.press({ key: 'refresh' })

    expect(await under(ui, 'hdr:backlog')).toEqual([DEPS, DOCS, LINT])
    release()
    await clock.advance(2000)
    await ui.unmount()
  })
}

for (const surface of WITHOUT_CLIENT) {
  test(`the detail view has up and down buttons that reorder the card on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls, prompts } = await start($, on, surface)

    await click(ui, LINT)
    expect(await ui.find({ key: 'reorder:up' })).toBeDefined()
    expect(await ui.find({ key: 'reorder:down' })).toBeDefined()

    await ui.press({ key: 'reorder:down' })
    await clock.advance(SYNC_PAUSE)
    expect(calls.writes).toEqual([path(5, 'lint')])
    expect(orderOf(files, 5, 'lint')).toBe(61)
    expect(files[path(5, 'lint')]).toContain('status: backlog')
    // Last now: nowhere further down.
    expect(await ui.find({ key: 'reorder:down' })).toBeUndefined()

    await ui.press({ key: 'reorder:up' })
    await ui.press({ key: 'reorder:up' })
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 5, 'lint')).toBeLessThan(orderOf(files, 4, 'docs'))
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    expect(prompts).toEqual([])

    await ui.press({ key: 'back' })
    expect(
      (await rowKeys(ui)).filter(key => [DOCS, LINT, DEPS].includes(key)),
    ).toEqual([LINT, DOCS, DEPS])
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`the detail view has reorder buttons in Suspended and none in Cancelled on the ${surface}`, async ($, on) => {
    const files: Files = {
      [path(31, 's')]: card(31, { status: 'suspended', order: 30 }),
      [path(32, 's')]: card(32, { status: 'suspended', order: 40 }),
      [path(41, 'c')]: card(41, { status: 'cancelled' }),
      [path(42, 'c')]: card(42, { status: 'cancelled' }),
    }
    const { clock, ui } = await start($, on, surface, files)
    await group(ui, 'inactive')

    await click(ui, 'card:md:0031-s')
    expect(await ui.find({ key: 'reorder:down' })).toBeDefined()
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await click(ui, 'card:md:0041-c')
    expect(await ui.find({ key: 'move:backlog' })).toBeDefined()
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    expect(await ui.find({ key: 'reorder:down' })).toBeUndefined()
    await clock.advance(2000)
    await ui.unmount()
  })

  test(`the detail view of a card alone in its section, or in Done, has no reorder buttons on the ${surface}`, async ($, on) => {
    const files = board()
    delete files[path(3, 'tests')]
    const { ui } = await start($, on, surface, files)

    await click(ui, API)
    expect(await ui.find({ key: 'move:backlog' })).toBeDefined()
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    expect(await ui.find({ key: 'reorder:down' })).toBeUndefined()
    await ui.press({ key: 'back' })

    await group(ui, 'inactive')
    await click(ui, OLD)
    expect(await ui.find({ key: 'reorder:up' })).toBeUndefined()
    await ui.unmount()
  })
}

// A GitHub board: three issues in Backlog and one in Claude, as the board query gives them.
const KANBAN_MD = [
  '## Task tracking',
  '- Repo: `TeeratP/claude-kanban` (public).',
  '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
  '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
].join('\n')

const NODES = [
  issueNode({ number: 1, status: 'Backlog', labels: ['ai'] }),
  issueNode({ number: 2, status: 'Backlog', labels: ['ai'] }),
  issueNode({ number: 3, status: 'Backlog', labels: ['ai'] }),
  issueNode({ number: 4, status: 'In progress', labels: ['ai'] }),
]

const POSITION = 'updateProjectV2ItemPosition'

// `gh api graphql` serves the board query and takes the position mutation.
const github = (): Route[] => [
  GH_VERSION,
  { match: ['gh', 'auth', 'status'], reply: {} },
  {
    match: ['git', 'remote', 'get-url', 'origin'],
    reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
  },
  {
    match: ['gh', 'api', 'graphql'],
    reply: argv =>
      queryOf(argv).includes(POSITION)
        ? { stdout: '{"data":{"updateProjectV2ItemPosition":{}}}' }
        : boardReply(NODES)(argv),
  },
  { match: ['gh', 'issue', 'edit'], reply: {} },
  { match: ['gh', 'project', 'item-edit'], reply: {} },
]

async function startGithub(
  $: Engine,
  on: On,
  routes: Route[] = github(),
  hold?: (argv: readonly string[]) => Promise<void> | undefined,
) {
  const world = boot(on, { 'CLAUDE.md': KANBAN_MD })
  const commands = fakeProcess(on, routes, hold)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ...world, commands, ui }
}

const positions = (commands: readonly { argv: readonly string[] }[]) =>
  commands
    .map(command => command.argv)
    .filter(argv => queryOf(argv).includes(POSITION))

test('a reorder on GitHub runs the position mutation after the card above, and nothing else', async ($, on) => {
  const { clock, ui, commands } = await startGithub($, on)
  const sent = commands.length

  await drag(ui, 'card:gh:3', 'card:gh:1')
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  await place(ui, 'gh:1', 'backlog', { at: 'after', cardId: 'gh:2' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  const [first, second] = positions(commands)
  const query = queryOf(first ?? [])
  expect(first).toEqual([
    'gh',
    'api',
    'graphql',
    '-f',
    query,
    '-f',
    'projectId=PVT_kwHOAcCsLc4BorgL',
    '-f',
    'itemId=PVTI_3',
  ])
  expect(query).toContain(
    'updateProjectV2ItemPosition(input: {projectId: $projectId, itemId: $itemId, afterId: $afterId})',
  )
  // Issue 1 goes after issue 2, which is below it now.
  expect(second?.slice(5)).toEqual([
    '-f',
    'projectId=PVT_kwHOAcCsLc4BorgL',
    '-f',
    'itemId=PVTI_1',
    '-f',
    'afterId=PVTI_2',
  ])
  expect(
    commands
      .slice(sent)
      .filter(command => !queryOf(command.argv).includes(POSITION)),
  ).toEqual([])
  expect(await under(ui, 'hdr:backlog')).toEqual([
    'card:gh:3',
    'card:gh:2',
    'card:gh:1',
  ])
  await clock.advance(2000)
  await ui.unmount()
})

test(
  'a card dropped into another section on GitHub is moved there, then put in its place',
  // Claude already has a card; at the default limit of one the prompt would be held.
  async ($, on) => {
    const { clock, ui, commands, prompts } = await startGithub($, on)
    const sent = commands.length

    await place(ui, 'gh:2', 'claude', { at: 'after', cardId: 'gh:4' })
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    const argvs = commands.slice(sent).map(command => command.argv)
    expect(argvs.map(argv => argv.slice(0, 3).join(' '))).toEqual([
      'gh issue edit',
      'gh project item-edit',
      'gh api graphql',
    ])
    expect(argvs[1]).toContain('b15c285e')
    expect(argvs[2]?.slice(5)).toEqual([
      '-f',
      'projectId=PVT_kwHOAcCsLc4BorgL',
      '-f',
      'itemId=PVTI_2',
      '-f',
      'afterId=PVTI_4',
    ])
    expect(prompts).toEqual([expect.stringMatching(/^Work on kanban card #2 /)])
    await clock.advance(2000)
    await ui.unmount()
  },
)

// #28: a reorder keeps what the move it follows is still to do.
test(
  'a card moved to Claude and reordered before the move is confirmed still gets its work prompt, once',
  // Claude already has a card; at the default limit of one the prompt would be held.
  async ($, on) => {
    const { clock, ui, files, prompts } = await start($, on, 'terminal')

    await place(ui, 'md:0004-docs', 'claude', {
      at: 'after',
      cardId: 'md:0003-tests',
    })
    await place(ui, 'md:0004-docs', 'claude', { at: 'top' })
    expect(await under(ui, 'hdr:claude')).toEqual([DOCS, API, TESTS])
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    expect(files[path(4, 'docs')]).toContain('status: claude')
    expect(orderOf(files, 4, 'docs')).toBeLessThan(orderOf(files, 2, 'api'))
    expect(prompts).toEqual([
      expect.stringMatching(/^Work on kanban card #4 "Write docs"/),
    ])
    await clock.advance(2000)
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  },
)

test(
  'a card reordered while its move to Claude is on its way still gets its work prompt, once',
  async ($, on) => {
    const { clock, calls, ui, files, prompts } = await start($, on, 'terminal')
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    await place(ui, 'md:0004-docs', 'claude', {
      at: 'after',
      cardId: 'md:0003-tests',
    })
    await clock.advance(SYNC_PAUSE)
    // The write is out and waiting; the person reorders the card meanwhile.
    await place(ui, 'md:0004-docs', 'claude', { at: 'top' })
    await clock.advance(SYNC_PAUSE)
    expect(prompts).toEqual([])

    release()
    await clock.settle()

    expect(files[path(4, 'docs')]).toContain('status: claude')
    expect(orderOf(files, 4, 'docs')).toBeLessThan(orderOf(files, 2, 'api'))
    expect(prompts).toEqual([
      expect.stringMatching(/^Work on kanban card #4 "Write docs"/),
    ])
    await clock.advance(2000)
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  },
)

test(
  'a card sent back and reordered before the move is confirmed still gets its resume prompt, once',
  async ($, on) => {
    const files: Files = {
      ...board(),
      [path(8, 'review')]: card(
        8,
        { status: 'human', title: 'Review me' },
        HANDED_OFF,
      ),
    }
    const { clock, ui, prompts } = await start($, on, 'terminal', files)

    await click(ui, 'card:md:0008-review')
    await ui.input({ key: 'feedback', text: 'Add a test' })
    await place(ui, 'md:0008-review', 'claude', { at: 'top' })
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    expect(files[path(8, 'review')]).toContain('status: claude')
    expect(prompts).toEqual([
      expect.stringMatching(/^Resume kanban card #8: read the newest feedback/),
    ])
    await clock.advance(2000)
    expect(prompts).toHaveLength(1)
    await ui.unmount()
  },
)

test('a question reordered in Human before the move is confirmed is still announced, once', async ($, on) => {
  const files: Files = {
    ...board(),
    [path(8, 'review')]: card(
      8,
      { status: 'human', title: 'Review me', order: 80 },
      HANDED_OFF,
    ),
  }
  const { clock, ui, toasts, notices } = await start($, on, 'terminal', files)

  await $.tool.call({
    tool: 'mcp__kanban__kanban_ask',
    card: 2,
    question: 'Which database should the tests use?',
  })
  await place(ui, 'md:0002-api', 'human', { at: 'top' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  expect(files[path(2, 'api')]).toContain('status: human')
  expect(toasts).toEqual([
    'Claude asks: Which database should the tests use? (#2)',
  ])
  expect(notices).toEqual(toasts)
  await clock.advance(2000)
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

// #28: a card that changes section on GitHub is placed in it, so the order
// the board shows is the order a reload gives.
const STATUS_OF_OPTION: Record<string, string> = {
  '1a1cd0bb': 'Backlog',
  b15c285e: 'In progress',
  '5f34c9ff': 'In review',
  '201b4a64': 'Done',
}

// A GitHub board that keeps what is done to it: a Status edit changes an
// issue's section and a position mutation moves its item.
function liveGithub(issues: FakeIssue[]): Route[] {
  const itemOf = (issue: FakeIssue) => `PVTI_${issue.number}`
  const fieldOf = (argv: readonly string[], name: string) =>
    argv.find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)

  return [
    GH_VERSION,
    { match: ['gh', 'auth', 'status'], reply: {} },
    {
      match: ['git', 'remote', 'get-url', 'origin'],
      reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
    },
    {
      match: ['gh', 'api', 'graphql'],
      reply: argv => {
        if (!queryOf(argv).includes(POSITION)) {
          return boardReply(issues.map(issueNode))(argv)
        }

        const at = issues.findIndex(
          one => itemOf(one) === fieldOf(argv, 'itemId'),
        )
        const moved = issues.splice(at, 1)
        const after = fieldOf(argv, 'afterId')
        issues.splice(
          after === undefined
            ? 0
            : issues.findIndex(one => itemOf(one) === after) + 1,
          0,
          ...moved,
        )

        return { stdout: '{"data":{"updateProjectV2ItemPosition":{}}}' }
      },
    },
    {
      match: ['gh', 'project', 'item-edit'],
      reply: argv => {
        const issue = issues.find(one => itemOf(one) === argv[4])
        const option = argv[argv.indexOf('--single-select-option-id') + 1]
        if (issue !== undefined && option !== undefined) {
          issue.status = STATUS_OF_OPTION[option] ?? issue.status
        }

        return {}
      },
    },
    { match: ['gh', 'issue', 'edit'], reply: {} },
  ]
}

const ready = (number: number, status = 'Backlog'): FakeIssue => ({
  number,
  status,
  labels: ['ai'],
})

// Moves a card to Claude with no place asked, as the Move buttons do.
const sendToClaude = (ui: Parameters<typeof place>[0], number: number) =>
  place(ui, `gh:${number}`, 'claude', undefined)

const lastPosition = (commands: readonly { argv: readonly string[] }[]) =>
  positions(commands).at(-1)?.slice(5)

test(
  'a card moved to another section on GitHub with no place goes after the last card there',
  async ($, on) => {
    const issues = [ready(1), ready(2), ready(3), ready(4, 'In progress')]
    const { clock, ui, commands } = await startGithub($, on, liveGithub(issues))
    const sent = commands.length

    await sendToClaude(ui, 2)
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    const argvs = commands.slice(sent).map(command => command.argv)
    expect(argvs.map(argv => argv.slice(0, 3).join(' '))).toEqual([
      'gh issue edit',
      'gh project item-edit',
      'gh api graphql',
    ])
    expect(lastPosition(commands)).toEqual([
      '-f',
      'projectId=PVT_kwHOAcCsLc4BorgL',
      '-f',
      'itemId=PVTI_2',
      '-f',
      'afterId=PVTI_4',
    ])
    await clock.advance(2000)
    await ui.unmount()
  },
)

test(
  'a card moved into an empty section on GitHub is positioned first there',
  async ($, on) => {
    const issues = [ready(1), ready(2), ready(3)]
    const { clock, ui, commands } = await startGithub($, on, liveGithub(issues))

    await sendToClaude(ui, 2)
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    expect(positions(commands)).toHaveLength(1)
    expect(lastPosition(commands)).toEqual([
      '-f',
      'projectId=PVT_kwHOAcCsLc4BorgL',
      '-f',
      'itemId=PVTI_2',
    ])
    await clock.advance(2000)
    await ui.unmount()
  },
)

test('cards moved to Claude on GitHub keep the order they were sent in after a reload', async ($, on) => {
  const issues = [ready(1), ready(2), ready(3), ready(4, 'In progress')]
  const { clock, ui } = await startGithub($, on, liveGithub(issues))

  // Not the order the project holds them in.
  for (const number of [3, 1, 2]) {
    await sendToClaude(ui, number)
    await clock.advance(SYNC_PAUSE)
    await clock.settle()
  }
  await clock.advance(2500)

  const queue = () => under(ui, 'hdr:claude')
  const shown = ['card:gh:4', 'card:gh:3', 'card:gh:1', 'card:gh:2']
  expect(await queue()).toEqual(shown)

  await ui.press({ key: 'refresh' })
  await clock.settle()
  await clock.advance(2500)

  expect(await queue()).toEqual(shown)
  await ui.unmount()
})

test('a place that has left its section falls back to the last card there, never to a card still being made', async ($, on) => {
  const issues = [ready(1), ready(2), ready(4, 'In progress')]
  let release = () => {}
  const created = new Promise<void>(resolve => {
    release = resolve
  })
  const { clock, ui, commands } = await startGithub(
    $,
    on,
    [
      ...liveGithub(issues),
      { match: ['gh', 'label', 'list'], reply: { stdout: 'ai\ntriage\n' } },
      {
        match: ['gh', 'issue', 'create'],
        reply: {
          stdout: 'https://github.com/TeeratP/claude-kanban/issues/30\n',
        },
      },
      {
        match: ['gh', 'project', 'item-add'],
        reply: { stdout: JSON.stringify({ id: 'PVTI_30', type: 'Issue' }) },
      },
    ],
    argv => (argv[2] === 'create' ? created : undefined),
  )
  // Backlog now holds Issue 1, Issue 2 and a card still being made.
  await ui.press({ key: 'add' })
  const adding = ui.input({ key: 'add:title', text: 'Write docs' })
  await clock.settle()
  expect(
    (await under(ui, 'hdr:backlog')).some(key => key.startsWith('card:new:')),
  ).toBe(true)

  // Issue 1 is put after Issue 2, which leaves Backlog before the move is sent.
  await place(ui, 'gh:1', 'backlog', { at: 'after', cardId: 'gh:2' })
  await place(ui, 'gh:2', 'claude', { at: 'top' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  // Nothing is left to go after, so Issue 1 goes first.
  expect(
    positions(commands).filter(argv => argv.includes('itemId=PVTI_1')),
  ).toEqual([
    [
      'gh',
      'api',
      'graphql',
      '-f',
      queryOf(positions(commands)[0] ?? []),
      '-f',
      'projectId=PVT_kwHOAcCsLc4BorgL',
      '-f',
      'itemId=PVTI_1',
    ],
  ])
  release()
  await adding
  await clock.settle()
  await clock.advance(2500)
  await ui.unmount()
})

// #31: where a card goes by default is a courtesy; GitHub has already applied
// its Status by then. A place the person asked for is still part of the move.
function failingPosition(live: Route[], isFailing: () => boolean): Route[] {
  const board = live.find(one => one.match[2] === 'graphql')

  return [
    {
      match: ['gh', 'api', 'graphql'],
      reply: argv => {
        if (isFailing() && queryOf(argv).includes(POSITION)) {
          return { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' }
        }
        const reply = board?.reply

        return typeof reply === 'function' ? reply(argv) : (reply ?? {})
      },
    },
    { match: ['gh', 'issue', 'comment'], reply: {} },
    {
      match: ['gh', 'issue', 'view'],
      reply: { stdout: '{"body":"","comments":[],"url":"","state":"OPEN"}' },
    },
    ...live,
  ]
}

test('a move to Human whose default position call fails is still confirmed and announced once', async ($, on) => {
  const issues = [ready(1), ready(2, 'In progress')]
  let isFailing = false
  const { clock, ui, commands, prompts, toasts, notices, logs } =
    await startGithub(
      $,
      on,
      failingPosition(liveGithub(issues), () => isFailing),
    )

  await sendToClaude(ui, 1)
  await clock.advance(SYNC_PAUSE)
  await clock.settle()
  expect(prompts).toEqual([expect.stringMatching(/^Work on kanban card #1 /)])

  isFailing = true
  const sent = commands.length
  await $.tool.call({
    tool: 'mcp__kanban__kanban_ask',
    card: 2,
    question: 'Which branch should this target?',
  })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  // Status was edited, the position was tried once, and the move is confirmed.
  const argvs = commands.slice(sent).map(command => command.argv)
  expect(
    argvs.filter(argv => argv[2] === 'item-edit' && argv.includes('PVTI_2')),
  ).toHaveLength(1)
  expect(positions(commands.slice(sent))).toHaveLength(1)
  const text = (await row(ui, 'card:gh:2'))?.text ?? ''
  expect(text).toContain('✓')
  expect(text).not.toContain('✕')
  expect(await under(ui, 'hdr:human')).toEqual(['card:gh:2'])
  expect(toasts).toEqual(['Claude asks: Which branch should this target? (#2)'])
  expect(notices).toEqual(toasts)
  expect(logs.filter(line => line.includes('HTTP 502'))).toEqual([
    'kanban: left #2 where GitHub put it, its position was not set: HTTP 502: Bad Gateway',
  ])
  await clock.advance(2500)
  expect(toasts).toHaveLength(1)
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test(
  'a card dropped in a place on GitHub whose position call fails still goes to ✕',
  async ($, on) => {
    const issues = [ready(1), ready(2), ready(4, 'In progress')]
    const { clock, ui, prompts, logs } = await startGithub(
      $,
      on,
      failingPosition(liveGithub(issues), () => true),
    )

    await place(ui, 'gh:2', 'claude', { at: 'after', cardId: 'gh:4' })
    await clock.advance(SYNC_PAUSE)
    await clock.settle()

    const text = (await row(ui, 'card:gh:2'))?.text ?? ''
    expect(text).toContain('✕')
    expect(text).not.toContain('✓')
    expect(prompts).toEqual([])
    expect(logs.filter(line => line.includes('was not set'))).toEqual([])
    await ui.unmount()
  },
)

// #28: local renumbering takes turns, so two cards dropped into the same full
// section within one pause both keep their place.
test(
  'two cards dropped into a section with no gap within one pause both keep their order on disk',
  async ($, on) => {
    const files: Files = {
      [path(1, 'first')]: card(1, { status: 'claude', order: 1 }),
      [path(2, 'second')]: card(2, { status: 'claude', order: 2 }),
      [path(3, 'x')]: card(3, { title: 'Card X', order: 10 }),
      [path(4, 'y')]: card(4, { title: 'Card Y', order: 11 }),
    }
    const { clock, ui, calls } = await start($, on, 'terminal', files)
    // A slow disk: both moves have read the files before either has written.
    let release = () => {}
    calls.hold = new Promise<void>(resolve => {
      release = resolve
    })

    await place(ui, 'md:0003-x', 'claude', {
      at: 'after',
      cardId: 'md:0001-first',
    })
    await place(ui, 'md:0004-y', 'claude', {
      at: 'after',
      cardId: 'md:0001-first',
    })
    const shown = await under(ui, 'hdr:claude')
    expect(shown).toEqual([
      'card:md:0001-first',
      'card:md:0004-y',
      'card:md:0003-x',
      'card:md:0002-second',
    ])
    await clock.advance(SYNC_PAUSE)
    release()
    await clock.settle()

    // The disk holds the order the board shows, with no two cards tied.
    const orders = [
      orderOf(files, 1, 'first'),
      orderOf(files, 4, 'y'),
      orderOf(files, 3, 'x'),
      orderOf(files, 2, 'second'),
    ]
    expect(
      orders.every((order, i) => i === 0 || order > (orders[i - 1] ?? 0)),
    ).toBe(true)
    await ui.press({ key: 'refresh' })
    await clock.settle()
    expect(await under(ui, 'hdr:claude')).toEqual(shown)
    await clock.advance(2000)
    await ui.unmount()
  },
)

test('a card added while a card is moved into the same section does not share its order', async ($, on) => {
  const files: Files = {
    [path(1, 'a')]: card(1, { status: 'claude', title: 'In Claude' }),
    [path(2, 'b')]: card(2, { title: 'In Backlog', order: 20 }),
  }
  const { clock, ui, calls } = await start($, on, 'terminal', files)
  // A slow disk: both have read the files before either has written.
  let release = () => {}
  calls.hold = new Promise<void>(resolve => {
    release = resolve
  })

  await ui.press({ key: 'add' })
  const adding = ui.input({ key: 'add:title', text: 'Write docs' })
  await clock.settle()
  await place(ui, 'md:0001-a', 'backlog', undefined)
  await clock.advance(SYNC_PAUSE)
  release()
  await adding
  await clock.settle()

  const created = Object.keys(files).find(file => file.includes('write-docs'))
  const orders = [
    orderOf(files, 2, 'b'),
    orderOf(files, 1, 'a'),
    Number(/\norder: (\S+)\n/.exec(files[created ?? ''] ?? '')?.[1]),
  ]
  expect(new Set(orders).size).toBe(3)
  await clock.advance(2500)
  await ui.unmount()
})

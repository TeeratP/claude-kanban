import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  click,
  keys,
  lineRows,
  litRows,
  row,
  rowIndex,
  rowKeys,
} from './board-ui'
import type { BoardUi } from './board-ui'
import { PANE, RUN, SYNC_PAUSE, boot, card, path } from './fakes'

const WITH_CLIENT = ['terminal', 'desktop'] as const
const WITHOUT_CLIENT = ['vscode', 'mobile'] as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
  [path(4, 'old')]: card(4, { status: 'done', title: 'Old thing' }),
})

const LOGIN = 'card:md:0001-login'
const API = 'card:md:0002-api'
const DOCS = 'card:md:0003-docs'

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  files: Record<string, string> = cards(),
  bodyColumns: number = PANE.props.bodyColumns,
) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    surface,
    props: { ...PANE.props, bodyColumns },
  })

  return { ...world, files, ui }
}

// Brings the cursor up and walks it down to `key`.
async function goTo(ui: BoardUi, key: string) {
  await keys(ui, 'down')
  for (let step = 0; step < 30; step += 1) {
    if ((await litRows(ui)).includes(key)) break
    await keys(ui, 'down')
  }
  expect(await litRows(ui)).toEqual([key])
}

// Eight Backlog cards: five show, a `more` row pages to the rest.
const backlog = () => {
  const files: Record<string, string> = {}
  for (let n = 1; n <= 8; n += 1) {
    files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
  }

  return files
}

for (const surface of WITH_CLIENT) {
  test(`the first key brings the cursor up and it takes no action on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    expect(await litRows(ui)).toEqual([])

    await keys(ui, 'return')
    expect(await litRows(ui)).toEqual(['hdr:human'])
    expect(await row(ui, LOGIN)).toBeDefined()

    await keys(ui, 'return')
    expect(await row(ui, LOGIN)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['hdr:human'])
    await ui.unmount()
  })

  test(`up, down, k and j move the cursor and stop at the ends on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    const all = await rowKeys(ui)
    const lit = async () => (await litRows(ui)).join()

    await keys(ui, 'down')
    expect(await lit()).toBe(all[0])
    await keys(ui, 'up')
    expect(await lit()).toBe(all[0])

    await keys(ui, 'down')
    expect(await lit()).toBe(all[1])
    await keys(ui, 'j')
    expect(await lit()).toBe(all[2])
    await keys(ui, 'k')
    expect(await lit()).toBe(all[1])
    await keys(ui, 'up')
    expect(await lit()).toBe(all[0])

    await keys(ui, ...all.map(() => 'down'))
    expect(await lit()).toBe(all[all.length - 1])
    await keys(ui, 'j')
    expect(await lit()).toBe(all[all.length - 1])
    await ui.unmount()
  })

  test(`the cursor skips rows that are only text on the ${surface}`, async ($, on) => {
    const files = cards()
    delete files[path(2, 'api')]
    const { ui } = await start($, on, surface, files)
    expect(await rowKeys(ui)).toContain('empty:claude')

    // A click on a text row records nothing for the keys to start from.
    await click(ui, 'empty:claude')
    await goTo(ui, 'hdr:claude')
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['hdr:backlog'])
    await keys(ui, 'up')
    expect(await litRows(ui)).toEqual(['hdr:claude'])
    await ui.unmount()
  })

  test(`a click draws no cursor and the keys start from the row it hit on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await click(ui, 'hdr:claude')
    expect(await row(ui, API)).toBeUndefined()
    expect(await litRows(ui)).toEqual([])

    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['hdr:claude'])
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['hdr:backlog'])

    // A click while the cursor shows moves it to the row clicked.
    await click(ui, 'hdr:human')
    expect(await litRows(ui)).toEqual(['hdr:human'])
    await ui.unmount()
  })

  test(`Enter on a card opens its detail on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await goTo(ui, LOGIN)
    await keys(ui, 'return')

    expect((await ui.find({ type: 'Text', text: '#1 Fix login' }))?.text).toBe(
      '#1 Fix login',
    )
    expect(await ui.find({ type: 'Client' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await rowKeys(ui)).toContain(LOGIN)
    await ui.unmount()
  })

  test(`Enter on a header folds it on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await goTo(ui, 'hdr:done')
    // The cursor's highlight runs to the pane's edge, so its row has trailing spaces.
    const done = async () => (await row(ui, 'hdr:done'))?.text.trimEnd()
    expect(await done()).toBe('▸ Done 1')
    await keys(ui, 'return')
    expect(await done()).toBe('▾ Done 1')
    expect(await row(ui, 'card:md:0004-old')).toBeDefined()
    expect(await litRows(ui)).toEqual(['hdr:done'])
    await keys(ui, 'return')
    expect(await done()).toBe('▸ Done 1')
    await ui.unmount()
  })

  test(`Enter on a more row pages its section on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, backlog())

    await goTo(ui, 'more:backlog:down')
    await keys(ui, 'return')

    expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 3 more')
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    // Its row gone, the cursor rests on the nearest one.
    expect(await litRows(ui)).toEqual(['card:md:0008-b'])
    await ui.unmount()
  })

  test(
    `m then a section key moves the card, as a drop does, on the ${surface}`,
    { options: { claudeLimit: 0 } },
    async ($, on) => {
      const { clock, ui, files } = await start($, on, surface)
      await goTo(ui, DOCS)

      await keys(ui, 'm')
      expect((await row(ui, 'hdr:human'))?.text).toBe('▾ Human 1  1/h')
      expect((await row(ui, 'hdr:claude'))?.text).toBe('▾ Claude 1  2/c')
      expect((await row(ui, 'hdr:done'))?.text).toBe('▸ Done 1  4/d')
      expect((await row(ui, 'hdr:backlog'))?.text).toBe('▾ Backlog 1')

      await keys(ui, 'h')
      const keysNow = await rowKeys(ui)
      expect(keysNow.slice(keysNow.indexOf('hdr:human') + 1, 3)).toEqual([
        LOGIN,
        DOCS,
      ])
      expect((await row(ui, 'hdr:human'))?.text).toBe('▾ Human 2')
      // The cursor follows the card into its new section.
      expect(await litRows(ui)).toEqual([DOCS])
      await clock.advance(SYNC_PAUSE)
      expect(files[path(3, 'docs')]).toContain('status: human')

      await keys(ui, 'm', '3')
      await clock.advance(SYNC_PAUSE)
      expect(files[path(3, 'docs')]).toContain('status: backlog')
      expect(await litRows(ui)).toEqual([DOCS])

      // Done is folded: the card is out of sight and the cursor rests near it.
      await keys(ui, 'm', 'd')
      await clock.advance(SYNC_PAUSE)
      expect(files[path(3, 'docs')]).toContain('status: done')
      expect(await row(ui, DOCS)).toBeUndefined()
      expect(await litRows(ui)).toHaveLength(1)
      await ui.unmount()
    },
  )

  test(
    `a card moved from Backlog to Claude by key asks Claude to work on it, any other move does not on the ${surface}`,
    { options: { claudeLimit: 0 } },
    async ($, on) => {
      const { clock, ui, prompts, files } = await start($, on, surface)

      await goTo(ui, LOGIN)
      await keys(ui, 'm', 'c')
      await clock.advance(SYNC_PAUSE)
      expect(files[path(1, 'login')]).toContain('status: claude')
      expect(prompts).toEqual([])

      await goTo(ui, DOCS)
      await keys(ui, 'm', '2')
      expect(prompts).toEqual([])
      await clock.advance(SYNC_PAUSE)
      expect(files[path(3, 'docs')]).toContain('status: claude')
      expect(prompts).toEqual([
        expect.stringMatching(
          /^Work on kanban card #3 "Write docs": read it with/,
        ),
      ])
      await ui.unmount()
    },
  )

  test(`any other key, a click or the card's own section ends a move with nothing moved on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const before = { ...files }
    const moving = async () =>
      ((await row(ui, 'hdr:human'))?.text ?? '').includes('1/h')
    await goTo(ui, DOCS)

    // The key that ends it is spent: the cursor stays where it was.
    for (const key of ['x', 'm', 'j', 'return', 'b', 'tab']) {
      await keys(ui, 'm')
      expect(await moving()).toBe(true)
      await keys(ui, key)
      expect(await moving()).toBe(false)
      expect(await litRows(ui)).toEqual([DOCS])
    }

    await keys(ui, 'm')
    await click(ui, 'hdr:done')
    expect(await moving()).toBe(false)

    // On a header or a more row, `m` starts nothing.
    await click(ui, 'hdr:human')
    await goTo(ui, 'hdr:claude')
    await keys(ui, 'm')
    expect(await moving()).toBe(false)

    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`keys with ctrl or meta, and keys that mean nothing, do nothing on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const before = { ...files }
    await goTo(ui, LOGIN)

    await ui.key({ key: 'j', ctrl: true })
    await ui.key({ key: 'k', meta: true })
    await ui.key({ key: 'return', ctrl: true })
    await ui.key({ key: 'm', meta: true })
    await keys(ui, 'x', 'tab', 'left', 'right', 'h', '1')

    expect(await litRows(ui)).toEqual([LOGIN])
    expect(await ui.find({ type: 'Client' })).toBeDefined()
    expect(await row(ui, 'hdr:human')).toMatchObject({ text: '▾ Human 1' })
    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`the cursor stays on its card when a refresh shifts the rows on the ${surface}`, async ($, on) => {
    const { ui, calls } = await start($, on, surface)
    await goTo(ui, DOCS)
    const was = await rowIndex(ui, DOCS)

    calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))
    await ui.press({ key: 'refresh' })

    expect(await rowIndex(ui, DOCS)).toBe(was + 1)
    expect(await litRows(ui)).toEqual([DOCS])
    await keys(ui, 'k')
    expect(await litRows(ui)).toEqual(['hdr:backlog'])
    await ui.unmount()
  })

  test(`the cursor moves to the nearest row when its card goes on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    await goTo(ui, DOCS)

    delete files[path(3, 'docs')]
    await ui.press({ key: 'refresh' })

    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['hdr:backlog'])
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['hdr:done'])
    await ui.unmount()
  })

  test(`a drag still highlights its target with a cursor showing on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    await goTo(ui, API)
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'hdr:human')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
    // The click gave the cursor to the card; the drag draws a line, not a second highlight.
    expect(await litRows(ui)).toEqual([DOCS])
    expect(await lineRows(ui)).toEqual(['hdr:human'])
    await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })

    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })

  test(`the toolbar shows the key hint, until a read fails, on the ${surface}`, async ($, on) => {
    const { ui, calls } = await start($, on, surface, cards(), 72)

    expect(
      await ui.find({ type: 'Text', text: /↑↓ ⏎ open · m move/ }),
    ).toBeDefined()

    calls.edit(path(1, 'login'), card(1, { status: 'human', title: 'Edited' }))
    calls.denyRead = 'EIO: disk error'
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: /EIO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑↓/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`a pane too narrow for the whole key hint leaves it out, on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, cards(), 30)

    expect(
      await ui.find({ type: 'Text', text: /↑↓|m move|open ·/ }),
    ).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of WITHOUT_CLIENT) {
  test(`the ${surface} keeps its Button rows and shows no key hint`, async ($, on) => {
    const { ui } = await start($, on, surface)

    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: DOCS })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑↓/ })).toBeUndefined()
    expect(
      await ui.find({ type: 'Text', text: /open · m move/ }),
    ).toBeUndefined()
    await ui.unmount()
  })
}

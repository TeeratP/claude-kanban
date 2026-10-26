import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  click,
  group,
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

// The rows the cursor can rest on: a group's header, a card or a `more` row.
const STOP = /^(grp|card|more)\b/

// Eight Backlog cards: six show, a `more` row pages to the rest.
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
    expect(await litRows(ui)).toEqual(['grp:active'])
    expect(await row(ui, LOGIN)).toBeDefined()

    // The next one acts: Active is open, so it folds, and with it every section.
    await keys(ui, 'return')
    expect(await row(ui, LOGIN)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['grp:active'])
    await ui.unmount()
  })

  test(`up, down, k and j move the cursor and stop at the ends on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    const all = (await rowKeys(ui)).filter(key => STOP.test(key))
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
    await goTo(ui, LOGIN)
    // Past the Claude header, its empty row and its filler, to the Inactive group.
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['grp:inactive'])
    await keys(ui, 'up')
    expect(await litRows(ui)).toEqual([LOGIN])
    await ui.unmount()
  })

  test(`the cursor rests on group headers, cards and more rows, never on a section header or filler on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, backlog())
    const stops = (await rowKeys(ui)).filter(key => STOP.test(key))
    const labels = (await rowKeys(ui)).filter(key => !STOP.test(key))

    expect(labels).toContain('hdr:backlog')
    expect(labels).toContain('hdr:human')
    expect(labels.some(key => key.startsWith('empty:'))).toBe(true)
    for (const stop of stops) {
      await keys(ui, 'down')
      expect(await litRows(ui)).toEqual([stop])
    }
    await ui.unmount()
  })

  test(`a click draws no cursor and the keys start from the row it hit on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await click(ui, 'grp:inactive')
    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual([])

    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['grp:inactive'])
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['card:md:0004-old'])

    // A click while the cursor shows moves it to the row clicked.
    await click(ui, 'grp:active')
    expect(await litRows(ui)).toEqual(['grp:active'])
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

  test(`Enter on a group header opens it and folds the other on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await goTo(ui, 'grp:inactive')
    // The cursor's highlight runs to the pane's edge, so its row has trailing spaces.
    const inactive = async () => (await row(ui, 'grp:inactive'))?.text.trimEnd()
    expect(await inactive()).toMatch(/^▸ Inactive\s+1 Done$/)
    await keys(ui, 'return')
    expect(await inactive()).toBe('▾ Inactive')
    expect(await row(ui, 'card:md:0004-old')).toBeDefined()
    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['grp:inactive'])
    await keys(ui, 'return')
    expect(await inactive()).toMatch(/^▸ Inactive\s+1 Done$/)
    expect(await row(ui, 'card:md:0004-old')).toBeUndefined()
    await ui.unmount()
  })

  test(`Enter on a more row pages its section on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, backlog())

    await goTo(ui, 'more:backlog:down')
    await keys(ui, 'return')

    expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 2 more$/)
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

      // The other sections show the keys that send the card there, in place of
      // their meta; the folded group shows its three on its own header.
      await keys(ui, 'm')
      expect((await row(ui, 'hdr:human'))?.text).toMatch(/Human 1 ─+ 2\/h$/)
      expect((await row(ui, 'hdr:claude'))?.text).toMatch(/Claude 1 ─+ 3\/c$/)
      expect((await row(ui, 'hdr:backlog'))?.text).toMatch(/Backlog 1 ─+$/)
      expect((await row(ui, 'grp:inactive'))?.text).toMatch(
        /^▸ Inactive\s+4\/d 5\/x 6\/s$/,
      )

      await keys(ui, 'h')
      const keysNow = await rowKeys(ui)
      expect(
        keysNow.slice(
          keysNow.indexOf('hdr:human') + 1,
          keysNow.indexOf('hdr:claude'),
        ),
      ).toEqual([LOGIN, DOCS])
      expect((await row(ui, 'hdr:human'))?.text).toMatch(/Human 2 ─+$/)
      // The cursor follows the card into its new section.
      expect(await litRows(ui)).toEqual([DOCS])
      await clock.advance(SYNC_PAUSE)
      expect(files[path(3, 'docs')]).toContain('status: human')

      await keys(ui, 'm', '1')
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

  for (const [name, column] of [
    ['d', 'done'],
    ['x', 'cancelled'],
    ['s', 'suspended'],
    ['4', 'done'],
    ['5', 'cancelled'],
    ['6', 'suspended'],
  ] as const) {
    test(`m then ${name} moves the card to ${column}, though that group is folded, on the ${surface}`, async ($, on) => {
      const { clock, ui, files } = await start($, on, surface)
      await goTo(ui, DOCS)

      await keys(ui, 'm', name)
      await clock.advance(SYNC_PAUSE)

      expect(files[path(3, 'docs')]).toContain(`status: ${column}`)
      expect(await row(ui, DOCS)).toBeUndefined()
      await group(ui, 'inactive')
      expect(await row(ui, DOCS)).toBeDefined()
      await ui.unmount()
    })
  }

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

      // Docs is above Login, which went down to Claude with the cursor on it.
      for (let step = 0; step < 30; step += 1) {
        if ((await litRows(ui)).includes(DOCS)) break
        await keys(ui, 'up')
      }
      expect(await litRows(ui)).toEqual([DOCS])
      await keys(ui, 'm', '3')
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
      ((await row(ui, 'hdr:human'))?.text ?? '').includes('2/h')
    await goTo(ui, DOCS)

    // The key that ends it is spent: the cursor stays where it was.
    for (const key of ['q', 'm', 'j', 'return', 'b', 'tab']) {
      await keys(ui, 'm')
      expect(await moving()).toBe(true)
      await keys(ui, key)
      expect(await moving()).toBe(false)
      expect(await litRows(ui)).toEqual([DOCS])
    }

    await keys(ui, 'm')
    await click(ui, 'grp:inactive')
    expect(await moving()).toBe(false)

    // On a group header or a more row, `m` starts nothing.
    await click(ui, 'grp:active')
    await goTo(ui, 'grp:inactive')
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
    expect((await row(ui, 'hdr:human'))?.text).toMatch(/^ {2}Human 1 ─+$/)
    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`the cursor stays on its card when a refresh shifts the rows on the ${surface}`, async ($, on) => {
    const { ui, calls } = await start($, on, surface)
    await goTo(ui, DOCS)
    const was = await rowIndex(ui, DOCS)

    // A card that sorts above Docs in its section.
    calls.edit(
      path(5, 'new'),
      card(5, { status: 'backlog', title: 'Fresh', order: 0 }),
    )
    await ui.press({ key: 'refresh' })

    expect(await rowIndex(ui, DOCS)).toBe(was + 1)
    expect(await litRows(ui)).toEqual([DOCS])
    await keys(ui, 'k')
    expect(await litRows(ui)).toEqual(['card:md:0005-new'])
    await ui.unmount()
  })

  test(`the cursor moves to the nearest row when its card goes on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    await goTo(ui, DOCS)

    delete files[path(3, 'docs')]
    await ui.press({ key: 'refresh' })

    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['grp:active'])
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual([LOGIN])
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

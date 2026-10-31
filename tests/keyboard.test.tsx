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
import { PANE, RUN, SYNC_PAUSE } from './fakes'
import type { FakeCard } from './fake-github'
import { bootGithub, issue } from './fake-github'

const WITH_CLIENT = ['terminal', 'desktop'] as const
const WITHOUT_CLIENT = ['vscode', 'mobile'] as const

const cards = () => [
  issue(1, { column: 'human', title: 'Fix login' }),
  issue(2, { column: 'claude', title: 'Build API' }),
  issue(3, { column: 'backlog', title: 'Write docs' }),
  issue(4, { column: 'done', title: 'Old thing' }),
]

const LOGIN = 'card:gh:1'
const API = 'card:gh:2'
const DOCS = 'card:gh:3'
const OLD = 'card:gh:4'

// How GitHub holds each closed-group section.
const HELD = {
  done: { status: 'Done', state: 'CLOSED', stateReason: 'COMPLETED' },
  cancelled: {
    status: 'Cancelled',
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
  },
  suspended: { status: 'Suspended', state: 'OPEN' },
} as const

// The commands that changed GitHub: none means nothing moved.
const writes = (github: { commands: { argv: readonly string[] }[] }) =>
  github.commands.filter(
    ({ argv }) =>
      (argv[1] === 'project' && argv[2] !== 'list' && argv[2] !== 'view') ||
      (argv[1] === 'issue' && argv[2] !== 'view' && argv[2] !== 'list') ||
      (argv[1] === 'api' &&
        argv.some(part => part.includes('updateProjectV2ItemPosition'))),
  )

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  issues: FakeCard[] = cards(),
  bodyColumns: number = PANE.props.bodyColumns,
) {
  const world = bootGithub(on, issues)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    surface,
    props: { ...PANE.props, bodyColumns },
  })

  return { ...world, ui }
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
const backlog = () =>
  Array.from({ length: 8 }, (_, at) =>
    issue(at + 1, { title: `Backlog ${at + 1}` }),
  )

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
    const { ui } = await start(
      $,
      on,
      surface,
      cards().filter(one => one.number !== 2),
    )
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
    expect(await litRows(ui)).toEqual([OLD])

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
    expect(await row(ui, OLD)).toBeDefined()
    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['grp:inactive'])
    await keys(ui, 'return')
    expect(await inactive()).toMatch(/^▸ Inactive\s+1 Done$/)
    expect(await row(ui, OLD)).toBeUndefined()
    await ui.unmount()
  })

  test(`Enter on a more row pages its section on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, backlog())

    await goTo(ui, 'more:backlog:down')
    await keys(ui, 'return')

    expect((await row(ui, 'more:backlog:up'))?.text).toMatch(/^ +↑ 2 more$/)
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    // Its row gone, the cursor rests on the nearest one.
    expect(await litRows(ui)).toEqual(['card:gh:8'])
    await ui.unmount()
  })

  test(
    `m then a section key moves the card, as a drop does, on the ${surface}`,
    async ($, on) => {
      const { clock, ui, github } = await start($, on, surface)
      await goTo(ui, DOCS)

      // The other sections show the keys that send the card there, in place of
      // their meta; the folded group shows its three on its own header.
      await keys(ui, 'm')
      expect((await row(ui, 'hdr:human'))?.text).toMatch(/Human 1 ─+ 3\/h$/)
      expect((await row(ui, 'hdr:claude'))?.text).toMatch(/Claude 1 ─+ 2\/c$/)
      expect((await row(ui, 'hdr:backlog'))?.text).toMatch(/Backlog 1 ─+$/)
      expect((await row(ui, 'grp:inactive'))?.text).toMatch(
        /^▸ Inactive\s+4\/d 5\/x 6\/s$/,
      )

      await keys(ui, 'h')
      const keysNow = await rowKeys(ui)
      expect(
        keysNow.slice(
          keysNow.indexOf('hdr:human') + 1,
          keysNow.indexOf('grp:inactive'),
        ),
      ).toEqual([LOGIN, DOCS])
      expect((await row(ui, 'hdr:human'))?.text).toMatch(/Human 2 ─+$/)
      // The cursor follows the card into its new section.
      expect(await litRows(ui)).toEqual([DOCS])
      await clock.advance(SYNC_PAUSE)
      expect(github.card(3).status).toBe('In review')

      await keys(ui, 'm', '1')
      await clock.advance(SYNC_PAUSE)
      expect(github.card(3).status).toBe('Backlog')
      expect(await litRows(ui)).toEqual([DOCS])

      // Done is folded: the card is out of sight and the cursor rests near it.
      await keys(ui, 'm', 'd')
      await clock.advance(SYNC_PAUSE)
      expect(github.card(3)).toMatchObject(HELD.done)
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
      const { clock, ui, github } = await start($, on, surface)
      await goTo(ui, DOCS)

      await keys(ui, 'm', name)
      await clock.advance(SYNC_PAUSE)

      expect(github.card(3)).toMatchObject(HELD[column])
      expect(await row(ui, DOCS)).toBeUndefined()
      await group(ui, 'inactive')
      expect(await row(ui, DOCS)).toBeDefined()
      await ui.unmount()
    })
  }

  test(
    `a card moved from Backlog to Claude by key asks Claude to work on it, any other move does not on the ${surface}`,
    async ($, on) => {
      const { clock, ui, prompts, github } = await start($, on, surface)

      await goTo(ui, LOGIN)
      await keys(ui, 'm', 'c')
      await clock.advance(SYNC_PAUSE)
      expect(github.card(1).status).toBe('In progress')
      expect(github.card(1).labels).toContain('ai')
      expect(prompts).toEqual([])

      // Docs is above Login, which went down to Claude with the cursor on it.
      for (let step = 0; step < 30; step += 1) {
        if ((await litRows(ui)).includes(DOCS)) break
        await keys(ui, 'up')
      }
      expect(await litRows(ui)).toEqual([DOCS])
      await keys(ui, 'm', '2')
      expect(prompts).toEqual([])
      await clock.advance(SYNC_PAUSE)
      expect(github.card(3).status).toBe('In progress')
      expect(github.card(3).labels).toContain('ai')
      expect(prompts).toEqual([
        expect.stringMatching(
          /^Work on kanban card #3 "Write docs": read it with/,
        ),
      ])
      await ui.unmount()
    },
  )

  test(`any other key, a click or the card's own section ends a move with nothing moved on the ${surface}`, async ($, on) => {
    const { clock, ui, github } = await start($, on, surface)
    const moving = async () =>
      ((await row(ui, 'hdr:human'))?.text ?? '').includes('3/h')
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
    expect(writes(github)).toEqual([])
    await ui.unmount()
  })

  test(`keys with ctrl or meta, and keys that mean nothing, do nothing on the ${surface}`, async ($, on) => {
    const { clock, ui, github } = await start($, on, surface)
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
    expect(writes(github)).toEqual([])
    await ui.unmount()
  })

  test(`the cursor stays on its card when a refresh shifts the rows on the ${surface}`, async ($, on) => {
    const { ui, github } = await start($, on, surface)
    await goTo(ui, DOCS)
    const was = await rowIndex(ui, DOCS)

    // A card that sorts above Docs in its section.
    github.cards.unshift(issue(5, { column: 'backlog', title: 'Fresh' }))
    await ui.press({ key: 'refresh' })

    expect(await rowIndex(ui, DOCS)).toBe(was + 1)
    expect(await litRows(ui)).toEqual([DOCS])
    await keys(ui, 'k')
    expect(await litRows(ui)).toEqual(['card:gh:5'])
    await ui.unmount()
  })

  test(`the cursor moves to the nearest row when its card goes on the ${surface}`, async ($, on) => {
    const { ui, github } = await start($, on, surface)
    await goTo(ui, DOCS)

    github.cards.splice(
      github.cards.findIndex(one => one.number === 3),
      1,
    )
    await ui.press({ key: 'refresh' })

    expect(await row(ui, DOCS)).toBeUndefined()
    expect(await litRows(ui)).toEqual(['grp:active'])
    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual([API])
    await ui.unmount()
  })

  test(`a drag still highlights its target with a cursor showing on the ${surface}`, async ($, on) => {
    const { clock, ui, github } = await start($, on, surface)
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
    expect(github.card(3).status).toBe('In review')
    await ui.unmount()
  })

  test(`the toolbar shows the key hint, until a read fails, on the ${surface}`, async ($, on) => {
    const { ui, github } = await start($, on, surface, cards(), 72)

    expect(
      await ui.find({ type: 'Text', text: /↑↓ ⏎ open · m move/ }),
    ).toBeDefined()

    github.card(1).title = 'Edited'
    github.fail['api graphql'] = {
      exitCode: 1,
      stderr: 'HTTP 502: Bad Gateway',
    }
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: /HTTP 502/ })).toBeDefined()
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

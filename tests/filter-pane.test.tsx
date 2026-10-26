import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import {
  TOOLBAR_ROWS,
  click,
  keys,
  litRows,
  row,
  rowIndex,
  rowKeys,
  toolbar,
} from './board-ui'
import type { BoardUi } from './board-ui'
import { boardReply, fakeProcess, issueNode, queryOf } from './fake-gh'
import type { Route } from './fake-gh'
import { KANBAN } from './github-board'
import { PANE, RUN, SCROLL, SYNC_PAUSE, boot, card, path } from './fakes'
import type { Files } from './fakes'

const SURFACES = ['terminal', 'desktop', 'vscode'] as const
const WITH_CLIENT = ['terminal', 'desktop'] as const

// Human has one card and Claude one. Backlog holds four, ten apart, with one the
// filter `fix` hides between the first and the second. Done holds two.
const board = (): Files => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  [path(10, 'alpha')]: card(10, {
    status: 'backlog',
    title: 'Alpha fix',
    order: 10,
  }),
  [path(11, 'hidden')]: card(11, {
    status: 'backlog',
    title: 'Hidden thing',
    order: 20,
  }),
  [path(12, 'beta')]: card(12, {
    status: 'backlog',
    title: 'Beta fix',
    order: 30,
  }),
  [path(13, 'gamma')]: card(13, {
    status: 'backlog',
    title: 'Gamma fix',
    order: 40,
  }),
  [path(20, 'old')]: card(20, { status: 'done', title: 'Old thing' }),
  [path(21, 'older')]: card(21, {
    status: 'done',
    title: 'Fix the old thing',
    updated: '2026-10-24T11:00:00Z',
  }),
})

const LOGIN = 'card:md:0001-login'
const ALPHA = 'card:md:0010-alpha'
const HIDDEN = 'card:md:0011-hidden'
const BETA = 'card:md:0012-beta'
const GAMMA = 'card:md:0013-gamma'
const OLDER = 'card:md:0021-older'

const FIELD = 'filter:text'

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

type FilterUi = BoardUi & Pick<Mounted<'terminal'>, 'input'>

// Types into the filter field, opening it when it is shut.
async function typeFilter(ui: FilterUi, text: string) {
  if ((await ui.find({ key: FIELD })) === undefined) {
    await ui.press({ key: 'filter' })
  }
  await ui.input({ key: FIELD, text, kind: 'change' })
}

// Types the text and presses Enter: the field shuts and the filter stays.
async function applyFilter(ui: FilterUi, text: string) {
  await typeFilter(ui, text)
  await ui.input({ key: FIELD, text })
}

// The keys of the rows under a header, up to the next one.
async function under(ui: BoardUi, header: string) {
  const all = await rowKeys(ui)
  const rest = all.slice(all.indexOf(header) + 1)
  const next = rest.findIndex(key => key.startsWith('hdr:'))

  return next < 0 ? rest : rest.slice(0, next)
}

const textOf = async (ui: BoardUi, key: string) => (await row(ui, key))?.text

const orderOf = (files: Files, id: number, slug: string) =>
  Number(/\norder: (\S+)\n/.exec(files[path(id, slug)] ?? '')?.[1])

type Pointer = Mounted<'terminal'>['pointer']

// Drags `from` onto `to`, the pointer moving straight from one to the other.
async function drag(ui: BoardUi, from: string, to: string) {
  const { pointer } = ui as unknown as { pointer: Pointer }
  const start = await rowIndex(ui, from)
  const end = await rowIndex(ui, to)

  await pointer({ type: 'down', x: 3, y: start, button: 'left' })
  await pointer({ type: 'move', x: 3, y: end, button: 'left' })
  await pointer({ type: 'up', x: 3, y: end, button: 'left' })
}

// Brings the cursor up and walks it down to `key`.
async function walkTo(ui: BoardUi, key: string) {
  for (let step = 0; step < 40; step += 1) {
    if ((await litRows(ui))[0] === key) return

    await keys(ui, 'down')
  }
  expect(await litRows(ui)).toEqual([key])
}

for (const surface of SURFACES) {
  test(`the filter button opens a field, and typing filters every section live on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    const button = await ui.find({ key: 'filter' })
    expect(button?.text).toBe('Find')
    expect(button?.props.hotkey).toBe('f')
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await textOf(ui, 'hdr:claude')).toBe('▾ Claude 1/1')

    await ui.press({ key: 'filter' })
    const field = await ui.find({ key: FIELD })
    expect(field?.type).toBe('Input')
    expect(field?.props.label).toBe('Filter')
    expect(field?.props.placeholder).toBe('words, #12, label:ai, @done')

    await ui.input({ key: FIELD, text: 'fix', kind: 'change' })
    expect((await ui.find({ key: FIELD }))?.props.value).toBe('fix')
    // (Without a Client, an empty row is not a Button.)
    const noMatch = surface === 'vscode' ? [] : ['empty:claude']
    expect(await rowKeys(ui)).toEqual([
      'hdr:human',
      LOGIN,
      'hdr:claude',
      ...noMatch,
      'hdr:backlog',
      ALPHA,
      BETA,
      GAMMA,
      'hdr:done',
      OLDER,
    ])
    // Each header counts the cards shown out of all it holds, Claude's too.
    expect(await textOf(ui, 'hdr:human')).toBe('▾ Human 1/1')
    expect(await textOf(ui, 'hdr:claude')).toBe('▾ Claude 0/1')
    expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 3/4')
    // Done is collapsed but has a match, so it shows.
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 1/2')
    // The text shows in the toolbar's Find button, with a button to clear it.
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find "fix"')
    expect((await ui.find({ key: 'filter:clear' }))?.text).toBe('✕')

    await ui.input({ key: FIELD, text: 'fix login', kind: 'change' })
    expect(await under(ui, 'hdr:human')).toEqual([LOGIN])
    expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 0/4')
    await ui.unmount()
  })

  test(`Enter keeps the filter and shuts the field, the button brings it back and the cross clears it on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await typeFilter(ui, 'fix')

    await ui.input({ key: FIELD, text: 'fix' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, GAMMA])
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find "fix"')

    await ui.press({ key: 'filter' })
    expect((await ui.find({ key: FIELD }))?.props.value).toBe('fix')
    // The button shuts the field again; the filter stays.
    await ui.press({ key: 'filter' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, GAMMA])

    await ui.press({ key: 'filter:clear' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await ui.find({ key: 'filter:clear' })).toBeUndefined()
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find')
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, HIDDEN, BETA, GAMMA])
    // Done is collapsed again: the filter never touched its stored flag.
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 2')
    expect(await textOf(ui, 'hdr:claude')).toBe('▾ Claude 1/1')
    await ui.unmount()
  })

  test(`a section with no match says so and the cross brings the cards back on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await typeFilter(ui, 'zzz')
    expect(await textOf(ui, 'hdr:human')).toBe('▾ Human 0/1')
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 0/2')
    expect(await rowKeys(ui)).not.toContain('note')
    expect(await under(ui, 'hdr:backlog')).toEqual(
      surface === 'vscode' ? [] : ['empty:backlog'],
    )
    if (surface !== 'vscode') {
      expect(await textOf(ui, 'empty:backlog')).toBe('  (no matches)')
    }

    await ui.press({ key: 'filter:clear' })
    expect(await under(ui, 'hdr:human')).toEqual([LOGIN])
    await ui.unmount()
  })

  // #31: a header press under a filter changes what is shown, not the stored flag.
  test(`a header pressed under a filter collapses or opens its section on screen, and clearing the filter gives the stored flags back on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    // Done is collapsed but has a match, so the filter opens it.
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 1/2')
    expect(await under(ui, 'hdr:done')).toEqual([OLDER])

    await click(ui, 'hdr:done')
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 1/2')
    expect(await under(ui, 'hdr:done')).toEqual([])
    // An open section collapses the same way.
    await click(ui, 'hdr:backlog')
    expect(await textOf(ui, 'hdr:backlog')).toBe('▸ Backlog 3/4')
    expect(await under(ui, 'hdr:backlog')).toEqual([])

    // A second press opens the one the filter had opened.
    await click(ui, 'hdr:done')
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 1/2')

    await ui.press({ key: 'filter:clear' })
    // Done is collapsed as stored, Backlog open as stored.
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 2')
    expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 4')
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, HIDDEN, BETA, GAMMA])

    // Without a filter a header press still changes the stored flag.
    await click(ui, 'hdr:done')
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 2')
    await ui.unmount()
  })

  test(`a section collapsed under a filter opens again when the filter text changes on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    await click(ui, 'hdr:done')
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 1/2')

    await typeFilter(ui, 'old')
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 2/2')
    await ui.unmount()
  })
}

test('the filter button and its field are not drawn on mobile, which has no text field', async ($, on) => {
  const { ui } = await start($, on, 'mobile')

  expect(await ui.find({ key: 'filter' })).toBeUndefined()
  expect(await ui.find({ key: FIELD })).toBeUndefined()
  expect(await rowKeys(ui)).toContain(ALPHA)
  await ui.unmount()
})

test('the filter stays through a visit to a card and is not saved', async ($, on) => {
  const { ui, saved } = await start($, on, 'terminal')
  // A term nothing has asks for nothing, so the cards stay.
  await applyFilter(ui, 'fix -label:zq9')

  await click(ui, ALPHA)
  expect((await ui.find({ type: 'Text', text: '#10 Alpha fix' }))?.text).toBe(
    '#10 Alpha fix',
  )
  await ui.press({ key: 'back' })

  expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, GAMMA])
  expect([...saved.values()].some(value => value.includes('zq9'))).toBe(false)
  await ui.unmount()
})

// Seven Human cards and eight Backlog ones: Human's cards come first on the board.
const long = (): Files => {
  const files: Files = {}
  for (let n = 1; n <= 7; n += 1) {
    files[path(n, 'h')] = card(n, { status: 'human', title: `Human ${n}` })
  }
  for (let n = 11; n <= 18; n += 1) {
    files[path(n, 'b')] = card(n, { status: 'backlog', title: `Backlog ${n}` })
  }

  return files
}

for (const surface of WITH_CLIENT) {
  test(`the wheel scrolls the section under it among the rows the filter leaves, and a change of text starts the sections over on the ${surface}`, async ($, on) => {
    const { ui, scrolls } = await start($, on, surface, long())
    const wheel = async (by: number) =>
      $.ui.scroll({
        ...SCROLL,
        by,
        // The toolbar is the first two rows of the tree.
        pointer: {
          column: 3,
          row: (await rowIndex(ui, 'card:md:0013-b')) + TOOLBAR_ROWS,
        },
      })

    // Unfiltered, this row is on Human's card; a scroll there moves Human.
    await typeFilter(ui, 'backlog')
    expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 8/8')
    expect(await textOf(ui, 'hdr:human')).toBe('▾ Human 0/7')
    expect(await textOf(ui, 'more:backlog:down')).toBe('  ↓ 3 more')

    // While the field is open the list sits lower than the layout knows.
    await wheel(1)
    expect(scrolls).toHaveLength(1)
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    await ui.input({ key: FIELD, text: 'backlog' })
    await wheel(2)
    expect(scrolls).toHaveLength(1)
    expect(await textOf(ui, 'more:backlog:up')).toBe('  ↑ 2 more')
    expect(await row(ui, 'more:human:up')).toBeUndefined()
    expect(await row(ui, 'more:human:down')).toBeUndefined()

    // The same text again changes nothing; other text starts every section over.
    await ui.press({ key: 'filter' })
    await ui.input({ key: FIELD, text: 'backlog' })
    expect(await textOf(ui, 'more:backlog:up')).toBe('  ↑ 2 more')
    await ui.press({ key: 'filter' })
    await ui.input({ key: FIELD, text: 'backlog ', kind: 'change' })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()
    expect(await textOf(ui, 'more:backlog:down')).toBe('  ↓ 3 more')

    // And so does clearing it.
    await ui.input({ key: FIELD, text: 'backlog' })
    await wheel(40)
    expect(await textOf(ui, 'more:backlog:up')).toBe('  ↑ 3 more')
    await ui.press({ key: 'filter:clear' })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()
    expect(await textOf(ui, 'more:human:down')).toBe('  ↓ 2 more')
    await ui.unmount()
  })

  test(`the window stops at the last card that matches and follows a card moved past its edge on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, long())
    // Six of Backlog's eight cards, so five show and one is below.
    await applyFilter(ui, '#11 #12 #13 #14 #15 #16')
    expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 6/8')
    expect(await textOf(ui, 'more:backlog:down')).toBe('  ↓ 1 more')

    await $.ui.scroll({
      ...SCROLL,
      by: 40,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:backlog')) + TOOLBAR_ROWS,
      },
    })
    expect(await textOf(ui, 'more:backlog:up')).toBe('  ↑ 1 more')
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    // One back is all the way back: the window never went past the matches.
    await $.ui.scroll({
      ...SCROLL,
      by: -1,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:backlog')) + TOOLBAR_ROWS,
      },
    })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    // The last card in sight goes a place down, past the edge: the window follows.
    await walkTo(ui, 'card:md:0015-b')
    await keys(ui, 'J')
    expect(await textOf(ui, 'more:backlog:up')).toBe('  ↑ 1 more')
    expect(await litRows(ui)).toEqual(['card:md:0015-b'])
    await ui.unmount()
  })

  test(`the wheel scrolls a collapsed section the filter has opened on the ${surface}`, async ($, on) => {
    const files: Files = {}
    for (let n = 1; n <= 7; n += 1) {
      files[path(n, 'o')] = card(n, {
        status: 'done',
        title: `Old ${n}`,
        updated: `2026-10-25T11:0${n}:00Z`,
      })
    }
    const { ui, scrolls } = await start($, on, surface, files)
    expect(await textOf(ui, 'hdr:done')).toBe('▸ Done 7')

    await applyFilter(ui, 'old')
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 7/7')
    expect(await textOf(ui, 'more:done:down')).toBe('  ↓ 3 more')
    await $.ui.scroll({
      ...SCROLL,
      by: 1,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:done')) + TOOLBAR_ROWS + 1,
      },
    })

    expect(scrolls).toHaveLength(0)
    expect(await textOf(ui, 'more:done:up')).toBe('  ↑ 1 more')
    await ui.unmount()
  })
}

for (const surface of WITH_CLIENT) {
  test(`the cursor walks the visible rows and Enter opens the card under it on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await applyFilter(ui, 'fix')

    // The hidden card, the empty row and the collapsed Done's card are never stops.
    const stops: string[] = []
    for (let step = 0; step < 9; step += 1) {
      await keys(ui, 'down')
      stops.push(...(await litRows(ui)))
    }
    expect(stops).toEqual([
      'hdr:human',
      LOGIN,
      'hdr:claude',
      'hdr:backlog',
      ALPHA,
      BETA,
      GAMMA,
      'hdr:done',
      OLDER,
    ])

    await keys(ui, 'up', 'up', 'up')
    expect(await litRows(ui)).toEqual([BETA])
    await keys(ui, 'return')
    expect((await ui.find({ type: 'Text', text: '#12 Beta fix' }))?.text).toBe(
      '#12 Beta fix',
    )
    await ui.press({ key: 'back' })
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, GAMMA])
    await ui.unmount()
  })

  test(`m and a section key move the card under the cursor, not one the filter hides, on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    await walkTo(ui, GAMMA)

    await keys(ui, 'm', 'd')
    await clock.advance(SYNC_PAUSE)

    expect(files[path(13, 'gamma')]).toContain('status: done')
    expect(files[path(11, 'hidden')]).toContain('status: backlog')
    expect(files[path(12, 'beta')]).toContain('status: backlog')
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA])
    expect(await under(ui, 'hdr:done')).toContain(GAMMA)
    await ui.unmount()
  })

  test(`shift-K puts a card above the visible card over it, ahead of the hidden ones, on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    await walkTo(ui, BETA)

    await keys(ui, 'K')
    expect(await under(ui, 'hdr:backlog')).toEqual([BETA, ALPHA, GAMMA])
    expect(await litRows(ui)).toEqual([BETA])
    await clock.advance(SYNC_PAUSE)

    // First of the section; no hidden card is rewritten.
    expect(orderOf(files, 12, 'beta')).toBe(5)
    expect(calls.writes).toEqual([path(12, 'beta')])
    await ui.press({ key: 'filter:clear' })
    expect(await under(ui, 'hdr:backlog')).toEqual([BETA, ALPHA, HIDDEN, GAMMA])
    await ui.unmount()
  })

  test(`shift-J puts a card below the visible card under it, the hidden card staying behind, on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    await walkTo(ui, ALPHA)

    await keys(ui, 'J')
    expect(await under(ui, 'hdr:backlog')).toEqual([BETA, ALPHA, GAMMA])
    await clock.advance(SYNC_PAUSE)

    expect(orderOf(files, 10, 'alpha')).toBe(35)
    expect(calls.writes).toEqual([path(10, 'alpha')])
    await ui.press({ key: 'filter:clear' })
    expect(await under(ui, 'hdr:backlog')).toEqual([HIDDEN, BETA, ALPHA, GAMMA])

    // The last visible card has nowhere to go.
    await applyFilter(ui, 'fix')
    await walkTo(ui, GAMMA)
    await keys(ui, 'J')
    await clock.advance(SYNC_PAUSE)
    expect(calls.writes).toEqual([path(10, 'alpha')])
    await ui.unmount()
  })

  test(`a card dragged on a filtered board lands after the visible card above its place, ahead of hidden cards, on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    await applyFilter(ui, 'fix')

    // Up onto Beta: before it, so after Alpha, which is ahead of the hidden card.
    await drag(ui, GAMMA, BETA)
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, GAMMA, BETA])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 13, 'gamma')).toBe(15)
    expect(calls.writes).toEqual([path(13, 'gamma')])

    // Down onto Beta: after it, past nothing the person cannot see.
    await drag(ui, ALPHA, BETA)
    expect(await under(ui, 'hdr:backlog')).toEqual([GAMMA, BETA, ALPHA])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 10, 'alpha')).toBe(31)

    // On the header: first of the section, ahead of every hidden card.
    await drag(ui, BETA, 'hdr:backlog')
    expect(await under(ui, 'hdr:backlog')).toEqual([BETA, GAMMA, ALPHA])
    await clock.advance(SYNC_PAUSE)
    expect(orderOf(files, 12, 'beta')).toBeLessThan(orderOf(files, 13, 'gamma'))
    expect(calls.writes).toEqual([
      path(13, 'gamma'),
      path(10, 'alpha'),
      path(12, 'beta'),
    ])

    await ui.press({ key: 'filter:clear' })
    expect(await under(ui, 'hdr:backlog')).toEqual([BETA, GAMMA, HIDDEN, ALPHA])
    await ui.unmount()
  })

  test(`a card dragged onto a header of another section moves there from a filtered board on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    await applyFilter(ui, 'fix')

    await drag(ui, BETA, 'hdr:done')
    await clock.advance(SYNC_PAUSE)

    expect(files[path(12, 'beta')]).toContain('status: done')
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, GAMMA])
    expect(await under(ui, 'hdr:done')).toContain(BETA)
    expect(await textOf(ui, 'hdr:done')).toBe('▾ Done 2/3')
    await ui.unmount()
  })
}

test("a card's own view moves it a place in its whole section, whatever the board's filter hides", async ($, on) => {
  const { clock, ui, files } = await start($, on, 'vscode')
  await applyFilter(ui, 'fix')

  await click(ui, BETA)
  await ui.press({ key: 'reorder:up' })
  await clock.advance(SYNC_PAUSE)

  // One place up is above the hidden card, not above Alpha.
  expect(orderOf(files, 12, 'beta')).toBe(15)
  await ui.press({ key: 'back' })
  expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, GAMMA])
  await ui.press({ key: 'filter:clear' })
  expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, BETA, HIDDEN, GAMMA])
  await ui.unmount()
})

const NODES = [
  issueNode({ number: 1, status: 'Backlog', labels: ['ai', 'docs'] }),
  issueNode({ number: 2, status: 'Backlog', labels: ['ai'] }),
  issueNode({ number: 3, status: 'Backlog', labels: ['ai', 'docs'] }),
  issueNode({ number: 4, status: 'Backlog', labels: ['ai', 'docs'] }),
  issueNode({ number: 5, status: 'In progress', labels: ['ai'] }),
]

const POSITION = 'updateProjectV2ItemPosition'

const github = (): Route[] => [
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

test('label filters read the GitHub labels, and a reorder goes after the nearest visible card', async ($, on) => {
  const world = boot(on, { 'CLAUDE.md': KANBAN })
  const commands = fakeProcess(on, github())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await applyFilter(ui, 'label:docs')
  expect(await under(ui, 'hdr:backlog')).toEqual([
    'card:gh:1',
    'card:gh:3',
    'card:gh:4',
  ])
  expect(await textOf(ui, 'hdr:backlog')).toBe('▾ Backlog 3/4')

  await applyFilter(ui, '-label:docs')
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:2'])
  expect(await under(ui, 'hdr:claude')).toEqual(['card:gh:5'])

  await applyFilter(ui, 'label:ai -label:docs @backlog #2')
  expect(await rowKeys(ui)).toContain('card:gh:2')
  expect(await textOf(ui, 'hdr:claude')).toBe('▾ Claude 0/1')

  // Issue 2 is hidden between 1 and 3: issue 4 before issue 3 goes after issue 1.
  await applyFilter(ui, 'label:docs')
  await ui.post({
    type: 'drop',
    cardId: 'gh:4',
    column: 'backlog',
    place: { at: 'before', cardId: 'gh:3' },
  } as never)
  await world.clock.advance(SYNC_PAUSE)
  await world.clock.settle()

  const moves = commands
    .map(command => command.argv)
    .filter(argv => queryOf(argv).includes(POSITION))
  expect(moves).toHaveLength(1)
  expect(moves[0]?.slice(5)).toEqual([
    '-f',
    'projectId=PVT_kwHOAcCsLc4BorgL',
    '-f',
    'itemId=PVTI_4',
    '-f',
    'afterId=PVTI_1',
  ])
  expect(await under(ui, 'hdr:backlog')).toEqual([
    'card:gh:1',
    'card:gh:4',
    'card:gh:3',
  ])
  await ui.press({ key: 'filter:clear' })
  expect(await under(ui, 'hdr:backlog')).toEqual([
    'card:gh:1',
    'card:gh:4',
    'card:gh:2',
    'card:gh:3',
  ])
  await world.clock.advance(2000)
  await ui.unmount()
})

test('a long filter is cut to fit the action row and the status row keeps its text', async ($, on) => {
  const { ui } = await start($, on, 'terminal')
  const query = 'label:ai label:feature -label:human area:UIX words that go on'

  await applyFilter(ui, query)

  const [status, actions] = await toolbar(ui)
  expect(actions).toMatch(
    /^ r: Refresh {3}n: New {3}f: Find "label:ai[^"]*…" ✕$/,
  )
  expect(status).toContain('updated')
  expect(cellWidth(status)).toBeLessThanOrEqual(PANE.props.bodyColumns)
  expect(cellWidth(actions)).toBeLessThanOrEqual(PANE.props.bodyColumns)
  await ui.unmount()
})

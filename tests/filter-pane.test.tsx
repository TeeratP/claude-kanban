import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { cellWidth } from '../hooks/model'
import {
  TOOLBAR_ROWS,
  click,
  group,
  header,
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
  bodyRows: number = PANE.props.scroll.bodyRows,
) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    surface,
    props: { ...PANE.props, scroll: { offset: 0, bodyRows } },
  })

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

// The keys of the rows under a header, up to the next header or group. Only
// where the list is a Client: elsewhere a section header is not a row.
async function under(ui: BoardUi, header: string) {
  const all = await rowKeys(ui)
  const rest = all.slice(all.indexOf(header) + 1)
  const next = rest.findIndex(
    key => key.startsWith('hdr:') || key.startsWith('grp:'),
  )

  return next < 0 ? rest : rest.slice(0, next)
}

// The cards of a section, in the order shown, on any surface: the section is
// told by the status in the card's file.
async function cardsIn(ui: BoardUi, files: Files, column: string) {
  const members = Object.entries(files)
    .filter(([, text]) => text.includes(`\nstatus: ${column}\n`))
    .map(([file]) => `card:md:${file.slice('.kanban/'.length, -'.md'.length)}`)

  return (await rowKeys(ui)).filter(key => members.includes(key))
}

const textOf = async (ui: BoardUi, key: string) => (await row(ui, key))?.text

const orderOf = (files: Files, id: number, slug: string) =>
  Number(/\norder: (\S+)\n/.exec(files[path(id, slug)] ?? '')?.[1])

type Pointer = Mounted<'terminal'>['pointer']

// Drags `from` onto `to`, the pointer moving straight from one to the other
// and ending at column `x` of it.
async function drag(ui: BoardUi, from: string, to: string, x = 3) {
  const { pointer } = ui as unknown as { pointer: Pointer }
  const start = await rowIndex(ui, from)
  const end = await rowIndex(ui, to)

  await pointer({ type: 'down', x: 3, y: start, button: 'left' })
  await pointer({ type: 'move', x, y: end, button: 'left' })
  await pointer({ type: 'up', x, y: end, button: 'left' })
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
    const { ui, files } = await start($, on, surface)
    const button = await ui.find({ key: 'filter' })
    expect(button?.text).toBe('Find')
    expect(button?.props.hotkey).toBe('f')
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await header(ui, 'claude')).toBe('Claude 1')

    await ui.press({ key: 'filter' })
    const field = await ui.find({ key: FIELD })
    expect(field?.type).toBe('Input')
    expect(field?.props.label).toBe('Filter')
    expect(field?.props.placeholder).toBe('words, #12, label:ai, @done')

    await ui.input({ key: FIELD, text: 'fix', kind: 'change' })
    expect((await ui.find({ key: FIELD }))?.props.value).toBe('fix')
    // (Without a Client, an empty row is a Text with no key.)
    expect(await rowKeys(ui)).toEqual([
      'grp:active',
      'hdr:backlog',
      ALPHA,
      BETA,
      GAMMA,
      'hdr:human',
      LOGIN,
      'hdr:claude',
      ...(surface === 'vscode' ? [] : ['empty:claude']),
      'grp:inactive',
    ])
    // Each header counts the cards shown out of all it holds, Claude's too.
    expect(await header(ui, 'human')).toBe('Human 1/1')
    expect(await header(ui, 'claude')).toBe('Claude 0/1')
    expect(await header(ui, 'backlog')).toBe('Backlog 3/4')
    // Inactive is folded, and says how many of its cards match.
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+1 match$/,
    )
    // The text shows in the toolbar's Find button, with a button to clear it.
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find "fix"')
    expect((await ui.find({ key: 'filter:clear' }))?.text).toBe('✕')

    await ui.input({ key: FIELD, text: 'fix login', kind: 'change' })
    expect(await cardsIn(ui, files, 'human')).toEqual([LOGIN])
    expect(await header(ui, 'backlog')).toBe('Backlog 0/4')
    await ui.unmount()
  })

  test(`Enter keeps the filter and shuts the field, the button brings it back and the cross clears it on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    await typeFilter(ui, 'fix')

    await ui.input({ key: FIELD, text: 'fix' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await cardsIn(ui, files, 'backlog')).toEqual([ALPHA, BETA, GAMMA])
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find "fix"')

    await ui.press({ key: 'filter' })
    expect((await ui.find({ key: FIELD }))?.props.value).toBe('fix')
    // The button shuts the field again; the filter stays.
    await ui.press({ key: 'filter' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await cardsIn(ui, files, 'backlog')).toEqual([ALPHA, BETA, GAMMA])

    await ui.press({ key: 'filter:clear' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await ui.find({ key: 'filter:clear' })).toBeUndefined()
    expect((await ui.find({ key: 'filter' }))?.text).toBe('Find')
    expect(await cardsIn(ui, files, 'backlog')).toEqual([
      ALPHA,
      HIDDEN,
      BETA,
      GAMMA,
    ])
    // Inactive is folded again: the filter never touched the stored group.
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+2 Done$/,
    )
    expect(await header(ui, 'claude')).toBe('Claude 1')
    await ui.unmount()
  })

  test(`a section with no match says so and the cross brings the cards back on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)

    await typeFilter(ui, 'zzz')
    expect(await header(ui, 'human')).toBe('Human 0/1')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+no matches$/,
    )
    expect(await rowKeys(ui)).not.toContain('note')
    if (surface !== 'vscode') {
      expect(await under(ui, 'hdr:backlog')).toEqual(['empty:backlog'])
      expect(await textOf(ui, 'empty:backlog')).toMatch(/^ +No matches$/)
    }

    await ui.press({ key: 'filter:clear' })
    expect(await cardsIn(ui, files, 'human')).toEqual([LOGIN])
    await ui.unmount()
  })

  // A group press under a filter changes what is shown, not the stored group.
  test(`a group pressed under a filter turns on screen, and clearing the filter gives the stored group back on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    // Active has matches, so it is the one drawn open; Inactive says what it holds.
    expect((await row(ui, 'grp:active'))?.text).toBe('▾ Active')
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(/1 match$/)

    await group(ui, 'inactive')
    expect(await header(ui, 'done')).toBe('Done 1/2')
    expect(await cardsIn(ui, files, 'done')).toEqual([OLDER])
    expect((await row(ui, 'grp:active'))?.text).toMatch(
      /^▸ Active\s+4 matches$/,
    )

    // Pressing the open group folds both.
    await group(ui, 'inactive')
    expect(await header(ui, 'done')).toBeUndefined()
    expect(await header(ui, 'backlog')).toBeUndefined()
    expect(await rowKeys(ui)).toEqual(
      surface === 'vscode'
        ? ['grp:active', 'grp:inactive']
        : ['grp:active', 'grp:inactive', 'folded'],
    )

    // A second press opens the one the filter had left open.
    await group(ui, 'active')
    expect((await row(ui, 'grp:active'))?.text).toBe('▾ Active')
    expect(await header(ui, 'backlog')).toBe('Backlog 3/4')

    await ui.press({ key: 'filter:clear' })
    // Active is open as stored.
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+2 Done$/,
    )
    expect(await header(ui, 'backlog')).toBe('Backlog 4')
    expect(await cardsIn(ui, files, 'backlog')).toEqual([
      ALPHA,
      HIDDEN,
      BETA,
      GAMMA,
    ])

    // Without a filter a press still changes the stored group.
    await group(ui, 'inactive')
    expect(await header(ui, 'done')).toBe('Done 2')
    expect(await header(ui, 'backlog')).toBeUndefined()
    await ui.unmount()
  })

  test(`a group chosen under a filter is dropped when the filter text changes on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await applyFilter(ui, 'fix')
    await group(ui, 'inactive')
    await group(ui, 'inactive')
    expect(await header(ui, 'done')).toBeUndefined()

    // Only Inactive matches `old`, so it is the one drawn open.
    await typeFilter(ui, 'old')
    expect(await header(ui, 'done')).toBe('Done 2/2')
    expect((await row(ui, 'grp:active'))?.text).toMatch(
      /^▸ Active\s+no matches$/,
    )
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

// Nine Human cards and eight Backlog ones; Backlog comes first on the board.
const long = (): Files => {
  const files: Files = {}
  for (let n = 1; n <= 9; n += 1) {
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

    // Unfiltered, this row is on a card of Backlog; a filter that leaves
    // Human nothing changes what the rows under it are.
    await typeFilter(ui, 'backlog')
    expect(await header(ui, 'backlog')).toBe('Backlog 8/8')
    expect(await header(ui, 'human')).toBe('Human 0/9')
    expect(await textOf(ui, 'more:backlog:down')).toMatch(/^ +↓ 2 more$/)

    // While the field is open the list sits lower than the layout knows.
    await wheel(1)
    expect(scrolls).toHaveLength(1)
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    await ui.input({ key: FIELD, text: 'backlog' })
    await wheel(2)
    expect(scrolls).toHaveLength(1)
    expect(await textOf(ui, 'more:backlog:up')).toMatch(/^ +↑ 2 more$/)
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    expect(await row(ui, 'more:human:up')).toBeUndefined()
    expect(await row(ui, 'more:human:down')).toBeUndefined()

    // The same text again changes nothing; other text starts every section over.
    await ui.press({ key: 'filter' })
    await ui.input({ key: FIELD, text: 'backlog' })
    expect(await textOf(ui, 'more:backlog:up')).toMatch(/^ +↑ 2 more$/)
    await ui.press({ key: 'filter' })
    await ui.input({ key: FIELD, text: 'backlog ', kind: 'change' })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()
    expect(await textOf(ui, 'more:backlog:down')).toMatch(/^ +↓ 2 more$/)

    // And so does clearing it.
    await ui.input({ key: FIELD, text: 'backlog' })
    await wheel(40)
    expect(await textOf(ui, 'more:backlog:up')).toMatch(/^ +↑ 2 more$/)
    await ui.press({ key: 'filter:clear' })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()
    expect(await textOf(ui, 'more:human:down')).toMatch(/^ +↓ 3 more$/)
    await ui.unmount()
  })

  test(`the window stops at the last card that matches and follows a card moved past its edge on the ${surface}`, async ($, on) => {
    // A pane of 22 rows: five rows under each header.
    const { ui } = await start($, on, surface, long(), 22)
    // Six of Backlog's eight cards, so four show and two are below.
    await applyFilter(ui, '#11 #12 #13 #14 #15 #16')
    expect(await header(ui, 'backlog')).toBe('Backlog 6/8')
    expect(await textOf(ui, 'more:backlog:down')).toMatch(/^ +↓ 2 more$/)

    await $.ui.scroll({
      ...SCROLL,
      bodyRows: 22,
      by: 40,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:backlog')) + TOOLBAR_ROWS,
      },
    })
    expect(await textOf(ui, 'more:backlog:up')).toMatch(/^ +↑ 2 more$/)
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    // Two back is all the way back: the window never went past the matches.
    await $.ui.scroll({
      ...SCROLL,
      bodyRows: 22,
      by: -2,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:backlog')) + TOOLBAR_ROWS,
      },
    })
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    // The last card in sight goes a place down, past the edge: the window follows.
    await walkTo(ui, 'card:md:0014-b')
    await keys(ui, 'J')
    expect(await textOf(ui, 'more:backlog:up')).toMatch(/^ +↑ 2 more$/)
    expect(await litRows(ui)).toEqual(['card:md:0014-b'])
    await ui.unmount()
  })

  test(`the wheel scrolls a group the filter has opened on the ${surface}`, async ($, on) => {
    const files: Files = {}
    for (let n = 1; n <= 12; n += 1) {
      files[path(n, 'o')] = card(n, {
        status: 'done',
        title: `Old ${n}`,
        updated: `2026-10-25T11:${String(n).padStart(2, '0')}:00Z`,
      })
    }
    const { ui, scrolls } = await start($, on, surface, files)
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+12 Done$/,
    )

    await applyFilter(ui, 'old')
    // Done lists its ten newest: six show, and four are below.
    expect(await header(ui, 'done')).toBe('Done 12/12')
    expect(await textOf(ui, 'more:done:down')).toMatch(/^ +↓ 4 more$/)
    await $.ui.scroll({
      ...SCROLL,
      by: 1,
      pointer: {
        column: 3,
        row: (await rowIndex(ui, 'hdr:done')) + TOOLBAR_ROWS + 1,
      },
    })

    expect(scrolls).toHaveLength(0)
    expect(await textOf(ui, 'more:done:up')).toMatch(/^ +↑ 1 more$/)
    await ui.unmount()
  })
}

for (const surface of WITH_CLIENT) {
  test(`the cursor walks the visible rows and Enter opens the card under it on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    await applyFilter(ui, 'fix')

    // The hidden card, the empty row, the section headers and the folded
    // group's card are never stops.
    const stops: string[] = []
    for (let step = 0; step < 6; step += 1) {
      await keys(ui, 'down')
      stops.push(...(await litRows(ui)))
    }
    expect(stops).toEqual([
      'grp:active',
      ALPHA,
      BETA,
      GAMMA,
      LOGIN,
      'grp:inactive',
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
    // It joined Done's older match in the folded group, which says so.
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(/2 matches$/)
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

  test(`a card dragged onto a chip of the folded group moves there from a filtered board on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    await applyFilter(ui, 'fix')

    // At 44 columns Done's chip is over cells 10 to 16.
    await drag(ui, BETA, 'grp:inactive', 12)
    await clock.advance(SYNC_PAUSE)

    expect(files[path(12, 'beta')]).toContain('status: done')
    expect(await under(ui, 'hdr:backlog')).toEqual([ALPHA, GAMMA])
    await group(ui, 'inactive')
    expect(await header(ui, 'done')).toBe('Done 2/3')
    expect(await under(ui, 'hdr:done')).toContain(BETA)
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
  expect(await cardsIn(ui, files, 'backlog')).toEqual([ALPHA, BETA, GAMMA])
  await ui.press({ key: 'filter:clear' })
  expect(await cardsIn(ui, files, 'backlog')).toEqual([
    ALPHA,
    BETA,
    HIDDEN,
    GAMMA,
  ])
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
  expect(await header(ui, 'backlog')).toBe('Backlog 3/4')

  await applyFilter(ui, '-label:docs')
  expect(await under(ui, 'hdr:backlog')).toEqual(['card:gh:2'])
  expect(await under(ui, 'hdr:claude')).toEqual(['card:gh:5'])

  await applyFilter(ui, 'label:ai -label:docs @backlog #2')
  expect(await rowKeys(ui)).toContain('card:gh:2')
  expect(await header(ui, 'claude')).toBe('Claude 0/1')

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

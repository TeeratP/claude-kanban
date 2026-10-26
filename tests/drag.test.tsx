import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import {
  TOOLBAR_ROWS,
  click,
  group,
  lineRows,
  row,
  rowIndex,
  rowKeys,
  rowStyle,
} from './board-ui'
import { PANE, RUN, SCROLL, SYNC_PAUSE, boot, card, path } from './fakes'

const WITH_CLIENT = ['terminal', 'desktop'] as const
const WITHOUT_CLIENT = ['vscode', 'mobile'] as const

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
  [path(4, 'old')]: card(4, { status: 'done', title: 'Old thing' }),
})

const DOCS = 'card:md:0003-docs'
const LOGIN = 'card:md:0001-login'

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  files: Record<string, string> = cards(),
) {
  const world = boot(on, files)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, files, ui }
}

// The keys of the rows between two headers.
const between = (keys: string[], from: string, to: string) =>
  keys.slice(keys.indexOf(from) + 1, keys.indexOf(to))

for (const surface of WITH_CLIENT) {
  test(`the ${surface} draws the list through a Client under the toolbar`, async ($, on) => {
    const { ui } = await start($, on, surface)

    expect(await ui.find({ type: 'Client', key: 'board' })).toMatchObject({
      props: { module: 'hooks/board-client.tsx', width: '100%' },
    })
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: LOGIN })).toBeUndefined()
    expect((await row(ui, LOGIN))?.text).toContain('#1 Fix login')
    expect(await rowKeys(ui)).toEqual([
      'grp:active',
      'hdr:backlog',
      DOCS,
      'hdr:human',
      LOGIN,
      'hdr:claude',
      'card:md:0002-api',
      'grp:inactive',
    ])
    await ui.unmount()
  })

  test(`dragging a card onto the Human header moves it on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'hdr:human')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })

    // A header puts the card at the top of its section.
    const keys = await rowKeys(ui)
    expect(between(keys, 'hdr:human', 'hdr:claude')).toEqual([DOCS, LOGIN])
    expect(between(keys, 'hdr:backlog', 'hdr:human')).toEqual(['empty:backlog'])
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })

  test(
    `dropping a Backlog card on Claude asks Claude to work on it, any other drop does not on the ${surface}`,
    { options: { claudeLimit: 0 } },
    async ($, on) => {
      const { clock, ui, prompts } = await start($, on, surface)
      const drop = async (card: string, header: string) => {
        const from = await rowIndex(ui, card)
        const to = await rowIndex(ui, header)
        await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
        await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
        await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })
      }

      await drop(LOGIN, 'hdr:claude')
      await clock.advance(SYNC_PAUSE)
      expect(prompts).toEqual([])

      await drop(DOCS, 'hdr:claude')
      expect(prompts).toEqual([])
      await clock.advance(SYNC_PAUSE)
      expect(prompts).toEqual([
        expect.stringMatching(
          /^Work on kanban card #3 "Write docs": read it with/,
        ),
      ])
      await ui.unmount()
    },
  )

  test(`a drag draws a line where the card would land and dims the card on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const from = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')
    const claude = await rowIndex(ui, 'hdr:claude')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    expect(await lineRows(ui)).toEqual([])

    // The line runs under the header: the card would be first in the section.
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBe(true)
    expect(await lineRows(ui)).toEqual(['hdr:human'])
    expect((await rowStyle(ui, 'hdr:human')).inverse).toBeUndefined()

    await ui.pointer({ type: 'move', x: 3, y: claude, button: 'left' })
    expect(await lineRows(ui)).toEqual(['hdr:claude'])

    await ui.pointer({ type: 'up', x: 3, y: claude, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    expect(await lineRows(ui)).toEqual([])
    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: claude')
    await ui.unmount()
  })

  test(`a drop that leaves the card where it is, or is off the list, moves nothing on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const own = await rowIndex(ui, 'hdr:backlog')
    const api = await rowIndex(ui, 'card:md:0002-api')
    const before = { ...files }

    // Onto its own header (it is already first), off the list either side.
    for (const y of [own, -3, 40]) {
      await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
      await ui.pointer({ type: 'move', x: 3, y, button: 'left' })
      await ui.pointer({ type: 'up', x: 3, y, button: 'left' })
    }
    // Away and back to the row it began on: a cancelled drag, not a click.
    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: api, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: docs, button: 'left' })
    expect(await lineRows(ui)).toEqual([])
    await ui.pointer({ type: 'up', x: 3, y: docs, button: 'left' })

    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    await ui.unmount()
  })

  // At 44 columns the closed Inactive group draws `▸ Inactive` then its chips:
  // Done over cells 10-16, Cancelled 16-27, Suspended 27-38.
  const chipDrop = async (
    ui: Mounted<(typeof WITH_CLIENT)[number], 'Pane'>,
    x: number,
  ) => {
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'grp:inactive')
    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x, y: to, button: 'left' })
    await ui.pointer({ type: 'up', x, y: to, button: 'left' })
  }

  test(`a card dragged onto a chip of the closed Inactive group moves to that section on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    await chipDrop(ui, 30)
    await clock.advance(SYNC_PAUSE)

    expect(files[path(3, 'docs')]).toContain('status: suspended')
    await group(ui, 'inactive')
    expect(await rowKeys(ui)).toContain(DOCS)
    expect(
      between(await rowKeys(ui), 'hdr:suspended', 'hdr:cancelled'),
    ).toEqual([])
    await ui.unmount()
  })

  for (const [x, column] of [
    [12, 'done'],
    [20, 'cancelled'],
    [30, 'suspended'],
  ] as const) {
    test(`the ${column} chip of the closed group sends the card to ${column} on the ${surface}`, async ($, on) => {
      const { clock, ui, files } = await start($, on, surface)

      await chipDrop(ui, x)
      await clock.advance(SYNC_PAUSE)

      expect(files[path(3, 'docs')]).toContain(`status: ${column}`)
      await ui.unmount()
    })
  }

  test(`the chip under the pointer is lit while a card is dragged, and the group shows its label again after on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)
    const chip = async (name: string) =>
      (
        await ui.find({
          type: 'Text',
          in: 'board',
          text: new RegExp(`^ ${name} $`),
        })
      )?.props
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'grp:inactive')

    expect(await chip('Suspended')).toBeUndefined()
    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 30, y: to, button: 'left' })

    expect((await chip('Suspended'))?.inverse).toBe(true)
    expect((await chip('Done'))?.inverse).toBeUndefined()
    await ui.pointer({ type: 'move', x: 12, y: to, button: 'left' })
    expect((await chip('Done'))?.inverse).toBe(true)
    expect((await chip('Suspended'))?.inverse).toBeUndefined()

    await ui.pointer({ type: 'up', x: 12, y: to, button: 'left' })
    expect(await chip('Done')).toBeUndefined()
    await ui.unmount()
  })

  test(`a drop on the label of the closed group, or past its chips, moves nothing on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const before = { ...files }

    await chipDrop(ui, 3)
    await chipDrop(ui, 43)
    await clock.advance(SYNC_PAUSE)

    expect(files).toEqual(before)
    expect(await rowKeys(ui)).toContain(DOCS)
    await ui.unmount()
  })

  test(`the open group's header is no target on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'grp:active')
    const before = { ...files }

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 30, y: to, button: 'left' })
    expect(await lineRows(ui)).toEqual([])
    await ui.pointer({ type: 'up', x: 30, y: to, button: 'left' })

    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    await ui.unmount()
  })

  test(`a card dropped on a blank row of a section goes last in it on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface, {
      ...cards(),
      [path(5, 'more')]: card(5, { status: 'backlog', title: 'More docs' }),
    })
    const from = await rowIndex(ui, LOGIN)
    const to = await rowIndex(ui, 'blank:backlog:3')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
    expect(await lineRows(ui)).toEqual(['card:md:0005-more'])
    await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })

    expect(between(await rowKeys(ui), 'hdr:backlog', 'hdr:human')).toEqual([
      DOCS,
      'card:md:0005-more',
      LOGIN,
    ])
    await clock.advance(SYNC_PAUSE)
    expect(files[path(1, 'login')]).toContain('status: backlog')
    await ui.unmount()
  })

  test(`a drop on a blank row of an empty section puts the card first in it on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface, {
      [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
    })
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'blank:human:3')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
    expect(await lineRows(ui)).toEqual(['hdr:human'])
    await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })

    expect(between(await rowKeys(ui), 'hdr:human', 'hdr:claude')).toEqual([
      DOCS,
    ])
    await ui.unmount()
  })

  test(`a click on a card opens its detail on the ${surface}`, async ($, on) => {
    const { ui } = await start($, on, surface)

    await click(ui, DOCS)

    expect((await ui.find({ type: 'Text', text: '#3 Write docs' }))?.text).toBe(
      '#3 Write docs',
    )
    expect((await ui.find({ key: 'spec' }))?.text).toBe('Spec text.')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await rowKeys(ui)).toContain(DOCS)
    await ui.unmount()
  })

  test(`a click on a group header opens it and folds the other, and a click on a more row pages on the ${surface}`, async ($, on) => {
    const files: Record<string, string> = {}
    for (let n = 1; n <= 8; n += 1) {
      files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
    }
    const { ui } = await start($, on, surface, files)

    // Seven rows under the header: six cards and the count of the other two.
    expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 2 more')
    await click(ui, 'more:backlog:down')
    expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 2 more')
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    await click(ui, 'more:backlog:up')
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    expect((await row(ui, 'grp:inactive'))?.text).toMatch(
      /^▸ Inactive\s+empty$/,
    )
    await click(ui, 'grp:inactive')
    expect((await row(ui, 'grp:inactive'))?.text).toBe('▾ Inactive')
    expect((await row(ui, 'grp:active'))?.text).toMatch(
      /^▸ Active\s+8 Backlog$/,
    )
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    await click(ui, 'grp:inactive')
    expect(await row(ui, 'grp:active')).toBeDefined()
    expect((await row(ui, 'grp:inactive'))?.text).toMatch(/^▸ Inactive/)
    await click(ui, 'grp:active')
    expect((await row(ui, 'grp:active'))?.text).toBe('▾ Active')
    expect(await row(ui, 'more:backlog:down')).toBeDefined()
    await ui.unmount()
  })

  test(`only the left button drags or clicks on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')
    const before = { ...files }

    for (const button of ['right', 'middle'] as const) {
      await ui.pointer({ type: 'down', x: 3, y: docs, button })
      await ui.pointer({ type: 'move', x: 3, y: human, button })
      await ui.pointer({ type: 'up', x: 3, y: human, button })
    }
    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'right' })
    await ui.pointer({ type: 'up', x: 3, y: docs, button: 'right' })

    expect(files).toEqual(before)
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    await ui.unmount()
  })

  test(`a hover with no button ends a drag the button left unfinished on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')

    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: human })
    await ui.pointer({ type: 'up', x: 3, y: human, button: 'left' })

    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: backlog')
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    await ui.unmount()
  })

  test(`a refresh that shifts the rows mid-gesture does not redirect it on the ${surface}`, async ($, on) => {
    const { clock, ui, files, calls } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')
    // A card that sorts above Docs in its own section.
    const fresh = () =>
      calls.edit(
        path(5, 'new'),
        card(5, { status: 'backlog', title: 'Fresh', order: 0 }),
      )

    // A click: a card arrives above, so the row under the pointer is another.
    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    fresh()
    await ui.press({ key: 'refresh' })
    await ui.pointer({ type: 'up', x: 3, y: docs, button: 'left' })
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '#5 Fresh' })).toBeUndefined()

    // A drag: the card still moves, found by what it is, not where it was.
    expect(await rowIndex(ui, DOCS)).toBe(docs + 1)
    await ui.pointer({ type: 'down', x: 3, y: docs + 1, button: 'left' })
    calls.edit(path(6, 'newer'), card(6, { status: 'human', title: 'Newer' }))
    await ui.press({ key: 'refresh' })
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: human, button: 'left' })

    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })

  test(`messages that are not the Client's are ignored on the ${surface}`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)
    const before = { ...files }

    await ui.post({ type: 'drop', cardId: 'md:0003-docs', column: 'nowhere' })
    await ui.post({ type: 'drop', column: 'human' })
    await ui.post({ type: 'page', column: 'human', dir: 'sideways' })
    await ui.post({ type: 'explode' })
    await ui.post('open')
    await ui.post(null)

    await clock.advance(SYNC_PAUSE)
    expect(files).toEqual(before)
    expect(await rowKeys(ui)).toContain(DOCS)
    await ui.unmount()
  })

  test(`the wheel over a section still scrolls it with the Client on the ${surface}`, async ($, on) => {
    const files: Record<string, string> = {}
    for (let n = 1; n <= 8; n += 1) {
      files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
    }
    const { ui, scrolls } = await start($, on, surface, files)
    const keys = await rowKeys(ui)
    // The tree's first two rows are the toolbar, the Client's rows follow.
    const pointer = {
      column: 3,
      row: keys.indexOf('card:md:0001-b') + TOOLBAR_ROWS,
    }
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    const result = await $.ui.scroll({ ...SCROLL, by: 1, pointer })

    expect(result).toEqual({})
    expect(scrolls).toHaveLength(0)
    expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')
    expect(await row(ui, 'card:md:0001-b')).toBeUndefined()
    expect(await row(ui, 'card:md:0002-b')).toBeDefined()
    await ui.unmount()
  })
}

for (const surface of WITHOUT_CLIENT) {
  test(`the ${surface} keeps Button rows and no Client`, async ($, on) => {
    const { clock, ui, files } = await start($, on, surface)

    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: LOGIN }))?.text).toContain(
      '#1 Fix login',
    )
    // The section headers are labels here: only the cards and the groups press.
    expect(
      (await ui.findAll({ type: 'Button' })).flatMap(one =>
        one.key !== undefined && /^(grp|card):/.test(one.key) ? [one.key] : [],
      ),
    ).toEqual(['grp:active', DOCS, LOGIN, 'card:md:0002-api', 'grp:inactive'])
    expect(await rowKeys(ui)).toEqual([
      'grp:active',
      'hdr:backlog',
      DOCS,
      'hdr:human',
      LOGIN,
      'hdr:claude',
      'card:md:0002-api',
      'grp:inactive',
    ])

    await click(ui, DOCS)
    expect((await ui.find({ type: 'Text', text: '#3 Write docs' }))?.text).toBe(
      '#3 Write docs',
    )
    await ui.press({ key: 'move:human' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })
}

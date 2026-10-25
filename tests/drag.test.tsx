import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { click, row, rowIndex, rowKeys, rowStyle } from './board-ui'
import { PANE, RUN, SCROLL, boot, card, path } from './fakes'

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
      'hdr:human',
      LOGIN,
      'hdr:claude',
      'card:md:0002-api',
      'hdr:backlog',
      DOCS,
      'hdr:done',
    ])
    await ui.unmount()
  })

  test(`dragging a card onto the Human header moves it on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    const from = await rowIndex(ui, DOCS)
    const to = await rowIndex(ui, 'hdr:human')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })

    expect(files[path(3, 'docs')]).toContain('status: human')
    const keys = await rowKeys(ui)
    expect(between(keys, 'hdr:human', 'hdr:claude')).toEqual([LOGIN, DOCS])
    expect(between(keys, 'hdr:backlog', 'hdr:done')).toEqual(['empty:backlog'])
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    await ui.unmount()
  })

  test(`a drag highlights the header it is over and dims the card on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    const from = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')
    const claude = await rowIndex(ui, 'hdr:claude')

    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()

    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBe(true)
    expect((await rowStyle(ui, 'hdr:human')).inverse).toBe(true)
    expect((await rowStyle(ui, 'hdr:claude')).inverse).toBeUndefined()

    await ui.pointer({ type: 'move', x: 3, y: claude, button: 'left' })
    expect((await rowStyle(ui, 'hdr:human')).inverse).toBeUndefined()
    expect((await rowStyle(ui, 'hdr:claude')).inverse).toBe(true)

    await ui.pointer({ type: 'up', x: 3, y: claude, button: 'left' })
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    expect(files[path(3, 'docs')]).toContain('status: claude')
    await ui.unmount()
  })

  test(`a drop that is not on another section's header moves nothing on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const own = await rowIndex(ui, 'hdr:backlog')
    const api = await rowIndex(ui, 'card:md:0002-api')
    const before = { ...files }

    // Onto its own header, onto another card, off the list either side.
    for (const y of [own, api, -3, 40]) {
      await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
      await ui.pointer({ type: 'move', x: 3, y, button: 'left' })
      await ui.pointer({ type: 'up', x: 3, y, button: 'left' })
    }
    // Away and back to the row it began on: a cancelled drag, not a click.
    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: api, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: docs, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: docs, button: 'left' })

    expect(files).toEqual(before)
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
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

  test(`a click on a header folds it and a click on a more row pages on the ${surface}`, async ($, on) => {
    const files: Record<string, string> = {}
    for (let n = 1; n <= 8; n += 1) {
      files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
    }
    const { ui } = await start($, on, surface, files)

    expect((await row(ui, 'more:backlog:down'))?.text).toBe('  ↓ 3 more')
    await click(ui, 'more:backlog:down')
    expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 3 more')
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
    await click(ui, 'more:backlog:up')
    expect(await row(ui, 'more:backlog:up')).toBeUndefined()

    expect((await row(ui, 'hdr:done'))?.text).toBe('▸ Done 0')
    await click(ui, 'hdr:done')
    expect((await row(ui, 'hdr:done'))?.text).toBe('▾ Done 0')
    await click(ui, 'hdr:backlog')
    expect((await row(ui, 'hdr:backlog'))?.text).toBe('▸ Backlog 8')
    expect(await row(ui, 'more:backlog:down')).toBeUndefined()
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
    const { ui, files } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')

    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: human })
    await ui.pointer({ type: 'up', x: 3, y: human, button: 'left' })

    expect(files[path(3, 'docs')]).toContain('status: backlog')
    expect((await rowStyle(ui, DOCS)).dimColor).toBeUndefined()
    await ui.unmount()
  })

  test(`a refresh that shifts the rows mid-gesture does not redirect it on the ${surface}`, async ($, on) => {
    const { ui, files, calls } = await start($, on, surface)
    const docs = await rowIndex(ui, DOCS)
    const human = await rowIndex(ui, 'hdr:human')
    const fresh = () =>
      calls.edit(path(5, 'new'), card(5, { status: 'human', title: 'Fresh' }))

    // A click: a card arrives above, so the row under the pointer is another.
    await ui.pointer({ type: 'down', x: 3, y: docs, button: 'left' })
    fresh()
    await ui.press({ key: 'refresh' })
    await ui.pointer({ type: 'up', x: 3, y: docs, button: 'left' })
    expect(
      await ui.find({ type: 'Text', text: '#3 Write docs' }),
    ).toBeUndefined()
    expect((await row(ui, 'hdr:backlog'))?.text).toBe('▾ Backlog 1')

    // A drag: the card still moves, found by what it is, not where it was.
    expect(await rowIndex(ui, DOCS)).toBe(docs + 1)
    await ui.pointer({ type: 'down', x: 3, y: docs + 1, button: 'left' })
    calls.edit(path(6, 'newer'), card(6, { status: 'human', title: 'Newer' }))
    await ui.press({ key: 'refresh' })
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: human, button: 'left' })

    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })

  test(`messages that are not the Client's are ignored on the ${surface}`, async ($, on) => {
    const { ui, files } = await start($, on, surface)
    const before = { ...files }

    await ui.post({ type: 'drop', cardId: 'md:0003-docs', column: 'nowhere' })
    await ui.post({ type: 'drop', column: 'human' })
    await ui.post({ type: 'page', column: 'human', dir: 'sideways' })
    await ui.post({ type: 'explode' })
    await ui.post('open')
    await ui.post(null)

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
    // The tree's row 0 is the toolbar, the Client's rows follow.
    const pointer = { column: 3, row: keys.indexOf('card:md:0001-b') + 1 }
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
    const { ui, files } = await start($, on, surface)

    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: LOGIN }))?.text).toContain(
      '#1 Fix login',
    )
    expect(await rowKeys(ui)).toEqual([
      'hdr:human',
      LOGIN,
      'hdr:claude',
      'card:md:0002-api',
      'hdr:backlog',
      DOCS,
      'hdr:done',
    ])

    await click(ui, DOCS)
    expect((await ui.find({ type: 'Text', text: '#3 Write docs' }))?.text).toBe(
      '#3 Write docs',
    )
    await ui.press({ key: 'move:human' })
    expect(files[path(3, 'docs')]).toContain('status: human')
    await ui.unmount()
  })
}

import type { On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { S } from '../hooks/strings'
import { group, row, rowIndex } from './board-ui'
import { PANE, RUN } from './fakes'
import type { FakeCard } from './fake-github'
import { bootGithub, issue } from './fake-github'

// Backlog holds Alpha (the person's), Beta (alice's) and Gamma (nobody's);
// Claude and Human one each; Done one.
const cards = (): FakeCard[] => [
  issue(10, { column: 'backlog', title: 'Alpha fix' }),
  issue(11, { column: 'backlog', title: 'Beta thing', assignees: ['alice'] }),
  issue(12, { column: 'backlog', title: 'Gamma fix', assignees: [] }),
  issue(20, { column: 'claude', title: 'Build API' }),
  issue(30, { column: 'human', title: 'Fix login' }),
  issue(40, { column: 'done', title: 'Old thing' }),
]

const WITH_CLIENT = ['terminal', 'desktop'] as const

// Boots the pane with the clipboard recorded; `isCopied: false` makes it refuse.
async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  issues: FakeCard[] = cards(),
  copies: { isCopied: boolean } = { isCopied: true },
) {
  const world = bootGithub(on, issues)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    if (copies.isCopied) copied.push(e.text)

    return {
      value: copies.isCopied
        ? { isCopied: true as const }
        : { isCopied: false as const, reason: 'no-clipboard' as const },
    }
  })
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  return { ...world, ui, copied }
}

type Pointed = Pick<
  Mounted<'terminal'>,
  'find' | 'findAll' | 'press' | 'drawn' | 'pointer'
>

// A click on a row at a column, as the Client sees it.
async function clickAt(ui: Pointed, key: string, x: number) {
  const y = await rowIndex(ui, key)
  await ui.pointer({ type: 'down', x, y, button: 'left' })
  await ui.pointer({ type: 'up', x, y, button: 'left' })
}

const RIGHT = PANE.props.bodyColumns - 2

for (const surface of WITH_CLIENT) {
  test(`[copy] on an active header copies the cards that section shows, one per line, on the ${surface}`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface)

    expect((await row(ui, 'hdr:backlog'))?.text).toMatch(/ \[copy\]$/)
    // The pane opens on Mine + open: Alpha and Gamma, not alice's Beta.
    await clickAt(ui, 'hdr:backlog', RIGHT)

    expect(copied).toEqual(['#10 Alpha fix\n#12 Gamma fix'])
    expect(toasts).toEqual([S.copied(2)])
    await ui.unmount()
  })

  test(`a header’s [copy] follows the view and the filter, and copies the whole list, not just the window on the ${surface}`, async ($, on) => {
    const many = Array.from({ length: 9 }, (_, i) =>
      issue(i + 1, { column: 'backlog', title: `Item ${i + 1}` }),
    )
    const { ui, copied } = await start($, on, surface, [
      ...many,
      issue(50, { column: 'backlog', title: 'Theirs', assignees: ['alice'] }),
    ])

    // The section shows six; all nine of the person's are copied, not alice's.
    expect(await row(ui, 'card:gh:9')).toBeUndefined()
    await clickAt(ui, 'hdr:backlog', RIGHT)
    expect(copied.at(-1)?.split('\n')).toEqual(
      many.map(one => `#${one.number} ${one.title}`),
    )

    await ui.press({ key: 'who' })
    await clickAt(ui, 'hdr:backlog', RIGHT)
    expect(copied.at(-1)?.split('\n')).toHaveLength(10)

    await ui.press({ key: 'filter' })
    await ui.input({ key: 'filter:text', text: 'Item 3' })
    await clickAt(ui, 'hdr:backlog', RIGHT)
    expect(copied.at(-1)).toBe('#3 Item 3')
    await ui.unmount()
  })

  test(`an empty section copies nothing and says so on the ${surface}`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface, [
      issue(10, { column: 'backlog', title: 'Alpha fix' }),
    ])

    await clickAt(ui, 'hdr:human', RIGHT)

    expect(copied).toEqual([])
    expect(toasts).toEqual([S.copyNone])
    await ui.unmount()
  })

  test(`a card under the pointer shows [copy] in place of its meta, and a click on it copies #N Title on the ${surface}`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface)
    const y = await rowIndex(ui, 'card:gh:10')

    expect((await row(ui, 'card:gh:10'))?.text).not.toContain('[copy]')
    await ui.pointer({ type: 'move', x: 5, y })
    expect((await row(ui, 'card:gh:10'))?.text).toMatch(/Alpha fix +\[copy\]$/)
    await ui.pointer({
      type: 'move',
      x: 5,
      y: await rowIndex(ui, 'card:gh:12'),
    })
    expect((await row(ui, 'card:gh:10'))?.text).not.toContain('[copy]')

    await clickAt(ui, 'card:gh:10', RIGHT)

    expect(copied).toEqual(['#10 Alpha fix'])
    expect(toasts).toEqual([S.copied(1)])
    // Copying did not open the card.
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a click elsewhere on a card still opens it, and copies nothing on the ${surface}`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface)

    await clickAt(ui, 'card:gh:10', 6)

    expect(await ui.find({ key: 'back' })).toBeDefined()
    expect(copied).toEqual([])
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  test(`inactive sections have no [copy], and a click at their right edge copies nothing on the ${surface}`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface)
    await group(ui, 'inactive')
    const y = await rowIndex(ui, 'card:gh:40')

    expect((await row(ui, 'hdr:done'))?.text).not.toContain('[copy]')
    await ui.pointer({ type: 'move', x: 5, y })
    expect((await row(ui, 'card:gh:40'))?.text).not.toContain('[copy]')
    await clickAt(ui, 'hdr:done', RIGHT)
    await ui.pointer({ type: 'move', x: 5, y: 0 })
    expect(copied).toEqual([])
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  test(`a clipboard that refuses is reported on the ${surface}`, async ($, on) => {
    const { ui, toasts } = await start($, on, surface, cards(), {
      isCopied: false,
    })

    await clickAt(ui, 'hdr:claude', RIGHT)

    expect(toasts).toEqual([S.copyFailed('no-clipboard')])
    await ui.unmount()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`pressing an active header copies its section on the ${surface}, where there is no Client`, async ($, on) => {
    const { ui, copied, toasts } = await start($, on, surface)

    await ui.press({ key: 'hdr:backlog' })

    expect(copied).toEqual(['#10 Alpha fix\n#12 Gamma fix'])
    expect(toasts).toEqual([S.copied(2)])
    await ui.unmount()
  })
}

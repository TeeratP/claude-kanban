import type { Mounted } from 'claude-code/testing'

// The board's list rows are a Client's Text on the terminal and the desktop and
// Buttons elsewhere. These reach a row by its key (`hdr:human`, `card:<id>`,
// `more:<column>:<dir>`) on either, so a test body can run on every surface.

/** What the helpers use of a mounted Pane; any surface's handle fits. */
export type BoardUi = Pick<Mounted, 'find' | 'findAll' | 'press' | 'drawn'>

const CLIENT = 'board'

/** Whether the board's list is drawn by the Client. */
export async function hasClient(ui: BoardUi): Promise<boolean> {
  return (await ui.find({ type: 'Client', key: CLIENT })) !== undefined
}

/** A list row by key, drawn as a Button or by the Client. */
export async function row(ui: BoardUi, key: string) {
  return (await hasClient(ui))
    ? ui.find({ key, in: CLIENT })
    : ui.find({ type: 'Button', key })
}

/** The props a row's text is drawn with (a Client row's Text, a Button's own). */
export async function rowStyle(
  ui: BoardUi,
  key: string,
): Promise<Record<string, unknown>> {
  const found = await row(ui, key)
  const inner = (await hasClient(ui)) ? found?.children[0] : found

  return typeof inner === 'object' && inner !== null && 'props' in inner
    ? (inner.props as Record<string, unknown>)
    : {}
}

/**
 * The Texts that are exactly a sync mark (`⟳`, `✓`, `✕`) in the list, drawn by
 * the Client or as Buttons. A mark the Client draws carries only the style it
 * needs: a bright one has no `dimColor`.
 */
export async function marks(ui: BoardUi, mark: string) {
  const text = new RegExp(`^${mark}$`)

  return (await hasClient(ui))
    ? ui.findAll({ type: 'Text', text, in: CLIENT })
    : ui.findAll({ type: 'Text', text })
}

const ROW_KEY = /^(hdr|card|more|empty|note)\b/

/** The list rows, top to bottom: the Client's keyed Boxes, or the Buttons. */
export async function listRows(ui: BoardUi) {
  const found = (await hasClient(ui))
    ? await ui.findAll({ in: CLIENT })
    : await ui.findAll({ type: 'Button' })

  return found.filter(one => one.key !== undefined && ROW_KEY.test(one.key))
}

/** The keys of the list rows, top to bottom. */
export async function rowKeys(ui: BoardUi): Promise<string[]> {
  return (await listRows(ui)).flatMap(one =>
    one.key === undefined ? [] : [one.key],
  )
}

/** The Client's row index of a key; its y in the Client's region. */
export async function rowIndex(ui: BoardUi, key: string): Promise<number> {
  const keys = await rowKeys(ui)
  const index = keys.indexOf(key)
  if (index < 0) throw new Error(`no board row keyed ${key}`)

  return index
}

type Pointer = Mounted<'terminal'>['pointer']

/** Presses a row: a Button press, or a click (down and up on the row) on the Client. */
export async function click(ui: BoardUi, key: string): Promise<void> {
  if (!(await hasClient(ui))) {
    await ui.press({ key })

    return
  }

  const pointer = (ui as unknown as { pointer: Pointer }).pointer
  const y = await rowIndex(ui, key)
  await pointer({ type: 'down', x: 2, y, button: 'left' })
  await pointer({ type: 'up', x: 2, y, button: 'left' })
}

type Key = Mounted<'terminal'>['key']

/** Sends keys to the Client, one after another, as a person typing them does. */
export async function keys(ui: BoardUi, ...names: string[]): Promise<void> {
  const send = (ui as unknown as { key: Key }).key
  for (const key of names) await send({ key })
}

/** The keys of the list rows drawn inverse: the cursor, or a drag's target. */
export async function litRows(ui: BoardUi): Promise<string[]> {
  const lit: string[] = []
  for (const key of await rowKeys(ui)) {
    if ((await rowStyle(ui, key)).inverse === true) lit.push(key)
  }

  return lit
}

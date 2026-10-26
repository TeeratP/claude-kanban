import type { Mounted } from 'claude-code/testing'

// The board's list rows are a Client's Text on the terminal and the desktop and
// Buttons elsewhere. These reach a row by its key (`hdr:human`, `card:<id>`,
// `more:<column>:<dir>`) on either, so a test body can run on every surface.

/** What the helpers use of a mounted Pane; any surface's handle fits. */
export type BoardUi = Pick<Mounted, 'find' | 'findAll' | 'press' | 'drawn'>

const CLIENT = 'board'

/** Rows the toolbar takes at the top of the pane's tree: the status, then the actions. */
export const TOOLBAR_ROWS = 2

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

const ROW_KEY = /^(hdr|card|act|more|empty|note|hint)\b/

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

/** The keys of the list rows with the insertion line under them: where a drag would drop. */
export async function lineRows(ui: BoardUi): Promise<string[]> {
  const lined: string[] = []
  for (const key of await rowKeys(ui)) {
    if ((await rowStyle(ui, key)).underline === true) lined.push(key)
  }

  return lined
}

type Drawn = {
  type?: string
  props?: Record<string, unknown>
  children?: unknown[]
}

// One drawn element as plain text. The engine draws a plain Button with a hotkey
// as `<hotkey>: <label>`, and without one as its label alone.
function plainText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return String(node ?? '')

  const { type, props, children } = node as Drawn
  const inner = (children ?? []).map(plainText).join('')
  if (type !== 'Button') return inner

  const label = children === undefined ? String(props?.label ?? '') : inner
  const hotkey = props?.hotkey

  return props?.plain === true && typeof hotkey === 'string'
    ? `${hotkey}: ${label}`
    : label
}

async function treeChildren(ui: BoardUi): Promise<unknown[]> {
  return ((await ui.drawn()) as Drawn).children ?? []
}

/** The first `count` rows of the pane's tree as plain text, as a terminal shows them. */
export async function treeText(ui: BoardUi, count: number): Promise<string[]> {
  return (await treeChildren(ui)).slice(0, count).map(plainText)
}

/** The toolbar: its status row, then its action row. */
export async function toolbar(ui: BoardUi): Promise<[string, string]> {
  const [status = '', actions = ''] = await treeText(ui, TOOLBAR_ROWS)

  return [status, actions]
}

// The first key found in an element or below it.
function firstKey(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined

  const { props, children } = node as Drawn
  if (typeof props?.key === 'string') return props.key

  for (const child of children ?? []) {
    const key = firstKey(child)
    if (key !== undefined) return key
  }

  return undefined
}

/** What each of the pane's top-level rows is: the first key in it, or else its type. */
export async function treeKinds(ui: BoardUi): Promise<string[]> {
  return (await treeChildren(ui)).map(
    node => firstKey(node) ?? String((node as Drawn).type),
  )
}

import type { Mounted } from 'claude-code/testing'

// The board's list rows are a Client's Text on the terminal and the desktop and
// Buttons elsewhere. These reach a row by its key (`grp:inactive`, `hdr:human`,
// `card:<id>`, `more:<column>:<dir>`) on either, so a test body can run on every
// surface. The section headers (`hdr:`) are labels: Texts where the list is not
// a Client's, and never Buttons.

/** What the helpers use of a mounted Pane; any surface's handle fits. */
export type BoardUi = Pick<Mounted, 'find' | 'findAll' | 'press' | 'drawn'>

const CLIENT = 'board'

/** Rows the toolbar takes at the top of the pane's tree: the status, then the actions. */
export const TOOLBAR_ROWS = 2

/** Whether the board's list is drawn by the Client. */
export async function hasClient(ui: BoardUi): Promise<boolean> {
  return (await ui.find({ type: 'Client', key: CLIENT })) !== undefined
}

/** A list row by key, drawn as a Button or by the Client; a section header, a Text, by its label. */
export async function row(ui: BoardUi, key: string) {
  if (await hasClient(ui)) return ui.find({ key, in: CLIENT })
  if (!key.startsWith('hdr:')) return ui.find({ type: 'Button', key })

  const column = key.slice('hdr:'.length)
  const label = column.charAt(0).toUpperCase() + column.slice(1)

  return ui.find({ type: 'Text', text: new RegExp(`^ {2}${label} \\S`) })
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

const ROW_KEY =
  /^(grp|hdr|card|act|more|empty|skeleton|blank|legend|folded|note|hint)\b/

/** The list rows, top to bottom: the Client's keyed Boxes, or the Buttons. */
export async function listRows(ui: BoardUi) {
  const found = (await hasClient(ui))
    ? await ui.findAll({ in: CLIENT })
    : await ui.findAll({ type: 'Button' })

  return found.filter(one => one.key !== undefined && ROW_KEY.test(one.key))
}

const FILLER = /^(blank|skeleton|legend)\b/
const HEADER_TEXT = /^ {2}(Backlog|Human|Claude|Done|Cancelled|Suspended) \S/

// The keys of the rows below a drawn element, in order: a Button's own key, and a
// section header's `hdr:` key, which a Text draws without.
function drawnKeys(node: unknown, found: string[]): string[] {
  if (typeof node !== 'object' || node === null) return found

  const { type, props, children } = node as Drawn
  const key = props?.key
  if (typeof key === 'string' && ROW_KEY.test(key)) {
    found.push(key)
  } else if (type === 'Text') {
    const label = HEADER_TEXT.exec(plainText(node))?.[1]
    if (label !== undefined) found.push(`hdr:${label.toLowerCase()}`)
  } else {
    for (const child of children ?? []) drawnKeys(child, found)
  }

  return found
}

/** The keys of the list rows, top to bottom, without the blank filler, the loading bars and the legend that only keep heights. */
export async function rowKeys(ui: BoardUi): Promise<string[]> {
  const found = (await hasClient(ui))
    ? (await listRows(ui)).flatMap(one =>
        one.key === undefined ? [] : [one.key],
      )
    : drawnKeys(await ui.drawn(), [])

  return found.filter(key => !FILLER.test(key))
}

/** The keys of the rows under a section's header, up to the next header or group row. */
export async function under(ui: BoardUi, header: string): Promise<string[]> {
  const found = await rowKeys(ui)
  if (!found.includes(header)) throw new Error(`no board row keyed ${header}`)

  const rest = found.slice(found.indexOf(header) + 1)
  const end = rest.findIndex(key => /^(hdr|grp):/.test(key))

  return end < 0 ? rest : rest.slice(0, end)
}

/** The Client's row index of a key; its y in the Client's region, filler rows counted. */
export async function rowIndex(ui: BoardUi, key: string): Promise<number> {
  const keys = (await listRows(ui)).map(one => one.key)
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

/**
 * A section header's label and count (`Human 2`), without its rule and meta;
 * undefined when its group is folded.
 */
export async function header(
  ui: BoardUi,
  column: string,
): Promise<string | undefined> {
  const found = await row(ui, `hdr:${column}`)

  return found?.text.replace(/\s+─.*$/, '').trim()
}

/** Presses a group's header: opens it, which folds the other, or folds it when open. */
export const group = (ui: BoardUi, name: 'active' | 'inactive') =>
  click(ui, `grp:${name}`)

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

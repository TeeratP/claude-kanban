import type { KanbanWho } from '../types'
import { cellWidth, oneLine, truncate } from './model'
import { S } from './strings'

/** A button on the toolbar's action row. */
export type Action = {
  key: 'refresh' | 'add' | 'filter' | 'filter:clear' | 'who' | 'retry-all'
  /** The hotkey, which the engine draws before the label as `n: `. */
  hotkey?: string
  label: string
}

/** The key that steps through whose cards the board shows; not one the board's Client takes. */
export const WHO_KEY = 'v'

/** An action with the cells of space the row puts before it. */
export type PlacedAction = Action & { before: number }

export type ActionsInput = {
  columns: number
  /** Whether the surface has a text field: New and Find need one. */
  canType: boolean
  /** The filter text; blank when there is no filter. */
  query: string
  /** How many moves failed. */
  failed: number
  /** Whose cards the board shows. */
  who: KanbanWho
}

// Cells before the first button, and between two buttons.
type Spacing = { indent: number; gap: number }

const WIDE: Spacing = { indent: 1, gap: 3 }
const TIGHT: Spacing = { indent: 0, gap: 1 }

// What gives way when even the tight spacing does not fit: Refresh first (the
// board refreshes itself), then New, then the view's name goes short, then the
// view's button. The filter and the retry stay, as they say what the board
// leaves out or what is wrong with it.
type Drop = { keys: Action['key'][]; isWhoShort?: true }

const NARROWEST: Drop = { keys: ['refresh', 'add', 'who'], isWhoShort: true }
const DROPS: Drop[] = [
  { keys: [] },
  { keys: ['refresh'] },
  { keys: ['refresh', 'add'] },
  { keys: ['refresh', 'add'], isWhoShort: true },
  NARROWEST,
]

const widthOf = (action: Action) =>
  (action.hotkey === undefined ? 0 : cellWidth(action.hotkey) + 2) +
  cellWidth(action.label)

// A clear cross sits one cell after its filter button; the rest are `gap` apart.
const place = (actions: Action[], { indent, gap }: Spacing): PlacedAction[] =>
  actions.map((action, at) => ({
    ...action,
    before: at === 0 ? indent : action.key === 'filter:clear' ? 1 : gap,
  }))

const rowWidth = (placed: PlacedAction[]) =>
  placed.reduce((sum, one) => sum + one.before + widthOf(one), 0)

// The buttons that remain, with the filter text (cut already) inside Find.
function actionsFor(
  { canType, query, failed, who }: ActionsInput,
  dropped: Drop,
  shown: string,
): Action[] {
  const all: Action[] = [{ key: 'refresh', hotkey: 'r', label: S.refresh }]
  if (canType) all.push({ key: 'add', hotkey: 'n', label: S.add })
  // Before Find, so no hotkey follows the filter's cross and reads as its own.
  all.push({
    key: 'who',
    hotkey: WHO_KEY,
    label: dropped.isWhoShort === true ? S.whoShort[who] : S.who[who],
  })
  if (canType) {
    all.push({
      key: 'filter',
      hotkey: 'f',
      label: shown === '' ? S.filter : S.filterQuery(shown),
    })
  }
  if (oneLine(query) !== '')
    all.push({ key: 'filter:clear', label: S.filterClear })
  if (failed > 0) all.push({ key: 'retry-all', label: S.retryAll(failed) })

  return all.filter(action => !dropped.keys.includes(action.key))
}

// What gives way so the filter's text can show: the spacing, then Refresh.
const FOR_TEXT: Drop[] = [{ keys: [] }, { keys: ['refresh'] }]

/**
 * The action row for a pane `columns` wide: Refresh and New, whose cards
 * show, Find with the filter text and a cross to clear it, and `✕N retry`.
 * While a filter is on its text shows if the spacing tightening and Refresh
 * giving way make room for it. Otherwise what does not fit gives way in this
 * order: the filter text, the spacing, Refresh, New, the view's long name, the
 * view's button.
 */
export function planActions(input: ActionsInput): PlacedAction[] {
  const text = oneLine(input.query)
  // The row with `dropped` gone at `spacing`, the text cut to the room left;
  // undefined when the row does not fit.
  const tryRow = (dropped: Drop, spacing: Spacing) => {
    const width = rowWidth(place(actionsFor(input, dropped, ''), spacing))
    if (width > input.columns) return undefined

    // The text takes what is left, inside its quotes; a cut that shows
    // nothing but an ellipsis is left out.
    const room = input.columns - width - cellWidth(' ""')
    const shown =
      room >= 2 || cellWidth(text) <= room ? truncate(text, room) : ''

    return { shown, row: place(actionsFor(input, dropped, shown), spacing) }
  }

  if (text !== '') {
    for (const dropped of FOR_TEXT) {
      for (const spacing of [WIDE, TIGHT]) {
        const tried = tryRow(dropped, spacing)
        if (tried !== undefined && tried.shown !== '') return tried.row
      }
    }
  }
  for (const dropped of DROPS) {
    for (const spacing of [WIDE, TIGHT]) {
      const tried = tryRow(dropped, spacing)
      if (tried !== undefined) return tried.row
    }
  }

  return place(actionsFor(input, NARROWEST, ''), TIGHT)
}

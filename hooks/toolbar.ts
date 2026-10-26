import { cellWidth, oneLine, truncate } from './model'
import { S } from './strings'

/** A button on the toolbar's action row. */
export type Action = {
  key: 'refresh' | 'add' | 'filter' | 'filter:clear' | 'retry-all' | 'settings'
  /** The hotkey, which the engine draws before the label as `n: `. */
  hotkey?: string
  label: string
}

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
}

// Cells before the first button, and between two buttons.
type Spacing = { indent: number; gap: number }

const WIDE: Spacing = { indent: 1, gap: 3 }
const TIGHT: Spacing = { indent: 0, gap: 1 }

// What gives way when even the tight spacing does not fit: Refresh first (the
// board refreshes itself), then New, then Settings. The filter and the retry
// stay, as they say what is wrong with the board.
const DROPS: Action['key'][][] = [
  [],
  ['refresh'],
  ['refresh', 'add'],
  ['refresh', 'add', 'settings'],
]
const NARROWEST = DROPS[DROPS.length - 1] ?? []

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
  { canType, query, failed }: ActionsInput,
  dropped: Action['key'][],
  shown: string,
): Action[] {
  const all: Action[] = [{ key: 'refresh', hotkey: 'r', label: S.refresh }]
  if (canType) {
    all.push(
      { key: 'add', hotkey: 'n', label: S.add },
      {
        key: 'filter',
        hotkey: 'f',
        label: shown === '' ? S.filter : S.filterQuery(shown),
      },
    )
  }
  if (oneLine(query) !== '')
    all.push({ key: 'filter:clear', label: S.filterClear })
  all.push({ key: 'settings', hotkey: 's', label: S.settings })
  if (failed > 0) all.push({ key: 'retry-all', label: S.retryAll(failed) })

  return all.filter(action => !dropped.includes(action.key))
}

/**
 * The action row for a pane `columns` wide: Refresh, New and Find with their
 * hotkeys, the filter text and a cross to clear it, Settings, and `✕N retry`.
 * What does not fit gives way in this order: the filter text, the spacing,
 * Refresh, New, Settings.
 */
export function planActions(input: ActionsInput): PlacedAction[] {
  const text = oneLine(input.query)

  for (const dropped of DROPS) {
    for (const spacing of [WIDE, TIGHT]) {
      const width = rowWidth(place(actionsFor(input, dropped, ''), spacing))
      if (width > input.columns) continue

      // The text takes what is left, inside its quotes; a cut that shows
      // nothing but an ellipsis is left out.
      const room = input.columns - width - cellWidth(' ""')
      const shown =
        room >= 2 || cellWidth(text) <= room ? truncate(text, room) : ''

      return place(actionsFor(input, dropped, shown), spacing)
    }
  }

  return place(actionsFor(input, NARROWEST, ''), TIGHT)
}

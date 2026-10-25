import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanUi } from '../types'
import { readUi, updateUi } from './atoms'
import { INITIAL_UI } from './model'
import { S } from './strings'

// New text starts every section from its top again.
const withText = (ui: KanbanUi, filter: string): KanbanUi =>
  filter === ui.filter ? ui : { ...ui, filter, offsets: INITIAL_UI.offsets }

/** Shows the filter's text field, or hides it when it is shown; the filter stays. */
export function toggleFilter($: EngineInterface) {
  return updateUi($, ui => ({ ...ui, isFilterOpen: !ui.isFilterOpen }))
}

/** Takes the text as typed, so the board follows it and a redraw does not lose it. */
export function typeInFilter($: EngineInterface, value: string) {
  return updateUi($, ui => (ui.isFilterOpen ? withText(ui, value) : ui))
}

/** Enter: keeps the text as the filter and hides the field, so the board can be walked by key. */
export function submitFilter($: EngineInterface, value: string) {
  return updateUi($, ui =>
    ui.isFilterOpen ? { ...withText(ui, value), isFilterOpen: false } : ui,
  )
}

/** Drops the filter and hides the field. */
export function clearFilter($: EngineInterface) {
  return updateUi($, ui => ({ ...withText(ui, ''), isFilterOpen: false }))
}

/**
 * The filter's text field under the toolbar; nothing while it is hidden or on a
 * surface with no text field (mobile).
 */
export async function renderFilter($: EngineInterface, e: RenderInput<'Pane'>) {
  // The mobile app draws no field yet, though its element table names Input.
  const els = $.ui.resolve(e)
  if (e.surface === 'mobile' || !('Input' in els)) return null

  const ui = await readUi($)
  if (!ui.isFilterOpen) return null

  const { Input } = els

  return (
    <Input
      key="filter:text"
      autoFocus
      label={S.filterLabel}
      placeholder={S.filterPlaceholder}
      submitLabel={S.filterSubmit}
      value={ui.filter}
      onInput={value => typeInFilter($, value)}
      onSubmit={value => submitFilter($, value)}
    />
  )
}

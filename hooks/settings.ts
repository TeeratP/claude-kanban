import type { ConfigRow, EngineInterface } from 'claude-code'

import type { KanbanBoard, KanbanSettingRow } from '../types'
import { readBoard, updateBoard, updateSettings, updateUi } from './atoms'
import { githubDenial } from './backend-config'
import { refresh, setBoard } from './board'
import { errorMessage } from './model'
import { changeBoard } from './pick'
import { S } from './strings'

/** The mod's `userConfig` fields in the order the view lists them. */
export const SETTING_FIELDS = ['backend', 'claudeLimit', 'reconcile'] as const

export type SettingField = (typeof SETTING_FIELDS)[number]

type Value = KanbanSettingRow['value']

/** A setting as the view draws it: its row, named and with the default its title states. */
export type Setting = {
  field: SettingField
  row: KanbanSettingRow
  /** The title without its ` (default: X)`. */
  name: string
  /** The default as the title spells it (`on`, `1`, `auto`); empty when the title has none. */
  fallback: string
}

/** One value a setting takes, as a choice row lists it. */
export type Choice = { text: string; value: Value }

const DEFAULT_SUFFIX = / \(default: (.*)\)$/

// The row key is `<plugin>.<field>`, with the marketplace after the plugin's
// name when it was installed from one.
const ownField = (key: string): SettingField | undefined =>
  SETTING_FIELDS.find(field =>
    new RegExp(`^kanban(@.*)?\\.${field}$`).test(key),
  )

// A row of this mod's whose value the view can show, as the atom keeps it.
function rowOf(row: ConfigRow): KanbanSettingRow[] {
  const { kind, value } = row
  if (ownField(row.key) === undefined) return []
  if (kind !== 'boolean' && kind !== 'choice' && kind !== 'number') return []
  if (
    typeof value !== 'boolean' &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  )
    return []

  return [
    {
      key: row.key,
      label: row.label,
      kind,
      value,
      ...(row.options === undefined ? {} : { options: [...row.options] }),
      isLocked: row.isLocked,
    },
  ]
}

/** The settings to draw, in the order of `SETTING_FIELDS`; a field with no row is left out. */
export function settingsOf(rows: readonly KanbanSettingRow[]): Setting[] {
  return SETTING_FIELDS.flatMap(field => {
    const row = rows.find(one => ownField(one.key) === field)
    if (row === undefined) return []

    const match = DEFAULT_SUFFIX.exec(row.label)

    return [
      {
        field,
        row,
        name: match === null ? row.label : row.label.slice(0, match.index),
        fallback: match?.[1] ?? '',
      },
    ]
  })
}

/** The values a boolean or choice setting takes, in order; none for a number. */
export function optionsOf(setting: Setting): Choice[] {
  const { kind, options } = setting.row
  if (kind === 'boolean') {
    return [
      { text: S.settingOn, value: true },
      { text: S.settingOff, value: false },
    ]
  }

  return kind === 'choice'
    ? (options ?? []).map(text => ({ text, value: text }))
    : []
}

/** How a value reads in the view: `on`/`off` for a boolean, else as it is. */
export function valueText(value: Value): string {
  if (typeof value === 'boolean') return value ? S.settingOn : S.settingOff

  return String(value)
}

/** Whether a value is the one the setting's title names as its default. */
export const isDefault = (setting: Setting, value: Value) =>
  setting.fallback !== '' && valueText(value) === setting.fallback

/** A number one step up or down, not below 0; undefined when that is no change. */
export function stepped(value: number, dir: 1 | -1): number | undefined {
  const next = Math.max(0, Math.floor(value) + dir)

  return next === value ? undefined : next
}

/** Reads the mod's rows from the `/config` menu into the view's state. */
export async function refreshSettings($: EngineInterface): Promise<void> {
  try {
    const rows = (await $.config.list()).flatMap(rowOf)
    await updateSettings($, ({ denied }) => ({ isLoaded: true, rows, denied }))
  } catch (error) {
    const reason = errorMessage(error)
    await updateSettings($, current => ({
      ...current,
      isLoaded: true,
      error: reason,
    }))
  }
}

/** Shows the Settings view and reads the rows it lists. */
export async function openSettings($: EngineInterface): Promise<void> {
  await updateUi($, ui => ({
    ...ui,
    view: { mode: 'settings' },
    carrySince: 0,
  }))
  await updateSettings($, current => ({ ...current, denied: {} }))
  await refreshSettings($)
}

/** Returns to the board. */
export async function closeSettings($: EngineInterface): Promise<void> {
  await updateUi($, ui => ({ ...ui, view: { mode: 'board' } }))
}

/**
 * Reads the rows again if the Settings view is up. A change in /config
 * reloads the plugin, so a view open across it starts from stale values.
 */
export async function resumeSettings($: EngineInterface): Promise<void> {
  const { view } = await updateUi($, ui => ui)
  if (view.mode === 'settings') await refreshSettings($)
}

/**
 * Changes one setting the way /config does, through the engine, which applies
 * the row's checks. A refusal is shown under the row and in a toast; the rows
 * are read again either way.
 */
export async function setSetting(
  $: EngineInterface,
  key: string,
  value: Value,
): Promise<void> {
  let reason: string | undefined
  try {
    // The engine does not run this plugin's own `config.set` hooks for its own
    // `$.config.set`, so the check that /config meets in `guardBackend` is made here.
    if (ownField(key) === 'backend' && value === 'github') {
      reason = await githubDenial($)
    }
    if (reason === undefined) reason = (await $.config.set({ key, value })).deny
  } catch (error) {
    reason = errorMessage(error)
  }

  await updateSettings($, ({ denied: before, ...current }) => {
    const { [key]: _gone, ...denied } = before

    return {
      ...current,
      denied: reason === undefined ? denied : { ...denied, [key]: reason },
    }
  })
  if (reason !== undefined) $.ui.toast(S.settingDenied(reason))
  await refreshSettings($)
}

/** What `Change board` does with the board as it stands; undefined when nothing can be changed. */
export function boardAction(
  board: Pick<KanbanBoard, 'mode' | 'backend' | 'pick'>,
): 'pick' | 'detect' | 'show' | undefined {
  const { backend } = board
  if (backend?.kind === 'github') {
    return backend.isDetected === true ? 'pick' : undefined
  }
  if (backend === null) return board.pick === undefined ? undefined : 'show'

  return board.mode === 'auto' ? 'detect' : undefined
}

/**
 * Opens the board picker when GitHub has several boards linked to the repo, or
 * looks for a board again when `auto` settled for local files. The picker
 * stands on the board, so the view gives way to it.
 */
export async function changeBoardFromSettings(
  $: EngineInterface,
): Promise<void> {
  const action = boardAction(await readBoard($))
  if (action === undefined) return

  if (action === 'pick') await changeBoard($)
  if (action === 'detect') {
    await setBoard($, board => ({ ...board, backend: null }))
    await refresh($)
  }

  const { pick } = await updateBoard($, board => board)
  if (action === 'show' || pick !== undefined) await closeSettings($)
}

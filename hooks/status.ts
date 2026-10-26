import type { KanbanBackendMode } from '../types'
import { cellWidth, truncate } from './model'
import { S } from './strings'

// Under this many columns the status row drops " (auto)" from the backend's name.
const AUTO_SHOWN_FROM = 40

/** The key that opens the Settings view from the board. */
export const SETTINGS_KEY = 's'

/** How the `s: Settings` button reads: whole, or cut to `s: Set…` in a narrow pane. */
export type SettingsForm = 'long' | 'short'

const FORMS: SettingsForm[] = ['long', 'short']

/** The button's label in a form. */
export const settingsLabel = (form: SettingsForm) =>
  form === 'long' ? S.settings : S.settingsShort

/** Cells the button takes drawn as the engine does: the hotkey, a colon, the label. */
export const settingsWidth = (form: SettingsForm) =>
  cellWidth(`${SETTINGS_KEY}: ${settingsLabel(form)}`)

export type StatusInput = {
  columns: number
  mode: KanbanBackendMode
  kind: 'github' | 'local' | undefined
  /** Why a local board has no GitHub behind it; never dropped. */
  note: string | undefined
  /** A detected board's `#2 Name`; empty for none. */
  boardName: string
  /** An error, `loading…`, a pause or the age; empty for none. */
  status: string
  /** Whether `status` is the age (`updated 5m ago`), which gives way when room is short. */
  isAge: boolean
  /** Whether the key hint may follow: a Client takes keys, and there is no error or first load. */
  canHint: boolean
}

export type StatusPlan = {
  text: string
  /** The Settings button's form; absent when the row is too narrow to hold it. */
  settings?: SettingsForm
}

const join = (parts: string[]) =>
  ` ${parts.filter(part => part !== '').join(' · ')}`

// The status in `room` cells. A detected board's name takes what the backend's
// name and the status leave, cut to fit; with too little room left it is left
// out. The key hint shows whole or not at all: a cut hint is noise. `allowBare`
// lets a status that fits only without the backend's name show alone, which a
// note on why the board is local never gives way to. `isCut` says the text had
// to be cut to fit.
function build(
  input: StatusInput,
  room: number,
  isShort: boolean,
  status: string,
  allowBare: boolean,
): { text: string; isCut: boolean } {
  const backendName = S.backendLabel(input.mode, input.kind, isShort)
  const nameRoom = room - (cellWidth(join([`${backendName} · X`, status])) - 1)
  const shownName =
    input.boardName === '' || nameRoom < cellWidth('#00 …')
      ? ''
      : truncate(input.boardName, nameRoom)
  const label =
    input.note !== undefined
      ? `${backendName} · ${input.note}`
      : shownName === ''
        ? backendName
        : `${backendName} · ${shownName}`
  const withHint = join([label, status, S.keyHint])
  const whole = join([label, status])
  const bare = join([status])

  if (input.canHint && cellWidth(withHint) <= room) {
    return { text: withHint, isCut: false }
  }
  if (cellWidth(whole) <= room) return { text: whole, isCut: false }
  if (
    allowBare &&
    input.note === undefined &&
    status !== '' &&
    cellWidth(bare) <= room
  ) {
    return { text: bare, isCut: false }
  }

  return { text: truncate(whole, room), isCut: true }
}

// With the Settings button beside it the status gives way, and the backend's
// name stays: " (auto)" goes first, then the age. What is left is cut.
function fitted(input: StatusInput, room: number): string {
  const tries: [boolean, string][] = [
    ...(input.columns < AUTO_SHOWN_FROM
      ? []
      : [[false, input.status] as [boolean, string]]),
    [true, input.status],
    ...(input.isAge ? [[true, ''] as [boolean, string]] : []),
  ]
  for (const [isShort, status] of tries) {
    const built = build(input, room, isShort, status, false)
    if (!built.isCut) return built.text
  }
  const [isShort, status] = tries[tries.length - 1] ?? [true, input.status]

  return build(input, room, isShort, status, false).text
}

/**
 * The status row's text and the Settings button beside it, right-aligned. The
 * button is `s: Settings` while the backend's name still has room beside it,
 * `s: Set…` when it has not, and left out when even that would push the name
 * out; the status text then fills the row as it does without the button.
 */
export function planStatus(input: StatusInput): StatusPlan {
  const least = cellWidth(join([S.backendLabel(input.mode, input.kind, true)]))

  for (const form of FORMS) {
    const room = input.columns - settingsWidth(form) - 1
    if (room >= least) return { text: fitted(input, room), settings: form }
  }

  return {
    text: build(
      input,
      input.columns,
      input.columns < AUTO_SHOWN_FROM,
      input.status,
      true,
    ).text,
  }
}

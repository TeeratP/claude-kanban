import { cellWidth, truncate } from './model'
import { S } from './strings'

/** The key that opens the Settings view from the board. */
export const SETTINGS_KEY = 's'

/** How the `s: Settings` button reads: whole, or cut to `s: Set…` in a narrow pane. */
export type SettingsForm = 'long' | 'short'

const FORMS: SettingsForm[] = ['long', 'short']

/** The button's label in a form. */
export const settingsLabel = (form: SettingsForm) =>
  form === 'long' ? S.settings : S.settingsShort

/** The button's text as the engine draws it with a hotkey: the key, a colon, the label. */
export const settingsText = (form: SettingsForm) =>
  `${SETTINGS_KEY}: ${settingsLabel(form)}`

/** Cells the button takes. */
export const settingsWidth = (form: SettingsForm) =>
  cellWidth(settingsText(form))

export type StatusInput = {
  columns: number
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
// lets a status that fits only without the backend's name show alone. `isCut`
// says the text had to be cut to fit.
function build(
  input: StatusInput,
  room: number,
  status: string,
  allowBare: boolean,
): { text: string; isCut: boolean } {
  const backendName = S.backendName
  const nameRoom = room - (cellWidth(join([`${backendName} · X`, status])) - 1)
  const shownName =
    input.boardName === '' || nameRoom < cellWidth('#00 …')
      ? ''
      : truncate(input.boardName, nameRoom)
  const label =
    shownName === '' ? backendName : `${backendName} · ${shownName}`
  const withHint = join([label, status, S.keyHint])
  const whole = join([label, status])
  const bare = join([status])

  if (input.canHint && cellWidth(withHint) <= room) {
    return { text: withHint, isCut: false }
  }
  if (cellWidth(whole) <= room) return { text: whole, isCut: false }
  if (allowBare && status !== '' && cellWidth(bare) <= room) {
    return { text: bare, isCut: false }
  }

  return { text: truncate(whole, room), isCut: true }
}

// With the Settings button beside it the status gives way, and the backend's
// name stays: the age goes. What is left is cut.
function fitted(input: StatusInput, room: number): string {
  const tries = [input.status, ...(input.isAge ? [''] : [])]
  for (const status of tries) {
    const built = build(input, room, status, false)
    if (!built.isCut) return built.text
  }

  return build(input, room, tries[tries.length - 1] ?? input.status, false)
    .text
}

/**
 * The status row's text and the Settings button beside it, right-aligned. The
 * button is `s: Settings` while the backend's name still has room beside it,
 * `s: Set…` when it has not, and left out when even that would push the name
 * out; the status text then fills the row as it does without the button.
 */
export function planStatus(input: StatusInput): StatusPlan {
  const least = cellWidth(join([S.backendName]))

  for (const form of FORMS) {
    const room = input.columns - settingsWidth(form) - 1
    if (room >= least) return { text: fitted(input, room), settings: form }
  }

  return { text: build(input, input.columns, input.status, true).text }
}

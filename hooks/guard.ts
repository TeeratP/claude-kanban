import type { EngineInterface } from 'claude-code'

import { isHandoffValid, parseSections } from './handoff'
import { parseCardFile } from './local'
import { isKanbanFile } from './model'
import { S } from './strings'

type WriteInput = { file_path: string; content: string }
type EditInput = {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

async function readIfPresent(
  $: EngineInterface,
  path: string,
): Promise<string | undefined> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : undefined
}

/** Whether the edit puts a card in Human that was not there, without a handoff to show for it. */
function isUnhandedHuman(
  path: string,
  before: string | undefined,
  after: string,
): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const next = parseCardFile(name, after)
  if (next?.card.column !== 'human') return false
  if (
    before !== undefined &&
    parseCardFile(name, before)?.card.column === 'human'
  )
    return false

  return !isHandoffValid(parseSections(next.body).sections)
}

/** Why a Write must not go through, or undefined when it may. */
export async function guardWrite(
  $: EngineInterface,
  e: WriteInput,
): Promise<string | undefined> {
  if (!isKanbanFile(e.file_path)) return undefined

  const before = await readIfPresent($, e.file_path)

  return isUnhandedHuman(e.file_path, before, e.content)
    ? S.useKanbanMove
    : undefined
}

/** Why an Edit must not go through, or undefined when it may. */
export async function guardEdit(
  $: EngineInterface,
  e: EditInput,
): Promise<string | undefined> {
  if (!isKanbanFile(e.file_path)) return undefined

  const before = await readIfPresent($, e.file_path)
  if (before === undefined) return undefined

  const swap = () => e.new_string
  const after =
    e.replace_all === true
      ? before.replaceAll(e.old_string, swap)
      : before.replace(e.old_string, swap)

  return isUnhandedHuman(e.file_path, before, after)
    ? S.useKanbanMove
    : undefined
}

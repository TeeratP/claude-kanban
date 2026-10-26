import type { EngineInterface } from 'claude-code'

import type { KanbanChoice } from '../types'
import { readBoard } from './atoms'
import { refresh, setBoard } from './board'
import {
  boardsFor,
  readOrigin,
  repoOf,
  resolveChoice,
  saveDetected,
} from './detect'
import { EMPTY_BOARD, errorMessage } from './model'
import { S } from './strings'

/** Shows the boards linked to the repo again so the person can switch; says so when there is no other. */
export async function changeBoard($: EngineInterface): Promise<void> {
  try {
    const { backend } = await readBoard($)
    if (backend?.kind !== 'github' || backend.isDetected !== true) return

    const choices = await boardsFor($, backend.repo)
    if (choices.length < 2) {
      $.ui.toast(S.noOtherBoard(backend.repo))

      return
    }
    await setBoard($, board => ({ ...board, pick: choices }))
  } catch (error) {
    $.ui.toast(S.pickFailed(errorMessage(error)))
  }
}

/**
 * Uses the board the person picked: remembers it for this directory and loads
 * it, with nothing carried over from the board before. Only local state
 * changes; nothing is written to GitHub.
 */
export async function chooseBoard(
  $: EngineInterface,
  choice: KanbanChoice,
): Promise<void> {
  try {
    const { backend } = await readBoard($)
    if (backend?.kind === 'github' && backend.projectId === choice.id) {
      await setBoard($, ({ pick: _done, ...board }) => board)

      return
    }

    const origin = await readOrigin($)
    const info = await resolveChoice($, repoOf(origin), choice)
    await saveDetected($, origin, info)
    await setBoard($, board => ({
      ...EMPTY_BOARD,
      mode: board.mode,
      backend: info,
    }))
    await refresh($)
  } catch (error) {
    const reason = S.pickFailed(errorMessage(error))
    $.ui.log(reason, { to: 'debug' })
    $.ui.toast(reason)
  }
}

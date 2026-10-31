import type { EngineInterface } from 'claude-code'

import type { KanbanCard } from '../types'
import { updateSettings } from './atoms'
import { ensureBackend, inBackground, refresh, setBoard } from './board'
import { assignGithub, saveNameGithub } from './github'
import { errorMessage } from './model'
import { cleanName, nameOf } from './people'
import { S } from './strings'

/**
 * Makes the card `login`'s, or nobody's with null. It shows at once; if GitHub
 * refuses, a toast says why and a load puts the card back as GitHub has it.
 */
export async function assignCard(
  $: EngineInterface,
  card: KanbanCard,
  login: string | null,
): Promise<void> {
  await setBoard($, board => ({
    ...board,
    cards: board.cards.map(one =>
      one.id === card.id
        ? { ...one, assignees: login === null ? [] : [login] }
        : one,
    ),
  }))
  try {
    await assignGithub($, await ensureBackend($), card, login)
  } catch (error) {
    $.ui.toast(S.assignFailed(errorMessage(error)))
    inBackground($, refresh($))
  }
}

/**
 * Sets the name the signed-in person goes by, for everyone on the board: an
 * empty one goes back to the login. Closes the name field once saved; a
 * failure stays under it.
 */
export async function saveName(
  $: EngineInterface,
  login: string,
  name: string,
): Promise<void> {
  try {
    const people = await saveNameGithub($, await ensureBackend($), login, name)
    await setBoard($, board => ({ ...board, people }))
    await updateSettings($, ({ nameDraft: _done, nameError: _old, ...rest }) => rest)
    $.ui.toast(
      cleanName(name) === ''
        ? S.nameCleared(login)
        : S.nameSaved(nameOf(people, login)),
    )
  } catch (error) {
    await updateSettings($, current => ({
      ...current,
      nameError: S.nameFailed(errorMessage(error)),
    }))
  }
}

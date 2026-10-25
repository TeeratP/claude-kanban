import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanColumn, KanbanSync } from '../types'
import { updateSync } from './atoms'
import { moveRemote } from './backend'
import { ensureBackend, refresh, setBoard } from './board'
import { errorMessage, maxOrder } from './model'
import { S } from './strings'

export type MoveResult = { ok: true } | { ok: false; error: string }

/** `onConfirm` names the prompt Claude is sent once the backend confirms the move. */
export type MoveOptions = { onConfirm?: 'work' | 'resume' }

/** Prompts Claude to pick the card up; a failure goes to the log, not to the move. */
function submitPrompt(
  $: EngineInterface,
  card: KanbanCard,
  kind: 'work' | 'resume',
) {
  const text =
    kind === 'work'
      ? S.workPrompt(card.number, card.title)
      : S.resumePrompt(card.number)

  $.prompt
    .submit({ text })
    .catch((error: unknown) => $.ui.log(S.promptFailed(errorMessage(error))))
}

/**
 * Moves a card at once on the board, then asks the backend to make it so;
 * a refused move puts the card back and says why.
 */
export async function moveCard(
  $: EngineInterface,
  cardId: string,
  to: KanbanColumn,
  opts: MoveOptions = {},
): Promise<MoveResult> {
  // The card is found inside the write: a read here could be an older moment.
  const seen: { card?: KanbanCard } = {}
  await setBoard($, board => {
    seen.card = board.cards.find(one => one.id === cardId)
    if (seen.card === undefined || seen.card.column === to) return board

    const order = maxOrder(board.cards, to) + 1

    return {
      ...board,
      cards: board.cards.map(one =>
        one.id === cardId ? { ...one, column: to, order } : one,
      ),
    }
  })
  const card = seen.card
  if (card === undefined || card.column === to) return { ok: true }

  const patchCard = (patch: Partial<KanbanCard>) =>
    setBoard($, board => ({
      ...board,
      cards: board.cards.map(one =>
        one.id === cardId ? { ...one, ...patch } : one,
      ),
    }))
  const entry: KanbanSync = {
    cardId,
    from: card.column,
    to,
    phase: 'pending',
    attempts: 1,
    ...(opts.onConfirm === undefined ? {} : { onConfirm: opts.onConfirm }),
  }
  await updateSync($, sync => ({ ...sync, [cardId]: entry }))
  const settle = () => updateSync($, ({ [cardId]: _settled, ...rest }) => rest)

  try {
    const info = await ensureBackend($)
    await patchCard(await moveRemote($, info, card, to))
  } catch (error) {
    const reason = errorMessage(error)
    await patchCard({ column: card.column, order: card.order })
    await settle()
    $.ui.toast(S.moveFailed(card, to, reason))

    return { ok: false, error: reason }
  }

  try {
    await refresh($)
  } finally {
    await settle()
  }
  if (entry.onConfirm !== undefined) submitPrompt($, card, entry.onConfirm)

  return { ok: true }
}

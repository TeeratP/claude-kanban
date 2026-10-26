import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanColumn } from '../types'
import { readBoard } from './atoms'
import type { Place } from './board-client'
import { filterCards } from './filter'
import { sectionList } from './layout'
import { isOrdered, isPendingId } from './model'
import { moveCard, moveOptions } from './sync'

/**
 * The card a drop at `place` goes after, among the section's other cards: null
 * for first, undefined when `place` names a card that is not among them.
 */
export function anchorFor(
  others: readonly KanbanCard[],
  place: Place,
): string | null | undefined {
  if (place.at === 'top') return null

  const at = others.findIndex(one => one.id === place.cardId)
  if (at < 0) return undefined
  if (place.at === 'after') return place.cardId

  return at === 0 ? null : others[at - 1]?.id
}

/**
 * Drops a card into a section, at `place` in it: moves it from another
 * section, or reorders it within its own. Left without a place, or dropped in
 * Done or Cancelled (which list by update time), it goes last. A card still
 * being made is not on the backend: it is not dropped, and no place is taken
 * from it.
 *
 * Under the board's filter `query`, `place` is among the cards the person sees,
 * and the card goes right after the nearest of them above that place (first
 * when none is above), ahead of the hidden cards that followed it.
 */
export async function dropCard(
  $: EngineInterface,
  cardId: string,
  column: KanbanColumn,
  place?: Place,
  query = '',
): Promise<void> {
  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)
  if (card === undefined || isPendingId(cardId)) return
  if (place !== undefined && place.at !== 'top' && isPendingId(place.cardId)) {
    return
  }

  const made = cards.filter(one => !isPendingId(one.id))
  const others = sectionList(filterCards(made, query), column).filter(
    one => one.id !== cardId,
  )
  const after =
    !isOrdered(column) || place === undefined
      ? undefined
      : anchorFor(others, place)

  await moveCard($, cardId, column, {
    ...moveOptions(card.column, column),
    ...(after === undefined ? {} : { after }),
  })
}

/**
 * Moves a card one place up or down in its section. Resolves its section, where
 * it ended up there and how many cards the section holds, or nothing when it
 * cannot move (at the end, in Done or Cancelled, or still being made). Under
 * the board's filter `query` a place is among the cards the person sees: the
 * card passes the visible one next to it, hidden cards in between staying
 * where they are.
 */
export async function shiftCard(
  $: EngineInterface,
  cardId: string,
  dir: 'up' | 'down',
  query = '',
): Promise<
  { column: KanbanColumn; index: number; length: number } | undefined
> {
  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)
  if (card === undefined || !isOrdered(card.column) || isPendingId(cardId)) {
    return undefined
  }

  const list = sectionList(
    filterCards(
      cards.filter(one => !isPendingId(one.id)),
      query,
    ),
    card.column,
  )
  // A card the filter hides has no place to move in.
  const at = list.findIndex(one => one.id === cardId)
  const index = at + (dir === 'up' ? -1 : 1)
  if (at < 0 || index < 0 || index >= list.length) return undefined

  const others = list.filter(one => one.id !== cardId)
  await moveCard($, cardId, card.column, {
    after: index === 0 ? null : (others[index - 1]?.id ?? null),
  })

  return { column: card.column, index, length: list.length }
}

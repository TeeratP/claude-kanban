import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanColumn } from '../types'
import { readBoard } from './atoms'
import type { Place } from './board-client'
import { sectionList } from './layout'
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
 * Done (which lists by update time), it goes last.
 */
export async function dropCard(
  $: EngineInterface,
  cardId: string,
  column: KanbanColumn,
  place?: Place,
): Promise<void> {
  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)
  if (card === undefined) return

  const others = sectionList(cards, column).filter(one => one.id !== cardId)
  const after =
    column === 'done' || place === undefined
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
 * cannot move (at the end, or in Done).
 */
export async function shiftCard(
  $: EngineInterface,
  cardId: string,
  dir: 'up' | 'down',
): Promise<
  { column: KanbanColumn; index: number; length: number } | undefined
> {
  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)
  if (card === undefined || card.column === 'done') return undefined

  const list = sectionList(cards, card.column)
  const index =
    list.findIndex(one => one.id === cardId) + (dir === 'up' ? -1 : 1)
  if (index < 0 || index >= list.length) return undefined

  const others = list.filter(one => one.id !== cardId)
  await moveCard($, cardId, card.column, {
    after: index === 0 ? null : (others[index - 1]?.id ?? null),
  })

  return { column: card.column, index, length: list.length }
}

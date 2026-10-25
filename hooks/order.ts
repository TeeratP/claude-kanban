import type { KanbanCard, KanbanColumn } from '../types'
import { sectionList } from './layout'

/** The order a dropped card takes, and the cards that had to change theirs to make room. */
export type Placement = { order: number; shifted: Record<string, number> }

// How far apart a renumbered section keeps its cards, so later drops fit between.
const STEP = 10

/**
 * Where `cardId` lands in `column` when it goes right after the card `after`
 * (first when null, last when that card is not in the section). It takes an
 * order in the gap between its neighbours; with no gap the section is
 * renumbered in steps of ten and `shifted` holds only the cards whose order
 * changed. Undefined when the card already sits there. An ordered section
 * only: Done lists by update time.
 */
export function placeIn(
  cards: readonly KanbanCard[],
  cardId: string,
  column: KanbanColumn,
  after: string | null,
): Placement | undefined {
  const old = sectionList(cards, column)
  const rest = old.filter(one => one.id !== cardId)
  const found = after === null ? -1 : rest.findIndex(one => one.id === after)
  const at = after === null ? 0 : found < 0 ? rest.length : found + 1

  const ids = [
    ...rest.slice(0, at).map(one => one.id),
    cardId,
    ...rest.slice(at).map(one => one.id),
  ]
  if (ids.length === old.length && old.every((one, i) => one.id === ids[i])) {
    return undefined
  }

  const prev = rest[at - 1]
  const following = rest[at]
  if (following === undefined) {
    return { order: (prev?.order ?? 0) + 1, shifted: {} }
  }

  const low = prev?.order ?? 0
  const middle = Math.floor((low + following.order) / 2)
  if (middle > low && middle < following.order) {
    return { order: middle, shifted: {} }
  }

  const shifted: Record<string, number> = {}
  for (const one of rest) {
    const next = STEP * (ids.indexOf(one.id) + 1)
    if (one.order !== next) shifted[one.id] = next
  }

  return { order: STEP * (at + 1), shifted }
}

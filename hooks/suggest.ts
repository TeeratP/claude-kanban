import type {
  EngineInterface,
  PromptComposeSection,
  PromptComposeTrait,
} from 'claude-code'

import type { KanbanSuggestion } from '../types'
import {
  readDismissed,
  readSuggestions,
  updateDismissed,
  updateSuggestions,
} from './atoms'
import { ensureBoard } from './board'
import { errorMessage, oneLine } from './model'
import { addCard } from './quick-add'
import { S } from './strings'

/** Suggestions the strip lists; the rest are counted in a `+N more` row. */
export const MAX_SHOWN = 3

/** Dismissed suggestions kept per directory; past this the oldest are forgotten. */
export const DISMISSED_MAX = 200

const STORE_SHAPE = 'suggestions-2'
// The shape before the dismissed list; its suggestions are still brought back.
const OLDER_SHAPE = 'suggestions-1'
const SECTION_ID = 'kanban:suggest'

/** Rows the strip takes between the toolbar and the list: each is one terminal row. */
export function stripRows(count: number): number {
  if (count === 0) return 0

  return 1 + Math.min(count, MAX_SHOWN) + (count > MAX_SHOWN ? 1 : 0)
}

/**
 * Rows the dismissed part of the strip takes: a toggle once any are dismissed
 * and, while they are shown, the rows a suggestion list takes.
 */
export function dismissedRows(count: number, isShown: boolean): number {
  return isShown ? stripRows(count) : Math.min(count, 1)
}

/** Rows the whole strip takes between the toolbar and the list. */
export async function readStripRows($: EngineInterface): Promise<number> {
  const { items, isShown } = await readDismissed($)

  return (
    stripRows((await readSuggestions($)).length) +
    dismissedRows(items.length, isShown)
  )
}

/**
 * The system prompt's sections with the one that asks Claude to suggest cards,
 * added once at the end; the one-line `--bare` prompt gets none.
 */
export function withSuggestSection(
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
): readonly PromptComposeSection[] {
  if (traits.includes('bare')) return sections
  if (sections.some(section => section.id === SECTION_ID)) return sections

  return [
    ...sections,
    { id: SECTION_ID, text: S.suggestPrompt, scope: 'session' },
  ]
}

const sameTitle = (a: string, b: string) =>
  oneLine(a).toLowerCase() === oneLine(b).toLowerCase()

const nextId = (list: readonly KanbanSuggestion[]) =>
  list.reduce((max, one) => Math.max(max, one.id), 0) + 1

async function storeKey($: EngineInterface) {
  return `suggestions:${await $.session.cwd()}`
}

// Written after every change, so a suggestion lives until it is handled.
async function save($: EngineInterface, items: readonly KanbanSuggestion[]) {
  try {
    // Taken from an update, as a read made earlier in this dispatch may be stale.
    const { items: dismissed } = await updateDismissed($, current => current)
    await $.store.set(await storeKey($), {
      shape: STORE_SHAPE,
      items,
      dismissed,
    })
  } catch (error) {
    $.ui.log(S.suggestionsNotSaved(errorMessage(error)), { to: 'debug' })
  }
}

function isSuggestion(value: unknown): value is KanbanSuggestion {
  if (typeof value !== 'object' || value === null) return false
  const { id, title, spec, why } = value as Record<string, unknown>

  return (
    typeof id === 'number' &&
    typeof title === 'string' &&
    title !== '' &&
    typeof spec === 'string' &&
    (why === undefined || typeof why === 'string')
  )
}

type Saved = { items: KanbanSuggestion[]; dismissed: KanbanSuggestion[] }

function savedState(value: unknown): Saved {
  const none: Saved = { items: [], dismissed: [] }
  if (typeof value !== 'object' || value === null) return none
  const { shape, items, dismissed } = value as Record<string, unknown>
  if (!Array.isArray(items)) return none

  if (shape === OLDER_SHAPE)
    return { items: items.filter(isSuggestion), dismissed: [] }
  if (shape !== STORE_SHAPE) return none

  return {
    items: items.filter(isSuggestion),
    dismissed: Array.isArray(dismissed)
      ? dismissed.filter(isSuggestion).slice(-DISMISSED_MAX)
      : [],
  }
}

/**
 * Brings back the suggestions and the dismissed ones saved for this directory;
 * any already shown are kept.
 */
export async function restoreSuggestions($: EngineInterface): Promise<void> {
  try {
    const { items, dismissed } = savedState(
      await $.store.get(await storeKey($)),
    )
    if (items.length > 0) {
      await updateSuggestions($, current =>
        current.length === 0 ? items : current,
      )
    }
    if (dismissed.length > 0) {
      await updateDismissed($, current =>
        current.items.length === 0 ? { ...current, items: dismissed } : current,
      )
    }
  } catch (error) {
    $.ui.log(S.suggestionsNotSaved(errorMessage(error)), { to: 'debug' })
  }
}

export type Suggestion = { title: string; spec: string; why: string }

/** What became of a suggestion: shown, folded into one already there, or one the person dismissed. */
export type SuggestOutcome = 'added' | 'folded' | 'dismissed'

/**
 * Adds a suggestion and toasts it once. One whose title is an open card's or
 * another suggestion's (any case) is folded in; one the person dismissed
 * before is turned away. Neither adds anything or toasts.
 */
export async function suggestCard(
  $: EngineInterface,
  input: Suggestion,
): Promise<SuggestOutcome> {
  // A board that cannot be had only means the cards are not compared.
  const { cards } = await ensureBoard($)
  // Suspended counts as open: an idea already on hold is not suggested again.
  const open = cards.filter(
    card => card.column !== 'done' && card.column !== 'cancelled',
  )
  const isOpen = open.some(card => sameTitle(card.title, input.title))
  // Taken from an update, as the person may have dismissed one while the board loaded.
  const { items: dismissed } = await updateDismissed($, current => current)
  const isDismissed = dismissed.some(one => sameTitle(one.title, input.title))

  const seen: { outcome: SuggestOutcome } = { outcome: 'folded' }
  const items = await updateSuggestions($, list => {
    const isListed = list.some(one => sameTitle(one.title, input.title))
    if (isOpen || isListed) {
      seen.outcome = 'folded'
    } else {
      seen.outcome = isDismissed ? 'dismissed' : 'added'
    }
    if (seen.outcome !== 'added') return list

    const { title, spec, why } = input

    return [
      ...list,
      { id: nextId(list), title, spec, ...(why === '' ? {} : { why }) },
    ]
  })
  if (seen.outcome !== 'added') return seen.outcome

  await save($, items)
  $.ui.toast(S.suggested(input.title))

  return 'added'
}

/** Drops a suggestion without adding a card, and remembers it so Claude is not let repeat it. */
export async function dismissSuggestion(
  $: EngineInterface,
  id: number,
): Promise<void> {
  const seen: { found?: KanbanSuggestion } = {}
  const items = await updateSuggestions($, list => {
    delete seen.found
    const found = list.find(one => one.id === id)
    if (found !== undefined) seen.found = found

    return list.filter(one => one.id !== id)
  })
  const found = seen.found
  if (found !== undefined) {
    await updateDismissed($, current => ({
      ...current,
      items: [
        ...current.items.filter(one => !sameTitle(one.title, found.title)),
        { ...found, id: nextId(current.items) },
      ].slice(-DISMISSED_MAX),
    }))
  }
  await save($, items)
}

/** Brings a dismissed suggestion back into the strip, first in line. */
export async function restoreDismissed(
  $: EngineInterface,
  id: number,
): Promise<void> {
  const seen: { found?: KanbanSuggestion } = {}
  await updateDismissed($, current => {
    delete seen.found
    const found = current.items.find(one => one.id === id)
    if (found === undefined) return current

    seen.found = found
    const items = current.items.filter(one => one.id !== id)

    return { items, isShown: current.isShown && items.length > 0 }
  })
  const found = seen.found
  if (found === undefined) return

  const items = await updateSuggestions($, list =>
    list.some(other => sameTitle(other.title, found.title))
      ? list
      : [{ ...found, id: nextId(list) }, ...list],
  )
  await save($, items)
}

/** Shows or hides the dismissed suggestions in the strip. */
export async function toggleDismissed($: EngineInterface): Promise<void> {
  await updateDismissed($, current => ({
    ...current,
    isShown: !current.isShown,
  }))
}

// A suggestion the backend could not make a card of comes back, first in line.
async function putBack($: EngineInterface, one: KanbanSuggestion) {
  const items = await updateSuggestions($, list =>
    list.some(other => sameTitle(other.title, one.title))
      ? list
      : [{ ...one, id: nextId(list) }, ...list],
  )
  await save($, items)
}

/** Turns a suggestion into a Backlog card the way the add form does. */
export async function addSuggestion(
  $: EngineInterface,
  id: number,
): Promise<void> {
  const seen: { found?: KanbanSuggestion } = {}
  const items = await updateSuggestions($, list => {
    delete seen.found
    const found = list.find(one => one.id === id)
    if (found === undefined) return list

    seen.found = found

    return list.filter(one => one.id !== id)
  })
  const found = seen.found
  if (found === undefined) return

  await save($, items)
  const spec = [
    found.spec,
    found.why === undefined ? '' : S.suggestWhy(found.why),
  ]
    .filter(part => part !== '')
    .join('\n\n')
  await addCard($, found.title, spec, () => putBack($, found))
}

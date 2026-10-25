import type {
  EngineInterface,
  PromptComposeSection,
  PromptComposeTrait,
} from 'claude-code'

import type { KanbanSuggestion } from '../types'
import { updateSuggestions } from './atoms'
import { ensureBoard } from './board'
import { errorMessage, oneLine } from './model'
import { addCard } from './quick-add'
import { S } from './strings'

/** Suggestions the strip lists; the rest are counted in a `+N more` row. */
export const MAX_SHOWN = 3

const STORE_SHAPE = 'suggestions-1'
const SECTION_ID = 'kanban:suggest'

/** Rows the strip takes between the toolbar and the list: each is one terminal row. */
export function stripRows(count: number): number {
  if (count === 0) return 0

  return 1 + Math.min(count, MAX_SHOWN) + (count > MAX_SHOWN ? 1 : 0)
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
    await $.store.set(await storeKey($), { shape: STORE_SHAPE, items })
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

function savedItems(value: unknown): KanbanSuggestion[] {
  if (typeof value !== 'object' || value === null) return []
  const { shape, items } = value as Record<string, unknown>

  return shape === STORE_SHAPE && Array.isArray(items)
    ? items.filter(isSuggestion)
    : []
}

/** Brings back the suggestions saved for this directory; any already shown are kept. */
export async function restoreSuggestions($: EngineInterface): Promise<void> {
  try {
    const items = savedItems(await $.store.get(await storeKey($)))
    if (items.length === 0) return

    await updateSuggestions($, current =>
      current.length === 0 ? items : current,
    )
  } catch (error) {
    $.ui.log(S.suggestionsNotSaved(errorMessage(error)), { to: 'debug' })
  }
}

export type Suggestion = { title: string; spec: string; why: string }

/**
 * Adds a suggestion and toasts it once. One whose title is an open card's or
 * another suggestion's (any case) is folded in: nothing is added and it
 * resolves false.
 */
export async function suggestCard(
  $: EngineInterface,
  input: Suggestion,
): Promise<boolean> {
  // A board that cannot be had only means the cards are not compared.
  const { cards } = await ensureBoard($)
  const open = cards.filter(card => card.column !== 'done')
  const isOpen = open.some(card => sameTitle(card.title, input.title))

  const seen = { isAdded: false }
  const items = await updateSuggestions($, list => {
    seen.isAdded =
      !isOpen && !list.some(one => sameTitle(one.title, input.title))
    if (!seen.isAdded) return list

    const { title, spec, why } = input

    return [
      ...list,
      { id: nextId(list), title, spec, ...(why === '' ? {} : { why }) },
    ]
  })
  if (!seen.isAdded) return false

  await save($, items)
  $.ui.toast(S.suggested(input.title))

  return true
}

/** Drops a suggestion without adding a card. */
export async function dismissSuggestion(
  $: EngineInterface,
  id: number,
): Promise<void> {
  const items = await updateSuggestions($, list =>
    list.filter(one => one.id !== id),
  )
  await save($, items)
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

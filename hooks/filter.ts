import type { KanbanCard, KanbanColumn } from '../types'
import { GROUPS, parseColumn } from './model'

// What a filter query asks for. Words, labels and exclusions each have to hold;
// of numbers, title tags, areas and sections a card need only be one.
type Filter = {
  words: string[]
  numbers: number[]
  withLabels: string[]
  withoutLabels: string[]
  tags: string[]
  areas: string[]
  columns: KanbanColumn[]
}

// A term is a run of characters that are not space or quote, or a quoted run:
// the closing quote may be missing, as while it is being typed.
const TERM = /(?:[^\s"]+|"[^"]*"?)+/g
const NUMBER = /^#(\d+)$/
const TAG = /^\[([^\]]+)\]$/
const TITLE_TAG = /^\[([^\]]+)\]/

/** Whether a query asks for anything: a blank one shows every card. */
export function isFiltering(query: string): boolean {
  return query.trim() !== ''
}

function parseFilter(query: string): Filter {
  const filter: Filter = {
    words: [],
    numbers: [],
    withLabels: [],
    withoutLabels: [],
    tags: [],
    areas: [],
    columns: [],
  }

  for (const raw of query.match(TERM) ?? []) {
    const term = raw.replaceAll('"', '').toLowerCase()
    const number = NUMBER.exec(term)?.[1]
    const tag = TAG.exec(term)?.[1]
    const section = term.startsWith('@') ? term.slice(1) : ''
    const column = parseColumn(section)

    if (number !== undefined) filter.numbers.push(Number(number))
    else if (tag !== undefined) filter.tags.push(tag)
    else if (term.startsWith('label:')) pushValue(filter.withLabels, term)
    else if (term.startsWith('-label:')) pushValue(filter.withoutLabels, term)
    else if (term.startsWith('area:')) pushValue(filter.areas, term)
    else if (column !== undefined) filter.columns.push(column)
    else if (section === 'active') filter.columns.push(...GROUPS.active)
    else if (section === 'inactive') filter.columns.push(...GROUPS.inactive)
    else if (term !== '') filter.words.push(term)
  }

  return filter
}

// A term with nothing after its colon (`label:`, as typed so far) asks nothing yet.
function pushValue(into: string[], term: string) {
  const value = term.slice(term.indexOf(':') + 1)
  if (value !== '') into.push(value)
}

// The `[PRJ-AREA]` a title starts with, without its brackets, in lower case.
const tagOf = (title: string) => TITLE_TAG.exec(title)?.[1]?.toLowerCase() ?? ''

// A bracket term names the whole tag, or just its project (`[KANB]`).
const hasTag = (tag: string, wanted: string) =>
  tag === wanted || (tag !== '' && tag.startsWith(`${wanted}-`))

// The part of the tag after its last dash: the area (`UIX` in `KANB-UIX`).
const areaOf = (tag: string) => tag.slice(tag.lastIndexOf('-') + 1)

function passes(card: KanbanCard, filter: Filter): boolean {
  const title = card.title.toLowerCase()
  const tag = tagOf(card.title)
  const labels = (card.labels ?? []).map(label => label.toLowerCase())

  return (
    filter.words.every(word => title.includes(word)) &&
    filter.withLabels.every(label => labels.includes(label)) &&
    !filter.withoutLabels.some(label => labels.includes(label)) &&
    (filter.numbers.length === 0 || filter.numbers.includes(card.number)) &&
    (filter.tags.length === 0 ||
      filter.tags.some(wanted => hasTag(tag, wanted))) &&
    (filter.areas.length === 0 ||
      (tag !== '' && filter.areas.includes(areaOf(tag)))) &&
    (filter.columns.length === 0 || filter.columns.includes(card.column))
  )
}

/**
 * Whether a card is one the query asks for. Words must all be in the title
 * (case aside; "a phrase" in quotes counts as one); `#12` is the number;
 * `label:ai` needs the label and `-label:ai` refuses it; `[KANB-UIX]` (or
 * `[KANB]`) and `area:UIX` read the title's `[PRJ-AREA]` prefix; `@claude`
 * names a section, `@active` and `@inactive` the three of a group. Several
 * numbers, tags, areas or sections are alternatives.
 */
export function matchesFilter(card: KanbanCard, query: string): boolean {
  return passes(card, parseFilter(query))
}

/** The cards the query asks for, in their order; all of them for a blank query. */
export function filterCards(
  cards: readonly KanbanCard[],
  query: string,
): readonly KanbanCard[] {
  if (!isFiltering(query)) return cards

  const filter = parseFilter(query)

  return cards.filter(card => passes(card, filter))
}

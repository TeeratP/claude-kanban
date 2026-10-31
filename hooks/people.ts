import type { KanbanCard, KanbanPeople, KanbanWho } from '../types'

// Who a card belongs to is its issue's assignees, by GitHub login, which never
// changes. The name a person goes by is theirs to pick and change; it lives in
// one block of the project board's README, so a rename edits one line there
// and no issue.

const BLOCK = /<!-- kanban:people\n([\s\S]*?)-->/
const LOGIN = /^[A-Za-z0-9-]+$/
// A name is one line, and short enough to sit beside a card's title.
const NAME_MAX = 40

/** The views in the order the toolbar button steps through them. */
export const WHO_ORDER: readonly KanbanWho[] = ['mine', 'open', 'all']

/** The view after `who`, wrapping to the first. */
export const nextWho = (who: KanbanWho): KanbanWho =>
  WHO_ORDER[(WHO_ORDER.indexOf(who) + 1) % WHO_ORDER.length] ?? 'mine'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Whether the card is assigned to `login` (logins are not case-sensitive). */
export const isTheirs = (card: KanbanCard, login: string) =>
  (card.assignees ?? []).some(one => same(one, login))

/** Whether nobody is assigned the card. */
export const isUnassigned = (card: KanbanCard) =>
  (card.assignees ?? []).length === 0

/**
 * The cards a view shows: `mine` those assigned to `viewer`, `open` those and
 * the unassigned, `all` every card. Without a viewer known yet, every card.
 */
export function whoCards(
  cards: readonly KanbanCard[],
  who: KanbanWho,
  viewer: string | undefined,
): readonly KanbanCard[] {
  if (who === 'all' || viewer === undefined || viewer === '') return cards

  return cards.filter(
    card =>
      isTheirs(card, viewer) || (who === 'open' && isUnassigned(card)),
  )
}

/** Whether a card is the person's to see to: theirs or nobody's. Without a viewer, every card is. */
export const isForViewer = (card: KanbanCard, viewer: string | undefined) =>
  viewer === undefined ||
  viewer === '' ||
  isTheirs(card, viewer) ||
  isUnassigned(card)

/** The name a login goes by: the one they picked, else the login. */
export function nameOf(people: KanbanPeople | undefined, login: string): string {
  const found = Object.entries(people ?? {}).find(([key]) => same(key, login))

  return found?.[1] ?? login
}

/**
 * Whose a card is, for its row, when it is someone else's: the first assignee
 * that is not `viewer`, by name. Empty for the person's own card or nobody's.
 */
export function ownerOf(
  card: KanbanCard,
  viewer: string | undefined,
  people: KanbanPeople | undefined,
): string {
  const assignees = card.assignees ?? []
  if (viewer !== undefined && assignees.some(one => same(one, viewer)))
    return ''

  const other = assignees[0]

  return other === undefined ? '' : nameOf(people, other)
}

/** A name as it may be kept: one line, trimmed, at most 40 characters; empty when there is none. */
export const cleanName = (name: string) =>
  name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)

/** The names in a board README's people block, by login; none when it has no block. */
export function parsePeople(readme: string): KanbanPeople {
  const block = BLOCK.exec(readme.replaceAll('\r\n', '\n'))?.[1] ?? ''
  const people: KanbanPeople = {}
  for (const line of block.split('\n')) {
    const split = line.indexOf(':')
    if (split <= 0) continue

    const login = line.slice(0, split).trim()
    const name = cleanName(line.slice(split + 1))
    if (LOGIN.test(login) && name !== '') people[login] = name
  }

  return people
}

/**
 * The README with `login` going by `name` in its people block: the block made
 * at the end when there is none, the rest of the README left as it is. An
 * empty name takes the login out, so it goes by the login again.
 */
export function withName(readme: string, login: string, name: string): string {
  const text = readme.replaceAll('\r\n', '\n')
  const people = Object.fromEntries(
    Object.entries(parsePeople(text)).filter(([key]) => !same(key, login)),
  )
  const kept = cleanName(name)
  if (kept !== '') people[login] = kept

  const block = [
    '<!-- kanban:people',
    ...Object.entries(people).map(([key, value]) => `${key}: ${value}`),
    '-->',
  ].join('\n')
  if (BLOCK.test(text)) return text.replace(BLOCK, block)

  return text.trimEnd() === '' ? block : `${text.trimEnd()}\n\n${block}`
}

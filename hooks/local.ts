import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanColumn, KanbanDetail } from '../types'
import { escapeMarkers, gistOf, parseSections, questionOf } from './handoff'
import { KANBAN_DIR, isColumn, maxOrder } from './model'
import { placeIn } from './order'
import { S } from './strings'

// Frontmatter lines this module does not own, kept so a rewrite loses nothing.
type Parsed = { card: KanbanCard; body: string; extras?: string[] }

const OWNED_KEYS = new Set([
  'id',
  'title',
  'status',
  'order',
  'created',
  'updated',
])

function toInt(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)

  return quoted?.[2] ?? value
}

/** Reads one `.kanban/*.md` file; null when it has no frontmatter or no id. */
export function parseCardFile(
  name: string,
  text: string,
  fallbackMs = 0,
): Parsed | null {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  if (lines[0]?.trim() !== '---') return null

  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (end < 0) return null

  const fields = new Map<string, string>()
  const extras: string[] = []
  let isOwned = false
  for (const line of lines.slice(1, end)) {
    const split = line.indexOf(': ')
    const isIndented = /^\s/.test(line)
    if (!isIndented && (split > 0 || line.trimEnd().endsWith(':'))) {
      const key =
        split > 0 ? line.slice(0, split).trim() : line.trimEnd().slice(0, -1)
      fields.set(key, split > 0 ? unquote(line.slice(split + 2).trim()) : '')
      isOwned = OWNED_KEYS.has(key)
      if (!isOwned) extras.push(line)
    } else if (line.trim() !== '' && !(isOwned && isIndented)) {
      // A nested value, a list item or a comment stays with what it follows.
      extras.push(line)
    }
  }

  const stem = name.replace(/\.md$/, '')
  const number = toInt(fields.get('id')) ?? toInt(/^(\d+)-/.exec(stem)?.[1])
  if (number === undefined) return null

  const status = fields.get('status')
  const created = fields.get('created') || new Date(fallbackMs).toISOString()
  const order = Number(fields.get('order'))

  return {
    card: {
      id: `md:${stem}`,
      number,
      title: fields.get('title') || stem,
      column: isColumn(status) ? status : 'backlog',
      order: fields.get('order') && Number.isFinite(order) ? order : number,
      createdAt: created,
      updatedAt: fields.get('updated') || created,
      file: `${KANBAN_DIR}/${name}`,
    },
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
    ...(extras.length > 0 && { extras }),
  }
}

function quoteTitle(title: string): string {
  const flat = title.replace(/\s*\n\s*/g, ' ')

  return /^\s|\s$|^(["']).*\1$/.test(flat) ? `"${flat}"` : flat
}

/** Writes a card back as a `.kanban/*.md` file; the inverse of `parseCardFile`. */
export function serializeCardFile(
  card: KanbanCard,
  body: string,
  extras: readonly string[] = [],
): string {
  return [
    '---',
    `id: ${card.number}`,
    `title: ${quoteTitle(card.title)}`,
    `status: ${card.column}`,
    `order: ${card.order}`,
    `created: ${card.createdAt}`,
    `updated: ${card.updatedAt}`,
    ...extras,
    '---',
    body === '' ? '' : `${body}\n`,
  ].join('\n')
}

// Parsed files by path, reused while the file's mtime is unchanged.
const cache = new Map<string, { mtimeMs: number; parsed: Parsed | null }>()

async function readParsed(
  $: EngineInterface,
  name: string,
  mtimeMs: number,
): Promise<Parsed | null> {
  const path = `${KANBAN_DIR}/${name}`
  const hit = cache.get(path)
  if (hit?.mtimeMs === mtimeMs) return hit.parsed

  const parsed = parseCardFile(name, await $.fs.read(path), mtimeMs)
  cache.set(path, { mtimeMs, parsed })

  return parsed
}

function nameOf(card: KanbanCard): string {
  if (card.file === undefined) throw new Error(S.cardHasNoFile(card))

  return card.file.slice(KANBAN_DIR.length + 1)
}

async function readCard($: EngineInterface, card: KanbanCard): Promise<Parsed> {
  const name = nameOf(card)
  const parsed = parseCardFile(name, await $.fs.read(`${KANBAN_DIR}/${name}`))
  if (parsed === null)
    throw new Error(S.unreadableCard(`${KANBAN_DIR}/${name}`))

  return parsed
}

// A card in Human whose newest section is an unanswered question carries it.
function withQuestion({ card, body }: Parsed): KanbanCard {
  if (card.column !== 'human') return card

  const ask = questionOf(parseSections(body).sections)

  return ask === undefined
    ? card
    : { ...card, tag: 'question', question: gistOf(ask.text) }
}

export async function loadLocal($: EngineInterface): Promise<KanbanCard[]> {
  if (!(await $.fs.exists(KANBAN_DIR))) return []

  const entries = await $.fs.list(KANBAN_DIR)
  const parsed = await Promise.all(
    entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .map(entry => readParsed($, entry.name, entry.mtimeMs)),
  )

  return parsed.flatMap(one => (one === null ? [] : [withQuestion(one)]))
}

// Writes that read the cards and then write some of them take turns: two at
// once would read the same state (the same highest number, the same gap in a
// section's order), and the later write would undo the earlier.
let writing: Promise<unknown> = Promise.resolve()

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const made = writing.then(work)
  writing = made.then(
    () => undefined,
    () => undefined,
  )

  return made
}

/**
 * Moves the card to `to`, after the card `after` (first when null) or last
 * when none is given. Neighbours that have to change their order to make room
 * are rewritten first, the moved card last.
 */
export function moveLocal(
  $: EngineInterface,
  card: KanbanCard,
  to: KanbanColumn,
  after?: KanbanCard | null,
): Promise<Partial<KanbanCard>> {
  return inTurn(() => writeMove($, card, to, after))
}

async function writeMove(
  $: EngineInterface,
  card: KanbanCard,
  to: KanbanColumn,
  after?: KanbanCard | null,
): Promise<Partial<KanbanCard>> {
  const current = await readCard($, card)
  const all = await loadLocal($)
  const placed =
    after === undefined
      ? undefined
      : placeIn(all, card.id, to, after === null ? null : after.id)
  // Already in place: another write got there first.
  if (after !== undefined && placed === undefined) return {}

  const isReorder = current.card.column === to && after !== undefined
  const patch = {
    column: to,
    order:
      placed?.order ??
      maxOrder(
        all.filter(other => other.id !== card.id),
        to,
      ) + 1,
    ...(isReorder
      ? {}
      : { updatedAt: new Date(await $.clock.now()).toISOString() }),
  }

  for (const other of all) {
    const order = placed?.shifted[other.id]
    if (order === undefined) continue

    const neighbour = await readCard($, other)
    const file = `${KANBAN_DIR}/${nameOf(other)}`
    await $.fs.write(
      file,
      serializeCardFile(
        { ...neighbour.card, order },
        neighbour.body,
        neighbour.extras,
      ),
    )
    cache.delete(file)
  }

  const path = `${KANBAN_DIR}/${nameOf(card)}`
  await $.fs.write(
    path,
    serializeCardFile(
      { ...current.card, ...patch },
      current.body,
      current.extras,
    ),
  )
  cache.delete(path)

  return patch
}

// Appends go through the same turn as moves and creates: an append rewrites the
// whole file, so overlapping a renumber of that card would undo it.
export function appendLocal(
  $: EngineInterface,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  return inTurn(() => writeAppend($, card, markdown))
}

async function writeAppend(
  $: EngineInterface,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  const current = await readCard($, card)
  const path = `${KANBAN_DIR}/${nameOf(card)}`
  const body = current.body === '' ? markdown : `${current.body}\n\n${markdown}`
  await $.fs.write(path, serializeCardFile(current.card, body, current.extras))
  cache.delete(path)
}

function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '')

  return slug === '' ? 'card' : slug
}

async function writeNew(
  $: EngineInterface,
  title: string,
  spec: string,
  column: KanbanColumn,
): Promise<KanbanCard> {
  const cards = await loadLocal($)
  const number = cards.reduce((max, one) => Math.max(max, one.number), 0) + 1
  const name = `${String(number).padStart(4, '0')}-${slugOf(title)}.md`
  const file = `${KANBAN_DIR}/${name}`
  const now = new Date(await $.clock.now()).toISOString()
  const card: KanbanCard = {
    id: `md:${name.replace(/\.md$/, '')}`,
    number,
    title,
    column,
    order: maxOrder(cards, column) + 1,
    createdAt: now,
    updatedAt: now,
    file,
  }
  await $.fs.write(file, serializeCardFile(card, escapeMarkers(spec)))

  return card
}

/** Writes a new card file numbered after the highest one; resolves the card. */
export function createLocal(
  $: EngineInterface,
  title: string,
  spec: string,
  column: KanbanColumn,
): Promise<KanbanCard> {
  return inTurn(() => writeNew($, title, spec, column))
}

export async function detailLocal(
  $: EngineInterface,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  return parseSections((await readCard($, card)).body)
}

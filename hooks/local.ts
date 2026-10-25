import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanColumn, KanbanDetail } from '../types'
import { parseSections } from './handoff'
import { KANBAN_DIR, isColumn, maxOrder } from './model'
import { S } from './strings'

type Parsed = { card: KanbanCard; body: string }

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
  for (const line of lines.slice(1, end)) {
    const split = line.indexOf(': ')
    if (split > 0) {
      fields.set(
        line.slice(0, split).trim(),
        unquote(line.slice(split + 2).trim()),
      )
    } else if (line.trimEnd().endsWith(':')) {
      fields.set(line.trimEnd().slice(0, -1), '')
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
  }
}

function quoteTitle(title: string): string {
  const flat = title.replace(/\s*\n\s*/g, ' ')

  return /^\s|\s$|^(["']).*\1$/.test(flat) ? `"${flat}"` : flat
}

/** Writes a card back as a `.kanban/*.md` file; the inverse of `parseCardFile`. */
export function serializeCardFile(card: KanbanCard, body: string): string {
  return [
    '---',
    `id: ${card.number}`,
    `title: ${quoteTitle(card.title)}`,
    `status: ${card.column}`,
    `order: ${card.order}`,
    `created: ${card.createdAt}`,
    `updated: ${card.updatedAt}`,
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

export async function loadLocal($: EngineInterface): Promise<KanbanCard[]> {
  if (!(await $.fs.exists(KANBAN_DIR))) return []

  const entries = await $.fs.list(KANBAN_DIR)
  const parsed = await Promise.all(
    entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .map(entry => readParsed($, entry.name, entry.mtimeMs)),
  )

  return parsed.flatMap(one => (one === null ? [] : [one.card]))
}

export async function moveLocal(
  $: EngineInterface,
  card: KanbanCard,
  to: KanbanColumn,
): Promise<Partial<KanbanCard>> {
  const current = await readCard($, card)
  const others = (await loadLocal($)).filter(other => other.id !== card.id)
  const patch = {
    column: to,
    order: maxOrder(others, to) + 1,
    updatedAt: new Date(await $.clock.now()).toISOString(),
  }
  const path = `${KANBAN_DIR}/${nameOf(card)}`
  await $.fs.write(
    path,
    serializeCardFile({ ...current.card, ...patch }, current.body),
  )
  cache.delete(path)

  return patch
}

export async function appendLocal(
  $: EngineInterface,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  const current = await readCard($, card)
  const path = `${KANBAN_DIR}/${nameOf(card)}`
  const body = current.body === '' ? markdown : `${current.body}\n\n${markdown}`
  await $.fs.write(path, serializeCardFile(current.card, body))
  cache.delete(path)
}

export async function detailLocal(
  $: EngineInterface,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  return parseSections((await readCard($, card)).body)
}

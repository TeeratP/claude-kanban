import type { KanbanSection } from '../types'
import { truncate } from './model'

const HEADER =
  /^## (Handoff|Feedback|Question|Answer) \((\d{4}-\d{2}-\d{2})\)\s*$/
const FIELD = /^\*\*(Did|Check|Changed|Need from you):\*\*\s*(.*)$/
// The line starts of HEADER and FIELD, loosened so no marker-like line slips through escapeMarkers.
const HEADER_START = /^## (?:Handoff|Feedback|Question|Answer) \(/
const FIELD_START = /^\*\*(Did|Check|Changed|Need from you):\*\*/

type Fields = NonNullable<KanbanSection['fields']>

const KIND: Record<string, KanbanSection['kind']> = {
  Handoff: 'handoff',
  Feedback: 'feedback',
  Question: 'question',
  Answer: 'answer',
}

const FIELD_KEY: Record<string, keyof Fields> = {
  Did: 'did',
  Check: 'check',
  Changed: 'changed',
  'Need from you': 'need',
}

function parseFields(text: string): Fields {
  const fields: Fields = { did: '', check: '', changed: '', need: '' }
  let key: keyof Fields | undefined

  for (const line of text.split('\n')) {
    const match = FIELD.exec(line)
    const name = match?.[1]
    if (name !== undefined) {
      key = FIELD_KEY[name]
      if (key !== undefined) fields[key] = match?.[2] ?? ''
    } else if (key !== undefined) {
      fields[key] += `\n${line}`
    }
  }
  for (const name of Object.keys(fields) as (keyof Fields)[]) {
    fields[name] = fields[name].trim()
  }

  return fields
}

/**
 * Makes free text safe to write inside a section: a line `parseSections` would read as a
 * section header gets a leading backslash, and one it would read as a field marker gets its
 * colon escaped. Both render as the literal text in Markdown and on GitHub; other lines
 * are unchanged.
 */
export function escapeMarkers(text: string): string {
  return text
    .split('\n')
    .map(line =>
      HEADER_START.test(line)
        ? `\\${line}`
        : line.replace(FIELD_START, '**$1\\:**'),
    )
    .join('\n')
}

/** The section Send back appends to a card: the person's feedback, dated. */
export function formatFeedback(text: string, date: string): string {
  return `## Feedback (${date})\n${escapeMarkers(text)}`
}

/** The section kanban_ask appends to a card: Claude's blocking question, dated. */
export function formatQuestion(text: string, date: string): string {
  return `## Question (${date})\n${escapeMarkers(text)}`
}

/** The section Answer appends to a question card: the person's answer, dated. */
export function formatAnswer(text: string, date: string): string {
  return `## Answer (${date})\n${escapeMarkers(text)}`
}

/**
 * Splits a card file's markdown into its spec and its Handoff / Feedback / Question /
 * Answer sections.
 * The first header line ends the spec, so a header line in a hand-written spec starts a
 * section: the file has no other boundary. Text written through the `format…` functions
 * is escaped and never does.
 */
export function parseSections(markdown: string): {
  body: string
  sections: KanbanSection[]
} {
  const body: string[] = []
  const found: {
    kind: KanbanSection['kind']
    date: string
    lines: string[]
  }[] = []

  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const header = HEADER.exec(line)
    if (header !== null) {
      found.push({
        kind: KIND[header[1] ?? ''] ?? 'feedback',
        date: header[2] ?? '',
        lines: [],
      })
    } else {
      ;(found[found.length - 1]?.lines ?? body).push(line)
    }
  }

  const sections = found.map(({ kind, date, lines }): KanbanSection => {
    const text = lines.join('\n').trim()

    return kind === 'handoff'
      ? { kind, date, text, fields: parseFields(text) }
      : { kind, date, text }
  })

  return { body: body.join('\n').trim(), sections }
}

/** The Handoff section Claude writes when it hands a card to the person. */
export function formatHandoff(fields: Fields, date: string): string {
  const line = (label: string, text: string) =>
    `**${label}:** ${escapeMarkers(text)}`.trimEnd()

  return [
    `## Handoff (${date})`,
    line('Did', fields.did),
    line('Check', fields.check),
    line('Changed', fields.changed),
    line('Need from you', fields.need),
  ].join('\n')
}

const PLACEHOLDERS = new Set(['', '…', '...', 'n/a'])

/** Whether a handoff field says something: not empty and not a placeholder. */
export function isFilled(text: string): boolean {
  return !PLACEHOLDERS.has(text.trim().toLowerCase())
}

/**
 * Whether the newest Question or Handoff comes after the newest Feedback or Answer, and
 * says what a card needs to go to the person: a question does, a handoff when it tells
 * the person what to check and what is needed. A section someone else wrote on the issue
 * (`byOther`) is not counted.
 */
export function isHandoffValid(all: readonly KanbanSection[]): boolean {
  const sections = all.filter(one => one.byOther === undefined)
  const handoff = sections.findLastIndex(
    one => one.kind === 'handoff' || one.kind === 'question',
  )
  const reply = sections.findLastIndex(
    one => one.kind === 'feedback' || one.kind === 'answer',
  )
  const newest = sections[handoff]

  return (
    handoff > reply &&
    (newest?.kind === 'question' ||
      (newest?.fields !== undefined &&
        isFilled(newest.fields.check) &&
        isFilled(newest.fields.need)))
  )
}

/**
 * The question the person is being asked: the newest counted section, when it is a
 * question. Anything after it, such as an answer or feedback, closes it.
 */
export function questionOf(
  all: readonly KanbanSection[],
): KanbanSection | undefined {
  const newest = all.findLast(one => one.byOther === undefined)

  return newest?.kind === 'question' ? newest : undefined
}

const GIST_CELLS = 140

/** A question on one line and cut short, for a toast or a notification. */
export function gistOf(text: string): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), GIST_CELLS)
}

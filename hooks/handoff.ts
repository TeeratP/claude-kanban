import type { KanbanSection } from '../types'

const HEADER = /^## (Handoff|Feedback) \((\d{4}-\d{2}-\d{2})\)\s*$/
const FIELD = /^\*\*(Did|Check|Changed|Need from you):\*\*\s*(.*)$/
// The line starts of HEADER and FIELD, loosened so no marker-like line slips through escapeMarkers.
const HEADER_START = /^## (?:Handoff|Feedback) \(/
const FIELD_START = /^\*\*(Did|Check|Changed|Need from you):\*\*/

type Fields = NonNullable<KanbanSection['fields']>

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

/**
 * Splits a card file's markdown into its spec and its Handoff / Feedback sections.
 * The first header line ends the spec, so a header line in a hand-written spec starts a
 * section: the file has no other boundary. Text written through `formatHandoff` and
 * `formatFeedback` is escaped and never does.
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
        kind: header[1] === 'Handoff' ? 'handoff' : 'feedback',
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

/** Whether the newest section is a handoff that tells the person what to check and what is needed. */
export function isHandoffValid(sections: readonly KanbanSection[]): boolean {
  const handoff = sections.findLastIndex(one => one.kind === 'handoff')
  const feedback = sections.findLastIndex(one => one.kind === 'feedback')
  const fields = sections[handoff]?.fields

  return (
    handoff > feedback &&
    fields !== undefined &&
    isFilled(fields.check) &&
    isFilled(fields.need)
  )
}

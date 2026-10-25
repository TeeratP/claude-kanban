import type { KanbanSection } from '../types'

const HEADER = /^## (Handoff|Feedback) \((\d{4}-\d{2}-\d{2})\)\s*$/
const FIELD = /^\*\*(Did|Check|Changed|Need from you):\*\*\s*(.*)$/

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

/** Splits a card file's markdown into its spec and its Handoff / Feedback sections. */
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

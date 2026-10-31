import type { ThemeKey } from 'claude-code'

import type {
  KanbanActivity,
  KanbanCard,
  KanbanCardActivity,
  KanbanRound,
} from '../types'
import type { Seg } from './board-client'
import { ageLabel, cellWidth, truncate } from './model'
import { S } from './strings'

// Drawn on a card's second row, which sits under the title and is indented to it.
const MAX_DOTS = 4
const NAME_MAX = 14
const MIN_ACTIVITY = 6
// With no tool started for this long, Claude counts as idle.
const IDLE_AFTER_MS = 60_000
const TARGET_MAX = 200

// Colours for the subagents' dots: not the sync marks' (success, warning, error),
// nor Claude's own, nor the one that means "needs you", so a dot never reads as
// a section's colour.
const PALETTE: readonly ThemeKey[] = [
  'suggestion',
  'planMode',
  'autoAccept',
  'bashBorder',
  'merged',
  'ide',
]

// Tools whose target is a path, which keeps its end when it is cut.
const PATH_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

const seg = (text: string, style: Partial<Omit<Seg, 'text'>> = {}): Seg => ({
  text,
  bold: false,
  dim: true,
  color: '',
  ...style,
})

/** The colour of an agent's dot: Claude's own for the main session, else the same palette colour for a name every time. */
export function colorOf(name: string): ThemeKey {
  if (name === S.mainAgent) return 'claude'

  // FNV-1a, so a name's colour does not depend on the others on the card.
  let hash = 0x811c9dc5
  for (const char of name.toLowerCase()) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  }

  return PALETTE[hash % PALETTE.length] ?? 'suggestion'
}

/** A time spent as `45s`, `12m`, `1h15m` or `2d3h`. */
export function durationLabel(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`

  const days = Math.floor(hours / 24)

  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`
}

const oneDecimal = (value: number) => String(Math.round(value * 10) / 10)

/** A token count as `850`, `1.2k`, `48k` or `1.3M`. */
export function tokenLabel(count: number): string {
  const n = Math.max(0, Math.round(count))
  if (n < 1000) return String(n)
  if (n < 10_000) return `${oneDecimal(n / 1000)}k`
  if (n < 999_500) return `${Math.round(n / 1000)}k`

  return `${oneDecimal(n / 1_000_000)}M`
}

export type Totals = { ms: number; tokens: number; cacheRead: number }

/** Time and tokens summed over rounds; cache reads are kept apart from the tokens. */
export function totalsOf(rounds: readonly KanbanRound[]): Totals {
  return rounds.reduce<Totals>(
    (sum, round) => ({
      ms: sum.ms + round.ms,
      tokens: sum.tokens + round.input + round.output,
      cacheRead: sum.cacheRead + round.cacheRead,
    }),
    { ms: 0, tokens: 0, cacheRead: 0 },
  )
}

/** `12m · 48k tok`; a part with nothing yet is left out, and none at all is ''. */
export function statsLabel({ ms, tokens }: Totals): string {
  return [
    ms > 0 ? durationLabel(ms) : '',
    tokens > 0 ? S.tokens(tokenLabel(tokens)) : '',
  ]
    .filter(part => part !== '')
    .join(S.statsSep)
}

/** `12m · 48k` for a card's second row, where there is no room to say `tok`. */
export function rowStats({ ms, tokens }: Totals): string {
  return [ms > 0 ? durationLabel(ms) : '', tokens > 0 ? tokenLabel(tokens) : '']
    .filter(part => part !== '')
    .join(S.statsSep)
}

/** The agents of one round: names in the order they joined, or just Claude. */
export function agentsOfRound(round: KanbanRound | undefined): string[] {
  return round === undefined || round.agents.length === 0
    ? [S.mainAgent]
    : round.agents
}

/** Every agent that worked on the card in any round, in the order first seen. */
export function agentsOf(one: KanbanCardActivity): string[] {
  const names = one.rounds.flatMap(round => round.agents)

  return names.length === 0
    ? [S.mainAgent]
    : names.filter((name, index) => names.indexOf(name) === index)
}

/** The ids of the Claude cards that get a second row: those Claude has worked on. */
export function detailIds(
  cards: readonly KanbanCard[],
  activity: KanbanActivity,
): Set<string> {
  return new Set(
    cards
      .filter(
        card =>
          card.column === 'claude' &&
          (activity.cards[card.id]?.rounds.length ?? 0) > 0,
      )
      .map(card => card.id),
  )
}

/** A card's totals, with the time of the turn running on it counted up to `now`. */
export function liveTotals(
  one: KanbanCardActivity,
  live: KanbanActivity['live'],
  now: number,
): Totals {
  const totals = totalsOf(one.rounds)
  const extra =
    live.isRunning && live.cardId === one.cardId
      ? Math.max(0, now - live.since)
      : 0

  return { ...totals, ms: totals.ms + extra }
}

/** `text` cut to `width` cells, keeping its end and starting at a `/` when it can (`…/auth.ts`). */
export function truncateStart(text: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(text) <= width) return text

  const chars = [...text]
  let out = ''
  let used = 0
  while (chars.length > 0) {
    const char = chars.pop() ?? ''
    const next = cellWidth(char)
    if (used + next > width - 1) break
    out = char + out
    used += next
  }

  const slash = out.indexOf('/')

  return `…${slash > 0 ? out.slice(slash) : out}`
}

/** The first line of a tool's argument worth showing, cut to a safe length. */
export function targetText(text: string): string {
  const line = text.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''

  return line.length > TARGET_MAX ? line.slice(0, TARGET_MAX) : line
}

// What Claude is doing now, cut to `room` cells.
function activityText(
  one: KanbanCardActivity,
  live: KanbanActivity['live'],
  now: number,
  room: number,
): string {
  // A subagent can work for a card the main turn has moved on from.
  const isRunning = live.isRunning
  const isFresh = one.isToolRunning || now - one.lastAt < IDLE_AFTER_MS
  if (!isRunning || !isFresh) {
    return truncate(S.idle(ageLabel(one.lastAt, now)), room)
  }
  if (one.tool === '') return truncate(S.working, room)

  const head = S.toolRunning(one.tool)
  const left = room - cellWidth(head) - 1
  if (one.target === '' || left < 2) return truncate(head, room)

  const target = PATH_TOOLS.has(one.tool)
    ? truncateStart(one.target, left)
    : truncate(one.target, left)

  return `${head} ${target}`
}

function clip(segs: Seg[], width: number): Seg[] {
  const out: Seg[] = []
  let left = width
  for (const one of segs) {
    if (left <= 0) break
    const cut =
      cellWidth(one.text) <= left ? one.text : truncate(one.text, left)
    out.push({ ...one, text: cut })
    left -= cellWidth(cut)
  }

  return out
}

// The parts of the second row after the dots, each led by a separator: the first
// by a space, the rest by ` · `.
const joined = (parts: readonly string[]) =>
  parts.length === 0 ? '' : ` ${parts.join(S.statsSep)}`

/**
 * The second row of a Claude card, from cell `indent` (where its title starts):
 * the agents' dots, then the agent that acted last, what Claude is doing now
 * and the stats, joined by ` · ` and fitted to `columns` cells. The stats keep
 * their room; the activity takes what is left, then gives way, then the name,
 * so the row is never wider than the pane.
 */
export function detailSegs(
  columns: number,
  one: KanbanCardActivity,
  live: KanbanActivity['live'],
  now: number,
  indent: number,
): Seg[] {
  const names = agentsOfRound(one.rounds.at(-1))
  const dots = names
    .slice(0, MAX_DOTS)
    .map(name => seg(S.agentDot, { dim: false, color: colorOf(name) }))
  const more = names.length - MAX_DOTS
  const head = [
    seg(' '.repeat(indent)),
    ...dots,
    ...(more > 0 ? [seg(S.agentsMore(more))] : []),
  ]
  const stats = rowStats(liveTotals(one, live, now))

  const used = cellWidth(head.map(part => part.text).join(''))
  const avail = columns - used
  const primary = one.lastAgent !== '' ? one.lastAgent : (names[0] ?? '')
  const name = truncate(primary, NAME_MAX)
  const parts = (...texts: string[]) => texts.filter(text => text !== '')

  // The activity gets what the name and the stats leave, if that is worth showing.
  const withoutActivity = parts(name, stats)
  const room =
    avail - cellWidth(joined(withoutActivity)) - cellWidth(S.statsSep)
  const chosen =
    room >= MIN_ACTIVITY
      ? parts(name, activityText(one, live, now, room), stats)
      : cellWidth(joined(withoutActivity)) <= avail
        ? withoutActivity
        : parts(stats)

  return clip(
    [...head, seg(joined(chosen))].filter(part => part.text !== ''),
    columns,
  )
}

/** The props a Segment is drawn with as a Text. */
export function segProps(part: Seg) {
  return {
    ...(part.bold ? { weight: 'bold' as const } : {}),
    ...(part.dim ? { dimColor: true } : {}),
    ...(part.italic === true ? { italic: true } : {}),
    ...(part.strike === true ? { strikethrough: true } : {}),
    ...(part.underline === true ? { underline: true } : {}),
    ...(part.color === '' ? {} : { color: part.color }),
  }
}

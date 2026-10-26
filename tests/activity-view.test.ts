import { expect, test } from 'claude-code/testing'

import type {
  KanbanActivity,
  KanbanCard,
  KanbanCardActivity,
  KanbanColumn,
  KanbanRound,
} from '../types'
import {
  colorOf,
  detailIds,
  detailSegs,
  durationLabel,
  statsLabel,
  tokenLabel,
  totalsOf,
  truncateStart,
} from '../hooks/activity-view'
import { hitTest, layoutBoard, sectionWindow } from '../hooks/layout'
import type { Row } from '../hooks/layout'
import { EMPTY_ACTIVITY, INITIAL_UI, cellWidth } from '../hooks/model'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const MINUTE = 60_000

const round = (extra: Partial<KanbanRound> = {}): KanbanRound => ({
  startedAt: NOW - 10 * MINUTE,
  ms: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  agents: ['Claude'],
  isOpen: true,
  ...extra,
})

const activityOf = (
  extra: Partial<KanbanCardActivity> = {},
): KanbanCardActivity => ({
  cardId: 'md:2',
  rounds: [round()],
  lastAt: NOW,
  lastAgent: 'Claude',
  tool: '',
  target: '',
  toolId: '',
  isToolRunning: false,
  ...extra,
})

const RUNNING: KanbanActivity['live'] = {
  cardId: 'md:2',
  since: NOW,
  isRunning: true,
}
const STOPPED = EMPTY_ACTIVITY.live
// Where a card's title starts, so where its second row does.
const TITLE_AT = 5

const text = (segs: { text: string }[]) => segs.map(one => one.text).join('')

test('an agent name always maps to the same colour, whatever its case', () => {
  expect(colorOf('Explore')).toBe(colorOf('Explore'))
  expect(colorOf('Explore')).toBe(colorOf('explore'))
  const colours = new Set(
    ['Claude', 'Explore', 'Plan', 'general-purpose', 'reviewer', 'a', 'b'].map(
      colorOf,
    ),
  )
  expect(colours.size).toBeGreaterThan(2)
  for (const colour of colours) {
    expect(['success', 'warning', 'error']).not.toContain(colour)
  }
})

test('times read as seconds, minutes, hours and days', () => {
  expect(durationLabel(0)).toBe('0s')
  expect(durationLabel(45_000)).toBe('45s')
  expect(durationLabel(12 * MINUTE)).toBe('12m')
  expect(durationLabel(60 * MINUTE)).toBe('1h')
  expect(durationLabel(75 * MINUTE)).toBe('1h15m')
  expect(durationLabel(27 * 60 * MINUTE)).toBe('1d3h')
  expect(durationLabel(48 * 60 * MINUTE)).toBe('2d')
})

test('token counts read as 850, 1.2k, 48k and 1.3M', () => {
  expect(tokenLabel(0)).toBe('0')
  expect(tokenLabel(850)).toBe('850')
  expect(tokenLabel(1_000)).toBe('1k')
  expect(tokenLabel(1_234)).toBe('1.2k')
  expect(tokenLabel(9_960)).toBe('10k')
  expect(tokenLabel(48_000)).toBe('48k')
  expect(tokenLabel(999_400)).toBe('999k')
  expect(tokenLabel(999_500)).toBe('1M')
  expect(tokenLabel(1_300_000)).toBe('1.3M')
})

test('rounds add up, with the cache reads kept apart from the tokens', () => {
  const rounds = [
    round({ ms: 5 * MINUTE, input: 10_000, output: 2_000, cacheRead: 50_000 }),
    round({ ms: 3 * MINUTE, input: 30_000, output: 6_000, cacheRead: 70_000 }),
  ]

  expect(totalsOf(rounds)).toEqual({
    ms: 8 * MINUTE,
    tokens: 48_000,
    cacheRead: 120_000,
  })
  expect(statsLabel(totalsOf(rounds))).toBe('8m · 48k tok')
})

test('a round with nothing to count has no stats to label', () => {
  expect(statsLabel(totalsOf([round()]))).toBe('')
})

test('a path cut to fit keeps its end, from a slash when there is one', () => {
  expect(truncateStart('src/auth.ts', 20)).toBe('src/auth.ts')
  expect(truncateStart('src/hooks/auth.ts', 12)).toBe('…/auth.ts')
  expect(truncateStart('authentication.ts', 8)).toBe('…tion.ts')
  expect(truncateStart('x', 0)).toBe('')
})

test('the second row names the main session and shows what it is doing', () => {
  const one = activityOf({
    tool: 'Edit',
    target: 'src/auth.ts',
    isToolRunning: true,
  })
  const segs = detailSegs(44, one, RUNNING, NOW, TITLE_AT)

  expect(text(segs)).toBe('     ● Claude · ⟳ Edit src/auth.ts')
  expect(segs.find(one => one.text === '●')?.color).toBe(colorOf('Claude'))
  expect(segs.find(one => one.text === '●')?.dim).toBe(false)
})

test('several agents show as several dots and the last to act is named', () => {
  const one = activityOf({
    rounds: [round({ agents: ['Claude', 'Explore', 'Plan'] })],
    lastAgent: 'Explore',
    tool: 'Grep',
    target: 'login',
    isToolRunning: true,
  })
  const segs = detailSegs(44, one, RUNNING, NOW, TITLE_AT)

  expect(text(segs)).toBe('     ●●● Explore · ⟳ Grep login')
  expect(segs.filter(one => one.text === '●').map(one => one.color)).toEqual([
    colorOf('Claude'),
    colorOf('Explore'),
    colorOf('Plan'),
  ])
})

test('past four agents the dots stop and a count follows', () => {
  const names = ['Claude', 'a', 'b', 'c', 'd', 'e']
  const one = activityOf({ rounds: [round({ agents: names })] })

  expect(text(detailSegs(44, one, STOPPED, NOW, TITLE_AT))).toContain('●●●●+2')
})

test('the stats keep their room and a path gives up its front', () => {
  const one = activityOf({
    rounds: [round({ ms: 12 * MINUTE, input: 40_000, output: 8_000 })],
    tool: 'Edit',
    target: 'src/hooks/authentication.ts',
    isToolRunning: true,
  })
  const line = text(detailSegs(44, one, STOPPED, NOW, TITLE_AT))
  const running = text(detailSegs(44, one, RUNNING, NOW, TITLE_AT))

  expect(line).toMatch(/ · 12m · 48k$/)
  expect(line).toContain('idle')
  expect(running).toMatch(/^ {5}● Claude · ⟳ Edit …\S+ · 12m · 48k$/)
  expect(cellWidth(running)).toBeLessThanOrEqual(44)
})

test('a turn running on the card counts its time up to now', () => {
  const one = activityOf({ rounds: [round({ ms: 2 * MINUTE })] })
  const live = { ...RUNNING, since: NOW - 3 * MINUTE }

  expect(text(detailSegs(60, one, live, NOW, TITLE_AT))).toContain('5m')
  expect(text(detailSegs(60, one, STOPPED, NOW, TITLE_AT))).toContain('2m')
})

test('Claude is idle once nothing has run for a minute, and says for how long', () => {
  const one = activityOf({
    tool: 'Bash',
    target: 'npm test',
    isToolRunning: false,
    lastAt: NOW - 3 * MINUTE,
  })

  expect(text(detailSegs(44, one, RUNNING, NOW, TITLE_AT))).toBe(
    '     ● Claude · idle 3m',
  )
  expect(
    text(
      detailSegs(44, { ...one, lastAt: NOW - 20_000 }, RUNNING, NOW, TITLE_AT),
    ),
  ).toBe('     ● Claude · ⟳ Bash npm test')
  // A tool still running is not idle, however long it takes.
  expect(
    text(
      detailSegs(44, { ...one, isToolRunning: true }, RUNNING, NOW, TITLE_AT),
    ),
  ).toBe('     ● Claude · ⟳ Bash npm test')
  // With no turn running it is idle, whatever the card was last doing.
  expect(
    text(
      detailSegs(44, { ...one, isToolRunning: true }, STOPPED, NOW, TITLE_AT),
    ),
  ).toBe('     ● Claude · idle 3m')
})

test('the row is never wider than the pane, whatever the pane', () => {
  const one = activityOf({
    rounds: [
      round({
        ms: 125 * MINUTE,
        input: 1_200_000,
        output: 9_000,
        agents: ['Claude', 'general-purpose', 'Explore'],
      }),
    ],
    lastAgent: 'general-purpose',
    tool: 'Bash',
    target: 'npm run build -- --watch --verbose',
    isToolRunning: true,
  })

  for (let columns = 1; columns <= 100; columns += 1) {
    expect(
      cellWidth(text(detailSegs(columns, one, RUNNING, NOW, TITLE_AT))),
    ).toBeLessThanOrEqual(columns)
  }
})

// Layout: a Claude card Claude has worked on gets a second row.

function cardOf(number: number, column: KanbanColumn): KanbanCard {
  return {
    id: `md:${number}`,
    number,
    title: `Card ${number}`,
    column,
    order: number,
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T11:00:00Z',
  }
}

const open = INITIAL_UI
const kinds = (rows: Row[]) =>
  rows.map(row => ('column' in row ? `${row.kind}:${row.column}` : row.kind))
// Without the blank filler that keeps the sections' heights.
const content = (rows: Row[]) =>
  kinds(rows).filter(kind => !kind.startsWith('blank'))

const worked = (...numbers: number[]): KanbanActivity => ({
  ...EMPTY_ACTIVITY,
  cards: Object.fromEntries(
    numbers.map(n => [`md:${n}`, activityOf({ cardId: `md:${n}` })]),
  ),
})

test('only a Claude card Claude has worked on has a second row', () => {
  const cards = [
    cardOf(1, 'claude'),
    cardOf(2, 'claude'),
    cardOf(3, 'human'),
    cardOf(4, 'backlog'),
  ]

  // Card 3 has activity but sits in Human; card 2 sits in Claude with none.
  expect([...detailIds(cards, worked(1, 3, 4), {})]).toEqual(['md:1'])
})

test('a card waiting in the queue has no second row, whatever Claude did on it before', () => {
  const cards = [cardOf(1, 'claude'), cardOf(2, 'claude')]

  expect([...detailIds(cards, worked(1, 2), { 'md:2': 'resume' })]).toEqual([
    'md:1',
  ])
})

test('the second row follows its card and belongs to its section', () => {
  const cards = [cardOf(1, 'claude'), cardOf(2, 'claude'), cardOf(3, 'backlog')]
  const rows = layoutBoard({
    cards,
    ui: open,
    bodyRows: 30,
    details: new Set(['md:1']),
  })

  expect(content(rows)).toEqual([
    'toolbar',
    'toolbar',
    'group',
    'header:backlog',
    'card:backlog',
    'header:claude',
    'card:claude',
    'detail:claude',
    'card:claude',
    'header:human',
    'empty:human',
    'group',
  ])
  // The row is the tree row it is drawn on, so a wheel over it is the Claude section's.
  const at = rows.findIndex(row => row.kind === 'detail')
  expect(hitTest(rows, at)).toBe('claude')
  expect(hitTest(rows, at + 1)).toBe('claude')
  expect(hitTest(rows, at - 5)).toBe('backlog')
})

test('with no second rows the layout is as it was', () => {
  const cards = [cardOf(1, 'claude'), cardOf(2, 'backlog')]

  expect(layoutBoard({ cards, ui: open, bodyRows: 30 })).toEqual(
    layoutBoard({ cards, ui: open, bodyRows: 30, details: new Set() }),
  )
})

test('the tree still fits the pane when second rows are on show', () => {
  const claude = Array.from({ length: 12 }, (_, i) => cardOf(i + 1, 'claude'))
  const others = [
    ...Array.from({ length: 9 }, (_, i) => cardOf(20 + i, 'human')),
    ...Array.from({ length: 9 }, (_, i) => cardOf(40 + i, 'backlog')),
  ]
  const cards = [...claude, ...others]
  const details = new Set(claude.map(one => one.id))

  for (const bodyRows of [20, 24, 30, 40]) {
    const rows = layoutBoard({ cards, ui: open, bodyRows, details })
    const bare = layoutBoard({ cards, ui: open, bodyRows })

    expect(rows.length).toBeLessThanOrEqual(bodyRows)
    expect(bare.length).toBeLessThanOrEqual(bodyRows)
    // A second row shows with its card, and the section is no taller for it.
    const shown = rows.filter(
      row => row.kind === 'card' && row.column === 'claude',
    )
    expect(rows.filter(row => row.kind === 'detail').length).toBe(shown.length)
    expect(rows.length).toBe(bare.length)
  }
})

test('a Claude section holds as many rows as another: its cards with second rows take two each', () => {
  const claude = Array.from({ length: 12 }, (_, i) => cardOf(i + 1, 'claude'))
  const details = new Set(claude.map(one => one.id))
  const rows = layoutBoard({ cards: claude, ui: open, bodyRows: 30, details })
  const claudeRows = rows.filter(
    row => 'column' in row && row.column === 'claude' && row.kind !== 'header',
  )

  // Seven rows: three cards with their second rows, and the count of the nine others.
  expect(claudeRows.map(row => row.kind)).toEqual([
    'card',
    'detail',
    'card',
    'detail',
    'card',
    'detail',
    'more',
  ])
  expect(claudeRows.at(-1)).toMatchObject({ dir: 'down', n: 9 })
})

test('a window pages by the cards it shows, however many rows their second rows take', () => {
  const claude = Array.from({ length: 12 }, (_, i) => cardOf(i + 1, 'claude'))
  const details = new Set(claude.map(one => one.id))

  const first = sectionWindow(claude, 'claude', 0, 7, details)
  expect(first.taken).toBe(3)
  const second = sectionWindow(claude, 'claude', first.taken, 7, details)
  // The count above takes a row, so two cards with their second rows fit with the count below.
  expect(second.rows[0]).toMatchObject({ kind: 'more', dir: 'up', n: 3 })
  expect(second.taken).toBe(2)
  expect(second.rows).toHaveLength(7)
})

// The second row, B.3: aligned to the title, joined by separators, stats kept short.

test('the second row starts at the title column, whatever the width of the numbers', () => {
  const one = activityOf({ tool: 'Edit', target: 'a.ts', isToolRunning: true })

  for (const indent of [3, 5, 7, 9]) {
    const line = text(detailSegs(60, one, RUNNING, NOW, indent))

    expect(line.indexOf('●')).toBe(indent)
  }
})

test('the name, the activity and the stats are joined by a dot, and the row says 48k, not 48k tok', () => {
  const one = activityOf({
    rounds: [round({ ms: 12 * MINUTE, input: 40_000, output: 8_000 })],
    lastAgent: 'Explore',
    tool: 'Edit',
    target: 'session.ts',
    isToolRunning: true,
  })

  expect(text(detailSegs(60, one, RUNNING, NOW, 5))).toBe(
    '     ● Explore · ⟳ Edit session.ts · 12m · 48k',
  )
  expect(
    text(
      detailSegs(
        60,
        { ...one, isToolRunning: false, lastAt: NOW - 3 * MINUTE },
        RUNNING,
        NOW,
        5,
      ),
    ),
  ).toBe('     ● Explore · idle 3m · 12m · 48k')
  // The detail view keeps the long form, where there is room to say what it is.
  expect(statsLabel(totalsOf(one.rounds))).toBe('12m · 48k tok')
})

test('a narrow pane gives up the activity first, then the name, and keeps the stats', () => {
  const one = activityOf({
    rounds: [round({ ms: 12 * MINUTE, input: 40_000, output: 8_000 })],
    lastAgent: 'Explore',
    tool: 'Edit',
    target: 'session.ts',
    isToolRunning: true,
  })
  const at = (columns: number) =>
    text(detailSegs(columns, one, RUNNING, NOW, 7))

  expect(at(44)).toBe('       ● Explore · ⟳ Edit …on.ts · 12m · 48k')
  // Too tight for the activity (under 6 cells): the name and the stats.
  expect(at(30)).toBe('       ● Explore · 12m · 48k')
  // Too tight for the name as well: just the stats.
  expect(at(24)).toBe('       ● 12m · 48k')
  for (const columns of [24, 30, 44]) {
    expect(cellWidth(at(columns))).toBeLessThanOrEqual(columns)
  }
})

test("Claude's own dot is always Claude's colour, and a subagent's never is, nor the colour for what needs you", () => {
  expect(colorOf('Claude')).toBe('claude')
  const names = [
    'Explore',
    'Plan',
    'general-purpose',
    'reviewer',
    'a',
    'b',
    'c',
    'test-runner',
    'security-auditor',
    'x1',
    'x2',
    'x3',
  ]
  const colours = names.map(colorOf)

  expect(colours).not.toContain('claude')
  expect(colours).not.toContain('permission')
  // The same name always gets the same colour, however it is cased.
  expect(colorOf('explore')).toBe(colorOf('Explore'))
  expect(new Set(colours).size).toBeGreaterThan(2)
})

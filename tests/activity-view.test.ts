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
  roundLabel,
  tokenLabel,
  totalLabel,
  totalsOf,
  truncateStart,
} from '../hooks/activity-view'
import { detailReserve, hitTest, layoutBoard } from '../hooks/layout'
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
  expect(totalLabel(totalsOf(rounds))).toBe(
    'Total · 8m · 48k tok · 120k cached',
  )
  expect(roundLabel(2, rounds[1] as KanbanRound)).toBe(
    'Round 2 · 3m · 36k tok · 70k cached · Claude',
  )
})

test('a card row stays on one line while Claude has nothing to show yet', () => {
  expect(totalLabel(totalsOf([round()]))).toBe('Total · -')
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
  const segs = detailSegs(44, one, RUNNING, NOW)

  expect(text(segs)).toBe('    ● Claude ⟳ Edit src/auth.ts')
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
  const segs = detailSegs(44, one, RUNNING, NOW)

  expect(text(segs)).toBe('    ●●● Explore ⟳ Grep login')
  expect(segs.filter(one => one.text === '●').map(one => one.color)).toEqual([
    colorOf('Claude'),
    colorOf('Explore'),
    colorOf('Plan'),
  ])
})

test('past four agents the dots stop and a count follows', () => {
  const names = ['Claude', 'a', 'b', 'c', 'd', 'e']
  const one = activityOf({ rounds: [round({ agents: names })] })

  expect(text(detailSegs(44, one, STOPPED, NOW))).toContain('●●●●+2')
})

test('the stats keep their room and a path gives up its front', () => {
  const one = activityOf({
    rounds: [round({ ms: 12 * MINUTE, input: 40_000, output: 8_000 })],
    tool: 'Edit',
    target: 'src/hooks/authentication.ts',
    isToolRunning: true,
  })
  const line = text(detailSegs(44, one, STOPPED, NOW))
  const running = text(detailSegs(44, one, RUNNING, NOW))

  expect(line).toMatch(/ · 12m · 48k tok$/)
  expect(line).toContain('idle')
  expect(running).toMatch(/^ {4}● Claude ⟳ Edit …\S+ · 12m · 48k tok$/)
  expect(cellWidth(running)).toBeLessThanOrEqual(44)
})

test('a turn running on the card counts its time up to now', () => {
  const one = activityOf({ rounds: [round({ ms: 2 * MINUTE })] })
  const live = { ...RUNNING, since: NOW - 3 * MINUTE }

  expect(text(detailSegs(60, one, live, NOW))).toContain('5m')
  expect(text(detailSegs(60, one, STOPPED, NOW))).toContain('2m')
})

test('Claude is idle once nothing has run for a minute, and says for how long', () => {
  const one = activityOf({
    tool: 'Bash',
    target: 'npm test',
    isToolRunning: false,
    lastAt: NOW - 3 * MINUTE,
  })

  expect(text(detailSegs(44, one, RUNNING, NOW))).toBe('    ● Claude idle 3m')
  expect(
    text(detailSegs(44, { ...one, lastAt: NOW - 20_000 }, RUNNING, NOW)),
  ).toBe('    ● Claude ⟳ Bash npm test')
  // A tool still running is not idle, however long it takes.
  expect(
    text(detailSegs(44, { ...one, isToolRunning: true }, RUNNING, NOW)),
  ).toBe('    ● Claude ⟳ Bash npm test')
  // With no turn running it is idle, whatever the card was last doing.
  expect(
    text(detailSegs(44, { ...one, isToolRunning: true }, STOPPED, NOW)),
  ).toBe('    ● Claude idle 3m')
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
      cellWidth(text(detailSegs(columns, one, RUNNING, NOW))),
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

const open = {
  ...INITIAL_UI,
  collapsed: { human: false, claude: false, backlog: false, done: false },
}
const kinds = (rows: Row[]) =>
  rows.map(row => ('column' in row ? `${row.kind}:${row.column}` : row.kind))

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

  expect(kinds(rows)).toEqual([
    'toolbar',
    'toolbar',
    'header:human',
    'empty:human',
    'header:claude',
    'card:claude',
    'detail:claude',
    'card:claude',
    'header:backlog',
    'card:backlog',
    'header:done',
    'empty:done',
  ])
  // The row is the tree row it is drawn on, so a wheel over it is the Claude section's.
  expect(hitTest(rows, 6)).toBe('claude')
  expect(hitTest(rows, 7)).toBe('claude')
  expect(hitTest(rows, 9)).toBe('backlog')
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
    expect(rows.filter(row => row.kind === 'detail').length).toBe(
      rows.filter(row => row.kind === 'card' && row.column === 'claude').length,
    )
  }
})

test('second rows are kept room for only while the Claude section is open', () => {
  const cards = [cardOf(1, 'claude'), cardOf(2, 'claude')]
  const details = new Set(['md:1', 'md:2'])

  expect(detailReserve(cards, open, details)).toBe(2)
  expect(detailReserve(cards, open, undefined)).toBe(0)
  expect(
    detailReserve(
      cards,
      { ...open, collapsed: { ...open.collapsed, claude: true } },
      details,
    ),
  ).toBe(0)
})

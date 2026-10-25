import type { AgentInfo, On, RenderSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { colorOf } from '../hooks/activity-view'
import { cellWidth } from '../hooks/model'
import {
  click,
  keys,
  listRows,
  litRows,
  marks,
  row,
  rowIndex,
  rowKeys,
} from './board-ui'
import type { BoardUi } from './board-ui'
import { NOW, PANE, RUN, SCROLL, SYNC_PAUSE, boot, card, path } from './fakes'

const EVERY_SURFACE = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const WITH_CLIENT = ['terminal', 'desktop'] as const

const KANBAN = (name: string) => `mcp__kanban__kanban_${name}` as const
const API = 'card:md:0002-api'
const API_ROW = 'act:md:0002-api'
const MINUTE = 60_000

const cards = () => ({
  [path(1, 'login')]: card(1, { status: 'human', title: 'Fix login' }),
  [path(2, 'api')]: card(2, { status: 'claude', title: 'Build API' }),
  [path(3, 'docs')]: card(3, { status: 'backlog', title: 'Write docs' }),
})

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const usage = (
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): Usage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
})

/** The engine's side of a model turn, its subagents and their list. */
function fakeAgents(on: On) {
  const world = {
    usage: usage(0, 0),
    list: [] as AgentInfo[],
    isListDown: false,
    spawned: 0,
    steps: 0,
  }

  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { ...world.usage, model: 'm' },
    }
  })
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => {
    world.spawned += 1

    return { model: 'm', agentId: `agent-${world.spawned}` }
  })
  on('agent.list', () =>
    world.isListDown ? { deny: 'agents unavailable' } : { value: world.list },
  )

  return world
}

async function start<S extends RenderSurface>(
  $: Engine,
  on: On,
  surface: S,
  files: Record<string, string> = cards(),
  store?: Record<string, unknown>,
) {
  const world = boot(on, files, store)
  const agents = fakeAgents(on)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })

  const turn = (n = 1) => ({ text: 'go', turnId: `t${n}` })
  const step = async (spent: Usage, agentId?: string) => {
    agents.usage = spent
    agents.steps += 1
    const stream = $.turn.step({
      turnId: 't1',
      index: agents.steps,
      model: 'm',
      messageCount: 1,
      ...(agentId === undefined ? {} : { agentId }),
    })
    for await (const _chunk of stream) {
      // The chunks are not read; the usage comes with the result.
    }
    await stream.result
  }
  const finish = (n = 1) =>
    $.turn.complete({
      answer: 'done',
      durationMs: 0,
      isAborted: false,
      turnId: `t${n}`,
      reason: 'answer',
    })

  return { ...world, files, agents, ui, turn, step, finish }
}

const showCard = ($: Engine, number: number) =>
  $.tool.call({ tool: KANBAN('show'), card: number })

const spawn = ($: Engine, subagentType: string) =>
  $.agent.spawn({
    tool_use_id: `use-${subagentType}`,
    prompt: 'Look around.',
    description: 'Look around',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: false,
    fork: false,
  })

const explorer = (id: string): AgentInfo => ({
  id,
  description: 'Look around',
  type: 'Explore',
  status: 'running',
})

// The second row under a card, drawn by the Client or as a Text.
async function detail(ui: BoardUi, id = API_ROW) {
  const found = (await ui.find({ type: 'Client', key: 'board' }))
    ? await row(ui, id)
    : await ui.find({ type: 'Text', text: /^ {4}●/ })

  return found?.text
}

test('the main session shows as Claude with a dot on its card', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')
  expect(await row(ui, API_ROW)).toBeUndefined()

  await $.turn.start(turn())
  await showCard($, 2)

  expect(await detail(ui)).toBe('    ● Claude ⟳ working')
  expect((await marks(ui, '●')).map(one => one.props.color)).toEqual([
    colorOf('Claude'),
  ])
  await ui.unmount()
})

test('a card Claude has not worked on has no second row, nor one in another section', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')

  await $.turn.start(turn())
  await showCard($, 1)
  await showCard($, 3)

  expect((await rowKeys(ui)).filter(key => key.startsWith('act:'))).toEqual([])
  await ui.unmount()
})

test('a subagent shows by its type, with its own dot, and keeps its colour on a redraw', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  await spawn($, 'Explore')
  await $.tool.call({
    tool: 'WebSearch',
    query: 'login',
    mode: 'standard',
    agentId: 'agent-1',
  })

  expect(await detail(ui)).toBe('    ●● Explore ⟳ WebSearch login')
  const colours = [colorOf('Claude'), colorOf('Explore')]
  expect((await marks(ui, '●')).map(one => one.props.color)).toEqual(colours)

  await ui.press({ key: 'refresh' })
  await $.tool.call({
    tool: 'WebSearch',
    query: 'logout',
    mode: 'standard',
    agentId: 'agent-1',
  })
  expect(await detail(ui)).toBe('    ●● Explore ⟳ WebSearch logout')
  expect((await marks(ui, '●')).map(one => one.props.color)).toEqual(colours)
  await ui.unmount()
})

test('two subagents of one type are one agent', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  await spawn($, 'Explore')
  await spawn($, 'Explore')
  await spawn($, 'Plan')

  expect((await marks(ui, '●')).map(one => one.props.color)).toEqual([
    colorOf('Claude'),
    colorOf('Explore'),
    colorOf('Plan'),
  ])
  await ui.unmount()
})

test('a named subagent shows by its name', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  await $.agent.spawn({
    tool_use_id: 'use-1',
    prompt: 'Review.',
    description: 'Review',
    subagentType: 'general-purpose',
    name: 'reviewer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: false,
    fork: false,
  })
  await $.tool.call({
    tool: 'Read',
    file_path: '/work/a.ts',
    agentId: 'agent-1',
  })

  expect(await detail(ui)).toBe('    ●● reviewer ⟳ Read a.ts')
  await ui.unmount()
})

test('a subagent the spawn hook did not see is found in the agent list', async ($, on) => {
  const { ui, turn, agents } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  agents.list = [explorer('agent-7')]
  await $.tool.call({
    tool: 'WebSearch',
    query: 'login',
    mode: 'standard',
    agentId: 'agent-7',
  })
  expect(await detail(ui)).toBe('    ●● Explore ⟳ WebSearch login')

  // One no list names, as the engine's own forks are, is left out.
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'agent-9' })
  expect(await detail(ui)).toBe('    ●● Explore ⟳ WebSearch login')
  await ui.unmount()
})

test('a subagent works for the card its spawner worked for when it was spawned', async ($, on) => {
  const files = {
    ...cards(),
    [path(4, 'web')]: card(4, { status: 'claude', title: 'Build web' }),
  }
  const { ui, turn } = await start($, on, 'terminal', files)
  await $.turn.start(turn())
  await showCard($, 2)
  await spawn($, 'Explore')
  await showCard($, 4)

  await $.tool.call({
    tool: 'WebSearch',
    query: 'login',
    mode: 'standard',
    agentId: 'agent-1',
  })

  expect(await detail(ui, API_ROW)).toBe('    ●● Explore ⟳ WebSearch login')
  expect(await detail(ui, 'act:md:0004-web')).toBe('    ● Claude ⟳ working')
  await ui.unmount()
})

test('the activity line follows the tool calls and turns idle when they stop', async ($, on) => {
  const { clock, ui, turn, finish } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  const edited = await $.tool.call({
    tool: 'Edit',
    file_path: '/work/src/auth.ts',
    old_string: 'a',
    new_string: 'b',
  })
  expect(edited).toMatchObject({ result: {} })
  expect(await detail(ui)).toBe('    ● Claude ⟳ Edit src/auth.ts')

  await $.tool.call({ tool: 'Bash', command: 'npm test\nnpm run lint' })
  expect(await detail(ui)).toBe('    ● Claude ⟳ Bash npm test')

  await $.tool.call({ tool: KANBAN('list') })
  expect(await detail(ui)).toBe('    ● Claude ⟳ kanban_list')

  await finish()
  expect(await detail(ui)).toBe('    ● Claude idle')

  await clock.advance(3 * MINUTE)
  await ui.press({ key: 'refresh' })
  expect(await detail(ui)).toContain('idle 3m')
  await ui.unmount()
})

test('a turn with no tool for a minute is idle, and a new tool wakes it', async ($, on) => {
  const { clock, ui, turn } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  await clock.advance(2 * MINUTE)
  await ui.press({ key: 'refresh' })
  expect(await detail(ui)).toContain('idle 2m')

  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  expect(await detail(ui)).toContain('⟳ Read README.md')
  await ui.unmount()
})

test('a long path or command is cut to the pane, a path from its front', async ($, on) => {
  const { ui, turn } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  await $.tool.call({
    tool: 'Write',
    file_path: '/work/src/modules/authentication/providers/oauth/callback.ts',
    content: 'x',
  })
  const path = await detail(ui)
  expect(cellWidth(path ?? '')).toBeLessThanOrEqual(44)
  expect(path).toBe('    ● Claude ⟳ Write …/oauth/callback.ts')

  await $.tool.call({
    tool: 'Bash',
    command: 'npm run build -- --watch --verbose --some-very-long-flag value',
  })
  const command = await detail(ui)
  expect(cellWidth(command ?? '')).toBeLessThanOrEqual(44)
  expect(command).toBe('    ● Claude ⟳ Bash npm run build -- --watc…')
  await ui.unmount()
})

test('tokens add up from the model requests while the card is active', async ($, on) => {
  const { ui, turn, step } = await start($, on, 'terminal')
  await $.turn.start(turn())
  // Before a card is the turn's, nothing is counted.
  await step(usage(9_000, 1_000))
  await showCard($, 2)

  await step(usage(10_000, 2_000, 50_000))
  await step(usage(30_000, 6_000, 70_000))
  expect(await detail(ui)).toMatch(/ · 48k tok$/)

  // Tokens written to the cache were new input; those read are kept apart.
  await step(usage(500, 100, 0, 1_400))
  expect(await detail(ui)).toMatch(/ · 50k tok$/)
  expect(await detail(ui)).not.toContain('cached')

  await spawn($, 'Explore')
  await step(usage(1_000, 1_000), 'agent-1')
  expect(await detail(ui)).toMatch(/ · 52k tok$/)
  await ui.unmount()
})

test('the detail view lists the agents by name and breaks the totals into rounds', async ($, on) => {
  const { clock, ui, turn, step, finish } = await start($, on, 'terminal')
  await $.turn.start(turn(1))
  await showCard($, 2)
  await spawn($, 'Explore')
  await step(usage(10_000, 2_000, 50_000))
  await clock.advance(5 * MINUTE)
  await finish(1)

  await $.tool.call({ tool: KANBAN('move'), card: 2, to: 'backlog' })
  await $.tool.call({ tool: KANBAN('move'), card: 2, to: 'claude' })
  await $.turn.start(turn(2))
  await showCard($, 2)
  await step(usage(30_000, 6_000, 70_000))
  await clock.advance(3 * MINUTE)
  await finish(2)

  expect(await detail(ui)).toMatch(/ · 8m · 48k tok$/)
  await click(ui, API)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts).toContain('Agents: ● Claude ● Explore')
  expect(texts).toContain('Total · 8m · 48k tok · 120k cached')
  expect(texts).toContain(
    'Round 1 · 5m · 12k tok · 50k cached · Claude, Explore',
  )
  expect(texts).toContain('Round 2 · 3m · 36k tok · 70k cached · Claude')
  await ui.unmount()
})

test('time adds up across rounds, one for each time the card goes to Claude', async ($, on) => {
  const { clock, ui, turn, finish } = await start($, on, 'terminal')

  await $.turn.start(turn(1))
  await showCard($, 2)
  await clock.advance(5 * MINUTE)
  await finish(1)
  expect(await detail(ui)).toContain(' · 5m')

  await $.tool.call({ tool: KANBAN('move'), card: 2, to: 'backlog' })
  expect(await row(ui, API_ROW)).toBeUndefined()
  await $.tool.call({ tool: KANBAN('move'), card: 2, to: 'claude' })
  // Time outside a turn, as between rounds, is not counted.
  await clock.advance(20 * MINUTE)

  await $.turn.start(turn(2))
  await showCard($, 2)
  await clock.advance(3 * MINUTE)
  await ui.press({ key: 'refresh' })
  expect(await detail(ui)).toContain(' · 8m')
  await finish(2)

  await ui.press({ key: 'refresh' })
  expect(await detail(ui)).toMatch(/idle · 8m$/)
  await ui.unmount()
})

test('a turn started by the work prompt belongs to its card with no tool call', async ($, on) => {
  const { clock, ui, prompts, turn, step, finish } = await start(
    $,
    on,
    'terminal',
  )
  const from = await rowIndex(ui, 'card:md:0003-docs')
  const to = await rowIndex(ui, 'hdr:claude')
  await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
  await ui.pointer({ type: 'move', x: 3, y: to, button: 'left' })
  await ui.pointer({ type: 'up', x: 3, y: to, button: 'left' })
  await clock.advance(SYNC_PAUSE)
  expect(prompts).toEqual([expect.stringMatching(/^Work on kanban card #3 /)])

  // Someone else's turn, ahead of it, is nobody's.
  await $.turn.start({ text: 'hello', turnId: 't0' })
  await step(usage(7_000, 1_000))
  await finish(0)
  expect((await rowKeys(ui)).filter(key => key.startsWith('act:'))).toEqual([])

  await $.turn.start({ text: prompts[0] ?? '', turnId: 't1' })
  await clock.advance(2 * MINUTE)
  await step(usage(5_000, 1_000))
  await finish(1)

  expect(await detail(ui, 'act:md:0003-docs')).toMatch(/idle · 2m · 6k tok$/)
  await ui.unmount()
})

test('a later turn belongs to no card until it touches one', async ($, on) => {
  const { ui, turn, step, finish } = await start($, on, 'terminal')
  await $.turn.start(turn(1))
  await showCard($, 2)
  await step(usage(10_000, 2_000))
  await finish(1)

  await $.turn.start(turn(2))
  await step(usage(20_000, 4_000))
  await finish(2)

  expect(await detail(ui)).toMatch(/ · 12k tok$/)
  await ui.unmount()
})

test('watching changes nothing: the call answers as it would and a failure goes to the log', async ($, on) => {
  const { ui, turn, agents, logs } = await start($, on, 'terminal')
  await $.turn.start(turn())
  await showCard($, 2)

  agents.isListDown = true
  const result = await $.tool.call({
    tool: 'Bash',
    command: 'ls',
    agentId: 'agent-5',
  })

  expect(result).toMatchObject({ result: {} })
  expect(logs.some(line => line.includes("could not record Claude's"))).toBe(
    true,
  )
  expect(await detail(ui)).toBe('    ● Claude ⟳ working')
  await ui.unmount()
})

// Totals kept in the store, under the directory and the card.
const SAVED_KEY = 'activity:/work:md:0002-api'
const savedCard = (extra: Record<string, unknown> = {}) => ({
  cardId: 'md:0002-api',
  rounds: [
    {
      startedAt: NOW - 3 * 60 * MINUTE,
      ms: 5 * MINUTE,
      input: 10_000,
      output: 2_000,
      cacheRead: 50_000,
      agents: ['Claude'],
      isOpen: false,
    },
    {
      startedAt: NOW - 2 * 60 * MINUTE,
      ms: 7 * MINUTE,
      input: 30_000,
      output: 6_000,
      cacheRead: 70_000,
      agents: ['Claude', 'Explore'],
      isOpen: false,
    },
  ],
  lastAt: NOW - 2 * 60 * MINUTE,
  lastAgent: 'Explore',
  tool: '',
  target: '',
  toolId: '',
  isToolRunning: false,
  ...extra,
})

test('the totals are kept in the store when a turn ends', async ($, on) => {
  const { clock, saved, ui, turn, step, finish } = await start(
    $,
    on,
    'terminal',
  )
  await $.turn.start(turn())
  await showCard($, 2)
  await step(usage(10_000, 2_000, 50_000))
  await clock.advance(5 * MINUTE)
  await finish()

  expect(JSON.parse(saved.get(SAVED_KEY) ?? 'null')).toEqual({
    shape: 'activity-1',
    cwd: '/work',
    card: {
      cardId: 'md:0002-api',
      rounds: [
        {
          startedAt: NOW,
          ms: 5 * MINUTE,
          input: 10_000,
          output: 2_000,
          cacheRead: 50_000,
          agents: ['Claude'],
          isOpen: true,
        },
      ],
      lastAt: NOW + 5 * MINUTE,
      lastAgent: '',
      tool: '',
      target: '',
      toolId: '',
      isToolRunning: false,
    },
  })
  await ui.unmount()
})

test('the totals kept in the store come back after a reload', async ($, on) => {
  const { ui } = await start($, on, 'terminal', cards(), {
    [SAVED_KEY]: { shape: 'activity-1', cwd: '/work', card: savedCard() },
    // Another directory's, and one in a shape this code does not know, are left out.
    'activity:/other:md:0002-api': {
      shape: 'activity-1',
      cwd: '/other',
      card: savedCard({ cardId: 'md:0003-docs' }),
    },
    'activity:/work:md:0003-docs': {
      shape: 'activity-0',
      cwd: '/work',
      card: savedCard({ cardId: 'md:0003-docs' }),
    },
  })

  expect(await detail(ui)).toBe('    ●● Explore idle 2h · 12m · 48k tok')
  expect(await row(ui, 'act:md:0003-docs')).toBeUndefined()
  await ui.unmount()
})

test('a card that comes back after a reload starts a round of its own', async ($, on) => {
  const { clock, ui, turn, finish } = await start($, on, 'terminal', cards(), {
    [SAVED_KEY]: { shape: 'activity-1', cwd: '/work', card: savedCard() },
  })

  await $.turn.start(turn())
  await showCard($, 2)
  await clock.advance(2 * MINUTE)
  await finish()

  await click(ui, API)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts).toContain('Total · 14m · 48k tok · 120k cached')
  expect(texts).toContain('Round 3 · 2m · Claude')
  await ui.unmount()
})

for (const surface of EVERY_SURFACE) {
  test(`the second row is one line and the board draws on the ${surface}`, async ($, on) => {
    const { ui, turn, step } = await start($, on, surface)
    await $.turn.start(turn())
    await showCard($, 2)
    await spawn($, 'general-purpose')
    await step(usage(10_000, 2_000, 50_000))
    await $.tool.call({
      tool: 'Edit',
      file_path: '/work/src/modules/authentication/providers/oauth/callback.ts',
      old_string: 'a',
      new_string: 'b',
      agentId: 'agent-1',
    })

    expect(await detail(ui)).toMatch(/^ {4}●● general-purpo… /)
    const rows = [
      ...(await ui.findAll({ type: 'Button' })),
      ...(await ui.findAll({ type: 'Text' })),
      ...(await listRows(ui)),
    ]
    expect(rows.length).toBeGreaterThan(5)
    for (const one of rows) {
      expect(cellWidth(one.text)).toBeLessThanOrEqual(PANE.props.bodyColumns)
    }
    await ui.unmount()
  })
}

// Six Claude cards and eight in Backlog: the Claude section scrolls with second rows in it.
const crowded = () => {
  const files: Record<string, string> = {}
  for (let n = 11; n <= 16; n += 1) {
    files[path(n, 'c')] = card(n, { status: 'claude', title: `Claude ${n}` })
  }
  for (let n = 21; n <= 28; n += 1) {
    files[path(n, 'b')] = card(n, { title: `Backlog ${n}` })
  }

  return files
}

async function crowd<S extends RenderSurface>($: Engine, on: On, surface: S) {
  const world = await start($, on, surface, crowded())
  await $.turn.start(world.turn())
  for (let n = 11; n <= 16; n += 1) await showCard($, n)

  return world
}

for (const surface of WITH_CLIENT) {
  test(`second rows are rows of their section, for the wheel, a drag and the cursor on the ${surface}`, async ($, on) => {
    const { clock, ui, files, prompts, scrolls } = await crowd($, on, surface)
    const keysOf = async () => rowKeys(ui)

    // Four of the six cards show, each with its row, and the tree fits the pane.
    expect((await keysOf()).filter(key => key.startsWith('act:'))).toHaveLength(
      4,
    )
    expect((await keysOf()).length + 1).toBeLessThanOrEqual(30)
    const index = (await keysOf()).indexOf('card:md:0011-c')
    expect((await keysOf()).slice(index, index + 4)).toEqual([
      'card:md:0011-c',
      'act:md:0011-c',
      'card:md:0012-c',
      'act:md:0012-c',
    ])

    // The wheel over a second row scrolls the Claude section.
    const at = (key: string) => rowIndex(ui, key).then(y => y + 1)
    await $.ui.scroll({
      ...SCROLL,
      by: 1,
      pointer: { column: 3, row: await at('act:md:0011-c') },
    })
    expect(scrolls).toHaveLength(0)
    expect((await row(ui, 'more:claude:up'))?.text).toBe('  ↑ 1 more')
    expect(await row(ui, 'card:md:0011-c')).toBeUndefined()
    expect(await row(ui, 'act:md:0012-c')).toBeDefined()

    // Rows below the second rows are the rows they are drawn on.
    await $.ui.scroll({
      ...SCROLL,
      by: 1,
      pointer: { column: 3, row: await at('card:md:0021-b') },
    })
    expect(scrolls).toHaveLength(0)
    expect((await row(ui, 'more:backlog:up'))?.text).toBe('  ↑ 1 more')
    expect(await row(ui, 'more:claude:up')).toBeDefined()

    // A card dragged past second rows lands on the header it is dropped on.
    const from = await rowIndex(ui, 'card:md:0022-b')
    const human = await rowIndex(ui, 'hdr:human')
    await ui.pointer({ type: 'down', x: 3, y: from, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: human, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: human, button: 'left' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(22, 'b')]).toContain('status: human')

    // A drop on a second row moves nothing.
    const other = await rowIndex(ui, 'card:md:0023-b')
    const onRow = await rowIndex(ui, 'act:md:0012-c')
    await ui.pointer({ type: 'down', x: 3, y: other, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: onRow, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: onRow, button: 'left' })
    await clock.advance(SYNC_PAUSE)
    expect(files[path(23, 'b')]).toContain('status: backlog')
    expect(prompts).toEqual([])
    await ui.unmount()
  })

  test(`the cursor passes over second rows on the ${surface}`, async ($, on) => {
    const { ui } = await crowd($, on, surface)

    await keys(ui, 'down')
    for (let step = 0; step < 30; step += 1) {
      if ((await litRows(ui)).includes('card:md:0011-c')) break
      await keys(ui, 'down')
    }
    expect(await litRows(ui)).toEqual(['card:md:0011-c'])

    await keys(ui, 'down')
    expect(await litRows(ui)).toEqual(['card:md:0012-c'])
    await keys(ui, 'up')
    expect(await litRows(ui)).toEqual(['card:md:0011-c'])
    await ui.unmount()
  })
}

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { boot } from './fakes'
import { boardReply, issueNode, queryOf } from './fake-gh'
import type { Call, Route } from './fake-gh'
import { GRAPHQL, KANBAN, github } from './github-board'

const POSITION = 'updateProjectV2ItemPosition'

const OLD = issueNode({ number: 4, status: 'Backlog', title: 'Old idea' })
const FLIGHT = issueNode({ number: 5, status: 'In progress', title: 'Flying' })

// The board query is answered from `nodes`; the position mutation as `position` says.
const board = (
  nodes: readonly unknown[],
  position: Route['reply'] = { stdout: `{"data":{"${POSITION}":{}}}` },
): Route => ({
  match: GRAPHQL,
  reply: argv =>
    queryOf(argv).includes(POSITION)
      ? typeof position === 'function'
        ? position(argv)
        : position
      : boardReply(nodes)(argv),
})

const CLOSES: Route[] = [
  { match: ['gh', 'issue', 'close'], reply: {} },
  { match: ['gh', 'issue', 'view'], reply: { stdout: 'CLOSED COMPLETED' } },
]

async function start($: Engine, on: On, overrides: Route[] = []) {
  const { clock, logs } = boot(on, { 'CLAUDE.md': KANBAN })
  const calls = github(on, overrides)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  return { calls, logs }
}

const create = ($: Engine, column: string) =>
  $.tool.call({
    tool: 'mcp__kanban__kanban_create',
    title: 'Fix the login loop',
    spec: 'Users loop.',
    column,
  })

const positions = (calls: readonly Call[]) =>
  calls.map(call => call.argv).filter(argv => queryOf(argv).includes(POSITION))

test('kanban_create into Claude on GitHub positions the card after the last card there, once its status is set', async ($, on) => {
  const { calls } = await start($, on, [board([OLD, FLIGHT])])

  expect(await create($, 'claude')).toHaveProperty('result')

  expect(positions(calls).map(argv => argv.slice(5))).toEqual([
    [
      '-f',
      'projectId=PVT_kwHOAcCsLc4BorgL',
      '-f',
      'itemId=PVTI_30',
      '-f',
      'afterId=PVTI_5',
    ],
  ])
  const argvs = calls.map(call => call.argv)
  const edited = argvs.findLastIndex(argv => argv[2] === 'item-edit')
  const positioned = argvs.findIndex(argv => queryOf(argv).includes(POSITION))
  expect(edited).toBeGreaterThan(-1)
  expect(positioned).toBeGreaterThan(edited)
})

test('kanban_create into an empty Claude section on GitHub positions the card first, with no afterId', async ($, on) => {
  const { calls } = await start($, on, [board([OLD])])

  expect(await create($, 'claude')).toHaveProperty('result')

  expect(positions(calls).map(argv => argv.slice(5))).toEqual([
    ['-f', 'projectId=PVT_kwHOAcCsLc4BorgL', '-f', 'itemId=PVTI_30'],
  ])
})

test('kanban_create into Backlog or Done on GitHub sets no position', async ($, on) => {
  const { calls } = await start($, on, [...CLOSES, board([OLD, FLIGHT])])

  expect(await create($, 'backlog')).toHaveProperty('result')
  expect(await create($, 'done')).toHaveProperty('result')

  expect(positions(calls)).toEqual([])
})

test('a position GitHub refuses leaves the created card in Claude and goes to the debug log', async ($, on) => {
  const { calls, logs } = await start($, on, [
    board([OLD, FLIGHT], { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' }),
  ])

  expect(await create($, 'claude')).toMatchObject({
    result: expect.stringContaining('#30 [claude]'),
  })

  expect(positions(calls)).toHaveLength(1)
  expect(logs).toContain(
    'kanban: left #30 where GitHub put it, its position was not set: HTTP 502: Bad Gateway',
  )
})

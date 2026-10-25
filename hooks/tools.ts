import type { EngineInterface, ToolSpec } from 'claude-code'

import { announceHandoff, ensureBoard } from './board'
import { sectionList } from './layout'
import { COLUMNS, isColumn } from './model'
import { S } from './strings'
import { moveCard } from './sync'

type ToolName = 'kanban_list' | 'kanban_move'

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'kanban_list',
    description: S.toolList.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        column: {
          type: 'string',
          enum: [...COLUMNS],
          description: S.toolList.column,
        },
      },
    },
  },
  {
    name: 'kanban_move',
    description: S.toolMove.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'integer', description: S.toolMove.card },
        to: { type: 'string', enum: [...COLUMNS], description: S.toolMove.to },
      },
      required: ['card', 'to'],
    },
  },
]

type ToolAnswer = { result: string } | { deny: string }

async function list(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const { column } = input
  if (column !== undefined && !isColumn(column))
    return { deny: S.badColumn(column) }

  const board = await ensureBoard($)
  if (board.fetchedAt === 0) return { deny: S.boardUnavailable(board.error) }

  const lines = COLUMNS.filter(one => column === undefined || column === one)
    .flatMap(one => sectionList(board.cards, one))
    .map(S.listLine)

  return { result: lines.length === 0 ? S.listEmpty : lines.join('\n') }
}

async function move(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const { card: number, to } = input
  if (typeof number !== 'number' || !Number.isInteger(number))
    return { deny: S.badCard }
  if (!isColumn(to)) return { deny: S.badColumn(to) }

  const board = await ensureBoard($)
  if (board.fetchedAt === 0) return { deny: S.boardUnavailable(board.error) }

  const card = board.cards.find(one => one.number === number)
  if (card === undefined) return { deny: S.noSuchCard(number) }

  const moved = await moveCard($, card.id, to)
  if (moved.ok && to === 'human' && card.column !== 'human')
    announceHandoff($, card)

  return moved.ok
    ? { result: S.moved(card, to) }
    : { deny: S.moveFailed(card, to, moved.error) }
}

/** Serves one of this plugin's tools. */
export function runTool(
  $: EngineInterface,
  name: ToolName,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  return name === 'kanban_list' ? list($, input) : move($, input)
}

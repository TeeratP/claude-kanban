import type { EngineInterface, ToolSpec } from 'claude-code'

import type { KanbanBackendInfo, KanbanBoard, KanbanCard } from '../types'
import { readDetailState, readQueue, updateDetailState } from './atoms'
import { appendSection, createCard, readDetail } from './backend'
import { ensureBoard, inBackground, refresh, setBoard } from './board'
import {
  formatHandoff,
  formatQuestion,
  gistOf,
  isFilled,
  isHandoffValid,
} from './handoff'
import { sectionList } from './layout'
import { COLUMNS, errorMessage, isColumn, isPendingId, withCard } from './model'
import { S } from './strings'
import { suggestCard } from './suggest'
import { moveCard } from './sync'

type ToolName =
  | 'kanban_list'
  | 'kanban_show'
  | 'kanban_handoff'
  | 'kanban_move'
  | 'kanban_create'
  | 'kanban_ask'
  | 'kanban_suggest'

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
    name: 'kanban_show',
    description: S.toolShow.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'integer', description: S.toolShow.card },
      },
      required: ['card'],
    },
  },
  {
    name: 'kanban_handoff',
    description: S.toolHandoff.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'integer', description: S.toolHandoff.card },
        did: { type: 'string', description: S.toolHandoff.did },
        check: { type: 'string', description: S.toolHandoff.check },
        changed: { type: 'string', description: S.toolHandoff.changed },
        need: { type: 'string', description: S.toolHandoff.need },
      },
      required: ['card', 'check', 'need'],
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
  {
    name: 'kanban_create',
    description: S.toolCreate.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: S.toolCreate.title },
        spec: { type: 'string', description: S.toolCreate.spec },
        column: {
          type: 'string',
          enum: COLUMNS.filter(one => one !== 'human'),
          description: S.toolCreate.column,
        },
      },
      required: ['title', 'spec'],
    },
  },
  {
    name: 'kanban_ask',
    description: S.toolAsk.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'integer', description: S.toolAsk.card },
        question: { type: 'string', description: S.toolAsk.question },
      },
      required: ['card', 'question'],
    },
  },
  {
    name: 'kanban_suggest',
    description: S.toolSuggest.description,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: S.toolSuggest.title },
        spec: { type: 'string', description: S.toolSuggest.spec },
        why: { type: 'string', description: S.toolSuggest.why },
      },
      required: ['title', 'spec'],
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

  // A card still being made has no number the tools could name.
  const made = board.cards.filter(one => !isPendingId(one.id))
  const { held } = await readQueue($)
  const lines = COLUMNS.filter(one => column === undefined || column === one)
    .flatMap(one => sectionList(made, one))
    .map(card => S.listLine(card, held[card.id] !== undefined))

  return { result: lines.length === 0 ? S.listEmpty : lines.join('\n') }
}

type Ready = { board: KanbanBoard; info: KanbanBackendInfo }
type Found = { card: KanbanCard; info: KanbanBackendInfo }

/** The loaded board and its backend, whether or not the pane is open. */
async function ready($: EngineInterface): Promise<Ready | { deny: string }> {
  const board = await ensureBoard($)

  return board.fetchedAt === 0 || board.backend === null
    ? { deny: S.boardUnavailable(board.error) }
    : { board, info: board.backend }
}

/** The card a tool names, with the backend that holds it; a deny when it cannot be had. */
async function find(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<Found | { deny: string }> {
  const { card: number } = input
  if (typeof number !== 'number' || !Number.isInteger(number))
    return { deny: S.badCard }

  const loaded = await ready($)
  if ('deny' in loaded) return loaded

  const card = loaded.board.cards.find(
    one => one.number === number && !isPendingId(one.id),
  )

  return card === undefined
    ? { deny: S.noSuchCard(number) }
    : { card, info: loaded.info }
}

/** A text input, trimmed and empty when absent; undefined when it is not text. */
function textOf(value: unknown): string | undefined {
  if (value === undefined) return ''

  return typeof value === 'string' ? value.trim() : undefined
}

async function show(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const found = await find($, input)
  if ('deny' in found) return found

  try {
    const { body, sections } = await readDetail($, found.info, found.card)

    return {
      result: [
        S.listLine(found.card),
        body === '' ? S.noSpec : body,
        ...sections.map(one => `## ${S.headingOf(one)}\n${one.text}`),
      ].join('\n\n'),
    }
  } catch (error) {
    return { deny: S.detailFailed(errorMessage(error)) }
  }
}

/** Re-reads the open detail view if it shows this card, so a new section appears. */
async function refreshDetail($: EngineInterface, found: Found): Promise<void> {
  if ((await readDetailState($))?.cardId !== found.card.id) return

  const { body, sections } = await readDetail($, found.info, found.card)
  await updateDetailState($, detail =>
    detail?.cardId === found.card.id ? { ...detail, body, sections } : detail,
  )
}

async function handoff(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const fields = { did: '', check: '', changed: '', need: '' }
  for (const name of ['did', 'check', 'changed', 'need'] as const) {
    const text = textOf(input[name])
    if (text === undefined) return { deny: S.badText(name) }
    fields[name] = text
  }
  if (!isFilled(fields.check) || !isFilled(fields.need))
    return { deny: S.handoffIncomplete }

  const found = await find($, input)
  if ('deny' in found) return found

  try {
    const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
    await appendSection($, found.info, found.card, formatHandoff(fields, date))
  } catch (error) {
    return { deny: S.handoffFailed(errorMessage(error)) }
  }
  inBackground($, refreshDetail($, found))

  return { result: S.handedOff(found.card) }
}

async function ask(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const question = textOf(input.question)
  if (question === undefined) return { deny: S.badText('question') }
  if (question === '') return { deny: S.askEmpty }

  const found = await find($, input)
  if ('deny' in found) return found

  const { card, info } = found
  try {
    const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
    await appendSection($, info, card, formatQuestion(question, date))
  } catch (error) {
    return { deny: S.askFailed(errorMessage(error)) }
  }
  inBackground($, refreshDetail($, found))

  // The card is announced as a question once the backend confirms the move.
  await moveCard(
    $,
    card.id,
    'human',
    card.column === 'human' ? undefined : { announce: true },
  )
  await setBoard($, board => ({
    ...board,
    cards: board.cards.map(one =>
      one.id === card.id && one.column === 'human'
        ? { ...one, tag: 'question', question: gistOf(question) }
        : one,
    ),
  }))

  return { result: S.asked(card) }
}

async function move(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const { to } = input
  if (!isColumn(to)) return { deny: S.badColumn(to) }

  const found = await find($, input)
  if ('deny' in found) return found

  const { card, info } = found
  if (to === 'human') {
    try {
      const { sections } = await readDetail($, info, card)
      if (!isHandoffValid(sections)) return { deny: S.needHandoff(card) }
    } catch (error) {
      return { deny: S.detailFailed(errorMessage(error)) }
    }
  }

  // Announced only once the backend confirms: a refused move never reaches the person.
  await moveCard(
    $,
    card.id,
    to,
    to === 'human' && card.column !== 'human' ? { announce: true } : undefined,
  )

  return { result: S.moved(card, to) }
}

async function create(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const title = textOf(input.title)?.replace(/\s+/g, ' ')
  const spec = textOf(input.spec)
  const column = input.column ?? 'backlog'
  if (title === undefined || title === '') return { deny: S.badTitle }
  if (spec === undefined) return { deny: S.badText('spec') }
  if (!isColumn(column)) return { deny: S.badColumn(column) }
  if (column === 'human') return { deny: S.createNotHuman }

  const loaded = await ready($)
  if ('deny' in loaded) return loaded

  try {
    const card = await createCard($, loaded.info, title, spec, column)
    // Shown at once; the reload behind it settles what a load in flight missed.
    await setBoard($, board => ({
      ...board,
      cards: withCard(board.cards, card),
    }))
    inBackground($, refresh($))

    return { result: S.created(card) }
  } catch (error) {
    return { deny: S.createFailed(errorMessage(error)) }
  }
}

async function suggest(
  $: EngineInterface,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  const title = textOf(input.title)?.replace(/\s+/g, ' ')
  const spec = textOf(input.spec)
  const why = textOf(input.why)
  if (title === undefined || title === '') return { deny: S.badTitle }
  if (spec === undefined) return { deny: S.badText('spec') }
  if (why === undefined) return { deny: S.badText('why') }

  const isAdded = await suggestCard($, { title, spec, why })

  return { result: isAdded ? S.suggestedResult(title) : S.suggestFolded(title) }
}

/** Serves one of this plugin's tools. */
export function runTool(
  $: EngineInterface,
  name: ToolName,
  input: Record<string, unknown>,
): Promise<ToolAnswer> {
  switch (name) {
    case 'kanban_list':
      return list($, input)
    case 'kanban_show':
      return show($, input)
    case 'kanban_handoff':
      return handoff($, input)
    case 'kanban_move':
      return move($, input)
    case 'kanban_create':
      return create($, input)
    case 'kanban_ask':
      return ask($, input)
    case 'kanban_suggest':
      return suggest($, input)
  }
}

import type { EngineInterface, RenderInput, UiScrollInput } from 'claude-code'

import type { KanbanCard, KanbanColumn, KanbanSync } from '../types'
import { detailIds, detailSegs, segProps } from './activity-view'
import {
  readActivity,
  readBoard,
  readQueue,
  readPausedUntil,
  readSync,
  readTick,
  readUi,
  updateUi,
} from './atoms'
import { refresh } from './board'
import type { BoardProps } from './board-client'
import { parseBoardMessage, toRowViews } from './board-rows'
import {
  capFor,
  cardLine,
  clampOffset,
  detailReserve,
  hitTest,
  layoutBoard,
  openCount,
  sectionList,
} from './layout'
import type { Row } from './layout'
import { TICK_BRIGHT_MS, ageLabel, cellWidth, truncate } from './model'
import { headerCount, queuePlace, queueView } from './queue'
import { minutesLeft } from './rate-limit'
import { S } from './strings'
import { moveCard, moveOptions, retryAll } from './sync'
import { openDetail } from './view-detail'

// Where the pane's window sat at the last draw; a wheel row is relative to it.
let lastBody = { offset: 0, bodyRows: 0 }

// A terminal cell cannot spin or fade, so a pending mark pulses with the
// ticker and a confirmed one dims after its first second.
function glyphOf(entry: KanbanSync, tick: number, now: number) {
  switch (entry.phase) {
    case 'pending':
      return { text: S.syncing, color: 'warning', dim: tick % 2 === 1 }
    case 'ok':
      return {
        text: S.confirmed,
        color: 'success',
        dim: now - (entry.settledAt ?? now) >= TICK_BRIGHT_MS,
      }
    case 'failed':
      return { text: S.failedGlyph, color: 'error', dim: false }
  }
}

function toggleSection($: EngineInterface, column: KanbanColumn) {
  return updateUi($, ui => ({
    ...ui,
    collapsed: { ...ui.collapsed, [column]: !ui.collapsed[column] },
  }))
}

// Moves a section's window by `delta(cap)` cards, kept within its list; resolves
// whether the window shown moved.
async function scrollSection(
  $: EngineInterface,
  column: KanbanColumn,
  bodyRows: number,
  delta: (cap: number) => number,
): Promise<boolean> {
  const { cards } = await readBoard($)
  const len = sectionList(cards, column).length
  const details = detailIds(
    cards,
    await readActivity($),
    (await readQueue($)).held,
  )

  const seen = { isMoved: false }
  await updateUi($, ui => {
    const cap = capFor(
      bodyRows,
      openCount(ui),
      detailReserve(cards, ui, details),
    )
    const shown = clampOffset(ui.offsets[column], len, cap)
    const offset = clampOffset(shown + delta(cap), len, cap)
    seen.isMoved = offset !== shown

    return offset === ui.offsets[column]
      ? ui
      : { ...ui, offsets: { ...ui.offsets, [column]: offset } }
  })

  return seen.isMoved
}

/**
 * Scrolls the section under the wheel; false leaves the move to the engine, as it
 * does for a section already at the end the wheel points to.
 */
export async function handleBoardScroll(
  $: EngineInterface,
  e: UiScrollInput,
): Promise<boolean> {
  const ui = await readUi($)
  if (ui.view.mode !== 'board' || e.pointer === undefined) return false

  const { cards } = await readBoard($)
  const rows = layoutBoard({
    cards,
    ui,
    bodyRows: e.bodyRows,
    details: detailIds(cards, await readActivity($), (await readQueue($)).held),
  })
  const column = hitTest(rows, e.pointer.row + lastBody.offset)
  if (column === undefined || ui.collapsed[column]) return false

  const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by)))

  return scrollSection($, column, e.bodyRows, () => step)
}

/** Acts on what the board's Client posted: a click on a row or a card dropped. */
export async function handleBoardMessage(
  $: EngineInterface,
  data: unknown,
): Promise<void> {
  const message = parseBoardMessage(data)
  if (message === undefined) return

  switch (message.type) {
    case 'open':
      await openDetail($, message.cardId)
      break
    case 'drop': {
      const { cards } = await readBoard($)
      const from = cards.find(one => one.id === message.cardId)?.column
      await moveCard(
        $,
        message.cardId,
        message.column,
        from === undefined ? undefined : moveOptions(from, message.column),
      )
      break
    }
    case 'toggle':
      await toggleSection($, message.column)
      break
    case 'page':
      await scrollSection($, message.column, lastBody.bodyRows, cap =>
        message.dir === 'up' ? -cap : cap,
      )
      break
  }
}

export async function renderBoard($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const board = await readBoard($)
  const ui = await readUi($)
  const sync = await readSync($)
  const tick = await readTick($)
  const queued = await readQueue($)
  const queue = queueView(queued, board.cards, sync)
  const pausedUntil = await readPausedUntil($)
  const activity = await readActivity($)
  const now = await $.clock.now()
  const failed = Object.values(sync).filter(entry => entry.phase === 'failed')
  const { bodyColumns: columns, scroll } = e.props
  // Terminal and desktop draw the list through a Client, which takes the keys.
  const hasClient = e.surface === 'terminal' || e.surface === 'desktop'
  lastBody = { offset: scroll.offset, bodyRows: scroll.bodyRows }

  const rows = layoutBoard({
    cards: board.cards,
    ui,
    bodyRows: scroll.bodyRows,
    details: detailIds(board.cards, activity, queued.held),
  })
  const detailOf = (card: KanbanCard) => {
    const one = activity.cards[card.id]

    return one === undefined ? [] : detailSegs(columns, one, activity.live, now)
  }

  const draw = (row: Row) => {
    switch (row.kind) {
      case 'toolbar': {
        const label = S.backendLabel(board.mode, board.backend?.kind)
        const status =
          board.error ??
          (board.isLoading
            ? S.loading
            : pausedUntil > now
              ? S.rateLimitLow(minutesLeft(pausedUntil - now))
              : board.fetchedAt === 0
                ? ''
                : S.updated(ageLabel(board.fetchedAt, now)))
        const retryLabel = S.retryAll(failed.length)
        const room =
          columns - 1 - (failed.length === 0 ? 0 : cellWidth(retryLabel) + 1)
        const join = (parts: string[]) =>
          ` ${parts.filter(part => part !== '').join(' · ')}`
        // The key hint shows whole or not at all: a cut hint is noise.
        const withHint = join([label, status, S.keyHint])
        const text =
          hasClient && board.error === undefined && cellWidth(withHint) <= room
            ? withHint
            : truncate(join([label, status]), room)

        return (
          <Box flexDirection="row">
            <Button key="refresh" plain onPress={() => refresh($)}>
              {S.refresh}
            </Button>
            {board.error === undefined ? (
              <Text dimColor wrap="truncate-end">
                {text}
              </Text>
            ) : (
              <Text color="error" wrap="truncate-end">
                {text}
              </Text>
            )}
            {failed.length > 0 && (
              <Button key="retry-all" plain onPress={() => retryAll($)}>
                {' '}
                <Text color="error">{retryLabel}</Text>
              </Button>
            )}
          </Box>
        )
      }

      case 'header': {
        const { column } = row

        return (
          <Button
            key={`hdr:${column}`}
            plain
            onPress={() => toggleSection($, column)}
          >
            {ui.collapsed[column] ? S.expand : S.collapse}{' '}
            <Text weight="bold">{S.col[column]}</Text>{' '}
            <Text dimColor>
              {headerCount(row.column, row.shown, row.total, queue)}
            </Text>
          </Button>
        )
      }

      case 'more': {
        const { column, dir } = row

        return (
          <Button
            key={`more:${column}:${dir}`}
            plain
            onPress={() =>
              scrollSection($, column, scroll.bodyRows, cap =>
                dir === 'up' ? -cap : cap,
              )
            }
          >
            <Text dimColor wrap="truncate-end">
              {S.more(dir, row.n)}
            </Text>
          </Button>
        )
      }

      case 'card': {
        const { card } = row
        const entry = sync[card.id]
        const glyph =
          entry === undefined ? undefined : glyphOf(entry, tick, now)
        const place = queuePlace(queue, card.id)
        const line = cardLine(
          card,
          columns,
          glyph?.text ?? (place === undefined ? ' ' : S.queuedMark(place)),
          ageLabel(card.updatedAt, now),
        )
        const tint =
          glyph === undefined ? {} : { color: glyph.color, dimColor: glyph.dim }

        return (
          <Button
            key={`card:${card.id}`}
            plain
            dimColor={card.column === 'done' || place !== undefined}
            onPress={() => openDetail($, card.id)}
          >
            {line.left}
            {line.title}
            <Text {...tint}>{line.glyph}</Text>
            <Text dimColor>{line.age}</Text>
          </Button>
        )
      }

      case 'detail':
        return (
          <Text wrap="truncate-end">
            {detailOf(row.card).map(part => (
              <Text {...segProps(part)}>{part.text}</Text>
            ))}
          </Text>
        )

      case 'empty':
        return (
          <Text dimColor wrap="truncate-end">
            {S.empty}
          </Text>
        )

      case 'note':
        return (
          <Text dimColor wrap="truncate-end">
            {truncate(S.noCards, columns)}
          </Text>
        )
    }
  }

  // The Client takes the pointer for drag and drop; the toolbar stays Buttons
  // above it. (The table names a Client on every surface, so the surface
  // decides.)
  if (!hasClient) {
    return <Box flexDirection="column">{rows.map(draw)}</Box>
  }

  const { Client } = $.ui.resolve(e)
  const props: BoardProps = {
    rows: toRowViews({
      rows,
      columns,
      collapsed: ui.collapsed,
      glyphOf: card => {
        const entry = sync[card.id]

        return entry === undefined ? undefined : glyphOf(entry, tick, now)
      },
      ageOf: card => ageLabel(card.updatedAt, now),
      detailOf,
      queue,
    }),
    columns,
  }

  return (
    <Box flexDirection="column">
      {draw({ kind: 'toolbar' })}
      <Client
        key="board"
        module="./board-client.tsx"
        props={props}
        width="100%"
        height={props.rows.length}
      />
    </Box>
  )
}

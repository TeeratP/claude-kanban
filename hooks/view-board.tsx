import type { EngineInterface, RenderInput, UiScrollInput } from 'claude-code'

import type { KanbanColumn, KanbanSync } from '../types'
import { readBoard, readSync, readTick, readUi, updateUi } from './atoms'
import { refresh } from './board'
import {
  capFor,
  cardLine,
  clampOffset,
  hitTest,
  layoutBoard,
  openCount,
  sectionList,
} from './layout'
import type { Row } from './layout'
import { TICK_BRIGHT_MS, ageLabel, cellWidth, truncate } from './model'
import { S } from './strings'
import { retryAll } from './sync'
import { openDetail } from './view-detail'

// Where the pane's window sat at the last draw; a wheel row is relative to it.
let lastBody = { offset: 0 }

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

// Moves a section's window by `delta(cap)` cards, kept within its list.
async function scrollSection(
  $: EngineInterface,
  column: KanbanColumn,
  bodyRows: number,
  delta: (cap: number) => number,
) {
  const { cards } = await readBoard($)
  const len = sectionList(cards, column).length

  await updateUi($, ui => {
    const cap = capFor(bodyRows, openCount(ui))
    const shown = clampOffset(ui.offsets[column], len, cap)
    const offset = clampOffset(shown + delta(cap), len, cap)

    return offset === ui.offsets[column]
      ? ui
      : { ...ui, offsets: { ...ui.offsets, [column]: offset } }
  })
}

/** Scrolls the section under the wheel; false leaves the move to the engine. */
export async function handleBoardScroll(
  $: EngineInterface,
  e: UiScrollInput,
): Promise<boolean> {
  const ui = await readUi($)
  if (ui.view.mode !== 'board' || e.pointer === undefined) return false

  const { cards } = await readBoard($)
  const rows = layoutBoard({ cards, ui, bodyRows: e.bodyRows })
  const column = hitTest(rows, e.pointer.row + lastBody.offset)
  if (column === undefined || ui.collapsed[column]) return false

  const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by)))
  await scrollSection($, column, e.bodyRows, () => step)

  return true
}

export async function renderBoard($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const board = await readBoard($)
  const ui = await readUi($)
  const sync = await readSync($)
  const tick = await readTick($)
  const now = await $.clock.now()
  const failed = Object.values(sync).filter(entry => entry.phase === 'failed')
  const { bodyColumns: columns, scroll } = e.props
  lastBody = { offset: scroll.offset }

  const rows = layoutBoard({
    cards: board.cards,
    ui,
    bodyRows: scroll.bodyRows,
  })

  const draw = (row: Row) => {
    switch (row.kind) {
      case 'toolbar': {
        const label =
          board.backend?.kind === 'github'
            ? S.backendGithub(board.backend.repo)
            : S.backendLocal
        const status =
          board.error ??
          (board.isLoading
            ? S.loading
            : board.fetchedAt === 0
              ? ''
              : S.updated(ageLabel(board.fetchedAt, now)))
        const retryLabel = S.retryAll(failed.length)
        const text = truncate(
          ` ${[label, status].filter(part => part !== '').join(' · ')}`,
          columns - 1 - (failed.length === 0 ? 0 : cellWidth(retryLabel) + 1),
        )

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
            <Text dimColor>{S.count(row.shown, row.total)}</Text>
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
        const line = cardLine(
          card,
          columns,
          glyph?.text ?? ' ',
          ageLabel(card.updatedAt, now),
        )
        const tint =
          glyph === undefined ? {} : { color: glyph.color, dimColor: glyph.dim }

        return (
          <Button
            key={`card:${card.id}`}
            plain
            dimColor={card.column === 'done'}
            onPress={() => openDetail($, card.id)}
          >
            {line.left}
            {line.title}
            <Text {...tint}>{line.glyph}</Text>
            <Text dimColor>{line.age}</Text>
          </Button>
        )
      }

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

  return <Box flexDirection="column">{rows.map(draw)}</Box>
}

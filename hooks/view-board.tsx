import type { EngineInterface, RenderInput, UiScrollInput } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanColumn,
  KanbanSync,
} from '../types'
import { detailIds, detailSegs, segProps } from './activity-view'
import {
  readActivity,
  readBoard,
  readQueue,
  readPausedUntil,
  readQuickAdd,
  readSuggestions,
  readSync,
  readTick,
  readUi,
  updateUi,
} from './atoms'
import { refresh } from './board'
import type { BoardProps } from './board-client'
import { parseBoardMessage, toRowViews } from './board-rows'
import { isFiltering } from './filter'
import {
  TOOLBAR_ROWS,
  applyFilter,
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
import { toggleQuickAdd } from './quick-add'
import { minutesLeft } from './rate-limit'
import { changeBoard } from './pick'
import { dropCard, shiftCard } from './reorder'
import { S } from './strings'
import { stripRows } from './suggest'
import { retryAll } from './sync'
import { planActions } from './toolbar'
import type { PlacedAction } from './toolbar'
import { openDetail } from './view-detail'
import { clearFilter, renderFilter, toggleFilter } from './view-filter'
import { pickRows, renderPicker } from './view-pick'
import { renderQuickAdd } from './view-quick-add'
import { renderSuggestions } from './view-suggest'

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

// Why a local board has no GitHub behind it, when the backend knows.
function localNote(info: KanbanBackendInfo | null): string | undefined {
  if (info?.kind !== 'local') return undefined
  if (info.isConfigUnclear === true) return S.configUnclear

  return info.noBoardFor === undefined
    ? undefined
    : S.noGithubBoard(info.noBoardFor)
}

// Under a filter the press turns the section as drawn, which the filter may have
// opened, and leaves the stored flag for when the filter is gone.
async function toggleSection($: EngineInterface, column: KanbanColumn) {
  const { cards } = await readBoard($)

  return updateUi($, ui =>
    isFiltering(ui.filter)
      ? {
          ...ui,
          filterCollapsed: {
            ...ui.filterCollapsed,
            [column]: !applyFilter(cards, ui).ui.collapsed[column],
          },
        }
      : {
          ...ui,
          collapsed: { ...ui.collapsed, [column]: !ui.collapsed[column] },
        },
  )
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
  const details = detailIds(
    cards,
    await readActivity($),
    (await readQueue($)).held,
  )

  const seen = { isMoved: false }
  await updateUi($, ui => {
    // The window moves over the cards the filter lets through.
    const view = applyFilter(cards, ui)
    const len = sectionList(view.cards, column).length
    const cap = capFor(
      bodyRows,
      openCount(view.ui),
      detailReserve(view.cards, view.ui, details),
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

// Scrolls the section the card is in just far enough to keep it in sight.
async function keepInView(
  $: EngineInterface,
  column: KanbanColumn,
  at: { index: number; length: number },
): Promise<void> {
  const { cards } = await readBoard($)
  await updateUi($, ui => {
    const cap = capFor(lastBody.bodyRows, openCount(applyFilter(cards, ui).ui))
    const shown = clampOffset(ui.offsets[column], at.length, cap)
    const offset =
      at.index < shown
        ? at.index
        : at.index >= shown + cap
          ? at.index - cap + 1
          : shown

    return offset === shown
      ? ui
      : { ...ui, offsets: { ...ui.offsets, [column]: offset } }
  })
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
  // An open form or filter field pushes the list down by rows the layout does not know.
  if ((await readQuickAdd($)).isOpen || ui.isFilterOpen) return false

  const board = await readBoard($)
  const { cards } = board
  const rows = layoutBoard({
    cards,
    ui,
    bodyRows: e.bodyRows,
    details: detailIds(cards, await readActivity($), (await readQueue($)).held),
  })
  // The picker and the suggestions sit between the toolbar and the list, outside the layout.
  const strip = stripRows((await readSuggestions($)).length) + pickRows(board)
  const column = hitTest(rows, e.pointer.row + lastBody.offset - strip)
  if (column === undefined || applyFilter(cards, ui).ui.collapsed[column]) {
    return false
  }

  const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by)))

  return scrollSection($, column, e.bodyRows, () => step)
}

/** Acts on what the board's Client posted: a click on a row, a card dropped or a card moved a place. */
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
    case 'drop':
      await dropCard(
        $,
        message.cardId,
        message.column,
        message.place,
        (await readUi($)).filter,
      )
      break
    case 'shift': {
      const moved = await shiftCard(
        $,
        message.cardId,
        message.dir,
        (await readUi($)).filter,
      )
      if (moved !== undefined) await keepInView($, moved.column, moved)
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
  // New and Find open text fields, which the mobile app has none of.
  const canType = e.surface !== 'mobile'
  const isFiltered = isFiltering(ui.filter)
  // The sections as drawn: a collapsed one with a match is open while filtering.
  const { ui: shown } = applyFilter(board.cards, ui)
  const filterField = await renderFilter($, e)
  const quickAdd = await renderQuickAdd($, e)
  const suggested = await renderSuggestions($, e)
  const picker = renderPicker($, e, board)
  lastBody = { offset: scroll.offset, bodyRows: scroll.bodyRows }

  const rows = layoutBoard({
    cards: board.cards,
    ui,
    bodyRows: scroll.bodyRows,
    details: detailIds(board.cards, activity, queued.held),
    hint: board.mode === 'auto' && board.backend?.kind === 'local',
  })
  const detailOf = (card: KanbanCard) => {
    const one = activity.cards[card.id]

    return one === undefined ? [] : detailSegs(columns, one, activity.live, now)
  }

  // The status text, dim: the backend, the board, how fresh it is, and why not.
  const statusRow = () => {
    const backendName = S.backendLabel(board.mode, board.backend?.kind)
    const note = localNote(board.backend)
    const isNoted = note !== undefined
    const detected =
      board.backend?.kind === 'github' && board.backend.isDetected === true
        ? board.backend
        : undefined
    const boardName =
      detected?.title === undefined
        ? ''
        : S.boardName(detected.projectNumber, detected.title)
    const status =
      board.error ??
      (board.isLoading
        ? S.loading
        : pausedUntil > now
          ? S.rateLimitLow(minutesLeft(pausedUntil - now))
          : board.fetchedAt === 0
            ? ''
            : S.updated(ageLabel(board.fetchedAt, now)))
    const room = columns
    const join = (parts: string[]) =>
      ` ${parts.filter(part => part !== '').join(' · ')}`
    // A detected board's name takes what the backend's name and the status leave,
    // cut to fit; with too little room left it is left out.
    const nameRoom =
      room - (cellWidth(join([`${backendName} · X`, status])) - 1)
    const shownName =
      boardName === '' || nameRoom < cellWidth('#00 …')
        ? ''
        : truncate(boardName, nameRoom)
    const label =
      note !== undefined
        ? `${backendName} · ${note}`
        : shownName === ''
          ? backendName
          : `${backendName} · ${shownName}`
    // The key hint shows whole or not at all: a cut hint is noise.
    const withHint = join([label, status, S.keyHint])
    // A status that fits only without the backend's name is shown whole, not cut;
    // a note on why the board is local is never dropped for it.
    const whole = join([label, status])
    const bare = join([status])
    const text =
      hasClient && board.error === undefined && cellWidth(withHint) <= room
        ? withHint
        : cellWidth(whole) > room &&
            !isNoted &&
            status !== '' &&
            cellWidth(bare) <= room
          ? bare
          : truncate(whole, room)

    if (board.error !== undefined) {
      return (
        <Text color="error" wrap="truncate-end">
          {text}
        </Text>
      )
    }

    return detected === undefined ? (
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    ) : (
      <Button key="source" plain dimColor onPress={() => changeBoard($)}>
        <Text dimColor wrap="truncate-end">
          {text}
        </Text>
      </Button>
    )
  }

  // The buttons, each labelled with its hotkey as the engine draws a plain
  // Button that has one (`n: New`), apart by Text rather than side by side.
  const actionsRow = () => {
    const actions = planActions({
      columns,
      canType,
      query: ui.filter,
      failed: failed.length,
    })
    const button = (action: PlacedAction) => {
      switch (action.key) {
        case 'refresh':
          return (
            <Button
              key="refresh"
              plain
              hotkey={action.hotkey}
              onPress={() => refresh($)}
            >
              {action.label}
            </Button>
          )
        case 'add':
          return (
            <Button
              key="add"
              plain
              hotkey={action.hotkey}
              onPress={() => toggleQuickAdd($)}
            >
              {action.label}
            </Button>
          )
        case 'filter':
          return (
            <Button
              key="filter"
              plain
              hotkey={action.hotkey}
              onPress={() => toggleFilter($)}
            >
              {action.label}
            </Button>
          )
        case 'filter:clear':
          return (
            <Button key="filter:clear" plain onPress={() => clearFilter($)}>
              {action.label}
            </Button>
          )
        case 'retry-all':
          return (
            <Button key="retry-all" plain onPress={() => retryAll($)}>
              <Text color="error">{action.label}</Text>
            </Button>
          )
      }
    }

    return (
      <Box flexDirection="row">
        {actions.flatMap(action => [
          action.before > 0 && (
            <Text key={`gap:${action.key}`}>{' '.repeat(action.before)}</Text>
          ),
          button(action),
        ])}
      </Box>
    )
  }

  const draw = (row: Row) => {
    switch (row.kind) {
      case 'toolbar':
        return row.line === 'status' ? statusRow() : actionsRow()

      case 'header': {
        const { column } = row

        return (
          <Button
            key={`hdr:${column}`}
            plain
            onPress={() => toggleSection($, column)}
          >
            {shown.collapsed[column] ? S.expand : S.collapse}{' '}
            <Text weight="bold">{S.col[column]}</Text>{' '}
            <Text dimColor>
              {headerCount(row.column, row.shown, row.total, queue, isFiltered)}
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
            {isFiltered ? S.noMatches : S.empty}
          </Text>
        )

      case 'note':
        return (
          <Text dimColor wrap="truncate-end">
            {truncate(S.noCards, columns)}
          </Text>
        )

      case 'hint':
        return (
          <Text dimColor wrap="truncate-end">
            {truncate(S.githubHint[row.line] ?? '', columns)}
          </Text>
        )
    }
  }

  // The Client takes the pointer for drag and drop; the toolbar stays Buttons
  // above it. (The table names a Client on every surface, so the surface
  // decides.)
  if (!hasClient) {
    return (
      <Box flexDirection="column">
        {rows.slice(0, TOOLBAR_ROWS).map(draw)}
        {picker}
        {filterField}
        {quickAdd}
        {suggested}
        {rows.slice(TOOLBAR_ROWS).map(draw)}
      </Box>
    )
  }

  const { Client } = $.ui.resolve(e)
  const props: BoardProps = {
    rows: toRowViews({
      rows,
      columns,
      collapsed: shown.collapsed,
      isFiltered,
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
      {rows.slice(0, TOOLBAR_ROWS).map(draw)}
      {picker}
      {filterField}
      {quickAdd}
      {suggested}
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

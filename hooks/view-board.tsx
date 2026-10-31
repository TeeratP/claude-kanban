import type { EngineInterface, RenderInput, UiScrollInput } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanColumn,
  KanbanGroup,
  KanbanSync,
} from '../types'
import { detailIds, detailSegs, segProps } from './activity-view'
import {
  readActivity,
  readBoard,
  readPausedUntil,
  readQuickAdd,
  readSync,
  readTick,
  readUi,
  updateBoard,
  updateUi,
} from './atoms'
import { refresh } from './board'
import type { BoardProps } from './board-client'
import { isDimCard, parseBoardMessage, toRowViews } from './board-rows'
import { isFiltering } from './filter'
import {
  TOOLBAR_ROWS,
  applyFilter,
  blocksOf,
  footRows,
  hitTest,
  layoutBoard,
  maxOffset,
  sectionBody,
  sectionList,
  sectionWindow,
  titleColumn,
} from './layout'
import type { Row } from './layout'
import { TICK_BRIGHT_MS, ageLabel } from './model'
import { quickAddRows, toggleQuickAdd } from './quick-add'
import { minutesLeft } from './rate-limit'
import { changeBoard } from './pick'
import { dropCard, shiftCard } from './reorder'
import { openSettings } from './settings'
import { S } from './strings'
import {
  SETTINGS_KEY,
  planStatus,
  settingsLabel,
  settingsText,
  settingsWidth,
} from './status'
import { retryAll } from './sync'
import { planActions } from './toolbar'
import type { PlacedAction } from './toolbar'
import { openDetail } from './view-detail'
import { clearFilter, renderFilter, toggleFilter } from './view-filter'
import { pickRows, renderPicker } from './view-pick'
import { renderSetup, setupRows } from './view-setup'
import { renderQuickAdd } from './view-quick-add'

// Where the pane's window sat at the last draw, and the rows above the list that
// the layout was told of; a wheel row is relative to it.
let lastBody = { offset: 0, bodyRows: 0, extraRows: 0 }

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

// A press on a group's header opens it, which folds the other, or folds it when
// it is open. Under a filter it turns the group as drawn, which the filter may
// have opened, and leaves the stored one for when the filter is gone.
async function toggleGroup($: EngineInterface, group: KanbanGroup) {
  const { cards } = await readBoard($)

  return updateUi($, ui => {
    if (isFiltering(ui.filter)) {
      return {
        ...ui,
        filterGroup:
          applyFilter(cards, ui).ui.openGroup === group ? 'none' : group,
      }
    }

    return { ...ui, openGroup: ui.openGroup === group ? 'none' : group }
  })
}

// The rows under each section's header in the pane as it was last drawn.
const bodyOf = (
  cards: readonly KanbanCard[],
  bodyRows: number,
  extraRows: number,
) => sectionBody({ bodyRows, extraRows, footRows: footRows(cards) }).body

// Moves a section's window by `delta(taken)` cards, kept within its list;
// resolves whether the window shown moved.
async function scrollSection(
  $: EngineInterface,
  column: KanbanColumn,
  bodyRows: number,
  extraRows: number,
  delta: (taken: number) => number,
): Promise<boolean> {
  const { cards } = await readBoard($)
  const details = detailIds(cards, await readActivity($))

  const seen = { isMoved: false }
  await updateUi($, ui => {
    // The window moves over the cards the filter lets through.
    const list = sectionList(applyFilter(cards, ui).cards, column)
    const body = bodyOf(cards, bodyRows, extraRows)
    const shown = sectionWindow(list, column, ui.offsets[column], body, details)
    const last = maxOffset(blocksOf(list, column, details), body)
    const offset = Math.min(
      last,
      Math.max(0, shown.offset + delta(shown.taken)),
    )
    seen.isMoved = offset !== shown.offset

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
  // The board as the move left it, not as this dispatch first read it.
  const { cards } = await updateBoard($, board => board)
  const details = detailIds(cards, await readActivity($))
  await updateUi($, ui => {
    const list = sectionList(applyFilter(cards, ui).cards, column)
    const body = bodyOf(cards, lastBody.bodyRows, lastBody.extraRows)
    const taken = (from: number) =>
      sectionWindow(list, column, from, body, details).taken
    const shown = sectionWindow(list, column, ui.offsets[column], body, details)
    const last = maxOffset(blocksOf(list, column, details), body)
    let offset = shown.offset
    if (at.index < offset) offset = at.index
    while (offset < last && at.index >= offset + taken(offset)) offset += 1

    return offset === shown.offset
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
  // The picker and the setup offer sit between the toolbar and the list; the layout is told of them.
  const strip = pickRows(board) + setupRows(board)
  const rows = layoutBoard({
    cards,
    ui,
    bodyRows: e.bodyRows,
    details: detailIds(cards, await readActivity($)),
    extraRows: strip,
  })
  const column = hitTest(rows, e.pointer.row + lastBody.offset - strip)
  if (column === undefined) return false

  const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by)))

  return scrollSection($, column, e.bodyRows, strip, () => step)
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
    case 'toggleGroup':
      await toggleGroup($, message.group)
      break
    case 'settings':
      await openSettings($)
      break
    case 'page':
      await scrollSection(
        $,
        message.column,
        lastBody.bodyRows,
        lastBody.extraRows,
        taken => (message.dir === 'up' ? -taken : taken),
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
  const filterField = await renderFilter($, e)
  const quickAdd = await renderQuickAdd($, e)
  const picker = renderPicker($, e, board)
  const setup = renderSetup($, e, board)
  // The rows above the list, which the equal-height sections give way to.
  const extraRows =
    pickRows(board) +
    setupRows(board) +
    (filterField === null ? 0 : 1) +
    (quickAdd === null ? 0 : quickAddRows(await readQuickAdd($)))
  lastBody = { offset: scroll.offset, bodyRows: scroll.bodyRows, extraRows }

  // Nothing loaded yet, no cards saved and no reason given why not: bars stand
  // in for the cards, from the first frame to the load's end.
  const isLoading =
    board.fetchedAt === 0 &&
    board.cards.length === 0 &&
    board.error === undefined &&
    board.pick === undefined
  const rows = layoutBoard({
    cards: board.cards,
    ui,
    bodyRows: scroll.bodyRows,
    details: detailIds(board.cards, activity),
    extraRows,
    legend: hasClient,
    isLoading,
  })
  // A card's second row starts where its title does.
  const titleAt = titleColumn(board.cards, columns)
  const detailOf = (card: KanbanCard) => {
    const one = activity.cards[card.id]

    return one === undefined
      ? []
      : detailSegs(columns, one, activity.live, now, titleAt)
  }

  // The status text, dim: the backend, the board, how fresh it is, and why not;
  // with `s: Settings` at the right end of the row.
  const statusRow = () => {
    const detected =
      board.backend?.isDetected === true ? board.backend : undefined
    const boardName =
      detected?.title === undefined
        ? ''
        : S.boardName(detected.projectNumber, detected.title)
    const isAge =
      board.error === undefined &&
      !(board.isLoading || isLoading) &&
      !(pausedUntil > now) &&
      board.fetchedAt !== 0
    // The setup offer under the toolbar says what is missing; the row only flags it.
    const status =
      (board.setup === undefined ? undefined : S.setupNeeded) ??
      board.error ??
      (board.isLoading || isLoading
        ? S.loading
        : pausedUntil > now
          ? S.rateLimitLow(minutesLeft(pausedUntil - now))
          : board.fetchedAt === 0
            ? ''
            : S.updated(ageLabel(board.fetchedAt, now)))
    const plan = planStatus({
      columns,
      boardName,
      status,
      isAge,
      canHint: hasClient && board.error === undefined && !isLoading,
    })
    const { text } = plan

    const shown =
      board.error !== undefined ? (
        <Text color="error" wrap="truncate-end">
          {text}
        </Text>
      ) : detected === undefined ? (
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
    if (plan.settings === undefined) return shown

    return (
      <Box flexDirection="row">
        <Box width={columns - settingsWidth(plan.settings)}>{shown}</Box>
        <Button
          key="settings"
          plain
          dimColor
          hotkey={hasClient ? undefined : SETTINGS_KEY}
          label={
            hasClient
              ? settingsText(plan.settings)
              : settingsLabel(plan.settings)
          }
          onPress={() => openSettings($)}
        />
      </Box>
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

  // What the Client draws for a row; the Buttons and Text of the other surfaces
  // are made from the same pieces, so the two read alike.
  const rowViewInput = {
    columns,
    isFiltered,
    glyphOf: (card: KanbanCard) => {
      const entry = sync[card.id]

      return entry === undefined ? undefined : glyphOf(entry, tick, now)
    },
    ageOf: (card: KanbanCard) => ageLabel(card.updatedAt, now),
    detailOf,
    cards: board.cards,
    canDrag: hasClient,
    canType,
    needsSetup: board.setup !== undefined,
  }
  const textOf = (row: Row) => {
    const [made] = toRowViews({ ...rowViewInput, rows: [row] })

    return made === undefined
      ? null
      : made.segs.map(part => <Text {...segProps(part)}>{part.text}</Text>)
  }

  const draw = (row: Row) => {
    switch (row.kind) {
      case 'toolbar':
        return row.line === 'status' ? statusRow() : actionsRow()

      // The group's header folds and opens it; its sections' headers are labels.
      case 'group':
        return (
          <Button
            key={`grp:${row.group}`}
            plain
            onPress={() => toggleGroup($, row.group)}
          >
            {textOf(row)}
          </Button>
        )

      case 'header':
        return (
          <Text key={`hdr:${row.column}`} wrap="truncate-end">
            {textOf(row)}
          </Text>
        )

      case 'blank':
      case 'folded':
      case 'empty':
      case 'skeleton':
      case 'note':
        return <Text wrap="truncate-end">{textOf(row)}</Text>

      // The legend is the Client's: the other surfaces have no keys to list.
      case 'legend':
        return null

      case 'more': {
        const { column, dir } = row

        return (
          <Button
            key={`more:${column}:${dir}`}
            plain
            onPress={() =>
              scrollSection($, column, scroll.bodyRows, extraRows, taken =>
                dir === 'up' ? -taken : taken,
              )
            }
          >
            {textOf(row)}
          </Button>
        )
      }

      case 'card': {
        const { card } = row

        return (
          <Button
            key={`card:${card.id}`}
            plain
            dimColor={isDimCard(card)}
            onPress={() => openDetail($, card.id)}
          >
            {textOf(row)}
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
      {setup}
        {setup}
        {filterField}
        {quickAdd}
        {rows.slice(TOOLBAR_ROWS).map(draw)}
      </Box>
    )
  }

  const { Client } = $.ui.resolve(e)
  const props: BoardProps = {
    rows: toRowViews({ ...rowViewInput, rows }),
    columns,
  }

  return (
    <Box flexDirection="column">
      {rows.slice(0, TOOLBAR_ROWS).map(draw)}
      {picker}
      {filterField}
      {quickAdd}
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

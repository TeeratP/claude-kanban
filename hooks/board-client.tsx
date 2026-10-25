import type {
  ClientKeyEvent,
  ClientModule,
  ClientPointerEvent,
} from 'claude-code'

// Self-contained on purpose: a surface module runs without `$` and takes
// nothing from the rest of the plugin. The hooks module builds these props and
// reads the posts; the types here are the contract between the two.

/** A run of a row's text and how it is drawn; '' for no colour. */
export type Seg = { text: string; bold: boolean; dim: boolean; color: string }

type Base = { key: string; segs: Seg[]; width: number }

/** One terminal row of the board's list, its text already cut to fit. */
export type RowView =
  | (Base & {
      kind: 'header'
      column: string
      /** The keys that move the card under the cursor here, and how they read. */
      moveKeys: string[]
      hint: string
      /** Whether the section keeps its cards in the order they were put in. */
      isOrdered: boolean
    })
  | (Base & { kind: 'more'; column: string; dir: 'up' | 'down' })
  | (Base & { kind: 'card'; column: string; cardId: string })
  // The dim second row under a card: part of that card, never a stop for the cursor.
  | (Base & { kind: 'detail'; column: string; cardId: string })
  // The empty row of a section names it; other text belongs to none.
  | (Base & { kind: 'text'; column?: string })

export type BoardProps = { rows: RowView[]; columns: number }

/** Where in a section a dropped card goes: its top, or right before or after a card. */
export type Place = { at: 'top' } | { at: 'before' | 'after'; cardId: string }

/**
 * What the module posts: a click on a row, a card dropped on a section (at a
 * place in it, or last when none) or moved a place up or down in its own.
 */
export type BoardPost =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: string; place?: Place }
  | { type: 'shift'; cardId: string; dir: 'up' | 'down' }
  | { type: 'toggle'; column: string }
  | { type: 'page'; column: string; dir: 'up' | 'down' }

/** Where a drop at a pointer position lands, and the rows that show it. */
export type DropTarget = {
  column: string
  /** Where in the section; none when it keeps no order. */
  place?: Place
  /** The row the insertion line is drawn under. */
  line?: number
  /** The row lit instead, for a section that keeps no order. */
  lit?: number
}

// Whether the pointer is in the lower half of its row; only where the terminal
// reports it finer than a cell.
const isLower = (row: number, fineY?: number) =>
  fineY !== undefined && fineY - row >= 0.5

// Whether the pointer comes down onto `row`: it moved down to get there from
// `prev`, or the card on row `from` began above it in its own section. Where no
// finer position is known, this says which side of a card the drop is on.
const movesDown = (
  rows: readonly RowView[],
  from: number,
  row: number,
  prev: number,
) => row >= prev || (rows[from]?.column === rows[row]?.column && from < row)

/**
 * What a card dropped over row `pointerRow` goes to. Any row of a section
 * takes it: a header or the empty row puts it first, a card puts it before
 * that card or after it, a card's second row after that card, a `more` row at
 * that edge of the window shown. The line of a place after a card is under its
 * second row when it has one. Which
 * side of a card is the lower half of its row where `fineY` knows it, and else
 * `isDown`: whether the pointer came down onto it. A section that keeps no
 * order is lit.
 */
export function dropTarget(
  rows: readonly RowView[],
  pointerRow: number,
  fineY?: number,
  isDown = false,
): DropTarget | undefined {
  const row = rows[pointerRow]
  const column = row?.column
  if (row === undefined || column === undefined) return undefined

  let headerAt = pointerRow
  while (headerAt >= 0) {
    const one = rows[headerAt]
    if (one?.kind === 'header' && one.column === column) break
    headerAt -= 1
  }
  const header = rows[headerAt]
  if (header?.kind !== 'header') return undefined
  if (!header.isOrdered) return { column, lit: headerAt }

  const top: DropTarget = { column, place: { at: 'top' }, line: headerAt }
  if (row.kind === 'header' || row.kind === 'text') return top

  if (row.kind === 'more') {
    const isUp = row.dir === 'up'
    const edge = rows[isUp ? pointerRow + 1 : pointerRow - 1]
    if (
      (edge?.kind !== 'card' && edge?.kind !== 'detail') ||
      edge.column !== column
    ) {
      return top
    }

    return isUp
      ? {
          column,
          place: { at: 'before', cardId: edge.cardId },
          line: pointerRow,
        }
      : {
          column,
          place: { at: 'after', cardId: edge.cardId },
          line: pointerRow - 1,
        }
  }

  // Only a card's second row has no half to be in: it is always after its card.
  const isAfter =
    row.kind === 'detail' ||
    (fineY === undefined ? isDown : isLower(pointerRow, fineY))

  return isAfter
    ? {
        column,
        place: { at: 'after', cardId: row.cardId },
        line: blockEnd(rows, pointerRow),
      }
    : {
        column,
        place: { at: 'before', cardId: row.cardId },
        line: pointerRow - 1,
      }
}

// The last row of the card on row `at`: its second row when it has one.
function blockEnd(rows: readonly RowView[], at: number) {
  const row = rows[at]
  const next = rows[at + 1]
  if (row?.kind !== 'card') return at

  return next?.kind === 'detail' && next.cardId === row.cardId ? at + 1 : at
}

// Whether the card on row `from` would stay where it is if dropped at `target`:
// in an unordered section, or at the place it already has, from just above it to
// the end of its rows.
function staysPut(rows: readonly RowView[], target: DropTarget, from: number) {
  return (
    target.column === rows[from]?.column &&
    (target.place === undefined ||
      (target.line !== undefined &&
        target.line >= from - 1 &&
        target.line <= blockEnd(rows, from)))
  )
}

// Where the button went down (its row and that row's key, since a refresh can
// shift rows under the pointer), whether the pointer has left that row since,
// the row it is over now, the row it was over before that and, where known, its
// fine position now.
type Gesture = {
  y: number
  key: string
  hasMoved: boolean
  over: number
  prev: number
  fine?: number
}

// The row the keys act on: its key (a refresh can shift rows), the index it
// had (for when its row is gone) and whether it is drawn. A click only records
// it, so a mouse user sees no cursor; the first key brings it up.
type Cursor = { key: string; index: number; shown: boolean }

// `moving` is the key of the card an `m` is moving, waiting for a section key.
type State = {
  gesture: Gesture | null
  cursor: Cursor | null
  moving: string | null
}

const IDLE: State = { gesture: null, cursor: null, moving: null }

// The rows the cursor can rest on: all but the plain text ones and card second rows.
const stopsOf = (rows: RowView[]) =>
  rows.flatMap((row, index) =>
    row.kind === 'text' || row.kind === 'detail' ? [] : [index],
  )

// Where the cursor is: its row, or when that is gone the nearest one it can
// rest on.
function place(rows: RowView[], stops: number[], cursor: Cursor) {
  const found = rows.findIndex(row => row.key === cursor.key)
  if (found >= 0) return found

  return stops.reduce<number | undefined>(
    (best, index) =>
      best === undefined ||
      Math.abs(index - cursor.index) < Math.abs(best - cursor.index)
        ? index
        : best,
    undefined,
  )
}

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, columns } = props
  // The state is read when the event comes: it may be newer than this call.
  const read = () => surface.state ?? IDLE
  const { gesture, cursor, moving } = read()
  const stops = stopsOf(rows)

  const post = (message: BoardPost) => surface.post(message)

  // What a click, or Enter on the cursor's row, does.
  const activate = (row: RowView) => {
    if (row.kind === 'card' || row.kind === 'detail') {
      post({ type: 'open', cardId: row.cardId })
    }
    if (row.kind === 'header') post({ type: 'toggle', column: row.column })
    if (row.kind === 'more') {
      post({ type: 'page', column: row.column, dir: row.dir })
    }
  }

  // A click acts on the row it hit; a card dragged to a place that is not its
  // own is dropped there.
  const finish = (start: Gesture, end: number, fineY?: number) => {
    const fromAt = rows.findIndex(row => row.key === start.key)
    const from = rows[fromAt]
    if (from === undefined) return

    if (!start.hasMoved && rows[end]?.key === start.key) {
      activate(from)
      return
    }
    if (from.kind !== 'card') return

    const prev = end === start.over ? start.prev : start.over
    const to = dropTarget(rows, end, fineY, movesDown(rows, fromAt, end, prev))
    if (to === undefined || staysPut(rows, to, fromAt)) return

    post({
      type: 'drop',
      cardId: from.cardId,
      column: to.column,
      ...(to.place === undefined ? {} : { place: to.place }),
    })
  }

  surface.onPointer((event: ClientPointerEvent) => {
    const now = read()
    const current = now.gesture

    if (event.type === 'down') {
      const pressed = rows[event.y]
      if (event.button !== 'left' || pressed === undefined) return
      surface.setState({
        ...now,
        gesture: {
          y: event.y,
          key: pressed.key,
          hasMoved: false,
          over: event.y,
          prev: event.y,
        },
        // A click is what gives the Client the keys: the cursor starts here.
        cursor:
          pressed.kind === 'text' || pressed.kind === 'detail'
            ? now.cursor
            : {
                key: pressed.key,
                index: event.y,
                shown: now.cursor?.shown === true,
              },
        moving: null,
      })
      return
    }
    if (current === null) return

    if (event.type === 'move') {
      // A move with no button is a hover: the button came up out of reach.
      if (event.button === undefined) {
        surface.setState({ ...now, gesture: null })
        return
      }
      // Within a row only crossing its middle changes where the card would land.
      if (
        event.y === current.over &&
        isLower(event.y, event.fine?.y) === isLower(current.over, current.fine)
      ) {
        return
      }
      const { fine: _was, ...held } = current
      surface.setState({
        ...now,
        gesture: {
          ...held,
          hasMoved: current.hasMoved || event.y !== current.y,
          over: event.y,
          prev: event.y === current.over ? current.prev : current.over,
          ...(event.fine === undefined ? {} : { fine: event.fine.y }),
        },
      })
      return
    }

    if (event.type === 'up') {
      surface.setState({ ...now, gesture: null })
      finish(current, event.y, event.fine?.y)
    }
  })

  // Up and down (or k and j) move the cursor, Enter does what a click does,
  // `m` then a section's key moves the card to the end of that section and
  // shift-k or shift-j moves it a place up or down in its own.
  surface.onKey((event: ClientKeyEvent) => {
    if (event.ctrl === true || event.meta === true) return

    const now = read()
    const here = now.cursor === null ? stops[0] : place(rows, stops, now.cursor)
    const at = here === undefined ? undefined : rows[here]
    if (here === undefined || at === undefined) return

    // The first key only brings the cursor up, where the person last clicked.
    if (now.cursor === null || !now.cursor.shown) {
      surface.setState({
        ...now,
        cursor: { key: at.key, index: here, shown: true },
      })
      return
    }

    // Any key ends a move; one that names a section also drops the card there.
    if (now.moving !== null) {
      const card = rows.find(row => row.key === now.moving)
      const to = rows.find(
        row => row.kind === 'header' && row.moveKeys.includes(event.key),
      )
      surface.setState({ ...now, moving: null })
      if (
        card?.kind === 'card' &&
        to?.kind === 'header' &&
        to.column !== card.column
      ) {
        post({ type: 'drop', cardId: card.cardId, column: to.column })
      }
      return
    }

    const shift =
      event.key === 'K' || (event.shift === true && event.key === 'k')
        ? 'up'
        : event.key === 'J' || (event.shift === true && event.key === 'j')
          ? 'down'
          : undefined
    if (shift !== undefined) {
      if (at.kind === 'card') {
        post({ type: 'shift', cardId: at.cardId, dir: shift })
      }
      return
    }

    const delta =
      event.key === 'down' || event.key === 'j'
        ? 1
        : event.key === 'up' || event.key === 'k'
          ? -1
          : 0
    if (delta !== 0) {
      const next = stops[stops.indexOf(here) + delta]
      const row = next === undefined ? undefined : rows[next]
      if (next === undefined || row === undefined) return
      surface.setState({
        ...now,
        cursor: { key: row.key, index: next, shown: true },
      })
      return
    }

    if (event.key === 'return') activate(at)
    if (event.key === 'm' && at.kind === 'card') {
      surface.setState({ ...now, moving: at.key })
    }
  })

  // While a card is being dragged it is dimmed and a line shows where it would
  // land: under the row above that place, or the section is lit when it keeps
  // no order. A place the card already has shows nothing.
  const draggedAt =
    gesture !== null && gesture.hasMoved
      ? rows.findIndex(row => row.key === gesture.key)
      : -1
  const dragged = rows[draggedAt]
  const found =
    gesture !== null && dragged?.kind === 'card'
      ? dropTarget(
          rows,
          gesture.over,
          gesture.fine,
          movesDown(rows, draggedAt, gesture.over, gesture.prev),
        )
      : undefined
  const target =
    found === undefined || staysPut(rows, found, draggedAt) ? undefined : found

  // The cursor, once a key has brought it up, and the card an `m` is moving:
  // the other headers then show the keys that send it there.
  const cursorAt =
    cursor === null || !cursor.shown ? undefined : place(rows, stops, cursor)
  const carried =
    moving === null ? undefined : rows.find(row => row.key === moving)

  const style = (seg: Seg) => ({
    ...(seg.bold ? { weight: 'bold' as const } : {}),
    ...(seg.dim ? { dimColor: true } : {}),
    ...(seg.color === '' ? {} : { color: seg.color }),
  })

  // A row is a keyed Box: only a Box keeps a key, and a test finds a row by it.
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isLit = index === target?.lit || index === cursorAt
        const isLine = index === target?.line
        const rowStyle = {
          ...(isLit ? { inverse: true } : {}),
          ...(isLine ? { underline: true } : {}),
          ...(row === dragged ? { dimColor: true } : {}),
        }
        const segs =
          row.kind === 'header' &&
          carried?.kind === 'card' &&
          row.column !== carried.column
            ? [
                ...row.segs,
                { text: row.hint, bold: true, dim: false, color: '' },
              ]
            : row.segs
        const only = segs.length === 1 ? segs[0] : undefined
        // The highlight and the line run to the pane's edge.
        const pad = isLit || isLine ? Math.max(0, columns - row.width) : 0

        return (
          <Box key={row.key}>
            {only !== undefined && pad === 0 ? (
              <Text wrap="truncate-end" {...style(only)} {...rowStyle}>
                {only.text}
              </Text>
            ) : (
              <Text wrap="truncate-end" {...rowStyle}>
                {segs.map(seg => (
                  <Text {...style(seg)}>{seg.text}</Text>
                ))}
                {pad > 0 && <Text>{' '.repeat(pad)}</Text>}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export default Board

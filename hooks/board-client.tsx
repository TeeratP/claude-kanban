import type {
  ClientKeyEvent,
  ClientModule,
  ClientPointerEvent,
} from 'claude-code'

// Self-contained on purpose: a surface module runs without `$` and takes
// nothing from the rest of the plugin. The hooks module builds these props and
// reads the posts; the types here are the contract between the two.

/** A run of a row's text and how it is drawn; '' for no colour. */
export type Seg = {
  text: string
  bold: boolean
  dim: boolean
  color: string
  italic?: true
  strike?: true
  underline?: true
}

type Base = { key: string; segs: Seg[]; width: number }

/** One terminal row of the board's list, its text already cut to fit. */
export type RowView =
  // A group's header: it folds and opens its three sections.
  | (Base & {
      kind: 'group'
      group: string
      isOpen: boolean
      /** The sections it holds, with the keys that move the card under the cursor to each. */
      sections: { column: string; moveKeys: string[] }[]
      /**
       * What a closed group shows while a card is dragged: its sections as chips,
       * `segs[seg]` over the cells `from` to `to` (not including `to`), and none when open.
       */
      chipSegs: Seg[]
      chips: { column: string; seg: number; from: number; to: number }[]
      /** What a closed group shows while `m` carries a card: the keys of its sections. */
      carrySegs: Seg[]
    })
  | (Base & {
      kind: 'header'
      column: string
      /** The piece of `segs` that is the section's name, which a drag lights when it would land here. */
      labelAt: number
      /** The keys that move the card under the cursor here. */
      moveKeys: string[]
      /** What the header shows while `m` carries a card to another section: those keys. */
      carrySegs: Seg[]
      /** Whether the section keeps its cards in the order they were put in. */
      isOrdered: boolean
    })
  | (Base & { kind: 'more'; column: string; dir: 'up' | 'down' })
  | (Base & { kind: 'card'; column: string; cardId: string })
  // The dim second row under a card: part of that card, never a stop for the cursor.
  | (Base & { kind: 'detail'; column: string; cardId: string })
  // The empty row of a section names it; other text belongs to none. `keyed` is
  // what a row shows once a key has brought the cursor up, when it differs.
  | (Base & { kind: 'text'; column?: string; keyed?: Seg[] })

export type BoardProps = { rows: RowView[]; columns: number }

/** Where in a section a dropped card goes: its top, or right before or after a card. */
export type Place = { at: 'top' } | { at: 'before' | 'after'; cardId: string }

/**
 * What the module posts: a click on a row, a card dropped on a section (at a
 * place in it, or last when none) or moved a place up or down in its own, and
 * a group opened or folded, the key that opens Settings, and whether `m` is
 * carrying a card (so that key is its section's instead).
 */
export type BoardPost =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: string; place?: Place }
  | { type: 'shift'; cardId: string; dir: 'up' | 'down' }
  | { type: 'toggleGroup'; group: string }
  | { type: 'page'; column: string; dir: 'up' | 'down' }
  | { type: 'settings' }
  | { type: 'carry'; isOn: boolean }

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

// The section a row belongs to; a group header and the rows under no section have none.
const columnOf = (row: RowView | undefined) =>
  row !== undefined && 'column' in row ? row.column : undefined

// Whether the pointer comes down onto `row`: it moved down to get there from
// `prev`, or the card on row `from` began above it in its own section. Where no
// finer position is known, this says which side of a card the drop is on.
const movesDown = (
  rows: readonly RowView[],
  from: number,
  row: number,
  prev: number,
) => row >= prev || (columnOf(rows[from]) === columnOf(rows[row]) && from < row)

/**
 * What a card dropped over row `pointerRow` goes to. Any row of a section
 * takes it: a header or the empty row puts it first, a blank row after the last
 * card shown, a card puts it before that card or after it, a card's second row
 * after that card, a `more` row at that edge of the window shown. The line of a
 * place after a card is under its second row when it has one. Which side of a
 * card is the lower half of its row where `fineY` knows it, and else `isDown`:
 * whether the pointer came down onto it. A section that keeps no order is lit.
 * A closed group's header takes it on the chip at column `x`, last in that
 * section; the rest of that header, and an open group's, take nothing.
 */
export function dropTarget(
  rows: readonly RowView[],
  pointerRow: number,
  fineY?: number,
  isDown = false,
  x?: number,
): DropTarget | undefined {
  const row = rows[pointerRow]
  if (row?.kind === 'group') {
    const chip =
      row.isOpen || x === undefined
        ? undefined
        : row.chips.find(one => x >= one.from && x < one.to)

    return chip === undefined
      ? undefined
      : { column: chip.column, lit: pointerRow }
  }
  const column = columnOf(row)
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
  if (row.kind === 'header') return top
  if (row.kind === 'text') {
    // Past the last card shown (a blank row), or in an empty section (the first, below the header).
    let above = pointerRow - 1
    while (above > headerAt && rows[above]?.kind === 'text') above -= 1
    const last = rows[above]
    if (last?.kind === 'card' || last?.kind === 'detail') {
      return {
        column,
        place: { at: 'after', cardId: last.cardId },
        line: blockEnd(rows, above),
      }
    }

    return last?.kind === 'more'
      ? dropTarget(rows, above, undefined, true)
      : top
  }

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
    target.column === columnOf(rows[from]) &&
    (target.place === undefined ||
      (target.line !== undefined &&
        target.line >= from - 1 &&
        target.line <= blockEnd(rows, from)))
  )
}

// Where the button went down (its row and that row's key, since a refresh can
// shift rows under the pointer), whether the pointer has left that row since,
// the row it is over now, the row it was over before that and, where known, its
// fine position now; and the column it is at, which picks a chip on a group's header.
type Gesture = {
  x: number
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

// `moving` is the key of the card an `m` is moving, waiting for a section key;
// `hover` the key of the row under a pointer with no button down.
type State = {
  gesture: Gesture | null
  cursor: Cursor | null
  moving: string | null
  hover: string | null
}

const IDLE: State = { gesture: null, cursor: null, moving: null, hover: null }

// The rows a pointer can rest on to be told they press: cards, `more` rows and group headers.
const hoverOf = (row: RowView | undefined) =>
  row?.kind === 'card' || row?.kind === 'more' || row?.kind === 'group'
    ? row.key
    : null

// `›` in the cell an indent leaves free, so no text moves; a row that does not
// start with a space is left as it is.
function pointed(segs: readonly Seg[]): Seg[] {
  const [first, ...rest] = segs
  if (first === undefined || !first.text.startsWith(' ')) return [...segs]

  return [
    { text: '›', bold: true, dim: false, color: '' },
    ...(first.text.length > 1 ? [{ ...first, text: first.text.slice(1) }] : []),
    ...rest,
  ]
}

// Whether the cursor can rest on a row: a group's header, a card or a `more` row.
// Not the section headers, which are labels, nor plain text and card second rows.
const isStop = (row: RowView) =>
  row.kind === 'group' || row.kind === 'card' || row.kind === 'more'

const stopsOf = (rows: RowView[]) =>
  rows.flatMap((row, index) => (isStop(row) ? [index] : []))

// The section a key after `m` sends a card to: found on the open group's section
// headers, or on a group's own row, which lists all three of its sections.
function sectionOfKey(rows: readonly RowView[], key: string) {
  for (const row of rows) {
    if (row.kind === 'header' && row.moveKeys.includes(key)) return row.column
    if (row.kind === 'group') {
      const found = row.sections.find(one => one.moveKeys.includes(key))
      if (found !== undefined) return found.column
    }
  }

  return undefined
}

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
  const { gesture, cursor, moving, hover } = read()
  const stops = stopsOf(rows)

  const post = (message: BoardPost) => surface.post(message)

  // What a click, or Enter on the cursor's row, does.
  const activate = (row: RowView) => {
    if (row.kind === 'card' || row.kind === 'detail') {
      post({ type: 'open', cardId: row.cardId })
    }
    if (row.kind === 'group') post({ type: 'toggleGroup', group: row.group })
    if (row.kind === 'more') {
      post({ type: 'page', column: row.column, dir: row.dir })
    }
  }

  // A click acts on the row it hit; a card dragged to a place that is not its
  // own is dropped there.
  const finish = (
    start: Gesture,
    end: number,
    endX: number,
    fineY?: number,
  ) => {
    const fromAt = rows.findIndex(row => row.key === start.key)
    const from = rows[fromAt]
    if (from === undefined) return

    if (!start.hasMoved && rows[end]?.key === start.key) {
      activate(from)
      return
    }
    if (from.kind !== 'card') return

    const prev = end === start.over ? start.prev : start.over
    const to = dropTarget(
      rows,
      end,
      fineY,
      movesDown(rows, fromAt, end, prev),
      endX,
    )
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

    if (event.type === 'leave') {
      if (now.hover !== null) surface.setState({ ...now, hover: null })
      return
    }
    // A move with no button is a hover; if a gesture was held, its button came up out of reach.
    if (event.type === 'move' && event.button === undefined) {
      const hover = hoverOf(rows[event.y])
      if (current !== null || now.hover !== hover) {
        surface.setState({ ...now, gesture: null, hover })
      }
      return
    }

    if (event.type === 'down') {
      const pressed = rows[event.y]
      if (event.button !== 'left' || pressed === undefined) return
      surface.setState({
        ...now,
        hover: null,
        gesture: {
          x: event.x,
          y: event.y,
          key: pressed.key,
          hasMoved: false,
          over: event.y,
          prev: event.y,
        },
        // A click is what gives the Client the keys: the cursor starts here.
        cursor: !isStop(pressed)
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
      // Within a row only crossing its middle changes where the card would land,
      // and on a group's header the chip under the pointer.
      if (
        event.y === current.over &&
        isLower(event.y, event.fine?.y) ===
          isLower(current.over, current.fine) &&
        (rows[event.y]?.kind !== 'group' || event.x === current.x)
      ) {
        return
      }
      const { fine: _was, ...held } = current
      surface.setState({
        ...now,
        gesture: {
          ...held,
          x: event.x,
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
      finish(current, event.y, event.x, event.fine?.y)
    }
  })

  // Up and down (or k and j) move the cursor, Enter does what a click does,
  // `m` then a section's key moves the card to the end of that section and
  // shift-k or shift-j moves it a place up or down in its own.
  surface.onKey((event: ClientKeyEvent) => {
    if (event.ctrl === true || event.meta === true) return

    const now = read()
    // `s` opens Settings, as its button's hotkey does where the keys come here
    // instead; while `m` carries a card it names Suspended, below.
    if (event.key === 's' && now.moving === null) {
      post({ type: 'settings' })
      return
    }

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
      const to = sectionOfKey(rows, event.key)
      surface.setState({ ...now, moving: null })
      if (card?.kind === 'card' && to !== undefined && to !== card.column) {
        post({ type: 'drop', cardId: card.cardId, column: to })
      } else {
        post({ type: 'carry', isOn: false })
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
      post({ type: 'carry', isOn: true })
    }
  })

  // While a card is being dragged it is dimmed, slanted and pointed at, and a
  // line shows where it would land: under the row above that place, or the
  // section is lit when it keeps no order, and the name of the section it would
  // land in is lit either way. A place the card already has shows nothing. A
  // closed group shows its sections as chips, the one under the pointer lit.
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
          gesture.x,
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
  const isDragging = dragged?.kind === 'card'
  const chipColumn =
    target?.lit !== undefined && rows[target.lit]?.kind === 'group'
      ? target.column
      : undefined

  const style = (seg: Seg) => ({
    ...(seg.bold ? { weight: 'bold' as const } : {}),
    ...(seg.dim ? { dimColor: true } : {}),
    ...(seg.italic === true ? { italic: true } : {}),
    ...(seg.strike === true ? { strikethrough: true } : {}),
    ...(seg.underline === true ? { underline: true } : {}),
    ...(seg.color === '' ? {} : { color: seg.color }),
  })

  // A row is a keyed Box: only a Box keeps a key, and a test finds a row by it.
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        // A group's chip is lit in its own place, not the whole row.
        const isLit =
          (index === target?.lit && row.kind !== 'group') || index === cursorAt
        const isLine = index === target?.line
        const isGhost = row === dragged
        const rowStyle = {
          ...(isLit ? { inverse: true } : {}),
          ...(isLine ? { underline: true } : {}),
          ...(isGhost ? { dimColor: true, italic: true } : {}),
        }
        // What the row shows: its text, or while a card is dragged or carried
        // the other form of a header (chips, the keys), which runs to the edge.
        let segs = row.segs
        let width = row.width
        let hot = -1
        if (row.kind === 'group' && !row.isOpen && isDragging) {
          segs = row.chipSegs
          width = columns
          hot = row.chips.find(one => one.column === chipColumn)?.seg ?? -1
        } else if (
          carried?.kind === 'card' &&
          ((row.kind === 'group' && !row.isOpen) ||
            (row.kind === 'header' && row.column !== carried.column))
        ) {
          segs = row.carrySegs
          width = columns
        } else if (
          row.kind === 'header' &&
          target !== undefined &&
          row.column === target.column &&
          index !== target.lit
        ) {
          hot = row.labelAt
        } else if (row.kind === 'text' && row.keyed && cursor?.shown === true) {
          segs = row.keyed
        }
        // A pointer resting on a row, or the card being dragged, is pointed at.
        const isHover =
          row.key === hover && gesture === null && index !== cursorAt
        let isMarked = false
        if (isGhost || (isHover && row.kind !== 'group')) {
          segs = pointed(segs)
          isMarked = true
        } else if (isHover && row.kind === 'group') {
          segs = segs.map((seg, at) =>
            at === 0 ? { ...seg, underline: true as const } : seg,
          )
          isMarked = true
        }
        const only = segs.length === 1 && !isMarked ? segs[0] : undefined
        // The highlight and the line run to the pane's edge.
        const pad = isLit || isLine ? Math.max(0, columns - width) : 0

        return (
          <Box key={row.key}>
            {only !== undefined && pad === 0 ? (
              <Text wrap="truncate-end" {...style(only)} {...rowStyle}>
                {only.text}
              </Text>
            ) : (
              <Text wrap="truncate-end" {...rowStyle}>
                {segs.map((seg, at) => (
                  <Text
                    {...style(seg)}
                    {...(at === hot ? { inverse: true } : {})}
                  >
                    {seg.text}
                  </Text>
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

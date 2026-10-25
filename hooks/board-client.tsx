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
    })
  | (Base & { kind: 'more'; column: string; dir: 'up' | 'down' })
  | (Base & { kind: 'card'; column: string; cardId: string })
  | (Base & { kind: 'text' })

export type BoardProps = { rows: RowView[]; columns: number }

/** What the module posts: a click on a row, or a card dropped on a header. */
export type BoardPost =
  | { type: 'open'; cardId: string }
  | { type: 'drop'; cardId: string; column: string }
  | { type: 'toggle'; column: string }
  | { type: 'page'; column: string; dir: 'up' | 'down' }

// Where the button went down (its row and that row's key, since a refresh can
// shift rows under the pointer), whether the pointer has left that row since,
// and the row it is over now.
type Gesture = { y: number; key: string; hasMoved: boolean; over: number }

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

// The rows the cursor can rest on: all but the plain text ones.
const stopsOf = (rows: RowView[]) =>
  rows.flatMap((row, index) => (row.kind === 'text' ? [] : [index]))

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
    if (row.kind === 'card') post({ type: 'open', cardId: row.cardId })
    if (row.kind === 'header') post({ type: 'toggle', column: row.column })
    if (row.kind === 'more') {
      post({ type: 'page', column: row.column, dir: row.dir })
    }
  }

  // A click acts on the row it hit; a drag that ends on a header moves the card.
  const finish = (start: Gesture, end: number) => {
    const from = rows.find(row => row.key === start.key)
    if (from === undefined) return

    if (!start.hasMoved && rows[end]?.key === start.key) {
      activate(from)
      return
    }

    const to = rows[end]
    if (
      from.kind === 'card' &&
      to?.kind === 'header' &&
      to.column !== from.column
    ) {
      post({ type: 'drop', cardId: from.cardId, column: to.column })
    }
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
        },
        // A click is what gives the Client the keys: the cursor starts here.
        cursor:
          pressed.kind === 'text'
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
      if (event.y === current.over) return
      surface.setState({
        ...now,
        gesture: {
          ...current,
          hasMoved: current.hasMoved || event.y !== current.y,
          over: event.y,
        },
      })
      return
    }

    if (event.type === 'up') {
      surface.setState({ ...now, gesture: null })
      finish(current, event.y)
    }
  })

  // Up and down (or k and j) move the cursor, Enter does what a click does and
  // `m` then a section's key moves the card, as a drop on its header does.
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

  // While a card is being dragged it is dimmed and the header it could drop on
  // is highlighted.
  const dragged =
    gesture !== null && gesture.hasMoved
      ? rows.find(row => row.key === gesture.key)
      : undefined
  const over = gesture === null ? undefined : rows[gesture.over]
  const target =
    dragged?.kind === 'card' &&
    over?.kind === 'header' &&
    over.column !== dragged.column
      ? gesture?.over
      : undefined

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
        const isLit = index === target || index === cursorAt
        const rowStyle = {
          ...(isLit ? { inverse: true } : {}),
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
        // The highlight runs to the pane's edge.
        const pad = isLit ? Math.max(0, columns - row.width) : 0

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

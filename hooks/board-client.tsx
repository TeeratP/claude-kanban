import type { ClientModule, ClientPointerEvent } from 'claude-code'

// Self-contained on purpose: a surface module runs without `$` and takes
// nothing from the rest of the plugin. The hooks module builds these props and
// reads the posts; the types here are the contract between the two.

/** A run of a row's text and how it is drawn; '' for no colour. */
export type Seg = { text: string; bold: boolean; dim: boolean; color: string }

type Base = { key: string; segs: Seg[]; width: number }

/** One terminal row of the board's list, its text already cut to fit. */
export type RowView =
  | (Base & { kind: 'header'; column: string })
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
type State = { gesture: Gesture | null }

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, columns } = props
  const gesture = surface.state?.gesture ?? null

  const post = (message: BoardPost) => surface.post(message)

  // A click acts on the row it hit; a drag that ends on a header moves the card.
  const finish = (start: Gesture, end: number) => {
    const from = rows.find(row => row.key === start.key)
    if (from === undefined) return

    if (!start.hasMoved && rows[end]?.key === start.key) {
      if (from.kind === 'card') post({ type: 'open', cardId: from.cardId })
      if (from.kind === 'header') post({ type: 'toggle', column: from.column })
      if (from.kind === 'more') {
        post({ type: 'page', column: from.column, dir: from.dir })
      }
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

  // The state is read when the event comes: it may be newer than this call.
  surface.onPointer((event: ClientPointerEvent) => {
    const current = surface.state?.gesture ?? null

    if (event.type === 'down') {
      const pressed = rows[event.y]
      if (event.button !== 'left' || pressed === undefined) return
      surface.setState({
        gesture: {
          y: event.y,
          key: pressed.key,
          hasMoved: false,
          over: event.y,
        },
      })
      return
    }
    if (current === null) return

    if (event.type === 'move') {
      // A move with no button is a hover: the button came up out of reach.
      if (event.button === undefined) {
        surface.setState({ gesture: null })
        return
      }
      if (event.y === current.over) return
      surface.setState({
        gesture: {
          ...current,
          hasMoved: current.hasMoved || event.y !== current.y,
          over: event.y,
        },
      })
      return
    }

    if (event.type === 'up') {
      surface.setState({ gesture: null })
      finish(current, event.y)
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

  const style = (seg: Seg) => ({
    ...(seg.bold ? { weight: 'bold' as const } : {}),
    ...(seg.dim ? { dimColor: true } : {}),
    ...(seg.color === '' ? {} : { color: seg.color }),
  })

  // A row is a keyed Box: only a Box keeps a key, and a test finds a row by it.
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isTarget = index === target
        const rowStyle = {
          ...(isTarget ? { inverse: true } : {}),
          ...(row === dragged ? { dimColor: true } : {}),
        }
        const only = row.segs.length === 1 ? row.segs[0] : undefined
        // The highlight runs to the pane's edge.
        const pad = isTarget ? Math.max(0, columns - row.width) : 0

        return (
          <Box key={row.key}>
            {only !== undefined && pad === 0 ? (
              <Text wrap="truncate-end" {...style(only)} {...rowStyle}>
                {only.text}
              </Text>
            ) : (
              <Text wrap="truncate-end" {...rowStyle}>
                {row.segs.map(seg => (
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

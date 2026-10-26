import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanBoard } from '../types'
import { cellWidth, truncate } from './model'
import { chooseBoard } from './pick'
import { S } from './strings'

// ` [#12]`: the least a board's button shows.
const LEAST = 6

/** Rows the picker takes between the toolbar and the list: one when there are boards to pick from. */
export function pickRows(board: Pick<KanbanBoard, 'pick'>): number {
  return board.pick === undefined || board.pick.length === 0 ? 0 : 1
}

/**
 * The boards to pick from, on one row under the toolbar: `Pick board: [#2 name]
 * [#6 name]`, each name cut to its share of the width. Nothing when there is
 * no choice to make.
 */
export function renderPicker(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  board: KanbanBoard,
) {
  const { pick } = board
  if (pick === undefined || pickRows(board) === 0) return null

  const { Box, Button, Text } = $.ui.resolve(e)
  // A board in use means the person is changing it.
  const caption = board.backend?.kind === 'github' ? S.changeBoard : S.pickBoard
  const room = e.props.bodyColumns - cellWidth(caption)
  const shown = pick.slice(0, Math.max(1, Math.floor(room / LEAST)))
  const share = Math.floor(room / shown.length) - cellWidth(S.pickLabel(''))

  return (
    <Box flexDirection="row">
      <Text dimColor>{caption}</Text>
      {shown.map(one => {
        const number = `#${one.number}`
        const name = S.boardName(one.number, one.title)

        return (
          <Button
            key={`pick:${one.id}`}
            plain
            onPress={() => chooseBoard($, one)}
          >
            {S.pickLabel(
              share >= cellWidth(number) ? truncate(name, share) : number,
            )}
          </Button>
        )
      })}
    </Box>
  )
}

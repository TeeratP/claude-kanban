import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanBoard } from '../types'
import { truncate } from './model'
import { askSetup } from './prompt'
import { S } from './strings'

/** The key the setup button takes; not one the board's Client takes. */
export const SETUP_KEY = 'g'

/** Rows the setup offer takes between the toolbar and the list: what is missing, then the button. */
export function setupRows(board: Pick<KanbanBoard, 'setup'>): number {
  return board.setup === undefined ? 0 : 2
}

/**
 * While GitHub is not set up for the board: what is missing, on one row, and a
 * button that asks Claude to set it up. Nothing once the board loads.
 */
export function renderSetup(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  board: KanbanBoard,
) {
  const { setup } = board
  if (setup === undefined) return null

  const { Box, Button, Text } = $.ui.resolve(e)
  const columns = e.props.bodyColumns

  return (
    <Box flexDirection="column">
      <Text color="warning" wrap="truncate-end">
        {truncate(` ${S.setupMissing[setup.step]}`, columns)}
      </Text>
      <Box flexDirection="row">
        <Text> </Text>
        <Button
          key="setup"
          plain
          hotkey={SETUP_KEY}
          onPress={() => askSetup($, setup)}
        >
          {S.setupButton}
        </Button>
      </Box>
    </Box>
  )
}

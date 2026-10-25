import type { EngineInterface, RenderInput } from 'claude-code'

import { readSuggestions } from './atoms'
import { cellWidth, truncate } from './model'
import { S } from './strings'
import { MAX_SHOWN, addSuggestion, dismissSuggestion } from './suggest'

/**
 * Claude's suggestions above the list: a header, up to three one-row
 * suggestions with Add and Dismiss, and a count of the rest. Nothing when
 * there are none. Every piece is one terminal row (see `stripRows`).
 */
export async function renderSuggestions(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
) {
  const list = await readSuggestions($)
  if (list.length === 0) return null

  const { Box, Button, Text } = $.ui.resolve(e)
  const columns = e.props.bodyColumns
  const add = ` ${S.suggestAdd}`
  const dismiss = ` ${S.suggestDismiss}`
  // What is left of the row for the title, after both buttons and a space.
  const room = columns - cellWidth(add) - cellWidth(dismiss) - 1

  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {truncate(S.suggestedHeader(list.length), columns)}
      </Text>
      {list.slice(0, MAX_SHOWN).map(one => (
        <Box key={`suggest:${one.id}`} flexDirection="row">
          <Button
            key={`suggest:add:${one.id}`}
            plain
            dimColor
            onPress={() => addSuggestion($, one.id)}
          >
            {add}
          </Button>
          <Button
            key={`suggest:dismiss:${one.id}`}
            plain
            dimColor
            onPress={() => dismissSuggestion($, one.id)}
          >
            {dismiss}
          </Button>
          <Text dimColor wrap="truncate-end">
            {` ${truncate(one.title, room)}`}
          </Text>
        </Box>
      ))}
      {list.length > MAX_SHOWN && (
        <Text dimColor wrap="truncate-end">
          {truncate(S.suggestMore(list.length - MAX_SHOWN), columns)}
        </Text>
      )}
    </Box>
  )
}

import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanDismissed, KanbanSuggestion } from '../types'
import { readDismissed, readSuggestions } from './atoms'
import { cellWidth, truncate } from './model'
import { S } from './strings'
import {
  MAX_SHOWN,
  addSuggestion,
  dismissSuggestion,
  restoreDismissed,
  toggleDismissed,
} from './suggest'

function renderSuggested(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  list: readonly KanbanSuggestion[],
) {
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

function renderDismissed(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  { items, isShown }: KanbanDismissed,
) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const columns = e.props.bodyColumns
  const restore = ` ${S.dismissedRestore}`
  const room = columns - cellWidth(restore) - 1
  const toggle = isShown
    ? S.dismissedHide(items.length)
    : S.dismissedShow(items.length)
  // The newest first: the one just dismissed is the one most likely wanted back.
  const newest = [...items].reverse()

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Button
          key="dismissed:toggle"
          plain
          dimColor
          onPress={() => toggleDismissed($)}
        >
          {truncate(toggle, columns)}
        </Button>
      </Box>
      {isShown &&
        newest.slice(0, MAX_SHOWN).map(one => (
          <Box key={`dismissed:${one.id}`} flexDirection="row">
            <Button
              key={`dismissed:restore:${one.id}`}
              plain
              dimColor
              onPress={() => restoreDismissed($, one.id)}
            >
              {restore}
            </Button>
            <Text dimColor wrap="truncate-end">
              {` ${truncate(one.title, room)}`}
            </Text>
          </Box>
        ))}
      {isShown && items.length > MAX_SHOWN && (
        <Text dimColor wrap="truncate-end">
          {truncate(S.suggestMore(items.length - MAX_SHOWN), columns)}
        </Text>
      )}
    </Box>
  )
}

/**
 * Claude's suggestions above the list: a header, up to three one-row
 * suggestions with Add and Dismiss, and a count of the rest. Below them, once
 * any are dismissed, a quiet `Show dismissed` toggle that lists the newest
 * dismissed ones with Restore. Nothing when there is neither. Every piece is
 * one terminal row (see `stripRows` and `dismissedRows`).
 */
export async function renderSuggestions(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
) {
  const list = await readSuggestions($)
  const dismissed = await readDismissed($)
  if (list.length === 0 && dismissed.items.length === 0) return null

  const { Box } = $.ui.resolve(e)

  return (
    <Box flexDirection="column">
      {list.length > 0 && renderSuggested($, e, list)}
      {dismissed.items.length > 0 && renderDismissed($, e, dismissed)}
    </Box>
  )
}

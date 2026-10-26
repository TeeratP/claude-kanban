import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { cellWidth } from './model'
import { S } from './strings'

/** Cells between two items of a row: a dim dot on the terminal, a gap where Buttons are native. */
export const separatorWidth = (surface: RenderInput<'Pane'>['surface']) =>
  surface === 'terminal' ? cellWidth(S.dot) : 1

/**
 * Items on one row, apart by a dim dot. A graphical surface draws its Buttons
 * itself, so there the dot gives way to a gap.
 */
export function dotted(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  items: readonly RenderElement[],
) {
  const { Box, Text } = $.ui.resolve(e)
  const hasDots = e.surface === 'terminal'

  return (
    <Box flexDirection="row" columnGap={hasDots ? 0 : 1}>
      {items.flatMap((item, index) =>
        index === 0 || !hasDots
          ? [item]
          : [
              <Text key={`dot:${index}`} dimColor>
                {S.dot}
              </Text>,
              item,
            ],
      )}
    </Box>
  )
}

/**
 * Splits items into rows of a width: as many as fit, in order, `gap` cells
 * apart, and at least one per row so a wide item is cut by the surface rather
 * than dropped.
 */
export function packRows<T>(
  items: readonly T[],
  widthOf: (item: T) => number,
  room: number,
  gap: number,
): T[][] {
  const rows: T[][] = []
  let used = 0
  for (const item of items) {
    const width = widthOf(item)
    const last = rows[rows.length - 1]
    if (last !== undefined && used + gap + width <= room) {
      last.push(item)
      used += gap + width
    } else {
      rows.push([item])
      used = width
    }
  }

  return rows
}

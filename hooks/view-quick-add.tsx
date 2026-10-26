import type { EngineInterface, RenderInput } from 'claude-code'

import { readQuickAdd } from './atoms'
import { cellWidth } from './model'
import {
  closeQuickAdd,
  hideQuickAddDetails,
  showQuickAddDetails,
  submitQuickAdd,
  typeInQuickAdd,
} from './quick-add'
import { S } from './strings'
import { dotted, separatorWidth } from './view-parts'

// The hint lines up under the first letter inside the title field's bracket.
const INDENT = 1

/**
 * The add-a-card form under the toolbar; nothing while it is closed or on a
 * surface with no text field (mobile).
 */
export async function renderQuickAdd(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
) {
  // The mobile app draws no field yet, though its element table names Input.
  const els = $.ui.resolve(e)
  if (e.surface === 'mobile' || !('Input' in els)) return null

  const { Box, Button, Input, Text } = els
  const form = await readQuickAdd($)
  if (!form.isOpen) return null

  // The second row is one row at any width: the longest wording that fits.
  const wordings = form.hasDetails ? S.addRowOpen : S.addRowClosed
  const room = e.props.bodyColumns - INDENT
  const widthOf = (one: (typeof wordings)[number]) =>
    cellWidth(one.hint) +
    cellWidth(one.details) +
    cellWidth(S.addCancel) +
    2 * separatorWidth(e.surface)
  const wording = wordings.find(one => widthOf(one) <= room) ??
    wordings.at(-1) ?? { hint: '', details: '' }

  return (
    <Box flexDirection="column">
      <Input
        key="add:title"
        autoFocus
        label={S.addTitleLabel}
        placeholder={S.addTitlePlaceholder}
        submitLabel={S.addSubmit}
        value={form.title}
        onInput={value => typeInQuickAdd($, 'title', value)}
        onSubmit={value => submitQuickAdd($, 'title', value)}
      />
      {form.hasDetails && (
        <Input
          key="add:spec"
          label={S.addDetailsLabel}
          placeholder={S.addDetailsPlaceholder}
          submitLabel={S.addSubmit}
          rows={3}
          value={form.spec}
          onInput={value => typeInQuickAdd($, 'spec', value)}
          onSubmit={value => submitQuickAdd($, 'spec', value)}
        />
      )}
      <Box paddingLeft={INDENT}>
        {dotted($, e, [
          <Text key="add:hint" dimColor>
            {wording.hint}
          </Text>,
          <Button
            key={form.hasDetails ? 'add:hide' : 'add:details'}
            plain
            label={wording.details}
            onPress={() =>
              form.hasDetails ? hideQuickAddDetails($) : showQuickAddDetails($)
            }
          >
            <Text color="suggestion">{wording.details}</Text>
          </Button>,
          <Button
            key="add:cancel"
            plain
            label={S.addCancel}
            onPress={() => closeQuickAdd($)}
          >
            <Text color="suggestion">{S.addCancel}</Text>
          </Button>,
        ])}
      </Box>
    </Box>
  )
}

import type { EngineInterface, RenderInput } from 'claude-code'

import { readQuickAdd } from './atoms'
import {
  closeQuickAdd,
  showQuickAddDetails,
  submitQuickAdd,
  typeInQuickAdd,
} from './quick-add'
import { S } from './strings'

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

  const { Box, Button, Input } = els
  const form = await readQuickAdd($)
  if (!form.isOpen) return null

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
      <Box flexDirection="row" gap={1}>
        {!form.hasDetails && (
          <Button
            key="add:details"
            label={S.addDetails}
            onPress={() => showQuickAddDetails($)}
          />
        )}
        <Button
          key="add:cancel"
          label={S.addCancel}
          onPress={() => closeQuickAdd($)}
        />
      </Box>
    </Box>
  )
}

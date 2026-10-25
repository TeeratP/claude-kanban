import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanDetail, KanbanView } from '../types'
import {
  readBoard,
  readDetailState,
  readSync,
  updateDetailState,
  updateUi,
} from './atoms'
import { readDetail } from './backend'
import { ensureBackend } from './board'
import { COLUMNS, ageLabel, errorMessage } from './model'
import { S } from './strings'
import { moveCard } from './sync'

type DetailView = Extract<KanbanView, { mode: 'detail' }>

/** Shows a card's detail and reads its spec and sections from the backend. */
export async function openDetail($: EngineInterface, cardId: string) {
  const view: KanbanView = { mode: 'detail', cardId, tab: 'card' }
  const loading: KanbanDetail = {
    cardId,
    isLoading: true,
    body: '',
    sections: [],
    diffState: 'none',
  }
  await updateUi($, ui => ({ ...ui, view }))
  await updateDetailState($, () => loading)

  // A slower read of another card must not land on the one now shown.
  const fill = (patch: Partial<KanbanDetail>) =>
    updateDetailState($, detail =>
      detail?.cardId === cardId ? { ...detail, ...patch } : detail,
    )

  try {
    const { cards } = await readBoard($)
    const card = cards.find(one => one.id === cardId)
    if (card === undefined) throw new Error(S.cardGone)

    const info = await ensureBackend($)
    const { body, sections } = await readDetail($, info, card)
    await fill({ isLoading: false, body, sections })
  } catch (error) {
    await fill({ isLoading: false, error: errorMessage(error) })
  }
}

export async function closeDetail($: EngineInterface) {
  const view: KanbanView = { mode: 'board' }
  await updateUi($, ui => ({ ...ui, view }))
  await updateDetailState($, () => null)
}

export async function renderDetail(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  view: DetailView,
) {
  const { Box, Button, Markdown, Text } = $.ui.resolve(e)
  const board = await readBoard($)
  const detail = await readDetailState($)
  const sync = await readSync($)
  const now = await $.clock.now()
  const card = board.cards.find(one => one.id === view.cardId)

  const back = (
    <Button
      key="back"
      hotkey="b"
      label={S.back}
      onPress={() => closeDetail($)}
    />
  )
  if (card === undefined) {
    return (
      <Box flexDirection="column">
        {back}
        <Text dimColor>{S.cardGone}</Text>
      </Box>
    )
  }

  const pending = sync[card.id]?.phase === 'pending' ? sync[card.id] : undefined
  const meta = [
    S.col[card.column],
    ageLabel(card.updatedAt, now),
    pending === undefined ? '' : S.syncPending(pending.to),
  ].filter(part => part !== '')
  const isReady = detail?.cardId === card.id && !detail.isLoading

  return (
    <Box flexDirection="column">
      {back}
      <Text weight="bold">{`#${card.number} ${card.title}`}</Text>
      <Text dimColor>{meta.join(' · ')}</Text>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{S.moveTo}</Text>
        {COLUMNS.filter(column => column !== card.column).map(column => (
          <Button
            key={`move:${column}`}
            label={S.col[column]}
            onPress={() => moveCard($, card.id, column)}
          />
        ))}
      </Box>
      {!isReady && <Text dimColor>{S.detailLoading}</Text>}
      {isReady && detail.error !== undefined && (
        <Text color="error">{S.detailFailed(detail.error)}</Text>
      )}
      {isReady && detail.error === undefined && (
        <Markdown
          key="spec"
          text={detail.body === '' ? S.noSpec : detail.body}
        />
      )}
      {isReady &&
        detail.sections.map((section, index) => (
          <Markdown
            key={`section:${index}`}
            text={`**${section.kind === 'handoff' ? S.handoffHeading(section.date) : S.feedbackHeading(section.date)}**\n\n${section.text}`}
          />
        ))}
    </Box>
  )
}

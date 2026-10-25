import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanDetail, KanbanSync, KanbanView } from '../types'
import {
  readBoard,
  readDetailState,
  readSync,
  updateDetailState,
  updateUi,
} from './atoms'
import { readDetail } from './backend'
import { ensureBackend } from './board'
import { COLUMNS, MAX_ATTEMPTS, ageLabel, errorMessage } from './model'
import { S } from './strings'
import { moveCard, retry } from './sync'

type DetailView = Extract<KanbanView, { mode: 'detail' }>

function syncNote(entry: KanbanSync): string {
  if (entry.phase === 'pending') return S.syncPending(entry.to)

  return entry.phase === 'ok'
    ? S.syncSaved
    : S.syncFailedNote(entry.error ?? '', entry.attempts, MAX_ATTEMPTS)
}

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

  const entry = sync[card.id]
  const meta = [
    S.col[card.column],
    ageLabel(card.updatedAt, now),
    entry === undefined ? '' : syncNote(entry),
  ].filter(part => part !== '')
  const isReady = detail?.cardId === card.id && !detail.isLoading

  return (
    <Box flexDirection="column">
      {back}
      <Text weight="bold">{`#${card.number} ${card.title}`}</Text>
      <Text dimColor>{meta.join(' · ')}</Text>
      {entry?.phase === 'failed' && (
        <Button
          key="retry"
          variant="primary"
          label={S.retry}
          onPress={() => retry($, card.id)}
        />
      )}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{S.moveTo}</Text>
        {COLUMNS.filter(column => column !== card.column).map(column => (
          <Button
            key={`move:${column}`}
            label={S.col[column]}
            onPress={() =>
              moveCard(
                $,
                card.id,
                column,
                card.column === 'backlog' && column === 'claude'
                  ? { onConfirm: 'work' }
                  : undefined,
              )
            }
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

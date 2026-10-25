import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanDetail, KanbanSync, KanbanView } from '../types'
import {
  agentsOf,
  colorOf,
  liveTotals,
  roundLabel,
  totalLabel,
} from './activity-view'
import {
  readActivity,
  readBoard,
  readDetailState,
  readSync,
  readUi,
  updateDetailState,
  updateUi,
} from './atoms'
import { appendSection, readDetail, readDiff } from './backend'
import { ensureBackend } from './board'
import { formatFeedback } from './handoff'
import { COLUMNS, MAX_ATTEMPTS, ageLabel, capDiff, errorMessage } from './model'
import { S } from './strings'
import { moveCard, moveOptions, retry } from './sync'

type DetailView = Extract<KanbanView, { mode: 'detail' }>

// Cards being sent back, so a second Enter or press cannot append twice.
const sending = new Set<string>()

// A slower read of another card must not land on the one now shown.
function fillDetail(
  $: EngineInterface,
  cardId: string,
  patch: Partial<KanbanDetail>,
) {
  return updateDetailState($, detail =>
    detail?.cardId === cardId ? { ...detail, ...patch } : detail,
  )
}

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
  // The draft is one card's feedback; another card must not start with it.
  await updateUi($, ui => ({ ...ui, view, draft: '' }))
  await updateDetailState($, () => loading)

  try {
    const { cards } = await readBoard($)
    const card = cards.find(one => one.id === cardId)
    if (card === undefined) throw new Error(S.cardGone)

    const info = await ensureBackend($)
    const { body, sections } = await readDetail($, info, card)
    await fillDetail($, cardId, { isLoading: false, body, sections })
  } catch (error) {
    await fillDetail($, cardId, {
      isLoading: false,
      error: errorMessage(error),
    })
  }
}

export async function closeDetail($: EngineInterface) {
  const view: KanbanView = { mode: 'board' }
  await updateUi($, ui => ({ ...ui, view }))
  await updateDetailState($, () => null)
}

async function loadDiff($: EngineInterface, cardId: string) {
  await fillDetail($, cardId, { diffState: 'loading' })

  try {
    const { cards } = await readBoard($)
    const card = cards.find(one => one.id === cardId)
    if (card === undefined) throw new Error(S.cardGone)

    const text = await readDiff($, await ensureBackend($), card)
    if (text === undefined) {
      await fillDetail($, cardId, { diffState: 'absent' })
    } else {
      const { text: diff, omitted } = capDiff(text)
      await fillDetail($, cardId, {
        diffState: 'ready',
        diff,
        ...(omitted === 0 ? {} : { diffOmitted: omitted }),
      })
    }
  } catch (error) {
    await fillDetail($, cardId, {
      diffState: 'error',
      diffError: errorMessage(error),
    })
  }
}

/** Switches the detail between the card and its diff; the diff is read on first use. */
export async function showTab(
  $: EngineInterface,
  cardId: string,
  tab: DetailView['tab'],
) {
  await updateUi($, ui =>
    ui.view.mode === 'detail' && ui.view.cardId === cardId
      ? { ...ui, view: { ...ui.view, tab } }
      : ui,
  )
  if (tab !== 'diff') return

  const detail = await readDetailState($)
  if (
    detail?.cardId === cardId &&
    (detail.diffState === 'none' || detail.diffState === 'error')
  ) {
    await loadDiff($, cardId)
  }
}

/** Records the feedback on the card, then returns it to Claude with a prompt to resume. */
export async function sendBack(
  $: EngineInterface,
  cardId: string,
  text: string,
) {
  const feedback = text.trim()
  if (feedback === '') {
    $.ui.toast(S.feedbackFirst)

    return
  }
  if (sending.has(cardId)) return

  sending.add(cardId)
  try {
    const { cards } = await readBoard($)
    const card = cards.find(one => one.id === cardId)
    if (card === undefined) {
      $.ui.toast(S.cardGone)

      return
    }

    try {
      const info = await ensureBackend($)
      const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
      await appendSection($, info, card, formatFeedback(feedback, date))
    } catch (error) {
      $.ui.toast(S.feedbackFailed(errorMessage(error)))

      return
    }

    await updateUi($, ui => ({ ...ui, draft: '' }))
    await closeDetail($)
    await moveCard($, cardId, 'claude', { onConfirm: 'resume' })
  } finally {
    sending.delete(cardId)
  }
}

export async function renderDetail(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  view: DetailView,
) {
  const els = $.ui.resolve(e)
  const { Box, Button, Code, Markdown, Text } = els
  // The mobile app draws no field yet, though its element table names Input.
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const board = await readBoard($)
  const ui = await readUi($)
  const detail = await readDetailState($)
  const sync = await readSync($)
  const activity = await readActivity($)
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
  const worked = activity.cards[card.id]
  const meta = [
    S.col[card.column],
    ageLabel(card.updatedAt, now),
    entry === undefined ? '' : syncNote(entry),
  ].filter(part => part !== '')
  const isReady = detail?.cardId === card.id && !detail.isLoading
  const hasDiff = (card.prNumbers?.length ?? 0) > 0
  const tab = hasDiff ? view.tab : 'card'
  const isHuman = card.column === 'human'

  const drawDiff = (shown: KanbanDetail) => {
    switch (shown.diffState) {
      case 'ready':
        return (
          <Box flexDirection="column">
            <Code key="diff" source={shown.diff ?? ''} format="diff" />
            {shown.diffOmitted !== undefined && (
              <Text dimColor>{S.diffCut(shown.diffOmitted)}</Text>
            )}
          </Box>
        )
      case 'absent':
        return <Text dimColor>{S.noDiff}</Text>
      case 'error':
        return <Text color="error">{S.diffFailed(shown.diffError ?? '')}</Text>
      default:
        return <Text dimColor>{S.detailLoading}</Text>
    }
  }

  return (
    <Box flexDirection="column">
      {back}
      <Text weight="bold">{`#${card.number} ${card.title}`}</Text>
      <Text dimColor>{meta.join(' · ')}</Text>
      {worked !== undefined && (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>{`${S.agentsHeading}:`}</Text>
            {agentsOf(worked).map(name => (
              <Text key={name}>
                {' '}
                <Text color={colorOf(name)}>{S.agentDot}</Text>
                {` ${name}`}
              </Text>
            ))}
          </Text>
          <Text dimColor>
            {totalLabel(liveTotals(worked, activity.live, now))}
          </Text>
          {worked.rounds.map((round, index) => (
            <Text key={`round:${index}`} dimColor>
              {roundLabel(index + 1, round)}
            </Text>
          ))}
        </Box>
      )}
      {entry?.phase === 'failed' && (
        <Button
          key="retry"
          variant="primary"
          label={S.retry}
          onPress={() => retry($, card.id)}
        />
      )}
      {isHuman && (
        <Box flexDirection="row" gap={1}>
          <Button
            key="approve"
            hotkey="a"
            variant="primary"
            label={S.approve}
            onPress={() => moveCard($, card.id, 'done')}
          />
          {Input !== undefined && (
            <Button
              key="sendback"
              hotkey="s"
              label={S.sendBack}
              onPress={async () =>
                sendBack($, card.id, (await readUi($)).draft)
              }
            />
          )}
          <Button
            key="park"
            hotkey="p"
            label={S.park}
            onPress={() => moveCard($, card.id, 'backlog')}
          />
        </Box>
      )}
      {isHuman && Input === undefined && (
        <Text dimColor>{S.sendBackNoField}</Text>
      )}
      {isHuman && Input !== undefined && (
        <Input
          key="feedback"
          label={S.feedbackLabel}
          placeholder={S.feedbackPlaceholder}
          rows={3}
          value={ui.draft}
          onInput={value => updateUi($, one => ({ ...one, draft: value }))}
          onSubmit={value => sendBack($, card.id, value)}
        />
      )}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{S.moveTo}</Text>
        {COLUMNS.filter(column => column !== card.column).map(column => (
          <Button
            key={`move:${column}`}
            label={S.col[column]}
            onPress={() =>
              moveCard($, card.id, column, moveOptions(card.column, column))
            }
          />
        ))}
      </Box>
      {hasDiff && (
        <Box flexDirection="row" gap={1}>
          <Button
            key="tab:card"
            variant={tab === 'card' ? 'primary' : 'secondary'}
            label={S.tabCard}
            onPress={() => showTab($, card.id, 'card')}
          />
          <Button
            key="tab:diff"
            variant={tab === 'diff' ? 'primary' : 'secondary'}
            label={S.tabDiff}
            onPress={() => showTab($, card.id, 'diff')}
          />
        </Box>
      )}
      {!isReady && <Text dimColor>{S.detailLoading}</Text>}
      {isReady && tab === 'diff' && drawDiff(detail)}
      {isReady && tab === 'card' && detail.error !== undefined && (
        <Text color="error">{S.detailFailed(detail.error)}</Text>
      )}
      {isReady && tab === 'card' && detail.error === undefined && (
        <Markdown
          key="spec"
          text={detail.body === '' ? S.noSpec : detail.body}
        />
      )}
      {isReady &&
        tab === 'card' &&
        detail.sections.map((section, index) => (
          <Markdown
            key={`section:${index}`}
            text={`**${section.kind === 'handoff' ? S.handoffHeading(section.date) : S.feedbackHeading(section.date)}**\n\n${section.text}`}
          />
        ))}
    </Box>
  )
}

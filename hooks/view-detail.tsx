import type { EngineInterface, RenderInput } from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanSync,
  KanbanView,
} from '../types'
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
  updateBoard,
  updateDetailState,
  updateUi,
} from './atoms'
import { appendSection, readDetail, readDiff } from './backend'
import { ensureBackend } from './board'
import { formatAnswer, formatFeedback, questionOf } from './handoff'
import { queueAfter, queueAt, queueStep, sectionList } from './layout'
import {
  COLUMNS,
  MAX_ATTEMPTS,
  PANE,
  SETTLE_MS,
  ageLabel,
  capDiff,
  errorMessage,
  isOrdered,
  isPendingId,
} from './model'
import { shiftCard } from './reorder'
import { S } from './strings'
import { moveCard, moveOptions, retry } from './sync'
import { renderCheck } from './view-check'

type DetailView = Extract<KanbanView, { mode: 'detail' }>

// Cards being sent back, so a second Enter or press cannot append twice.
const sending = new Set<string>()

// The card the review last moved on to by itself, and when.
let advanced: { cardId: string; at: number } | undefined

// Whether the review moved on to this card just now: its decisions wait.
async function isSettling($: EngineInterface, cardId: string) {
  return (
    advanced?.cardId === cardId &&
    (await $.clock.now()) - advanced.at < SETTLE_MS
  )
}

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
  // A card still being made has no spec to show yet.
  if (isPendingId(cardId)) return

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

// After a decision the review moves on to the next Human card, or back to the
// board when none is left; not when the person has already gone elsewhere. The
// queue is read after the move, since cards come and go while the card is open.
async function advance($: EngineInterface, decided: KanbanCard) {
  const { view } = await updateUi($, ui => ui)
  if (view.mode !== 'detail' || view.cardId !== decided.id) return

  const { cards } = await updateBoard($, board => board)
  const next = queueAfter(cards, decided)
  if (next === undefined) {
    await closeDetail($)

    return
  }

  advanced = { cardId: next, at: await $.clock.now() }
  await openDetail($, next)
}

/** Moves a Human card out of Human, then opens the next Human card, or the board when none is left. */
export async function decide(
  $: EngineInterface,
  cardId: string,
  to: KanbanColumn,
) {
  if (await isSettling($, cardId)) return

  const { cards } = await readBoard($)
  const card = cards.find(one => one.id === cardId)
  if (card?.column !== 'human') return

  await moveCard($, cardId, to)
  await advance($, card)
}

/** Opens the Human card `step` places from this one, wrapping at the ends. */
export async function stepQueue(
  $: EngineInterface,
  cardId: string,
  step: 1 | -1,
) {
  const { cards } = await readBoard($)
  const next = queueStep(cards, cardId, step)
  if (next !== undefined) await openDetail($, next)
}

/** Moves the focus to the feedback field; the surface may refuse. */
export async function focusFeedback($: EngineInterface) {
  const { deny } = await $.ui.focus({ requestId: PANE, key: 'feedback' })
  if (deny !== undefined) $.ui.toast(S.focusFailed(deny))
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

/**
 * Records the feedback on the card, then returns it to Claude with a prompt to resume.
 * On a card Claude asked a question on, the feedback is the answer.
 */
export async function sendBack(
  $: EngineInterface,
  cardId: string,
  text: string,
) {
  if (await isSettling($, cardId)) return

  const feedback = text.trim()
  const isAsk =
    (await readBoard($)).cards.find(one => one.id === cardId)?.tag ===
    'question'
  if (feedback === '') {
    $.ui.toast(isAsk ? S.answerFirst : S.feedbackFirst)

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
      await appendSection(
        $,
        info,
        card,
        isAsk ? formatAnswer(feedback, date) : formatFeedback(feedback, date),
      )
    } catch (error) {
      $.ui.toast(
        isAsk
          ? S.answerFailed(errorMessage(error))
          : S.feedbackFailed(errorMessage(error)),
      )

      return
    }

    await updateUi($, ui => ({ ...ui, draft: '' }))
    await moveCard($, cardId, 'claude', {
      onConfirm: isAsk ? 'answer' : 'resume',
    })
    await advance($, card)
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
  const isHuman = card.column === 'human'
  const queue = isHuman ? queueAt(board.cards, card.id) : undefined
  const canWalk = queue !== undefined && queue.total > 1
  const meta = [
    queue === undefined
      ? S.col[card.column]
      : S.queuePosition(queue.index + 1, queue.total),
    ageLabel(card.updatedAt, now),
    entry === undefined ? '' : syncNote(entry),
  ].filter(part => part !== '')
  const isReady = detail?.cardId === card.id && !detail.isLoading
  const hasDiff = (card.prNumbers?.length ?? 0) > 0
  const tab = hasDiff ? view.tab : 'card'
  const isAsk = isHuman && card.tag === 'question'
  // The question being asked, once the card's sections are read.
  const asking = isReady && isAsk ? questionOf(detail.sections) : undefined
  const hint = [
    S.reviewKeys.approve,
    ...(Input === undefined
      ? []
      : [isAsk ? S.reviewKeys.answer : S.reviewKeys.sendBack]),
    S.reviewKeys.park,
    ...(Input === undefined ? [] : [S.reviewKeys.write]),
    ...(canWalk ? [S.reviewKeys.next, S.reviewKeys.prev] : []),
    S.reviewKeys.board,
  ]
  // Where the Client has drag and keys, the board reorders; elsewhere it is here.
  const hasClient = e.surface === 'terminal' || e.surface === 'desktop'
  const siblings = sectionList(board.cards, card.column)
  const place = siblings.findIndex(one => one.id === card.id)
  const canReorder = !hasClient && isOrdered(card.column) && place >= 0

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

  const check =
    isReady && tab === 'card' && detail.error === undefined
      ? await renderCheck($, e, card, detail.sections, now)
      : null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {back}
        {canWalk && (
          <Button
            key="prev"
            hotkey="k"
            label={S.prevCard}
            onPress={() => stepQueue($, card.id, -1)}
          />
        )}
        {canWalk && (
          <Button
            key="next"
            hotkey="n"
            label={S.nextCard}
            onPress={() => stepQueue($, card.id, 1)}
          />
        )}
      </Box>
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
      {asking !== undefined && (
        <Markdown key="question" text={`**${S.askBlock}**\n\n${asking.text}`} />
      )}
      {isHuman && (
        <Box flexDirection="row" gap={1}>
          <Button
            key="approve"
            hotkey="a"
            variant="primary"
            label={S.approve}
            onPress={() => decide($, card.id, 'done')}
          />
          {Input !== undefined && (
            <Button
              key="sendback"
              hotkey="s"
              label={isAsk ? S.answerButton : S.sendBack}
              onPress={async () =>
                sendBack($, card.id, (await readUi($)).draft)
              }
            />
          )}
          <Button
            key="park"
            hotkey="p"
            label={S.park}
            onPress={() => decide($, card.id, 'backlog')}
          />
        </Box>
      )}
      {isHuman && Input === undefined && (
        <Text dimColor>{isAsk ? S.answerNoField : S.sendBackNoField}</Text>
      )}
      {isHuman && Input !== undefined && (
        <Button
          key="focus"
          hotkey="f"
          label={isAsk ? S.focusAnswer : S.focusFeedback}
          onPress={() => focusFeedback($)}
        />
      )}
      {isHuman && Input !== undefined && (
        <Input
          key="feedback"
          label={isAsk ? S.answerLabel : S.feedbackLabel}
          placeholder={isAsk ? S.answerPlaceholder : S.feedbackPlaceholder}
          rows={3}
          value={ui.draft}
          onInput={value => updateUi($, one => ({ ...one, draft: value }))}
          onSubmit={value => sendBack($, card.id, value)}
        />
      )}
      {isHuman && <Text dimColor>{S.reviewHint(hint)}</Text>}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{S.moveTo}</Text>
        {COLUMNS.filter(column => column !== card.column).map(column => (
          <Button
            key={`move:${column}`}
            label={
              column === 'done' ||
              column === 'suspended' ||
              column === 'cancelled'
                ? S.setAsideTo[column]
                : S.col[column]
            }
            onPress={() =>
              moveCard($, card.id, column, moveOptions(card.column, column))
            }
          />
        ))}
      </Box>
      {canReorder && siblings.length > 1 && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{S.reorderLabel}</Text>
          {place > 0 && (
            <Button
              key="reorder:up"
              label={S.reorderUp}
              onPress={() => shiftCard($, card.id, 'up')}
            />
          )}
          {place < siblings.length - 1 && (
            <Button
              key="reorder:down"
              label={S.reorderDown}
              onPress={() => shiftCard($, card.id, 'down')}
            />
          )}
        </Box>
      )}
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
        detail.sections.map((section, index) =>
          // The open question is shown at the top.
          section === asking ? null : (
            <Markdown
              key={`section:${index}`}
              text={`**${S.headingOf(section)}**\n\n${section.text}`}
            />
          ),
        )}
      {check}
    </Box>
  )
}

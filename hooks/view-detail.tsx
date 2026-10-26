import type {
  EngineInterface,
  RenderElement,
  RenderInput,
  ThemeKey,
} from 'claude-code'

import type {
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanSection,
  KanbanSync,
  KanbanView,
} from '../types'
import {
  type Totals,
  agentsOf,
  agentsOfRound,
  colorOf,
  liveTotals,
  statsLabel,
  tokenLabel,
  totalsOf,
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
  cellWidth,
  errorMessage,
  isPendingId,
} from './model'
import { shiftCard } from './reorder'
import { S } from './strings'
import { moveCard, moveOptions, retry } from './sync'
import { renderCheck } from './view-check'
import { dotted, packRows, separatorWidth } from './view-parts'

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

// How a card's section reads in its line under the title; Human and Claude carry their colors.
const SECTION_LOOK: Partial<
  Record<KanbanColumn, { color: ThemeKey } | { dimColor: true }>
> = {
  human: { color: 'permission' },
  claude: { color: 'claude' },
  done: { dimColor: true },
}

const SYNC_COLOR = {
  pending: 'warning',
  ok: 'success',
  failed: 'error',
} as const satisfies Record<KanbanSync['phase'], ThemeKey>

// Who wrote a section: Claude, or the person.
const WRITER = {
  handoff: 'claude',
  question: 'claude',
  feedback: 'permission',
  answer: 'permission',
  check: 'permission',
} as const satisfies Record<KanbanSection['kind'], ThemeKey>

const HANDOFF_FIELDS = ['did', 'check', 'changed', 'need'] as const

// Below this many columns the label boxes take their narrow width.
const NARROW = 40

// Cells between the Prev, the place and the Next.
const NAV_GAP = 2

// The handoff the person is being asked to look at: the newest counted one, unless
// feedback or an answer has come after it.
function currentHandoff(sections: readonly KanbanSection[]) {
  const counted = sections.filter(one => one.byOther === undefined)
  const handoff = counted.findLast(one => one.kind === 'handoff')
  const reply = counted.findLastIndex(
    one => one.kind === 'feedback' || one.kind === 'answer',
  )

  return handoff !== undefined && counted.indexOf(handoff) > reply
    ? handoff
    : undefined
}

// The fields of a handoff that say something, as label and text.
function handoffRows(section: KanbanSection): [string, string][] {
  const { fields } = section
  if (fields === undefined) return []

  return HANDOFF_FIELDS.flatMap(name =>
    fields[name].trim() === '' ? [] : [[S.handoffField[name], fields[name]]],
  )
}

// What follows `Total` or `Round N`: time and tokens, cache reads, then `extra`.
function activityValue(totals: Totals, ...extra: string[]) {
  const stats = statsLabel(totals)

  return [
    stats === '' ? '-' : stats,
    ...(totals.cacheRead > 0 ? [S.cached(tokenLabel(totals.cacheRead))] : []),
    ...extra,
  ].join(S.statsSep)
}

// The least cut of the Prev / place / Next group that fits beside Board: the
// arrows go first, then the place, then the words.
function navLevel(columns: number, place: string): number {
  const back = cellWidth(`b: ${S.back}`)
  for (const level of [0, 1, 2]) {
    const items = [
      `k: ${S.navPrev[level]}`,
      ...(level < 2 ? [place] : []),
      `n: ${S.navNext[level]}`,
    ]
    const width =
      items.reduce((sum, item) => sum + cellWidth(item), 0) +
      NAV_GAP * (items.length - 1)
    if (back + 1 + width <= columns) return level
  }

  return 3
}

export async function renderDetail(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  view: DetailView,
) {
  const els = $.ui.resolve(e)
  const { Box, Button, Code, Link, Markdown, Text } = els
  // The mobile app draws no field yet, though its element table names Input.
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const board = await readBoard($)
  const ui = await readUi($)
  const detail = await readDetailState($)
  const sync = await readSync($)
  const activity = await readActivity($)
  const now = await $.clock.now()
  const card = board.cards.find(one => one.id === view.cardId)
  const columns = e.props.bodyColumns
  const isNarrow = columns < NARROW

  const back = (
    <Button
      key="back"
      plain
      hotkey="b"
      label={S.back}
      onPress={() => closeDetail($)}
    />
  )
  if (card === undefined) {
    return (
      <Box flexDirection="column" gap={1}>
        {back}
        <Text dimColor>{S.cardGone}</Text>
      </Box>
    )
  }

  const entry = sync[card.id]
  const worked = activity.cards[card.id]
  const isHuman = card.column === 'human'
  const queue = isHuman ? queueAt(board.cards, card.id) : undefined
  const isReady = detail?.cardId === card.id && !detail.isLoading
  const hasDiff = (card.prNumbers?.length ?? 0) > 0
  const tab = hasDiff ? view.tab : 'card'
  const isAsk = isHuman && card.tag === 'question'
  // The question being asked, once the card's sections are read.
  const asking = isReady && isAsk ? questionOf(detail.sections) : undefined
  // What the person is shown first: the open question, else the handoff to review.
  const pinned =
    isReady && isHuman && detail.error === undefined
      ? (asking ?? currentHandoff(detail.sections))
      : undefined
  // Where the Client has drag and keys, the board reorders; elsewhere it is here.
  const hasClient = e.surface === 'terminal' || e.surface === 'desktop'
  const siblings = sectionList(board.cards, card.column)
  const place = siblings.findIndex(one => one.id === card.id)
  const canReorder = !hasClient && card.column !== 'done' && place >= 0
  const labelWidth = isNarrow ? 8 : 10
  const fieldWidth = isNarrow ? 8 : 9

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

  // A dim label, then what it is about, in two columns.
  const listed = (key: string, rows: readonly [string, string][]) => (
    <Box key={key} flexDirection="column">
      {rows.map(([label, text], index) => (
        <Box key={`${key}:${index}`} flexDirection="row">
          <Box width={fieldWidth}>
            <Text dimColor>{label}</Text>
          </Box>
          <Text wrap="wrap">{text}</Text>
        </Box>
      ))}
    </Box>
  )

  // A section's content: a handoff's fields in two columns, any other text as Markdown.
  const contentOf = (section: KanbanSection) => {
    const rows = handoffRows(section)

    return rows.length > 0 ? (
      listed('fields', rows)
    ) : (
      <Markdown text={section.text} />
    )
  }

  // A dim label, then the Buttons it is for in rows that fit the width.
  const labelled = (
    label: string,
    buttons: readonly { key: string; width: number; button: RenderElement }[],
  ) => (
    <Box key={`row:${label}`} flexDirection="row">
      <Box width={labelWidth}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column">
        {packRows(
          buttons,
          one => one.width,
          columns - labelWidth,
          separatorWidth(e.surface),
        ).map(line => (
          <Box key={`line:${line.map(one => one.key).join(':')}`}>
            {dotted(
              $,
              e,
              line.map(one => one.button),
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )

  // The sections a card can move to, as one row of links under a label.
  const moveRow = (label: string, targets: readonly KanbanColumn[]) =>
    labelled(
      label,
      targets.map(column => ({
        key: column,
        width: cellWidth(S.col[column]),
        button: (
          <Button
            key={`move:${column}`}
            plain
            label={S.col[column]}
            onPress={() =>
              moveCard($, card.id, column, moveOptions(card.column, column))
            }
          >
            <Text color="suggestion">{S.col[column]}</Text>
          </Button>
        ),
      })),
    )

  const check =
    isReady && tab === 'card' && detail.error === undefined
      ? await renderCheck($, e, card, detail.sections, now)
      : null

  const blocks: RenderElement[] = []

  if (queue !== undefined && queue.total > 1) {
    const position = S.position(queue.index + 1, queue.total)
    const level = navLevel(columns, position)
    blocks.push(
      <Box key="nav" flexDirection="row" justifyContent="space-between">
        {back}
        <Box flexDirection="row" gap={NAV_GAP}>
          <Button
            key="prev"
            plain
            hotkey="k"
            label={S.navPrev[level] ?? ''}
            onPress={() => stepQueue($, card.id, -1)}
          />
          {level < 2 && <Text dimColor>{position}</Text>}
          <Button
            key="next"
            plain
            hotkey="n"
            label={S.navNext[level] ?? ''}
            onPress={() => stepQueue($, card.id, 1)}
          />
        </Box>
      </Box>,
    )
  } else {
    blocks.push(back)
  }

  const age = ageLabel(card.updatedAt, now)
  const metaParts: RenderElement[] = [
    <Text key="section" {...(SECTION_LOOK[card.column] ?? {})}>
      {S.col[card.column]}
    </Text>,
    ...(card.tag === undefined
      ? []
      : [
          <Text key="tag" dimColor>
            {S.tagWords[card.tag]}
          </Text>,
        ]),
    ...(age === ''
      ? []
      : [
          <Text key="updated" dimColor>
            {S.detailUpdated(age)}
          </Text>,
        ]),
    ...(entry === undefined
      ? []
      : [
          <Text key="sync" color={SYNC_COLOR[entry.phase]}>
            {syncNote(entry)}
          </Text>,
        ]),
    ...(card.url === undefined
      ? []
      : [<Link key="link" href={card.url} label={S.githubLink} />]),
  ]
  blocks.push(
    <Box key="head" flexDirection="column">
      <Text wrap="wrap">
        <Text dimColor>{`#${card.number}`}</Text>
        <Text weight="bold">{` ${card.title}`}</Text>
      </Text>
      <Text>
        {metaParts.flatMap((part, index) =>
          index === 0
            ? [part]
            : [
                <Text key={`dot:${index}`} dimColor>
                  {S.dot}
                </Text>,
                part,
              ],
        )}
      </Text>
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
          <Box paddingLeft={2}>
            {listed('activity', [
              [
                S.totalHeading,
                activityValue(liveTotals(worked, activity.live, now)),
              ],
              ...worked.rounds.map((round, index): [string, string] => [
                S.roundHeading(index + 1),
                activityValue(
                  totalsOf([round]),
                  agentsOfRound(round).join(', '),
                ),
              ]),
            ])}
          </Box>
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
    </Box>,
  )

  if (isHuman) {
    blocks.push(
      <Box key="actions" flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
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
        {Input === undefined && (
          <Text dimColor>{isAsk ? S.answerNoField : S.sendBackNoField}</Text>
        )}
        {Input !== undefined && (
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
        {Input !== undefined && (
          <Button
            key="focus"
            plain
            dimColor
            hotkey="f"
            label={isAsk ? S.focusAnswer : S.focusFeedback}
            onPress={() => focusFeedback($)}
          />
        )}
      </Box>,
    )
  }

  if (pinned !== undefined) {
    const title = asking === undefined ? S.pinnedHandoff : S.pinnedAsk
    blocks.push(
      <Box
        key={asking === undefined ? 'handoff' : 'question'}
        flexDirection="column"
      >
        <Text>
          <Text weight="bold" color="claude">
            {title.who}
          </Text>
          <Text weight="bold">
            {`${title.rest}${S.dot}${S.shortDate(pinned.date)}`}
          </Text>
        </Text>
        <Box paddingLeft={2}>{contentOf(pinned)}</Box>
      </Box>,
    )
    // The Check runs what that handoff says to check, so it follows it.
    if (check !== null) blocks.push(check)
  }

  blocks.push(
    moveRow(
      S.moveRowLabel,
      COLUMNS.filter(column => column !== card.column),
    ),
  )

  if (canReorder && siblings.length > 1) {
    const arrow = (dir: 'up' | 'down') => {
      const mark = dir === 'up' ? S.reorderUp : S.reorderDown

      return {
        key: dir,
        width: cellWidth(mark),
        button: (
          <Button
            key={`reorder:${dir}`}
            plain
            label={mark}
            onPress={() => shiftCard($, card.id, dir)}
          >
            <Text color="suggestion">{mark}</Text>
          </Button>
        ),
      }
    }
    const arrows = [
      ...(place > 0 ? [arrow('up')] : []),
      ...(place < siblings.length - 1 ? [arrow('down')] : []),
    ]
    blocks.push(labelled(S.reorderRowLabel, arrows))
  }

  if (hasDiff) {
    blocks.push(
      <Box key="tabs" flexDirection="row" gap={1}>
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
      </Box>,
    )
  }

  if (!isReady) {
    blocks.push(<Text dimColor>{S.detailLoading}</Text>)
  } else if (tab === 'diff') {
    blocks.push(drawDiff(detail))
  } else if (detail.error !== undefined) {
    blocks.push(<Text color="error">{S.detailFailed(detail.error)}</Text>)
  } else {
    blocks.push(
      <Markdown
        key="spec"
        text={detail.body === '' ? S.noSpec : detail.body}
      />,
    )
    // The pinned section is shown above, not twice.
    const history = detail.sections.flatMap((section, index) =>
      section === pinned ? [] : [{ section, index }],
    )
    if (history.length > 0) {
      blocks.push(
        <Box key="history" flexDirection="column">
          <Text weight="bold">{S.historyHeading}</Text>
          <Box flexDirection="column" paddingLeft={2} gap={1}>
            {history.map(({ section, index }) => (
              <Box key={`section:${index}`} flexDirection="column">
                <Text>
                  <Text
                    weight="bold"
                    {...(section.byOther === undefined
                      ? { color: WRITER[section.kind] }
                      : {})}
                  >
                    {`${S.sectionName[section.kind]}${S.dot}${S.shortDate(section.date)}`}
                  </Text>
                  {section.byOther !== undefined && (
                    <Text dimColor>{S.notCounted(section.byOther)}</Text>
                  )}
                </Text>
                <Box paddingLeft={2}>{contentOf(section)}</Box>
              </Box>
            ))}
          </Box>
        </Box>,
      )
    }
  }
  if (check !== null && pinned === undefined) blocks.push(check)

  return (
    <Box flexDirection="column" gap={1}>
      {blocks}
    </Box>
  )
}

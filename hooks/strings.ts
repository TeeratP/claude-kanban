import type {
  KanbanBackendMode,
  KanbanCard,
  KanbanColumn,
  KanbanSection,
  KanbanTag,
} from '../types'

const COL = {
  human: 'Human',
  claude: 'Claude',
  backlog: 'Backlog',
  done: 'Done',
} satisfies Record<KanbanColumn, string>

const SECTION_NAME = {
  handoff: 'Handoff',
  feedback: 'Feedback',
  question: 'Question',
  answer: 'Answer',
} satisfies Record<KanbanSection['kind'], string>

const BACKEND = { github: 'GitHub', local: 'Local' } as const

// A section someone else wrote on the issue is shown, but never counts.
const fromOther = (login?: string) =>
  login === undefined ? '' : ` from @${login}, not counted`

// Every string the person or the model reads lives here.
export const S = {
  commandDescription: 'Open the kanban board in a side pane',
  paneTitle: 'Kanban',
  opened: 'Kanban pane opened.',
  notPlaced: (reason: string) =>
    `The kanban pane could not be placed: ${reason}`,
  refreshFailed: (reason: string) =>
    `kanban: could not refresh the board: ${reason}`,

  col: COL,
  tagShort: {
    review: 'rev',
    human: 'hum',
    question: '?',
  } satisfies Record<KanbanTag, string>,
  count: (shown: number, total: number) =>
    shown === total ? String(total) : `${shown} of ${total}`,
  empty: '  (empty)',
  noCards: 'No cards yet. Add .kanban/0001-title.md',
  more: (dir: 'up' | 'down', n: number) =>
    `  ${dir === 'up' ? '↑' : '↓'} ${n} more`,

  refresh: '↻',
  loading: 'loading…',
  updated: (age: string) => `updated ${age}`,
  expand: '▸',
  collapse: '▾',
  syncing: '⟳',
  failedGlyph: '✕',
  confirmed: '✓',

  unreadableCard: (path: string) => `${path} is not a kanban card file.`,
  cardHasNoFile: (card: KanbanCard) => `Card #${card.number} has no file.`,

  back: '← Board',
  moveTo: 'Move to:',
  detailLoading: 'Loading…',
  noSpec: '(no description)',
  cardGone: 'This card is no longer on the board.',
  detailFailed: (reason: string) => `Could not read the card: ${reason}`,
  metaColumn: (column: KanbanColumn) => COL[column],
  syncPending: (to: KanbanColumn) => `⟳ syncing to ${COL[to]}`,
  handoffHeading: (date: string, byOther?: string) =>
    `Handoff (${date})${fromOther(byOther)}`,
  feedbackHeading: (date: string, byOther?: string) =>
    `Feedback (${date})${fromOther(byOther)}`,

  toolList: {
    description:
      'List the cards on the kanban board, one per line: #number [column] title. Done lists only its 10 newest.',
    column: 'Only list cards in this column.',
  },
  toolMove: {
    description:
      'Move a kanban card to another column (human, claude, backlog or done).',
    card: 'The card number, as shown by kanban_list.',
    to: 'The column to move the card to.',
  },
  listLine: (card: KanbanCard, isQueued = false) =>
    `#${card.number} [${card.column}] ${card.title}${card.tag ? ` (${card.tag})` : ''}${isQueued ? ' (queued)' : ''} updated ${card.updatedAt.slice(0, 10)}`,
  boardUnavailable: (reason?: string) =>
    `The kanban board could not be loaded${reason === undefined ? '' : `: ${reason}`}.`,
  listEmpty: 'No cards on the board.',
  moved: (card: KanbanCard, to: KanbanColumn) =>
    `Moved #${card.number} to ${COL[to]} (syncing).`,
  noSuchCard: (n: unknown) => `There is no kanban card #${String(n)}.`,
  badColumn: (to: unknown) =>
    `"${String(to)}" is not a column; use human, claude, backlog or done.`,
  badCard: 'card must be a whole number.',
  toolFailed: (name: string) => `${name} failed; see the debug log.`,

  // #5
  waiting: (n: number) =>
    n === 1 ? '1 card waiting on you' : `${n} cards waiting on you`,
  handedToYou: (card: KanbanCard) =>
    `Waiting on you: #${card.number} ${card.title}`,
  cacheFailed: (reason: string) =>
    `kanban: could not use the saved board: ${reason}`,
  notifyFailed: (reason: string) =>
    `kanban: could not send the notification: ${reason}`,

  // #6
  toolShow: {
    description:
      'Show one kanban card in full: its spec, then every Handoff, Feedback, Question and Answer section, newest last.',
    card: 'The card number, as shown by kanban_list.',
  },
  toolHandoff: {
    description:
      'Record a handoff on a kanban card before giving it to the person: what you did, how they can check it, what changed and what you need from them. A card can only move to Human after a handoff newer than the latest feedback.',
    card: 'The card number, as shown by kanban_list.',
    did: 'What you did, briefly.',
    check: 'How the person can check the work; required.',
    changed: 'The files or things that changed.',
    need: 'What you need from the person: a review, a decision, an answer; required.',
  },
  toolCreate: {
    description:
      'Create a kanban card in the local .kanban folder. Not for GitHub boards: use the /issue skill there.',
    title: 'A short title for the card.',
    spec: 'The card text: what is to be done and how to tell it is done.',
    column:
      'The column to create the card in (claude, backlog or done); backlog if omitted.',
  },
  handoffFailed: (reason: string) => `Could not record the handoff: ${reason}`,
  handedOff: (card: KanbanCard) =>
    `Recorded a handoff on #${card.number}. Move it to human with kanban_move when it is ready for the person.`,
  badText: (name: string) => `${name} must be text.`,
  handoffIncomplete:
    'A handoff needs a real check and a real need: say how the person can verify the work and what you need from them.',
  needHandoff: (card: KanbanCard) =>
    `Card #${card.number} cannot move to Human yet: record a handoff with kanban_handoff (with a check and what you need from the person), newer than any feedback.`,
  useKanbanMove:
    'A card goes to Human through a handoff, not a file edit: record one with kanban_handoff, then use kanban_move.',
  badTitle: 'title must be text that is not empty.',
  createNotHuman:
    'A new card cannot start in Human: create it in claude or backlog, record a handoff with kanban_handoff, then use kanban_move.',
  created: (card: KanbanCard) =>
    `Created #${card.number} [${card.column}] ${card.title} in ${card.file ?? 'the board'}.`,
  createFailed: (reason: string) => `Could not create the card: ${reason}`,
  createViaIssueSkill:
    'GitHub boards are made of issues; create the card with the /issue skill instead.',

  // #3
  githubDetectFailed: (reason: string) =>
    `kanban: using local cards, GitHub is not usable here: ${reason}`,
  commandExited: (command: string, code: number) => `${command} exited ${code}`,
  ghBadJson: (what: string, reason?: string) =>
    `gh returned ${what} that could not be read${reason ? `: ${reason}` : ''}.`,
  noBoardItem: (card: KanbanCard) =>
    `#${card.number} is not on the project board.`,
  closeNotVerified: (card: KanbanCard) =>
    `#${card.number} is still open after gh issue close.`,
  noStatusField: (projectNumber: string) =>
    `Project #${projectNumber} has no Status field.`,
  missingStatusOption: (name: string) =>
    `The project's Status field has no "${name}" option.`,

  // #7
  approve: 'Approve',
  sendBack: 'Send back',
  park: 'Park',
  feedbackLabel: 'Feedback',
  feedbackPlaceholder: 'What should Claude change?',
  feedbackFirst: 'Write the feedback first, then send the card back.',
  feedbackFailed: (reason: string) => `Could not save the feedback: ${reason}`,
  sendBackNoField:
    'Send back is unavailable here: this screen has no text field. Use the terminal or desktop.',
  tabCard: 'Card',
  tabDiff: 'Diff',
  noDiff: 'No diff for this card.',
  diffFailed: (reason: string) => `Could not read the diff: ${reason}`,
  diffCut: (omitted: number) =>
    `… diff cut, ${omitted} more characters not shown.`,

  // #4
  movedBack: (
    card: KanbanCard,
    to: KanbanColumn,
    from: KanbanColumn,
    reason: string,
  ) =>
    `Could not move #${card.number} to ${COL[to]}, so it is back in ${COL[from]}: ${reason}`,
  syncFailed: (reason: string) =>
    `kanban: a card move could not be synced: ${reason}`,
  retry: 'Retry',
  retryAll: (n: number) => `✕${n} retry`,
  syncSaved: '✓ saved',
  syncFailedNote: (reason: string, attempt: number, max: number) =>
    `✕ ${reason} (attempt ${attempt}/${max})`,
  workPrompt: (n: number, title: string) =>
    `Work on kanban card #${n} "${title}": read it with mcp__kanban__kanban_show, do the work, then record a handoff with mcp__kanban__kanban_handoff and move it to human with mcp__kanban__kanban_move.`,
  resumePrompt: (n: number) =>
    `Resume kanban card #${n}: read the newest feedback (mcp__kanban__kanban_show) and continue.`,
  promptFailed: (reason: string) =>
    `kanban: could not send the prompt to Claude: ${reason}`,

  // #10
  backendLabel: (mode: KanbanBackendMode, kind?: 'github' | 'local') => {
    const name = kind ?? mode

    return name === 'auto'
      ? ''
      : `${BACKEND[name]}${mode === 'auto' ? ' (auto)' : ''}`
  },
  githubNoProject: 'CLAUDE.md needs a Repo and a Project board line',
  githubSignedOut: (reason: string) =>
    `gh auth status failed: run gh auth login (${reason})`,
  githubNoRemote: (reason: string) =>
    `no origin remote: run git remote add origin <url> (${reason})`,
  githubProjectFailed: (reason: string) =>
    `project board: ${reason}; check the IDs in CLAUDE.md`,
  // #11
  keyHint: '↑↓ ⏎ open · m move',
  moveKeys: (keys: readonly string[]) => `  ${keys.join('/')}`,

  // #15
  // Short: they share a 44-column toolbar with the backend label.
  rateLimitHit: (minutes: number) => `limit hit · paused ${minutes}m`,
  rateLimitLow: (minutes: number) => `limit low · paused ${minutes}m`,
  refreshWhilePaused: (minutes: number) =>
    `GitHub rate limit is low and polling is paused for ${minutes}m. Refreshing anyway.`,
  rateLimitLookupFailed: (reason: string) =>
    `kanban: could not read when the GitHub rate limit resets: ${reason}`,
  pageLimitReached: (items: number) =>
    `kanban: the board has more than ${items} items; only the first ${items} are shown.`,
  aiLabelDescription: 'agent can do end-to-end',
  unknownAuthor: 'unknown',
  // #21
  headingOf: (section: KanbanSection) =>
    `${SECTION_NAME[section.kind]} (${section.date})${fromOther(section.byOther)}`,
  toolAsk: {
    description:
      'Ask the person a blocking question on a kanban card when you cannot go on without a decision only they can make. Records the question and moves the card to Human; you are asked to resume once they answer. Not for progress updates or for questions you can settle yourself: record a handoff with kanban_handoff when the work is done.',
    card: 'The card number, as shown by kanban_list.',
    question:
      'The question, with what you need decided and the options you see.',
  },
  askEmpty: 'question must be text that is not empty.',
  askFailed: (reason: string) => `Could not record the question: ${reason}`,
  asked: (card: KanbanCard) =>
    `Recorded your question on #${card.number} and moved it to Human (syncing). Stop here: you are asked to resume once the person answers.`,
  claudeAsks: (card: KanbanCard) =>
    `Claude asks: ${card.question ?? card.title} (#${card.number})`,
  askBlock: 'Claude asks',
  answerButton: 'Answer',
  answerLabel: 'Answer',
  answerPlaceholder: 'Your answer to Claude',
  answerFirst: 'Write the answer first, then send it to Claude.',
  answerFailed: (reason: string) => `Could not save the answer: ${reason}`,
  answerNoField:
    'Answering is unavailable here: this screen has no text field. Use the terminal or desktop.',
  answerPrompt: (n: number) =>
    `Resume kanban card #${n}: the person answered your question; read it with mcp__kanban__kanban_show and continue.`,

  // #20
  claudeCount: (running: number, limit: number, queued: number) =>
    `${running}/${limit}${queued === 0 ? '' : ` · ${queued} queued`}`,
  queuedMark: (place: number) => `queued ${place}`,
  queueSaveFailed: (reason: string) =>
    `kanban: could not save the queue: ${reason}`,
  queueRestoreFailed: (reason: string) =>
    `kanban: could not read the saved queue: ${reason}`,
}

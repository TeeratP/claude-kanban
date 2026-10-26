import type {
  KanbanBackendMode,
  KanbanCard,
  KanbanColumn,
  KanbanGroup,
  KanbanSection,
  KanbanTag,
} from '../types'
import type { Copy } from './model'

const COL = {
  human: 'Human',
  claude: 'Claude',
  backlog: 'Backlog',
  done: 'Done',
  cancelled: 'Cancelled',
  suspended: 'Suspended',
} satisfies Record<KanbanColumn, string>

const SECTION_NAME = {
  handoff: 'Handoff',
  feedback: 'Feedback',
  question: 'Question',
  answer: 'Answer',
  check: 'Check run',
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
  more: (dir: 'up' | 'down', n: number) =>
    `${dir === 'up' ? '↑' : '↓'} ${n} more`,

  refresh: 'Refresh',
  loading: 'loading…',
  updated: (age: string) =>
    age === 'now' ? 'updated just now' : `updated ${age} ago`,
  expand: '▸',
  collapse: '▾',
  syncing: '⟳',
  failedGlyph: '✕',
  confirmed: '✓',

  unreadableCard: (path: string) => `${path} is not a kanban card file.`,
  cardHasNoFile: (card: KanbanCard) => `Card #${card.number} has no file.`,

  back: '← Board',
  detailLoading: 'Loading…',
  noSpec: '(no description)',
  cardGone: 'This card is no longer on the board.',
  detailFailed: (reason: string) => `Could not read the card: ${reason}`,
  syncPending: (to: KanbanColumn) => `⟳ syncing to ${COL[to]}`,

  toolList: {
    description:
      'List the cards on the kanban board, one per line: #number [column] title. Done and Cancelled list only their 10 newest.',
    column: 'Only list cards in this column.',
  },
  toolMove: {
    description:
      'Move a kanban card to another column (human, claude, backlog or done). Suspended and Cancelled are set by the person only.',
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
      'Create a kanban card: a file in the local .kanban folder, or on a GitHub board an issue labeled triage, which the person grooms later.',
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
    `Created #${card.number} [${card.column}] ${card.title} in ${card.file ?? card.url ?? 'the board'}.`,
  createFailed: (reason: string) => `Could not create the card: ${reason}`,

  // #3
  githubDetectFailed: (reason: string) =>
    `kanban: using local cards, GitHub is not usable here: ${reason}`,
  commandExited: (command: string, code: number) => `${command} exited ${code}`,
  ghBadJson: (what: string, reason?: string) =>
    `gh returned ${what} that could not be read${reason ? `: ${reason}` : ''}.`,
  noBoardItem: (card: KanbanCard) =>
    `#${card.number} is not on the project board.`,
  closeNotVerified: (card: KanbanCard) =>
    `#${card.number} is not closed as expected after gh issue close.`,
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
  // `isShort` drops the " (auto)" a narrow pane has no room for.
  backendLabel: (
    mode: KanbanBackendMode,
    kind?: 'github' | 'local',
    isShort = false,
  ) => {
    const name = kind ?? mode

    return name === 'auto'
      ? ''
      : `${BACKEND[name]}${mode === 'auto' && !isShort ? ' (auto)' : ''}`
  },
  githubSignedOut: (reason: string) =>
    `gh auth status failed: run gh auth login (${reason})`,
  githubNoRemote: (reason: string) =>
    `no origin remote: run git remote add origin <url> (${reason})`,
  githubProjectFailed: (reason: string) =>
    `project board: ${reason}; check the IDs in CLAUDE.md`,
  // #11
  keyHint: '↑↓ ⏎ open · m move',

  // #19
  checkHeading: 'Check',
  runCheck: (command: string) => `Run check: ${command}`,
  checkRunning: (command: string, elapsed: string) =>
    `⟳ Running ${command} · ${elapsed}`,
  checkPassed: (code: number, took: string) =>
    `✓ Passed · exit ${code} · ${took}`,
  checkFailed: (code: number, took: string) =>
    `✕ Failed · exit ${code} · ${took}`,
  checkTimedOut: (minutes: number) => `✕ Timed out after ${minutes} min`,
  checkNotRun: (reason: string) => `✕ Could not run: ${reason}`,
  checkLost: '✕ The run was lost when the plugin reloaded. Run it again.',
  checkRan: (age: string) => (age === 'now' ? 'just now' : `${age} ago`),
  checkEarlier: (n: number) =>
    `… ${n} earlier ${n === 1 ? 'line' : 'lines'} not shown`,
  checkCapped: '… the output was cut at 4 MiB; its end is not shown',
  attachToCard: 'Attach to card',
  checkSaving: 'Saving to the card…',
  checkSaved: '✓ Saved on the card',
  checkSaveFailed: (reason: string) =>
    `Could not save the run on the card: ${reason}`,
  checkField: { command: 'Command', result: 'Result', output: 'Output' },
  checkLogFailed: (reason: string) => `kanban: a check run failed: ${reason}`,

  // #18
  focusFeedback: 'Write feedback',
  focusAnswer: 'Write answer',
  focusFailed: (reason: string) =>
    `Could not move to the feedback box: ${reason}`,

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
  answerButton: 'Answer',
  answerLabel: 'Answer',
  answerPlaceholder: 'Your answer to Claude',
  answerFirst: 'Write the answer first, then send it to Claude.',
  answerFailed: (reason: string) => `Could not save the answer: ${reason}`,
  answerNoField:
    'Answering is unavailable here: this screen has no text field. Use the terminal or desktop.',
  answerPrompt: (n: number) =>
    `Resume kanban card #${n}: the person answered your question; read it with mcp__kanban__kanban_show and continue.`,

  // #17
  mainAgent: 'Claude',
  agentDot: '●',
  agentsMore: (n: number) => `+${n}`,
  toolRunning: (tool: string) => `⟳ ${tool}`,
  working: '⟳ working',
  idle: (age: string) => (age === 'now' ? 'idle' : `idle ${age}`),
  statsSep: ' · ',
  tokens: (label: string) => `${label} tok`,
  cached: (label: string) => `${label} cached`,
  agentsHeading: 'Agents',
  totalHeading: 'Total',
  roundHeading: (n: number) => `Round ${n}`,
  activityFailed: (reason: string) =>
    `kanban: could not record Claude's activity: ${reason}`,

  // #20
  queueSaveFailed: (reason: string) =>
    `kanban: could not save the queue: ${reason}`,
  queueRestoreFailed: (reason: string) =>
    `kanban: could not read the saved queue: ${reason}`,

  // #22
  positionFailed: (reason: string) =>
    reason === ''
      ? "GitHub did not accept the card's new position."
      : `GitHub did not accept the card's new position: ${reason}`,
  reorderUndone: (card: KanbanCard, reason: string) =>
    `Could not reorder #${card.number} in ${COL[card.column]}, so it is back where it was: ${reason}`,
  reorderUp: '↑',
  reorderDown: '↓',

  // #23
  add: 'New',
  addTitleLabel: 'New card',
  addTitlePlaceholder: 'New card title',
  addDetailsLabel: 'Details',
  addDetailsPlaceholder: 'What is to be done, and how to tell it is done',
  addSubmit: 'add',
  addCancel: 'Cancel',
  addNeedsTitle: 'Give the card a title first.',
  addFailed: (reason: string) => `Could not add the card: ${reason}`,
  triageLabelDescription: 'needs grooming',
  createdPartly: (url: string, reason: string) =>
    `Created ${url} but could not finish adding it: ${reason}`,
  // #24
  toolSuggest: {
    description:
      'Suggest a kanban card for a follow-up, a deferred item or out-of-scope work you notice. This creates nothing: the person sees the suggestion on the board and presses Add or Dismiss.',
    title: 'A short title for the card.',
    spec: 'The card text: what is to be done and how to tell it is done.',
    why: 'Why it is worth doing, in a sentence.',
  },
  suggestPrompt:
    'When you notice a follow-up, a deferred item or out-of-scope work, call mcp__kanban__kanban_suggest (title, spec, why) instead of only mentioning it in text. It only proposes a card: the person presses Add. Do not create cards with kanban_create unless asked.',
  suggested: (title: string) => `Claude suggests a card: ${title}`,
  suggestedResult: (title: string) =>
    `Suggested "${title}". The person decides whether to add it; do not create it yourself unless asked.`,
  suggestFolded: (title: string) =>
    `"${title}" is already a card or a suggestion; nothing was added.`,
  suggestedHeader: (n: number) => `Suggested (${n})`,
  suggestMore: (n: number) => `  +${n} more`,
  suggestAdd: 'Add',
  suggestDismiss: '✕',
  suggestWhy: (why: string) => `Why: ${why}`,
  suggestionsNotSaved: (reason: string) =>
    `kanban: could not save the suggestions: ${reason}`,

  // #25
  filter: 'Find',
  filterLabel: 'Filter',
  filterSubmit: 'done',
  filterClear: '✕',
  filterCount: (shown: number, total: number) => `${shown}/${total}`,

  // #31
  positionSkipped: (card: KanbanCard, reason: string) =>
    `kanban: left #${card.number} where GitHub put it, its position was not set: ${reason}`,

  // #32
  configUnreadable: (file: string, reason: string) =>
    `kanban: could not read ${file} for the board config: ${reason}`,
  githubConfigUnclear:
    'CLAUDE.md or AGENTS.md mentions a project board, but no Repo and Project number could be read from it',
  configUnclear: 'board config not understood',

  // #33
  boardName: (number: number, title: string) => `#${number} ${title}`,
  noGithubBoard: (repo: string) => `no GitHub board for ${repo}`,
  pickBoard: 'Pick board:',
  changeBoard: 'Change board:',
  pickLabel: (name: string) => ` [${name}]`,
  noOtherBoard: (repo: string) => `No other GitHub board is linked to ${repo}.`,
  pickFailed: (reason: string) => `Could not use that board: ${reason}`,
  noReviewStatus:
    'This board has no In review status: Human is the human label on a card in progress.',
  humanLabelDescription: 'needs a person (credentials, console, device)',
  detectSaveFailed: (reason: string) =>
    `kanban: could not save the detected board: ${reason}`,
  githubNoGh: (reason: string) =>
    `gh is not installed: install it from https://cli.github.com (${reason})`,
  originNotGithub: (url: string) => `origin ${url} is not a github.com URL`,
  githubLookupFailed: (repo: string, reason: string) =>
    `could not list the GitHub Projects of ${repo}: ${reason}; run gh auth refresh -s read:project`,
  githubDetectedFailed: (number: number, reason: string) =>
    `project board #${number} can't be used: ${reason}`,
  githubNoBoard: (repo: string) =>
    `no GitHub Project is linked to ${repo}: link one on GitHub, or add Repo and Project board lines to CLAUDE.md or AGENTS.md`,
  githubPick: (repo: string) =>
    `Several GitHub boards fit ${repo}: the person must pick one in the kanban pane`,

  // #34
  filterQuery: (query: string) => `Find "${query}"`,
  // #35
  group: { active: 'Active', inactive: 'Inactive' } satisfies Record<
    KanbanGroup,
    string
  >,
  groupsFolded: '  Press a group to open it',
  groupEmpty: 'empty',
  groupMatches: (n: number) =>
    n === 0 ? 'no matches' : n === 1 ? '1 match' : `${n} matches`,
  // A section's count in a folded group's summary: `12 Done`, or `12D` when short.
  groupCount: (n: number, column: KanbanColumn, isShort: boolean) =>
    isShort ? `${n}${COL[column].charAt(0)}` : `${n} ${COL[column]}`,
  newestMeta: (n: number) => `${n} newest`,
  // Claude's limit, who waits for a slot and who is over it; `short` for a narrow pane.
  claudeMeta: (limit: number, queued: number, over: number, isShort: boolean) =>
    [
      isShort ? `lim ${limit}` : `limit ${limit}`,
      ...(queued === 0 ? [] : [isShort ? `${queued}q` : `${queued} queued`]),
      ...(over === 0 ? [] : [`${over} over`]),
    ].join(' · '),
  setAside: (card: KanbanCard) =>
    `Card #${card.number} is ${card.column} by the person; leave it unless they move it back.`,
  stillWorking: (card: KanbanCard) =>
    `Claude is still working on #${card.number}. Press Esc in the prompt to stop it.`,
  setAsideTo: { done: 'Done', suspended: 'Suspend', cancelled: 'Cancel' },
  suspendedLabelDescription: 'on hold (kanban Suspended)',
  badSection: (to: unknown) =>
    `"${String(to)}" is not a column; use backlog, human, claude, done, cancelled or suspended.`,

  // #39
  paneTitleCount: (waiting: number) => `Kanban · ${waiting}`,
  retitleFailed: (reason: string) =>
    `kanban: could not retitle the pane: ${reason}`,

  // #38
  dot: ' · ',
  // The nav's Prev and Next, whole to bare: the arrows go first, then the place, then the words.
  navPrev: ['‹ Prev', 'Prev', 'Prev', '‹'],
  navNext: ['Next ›', 'Next', 'Next', '›'],
  position: (at: number, total: number) => `${at}/${total}`,
  tagWords: {
    review: 'in review',
    human: 'labelled human',
    question: 'question',
  } satisfies Record<KanbanTag, string>,
  detailUpdated: (age: string) =>
    age === 'now' ? 'updated just now' : `updated ${age} ago`,
  githubLink: 'GitHub',
  shortDate: (iso: string) => {
    const [, month, day] = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso) ?? []
    const name = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][Number(month) - 1]

    return name === undefined ? iso : `${name} ${Number(day)}`
  },
  pinnedHandoff: { who: "Claude's", rest: ' handoff' },
  pinnedAsk: { who: 'Claude', rest: ' asks' },
  sectionName: SECTION_NAME,
  notCounted: (login: string) => ` from @${login}, not counted`,
  historyHeading: 'History',
  handoffField: {
    did: 'Did',
    check: 'Check',
    changed: 'Changed',
    need: 'Need',
  },
  moveRowLabel: 'Move to',
  setAsideRow: { long: 'Set aside', short: 'Aside' },
  reorderRowLabel: 'Reorder',
  // Quick add's hint and details button, the longest that fits first.
  addRowClosed: [
    { hint: '⏎ adds to Backlog', details: 'Add details' },
    { hint: '⏎ add', details: 'Details' },
    { hint: '⏎', details: 'Details' },
  ],
  addRowOpen: [
    { hint: '⏎ adds to Backlog', details: 'Hide details' },
    { hint: '⏎ adds', details: 'Hide details' },
    { hint: '⏎ add', details: 'Hide' },
    { hint: '⏎', details: 'Hide' },
  ],
  filterTerms: 'words, #12, label:ai, @done',

  // #37
  // A card not yet made has no number: the column says `new`.
  newCard: 'new',
  // Marks a spare row of a section, under the numbers.
  slot: '·',
  // A queued card's place in the queue, in place of its age: `queued 1`, or `q1` in a narrow pane.
  queued: (place: number, isShort: boolean) =>
    isShort ? `q${place}` : `queued ${place}`,
  // What a section says when it holds no card, long and short; the person's surface decides some.
  emptyHuman: { long: 'All clear, nothing needs you', short: 'All clear' },
  emptyClaude: (canDrag: boolean): Copy => ({
    long: canDrag ? 'Idle · drag a card here' : 'Idle · open a card to move it',
    short: 'Idle',
  }),
  emptyBacklog: (canType: boolean): Copy =>
    canType
      ? { long: 'Nothing yet · n adds a card', short: 'n adds a card' }
      : { long: 'Nothing parked', short: 'Nothing parked' },
  emptyDone: { long: 'Nothing finished yet', short: 'None yet' },
  emptySuspended: { long: 'Nothing on hold', short: 'None' },
  emptyCancelled: { long: 'Nothing dropped', short: 'None' },
  noMatches: 'No matches',
  // An empty board: what it is, and for an auto board on local cards how to use GitHub.
  noCards: {
    long: 'Cards live in .kanban/*.md here.',
    short: 'Cards live in .kanban/',
  },
  noIssues: { long: 'No issues on this board yet.', short: 'No issues yet.' },
  githubHint: [
    {
      long: 'On GitHub? Link a Project to the repo',
      short: 'GitHub? Link a Project',
    },
    {
      long: 'or set backend: github to see why.',
      short: 'or set backend: github',
    },
  ] satisfies Copy[],
  // The key hint in a spare row at the bottom of the list, before and after the first key.
  legendIdle: {
    long: '⏎ open · m move · ⇧J/K reorder',
    short: '⏎ open · m move',
  },
  legendKeys: {
    long: '↑↓ walk · ⏎ open · m+key move',
    short: '↑↓ ⏎ open · m move',
  },

  // #42
  // The system prompt's section on the backlog: what it is, which depends on the backend, then the rules.
  backlogIs: {
    github: (owner: string, project: number) =>
      `This project's backlog is GitHub Issues on board ${owner}/#${project}.`,
    // The `github` setting, before any board is known.
    githubAny: "This project's backlog is GitHub Issues.",
    local: "This project's backlog is the .kanban/*.md cards.",
    unknown: "This project's backlog is a kanban board.",
  },
  backlogRules: [
    'Keep it current with the kanban tools:',
    '- Asked to work the backlog, or given no task: take the top Backlog card (kanban_list) and kanban_move it to claude before writing code.',
    '- When the work a card tracks is done, record kanban_handoff, then kanban_move it to human. Never move a card to done: the person approves it.',
    '- Blocked on a decision only the person can make: kanban_ask.',
    '- Follow-ups: kanban_suggest. Use kanban_create only when asked.',
    '- Never move cards into or out of Suspended or Cancelled.',
    '- Use the kanban tools, not raw gh issue/gh project edits or hand edits of .kanban files, so the board stays in sync.',
  ].join('\n'),
  // Submitted when a turn ends with a card still in Claude and no handoff, question or move.
  reconcilePrompt: (n: number) =>
    `Card #${n} is still in Claude. If the work is done, record a handoff and move it to Human; if you need a decision, kanban_ask; if you are still working, say so and continue.`,
  // Toasted once a session when a turn changed files and no card was in play.
  untrackedWork:
    'This turn changed files with no card in Claude. If it is backlog work, move or create its card.',
  reconcileFailed: (reason: string) =>
    `kanban: could not check the turn's cards: ${reason}`,
}

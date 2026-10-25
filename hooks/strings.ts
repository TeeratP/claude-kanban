import type { KanbanCard, KanbanColumn, KanbanTag } from '../types'

const COL = {
  human: 'Human',
  claude: 'Claude',
  backlog: 'Backlog',
  done: 'Done',
} satisfies Record<KanbanColumn, string>

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
  tagShort: { review: 'rev', human: 'hum' } satisfies Record<KanbanTag, string>,
  count: (shown: number, total: number) =>
    shown === total ? String(total) : `${shown} of ${total}`,
  empty: '  (empty)',
  noCards: 'No cards yet. Add .kanban/0001-title.md',
  more: (dir: 'up' | 'down', n: number) =>
    `  ${dir === 'up' ? '↑' : '↓'} ${n} more`,

  backendLocal: 'local',
  backendGithub: (repo: string) => repo,
  refresh: '↻',
  loading: 'loading…',
  updated: (age: string) => `updated ${age}`,
  expand: '▸',
  collapse: '▾',
  syncing: '⟳',
  failedGlyph: '✕',
  confirmed: '✓',

  moveFailed: (card: KanbanCard, to: KanbanColumn, reason: string) =>
    `Could not move #${card.number} to ${COL[to]}: ${reason}`,
  githubUnavailable: 'The GitHub backend is not available in this build.',
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
  handoffHeading: (date: string) => `Handoff (${date})`,
  feedbackHeading: (date: string) => `Feedback (${date})`,

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
  listLine: (card: KanbanCard) =>
    `#${card.number} [${card.column}] ${card.title}${card.tag ? ` (${card.tag})` : ''} updated ${card.updatedAt.slice(0, 10)}`,
  boardUnavailable: (reason?: string) =>
    `The kanban board could not be loaded${reason === undefined ? '' : `: ${reason}`}.`,
  listEmpty: 'No cards on the board.',
  moved: (card: KanbanCard, to: KanbanColumn) =>
    `Moved #${card.number} to ${COL[to]}.`,
  noSuchCard: (n: unknown) => `There is no kanban card #${String(n)}.`,
  badColumn: (to: unknown) =>
    `"${String(to)}" is not a column; use human, claude, backlog or done.`,
  badCard: 'card must be a whole number.',
  toolFailed: (name: string) => `${name} failed; see the debug log.`,

  // #6
  toolShow: {
    description:
      'Show one kanban card in full: its spec, then every Handoff and Feedback section, newest last.',
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
}

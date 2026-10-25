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
}

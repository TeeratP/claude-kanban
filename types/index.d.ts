export type KanbanColumn =
  'human' | 'claude' | 'backlog' | 'done' | 'suspended' | 'cancelled'
/** Active: Backlog, Claude, Human. Inactive: Done, Cancelled, Suspended. */
export type KanbanGroup = 'active' | 'inactive'
export type KanbanTag = 'review' | 'human' | 'question'
export type KanbanCard = {
  id: string
  number: number
  title: string
  column: KanbanColumn
  order: number
  createdAt: string
  updatedAt: string
  tag?: KanbanTag
  question?: string
  file?: string
  itemId?: string
  status?: string
  labels?: string[]
  isClosed?: boolean
  url?: string
  prNumbers?: number[]
  /** Why a GitHub issue was closed (or reopened); absent for one never closed. */
  stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED'
  /** The GitHub logins the issue is assigned to: whose card it is. */
  assignees?: string[]
}
/** Whose cards the board shows: the person's, theirs and nobody's, or everyone's. */
export type KanbanWho = 'mine' | 'open' | 'all'
/** The names people gave themselves, by GitHub login; kept in the board's README. */
export type KanbanPeople = Record<string, string>
// `inReview` is missing on a detected board without that status: Human is then the `human` label.
// `cancelled` and `suspended` are Status options the board happens to have, learned from its loads.
// `isDetected`: found from git and gh with no config (`title` is the board's name then).
export type KanbanGithub = {
  kind: 'github'
  repo: string
  owner: string
  projectNumber: number
  projectId: string
  statusFieldId: string
  options: {
    backlog: string
    ready?: string
    inProgress: string
    inReview?: string
    done: string
    cancelled?: string
    suspended?: string
  }
  // The names the board gives its `cancelled` and `suspended` options, learned from its loads.
  optionNames?: { cancelled?: string; suspended?: string }
  title?: string
  isDetected?: true
}
export type KanbanBackendInfo = KanbanGithub
/** A GitHub project the zero-config search found for the repo. */
export type KanbanChoice = {
  id: string
  number: number
  title: string
  owner: string
}
/**
 * What is missing before the board can use GitHub: the gh CLI, a signed-in gh,
 * a github.com origin, a board for the repo, or a board config that reads.
 */
export type KanbanSetupStep = 'gh' | 'auth' | 'remote' | 'board' | 'config'
export type KanbanSetup = { step: KanbanSetupStep; reason: string }
export type KanbanBoard = {
  backend: KanbanBackendInfo | null
  /** The signed-in GitHub login, as the last load gave it. */
  viewer?: string
  people?: KanbanPeople
  cards: KanbanCard[]
  fetchedAt: number
  isLoading: boolean
  error?: string
  /** Set while the board cannot reach GitHub for want of setup; the pane offers to have Claude do it. */
  setup?: KanbanSetup
  /** The boards to pick from, while the person has to choose one. */
  pick?: KanbanChoice[]
}
export type KanbanSyncPhase = 'pending' | 'ok' | 'failed'
export type KanbanSync = {
  cardId: string
  from: KanbanColumn
  to: KanbanColumn
  queued?: KanbanColumn
  after?: string | null
  queuedAfter?: string | null
  phase: KanbanSyncPhase
  attempts: number
  error?: string
  settledAt?: number
  onConfirm?: 'work' | 'resume' | 'answer'
  announce?: boolean
}
export type KanbanPrompt = 'work' | 'resume' | 'answer'
export type KanbanView =
  | { mode: 'board' }
  | { mode: 'detail'; cardId: string; tab: 'card' | 'diff' }
  | { mode: 'settings' }
export type KanbanUi = {
  view: KanbanView
  offsets: Record<KanbanColumn, number>
  /** The group drawn open; 'none' when both are folded. */
  openGroup: KanbanGroup | 'none'
  draft: string
  /** The filter query applied to the board ('' for none); kept for the session only. */
  filter: string
  /** Whether the filter's text field is shown. */
  isFilterOpen: boolean
  /** The group a header press chose while filtering; dropped when the filter changes. */
  filterGroup?: KanbanGroup | 'none'
  /** Whose cards show; the person's own when the pane opens. */
  who: KanbanWho
}
/** One of the mod's `/config` rows as `$.config.list()` returns it. */
export type KanbanSettingRow = {
  /** What `$.config.set` takes: `<plugin>.<field>`. */
  key: string
  /** The row's label, which ends in ` (default: X)`. */
  label: string
  kind: 'boolean' | 'choice'
  value: boolean | string
  options?: string[]
  /** Whether a trusted source owns the value, so a change is refused. */
  isLocked: boolean
}
export type KanbanSettings = {
  isLoaded: boolean
  rows: KanbanSettingRow[]
  /** Why a change was refused, by row key; dropped when a change goes through. */
  denied: Record<string, string>
  /** Why the rows could not be read. */
  error?: string
  /** The name being typed in the Your name field; absent while it is not open. */
  nameDraft?: string
  /** Why the name could not be saved. */
  nameError?: string
}
export type KanbanQuickAdd = {
  isOpen: boolean
  hasDetails: boolean
  title: string
  spec: string
}
export type KanbanSection = {
  kind: 'handoff' | 'feedback' | 'question' | 'answer' | 'check'
  date: string
  text: string
  fields?: { did: string; check: string; changed: string; need: string }
  byOther?: string
}
export type KanbanDetail = {
  cardId: string
  isLoading: boolean
  body: string
  sections: KanbanSection[]
  diffState: 'none' | 'loading' | 'ready' | 'absent' | 'error'
  diff?: string
  diffOmitted?: number
  diffError?: string
  error?: string
}
export type KanbanCheckOutcome =
  'running' | 'passed' | 'failed' | 'timeout' | 'error'
export type KanbanCheckRun = {
  cardId: string
  command: string
  outcome: KanbanCheckOutcome
  startedAt: number
  durationMs: number
  exitCode: number
  output: string
  omitted: number
  isCut: boolean
  record: 'none' | 'saving' | 'saved' | 'failed'
  error: string
}
/** One Claude -> Human -> Claude round on a card: time and tokens spent, and who worked in it. */
export type KanbanRound = {
  startedAt: number
  ms: number
  input: number
  output: number
  cacheRead: number
  agents: string[]
  isOpen: boolean
}
/** What Claude has done on one card: its rounds, and the tool it is on now. */
export type KanbanCardActivity = {
  cardId: string
  rounds: KanbanRound[]
  lastAt: number
  lastAgent: string
  tool: string
  target: string
  toolId: string
  isToolRunning: boolean
}
export type KanbanActivity = {
  cards: Record<string, KanbanCardActivity>
  /** The card the running main turn belongs to ('' for none) and where its time is counted from. */
  live: { cardId: string; since: number; isRunning: boolean }
  /** Each subagent seen, by its id: its name and the card it inherited. */
  agents: Record<string, { name: string; cardId: string }>
}
/** What the turn-end check keeps: the running main turn, and what it has already said this session. */
export type KanbanReconcile = {
  /** The turn's cards, each true once it got a handoff, a question or a move out of Claude; and whether it changed files. */
  turn: {
    isReconcile: boolean
    hasEdits: boolean
    cards: Record<string, boolean>
  }
  /** Per card, how many rounds it had when its reconcile prompt was sent. */
  sent: Record<string, number>
  /** Reconcile prompts submitted whose turn has not begun. */
  waiting: string[]
  /** Whether the once-a-session toast for work with no card has been shown. */
  isNudged: boolean
}

declare module 'claude-code' {
  interface PluginState {
    kanban: {
      board: Shaped<KanbanBoard>
      ui: Shaped<KanbanUi>
      sync: Shaped<Record<string, KanbanSync>>
      detail: Shaped<KanbanDetail | null>
      check: Shaped<Record<string, KanbanCheckRun>>
      tick: number
      pausedUntil: number
      viewer: string
      activity: Shaped<KanbanActivity>
      quickAdd: Shaped<KanbanQuickAdd>
      settings: Shaped<KanbanSettings>
      reconcile: Shaped<KanbanReconcile>
    }
  }
}

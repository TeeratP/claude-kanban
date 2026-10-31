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
}
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
// `isConfigUnclear`: under `auto`, a CLAUDE.md or AGENTS.md mentions a board that could not be read.
// `noBoardFor`: under `auto`, no GitHub board was found for this repo (`owner/name`).
export type KanbanBackendInfo =
  | { kind: 'local'; isConfigUnclear?: true; noBoardFor?: string }
  | KanbanGithub
/** A GitHub project the zero-config search found for the repo. */
export type KanbanChoice = {
  id: string
  number: number
  title: string
  owner: string
}
export type KanbanBackendMode = 'auto' | 'github' | 'local'
/** What the /config checks last learned of `gh`: installed, missing, or not known yet. */
export type KanbanGhState = 'unknown' | 'found' | 'missing'
export type KanbanBoard = {
  mode: KanbanBackendMode
  backend: KanbanBackendInfo | null
  cards: KanbanCard[]
  fetchedAt: number
  isLoading: boolean
  error?: string
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
      ghInstalled: KanbanGhState
      activity: Shaped<KanbanActivity>
      quickAdd: Shaped<KanbanQuickAdd>
      settings: Shaped<KanbanSettings>
      reconcile: Shaped<KanbanReconcile>
    }
  }
}

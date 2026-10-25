export type KanbanColumn = 'human' | 'claude' | 'backlog' | 'done'
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
}
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
    inReview: string
    done: string
  }
}
export type KanbanBackendInfo = { kind: 'local' } | KanbanGithub
export type KanbanBackendMode = 'auto' | 'github' | 'local'
export type KanbanBoard = {
  mode: KanbanBackendMode
  backend: KanbanBackendInfo | null
  cards: KanbanCard[]
  fetchedAt: number
  isLoading: boolean
  error?: string
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
export type KanbanQueue = {
  limit: number
  held: Record<string, KanbanPrompt>
}
export type KanbanView =
  { mode: 'board' } | { mode: 'detail'; cardId: string; tab: 'card' | 'diff' }
export type KanbanUi = {
  view: KanbanView
  offsets: Record<KanbanColumn, number>
  collapsed: Record<KanbanColumn, boolean>
  draft: string
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

declare module 'claude-code' {
  interface PluginState {
    kanban: {
      board: Shaped<KanbanBoard>
      ui: Shaped<KanbanUi>
      sync: Shaped<Record<string, KanbanSync>>
      detail: Shaped<KanbanDetail | null>
      check: Shaped<Record<string, KanbanCheckRun>>
      tick: number
      queue: Shaped<KanbanQueue>
      pausedUntil: number
      viewer: string
      activity: Shaped<KanbanActivity>
      quickAdd: Shaped<KanbanQuickAdd>
    }
  }
}

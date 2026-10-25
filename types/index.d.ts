export type KanbanColumn = 'human' | 'claude' | 'backlog' | 'done'
export type KanbanTag = 'review' | 'human'
export type KanbanCard = {
  id: string
  number: number
  title: string
  column: KanbanColumn
  order: number
  createdAt: string
  updatedAt: string
  tag?: KanbanTag
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
  phase: KanbanSyncPhase
  attempts: number
  error?: string
  settledAt?: number
  onConfirm?: 'work' | 'resume'
  announce?: boolean
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
  kind: 'handoff' | 'feedback'
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

declare module 'claude-code' {
  interface PluginState {
    kanban: {
      board: Shaped<KanbanBoard>
      ui: Shaped<KanbanUi>
      sync: Shaped<Record<string, KanbanSync>>
      detail: Shaped<KanbanDetail | null>
      tick: number
      pausedUntil: number
      viewer: string
      quickAdd: Shaped<KanbanQuickAdd>
    }
  }
}

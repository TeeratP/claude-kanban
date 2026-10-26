import type {
  EngineInterface,
  PromptComposeSection,
  PromptComposeTrait,
} from 'claude-code'

import type { KanbanBackendInfo, KanbanBackendMode } from '../types'
import { readBoard } from './atoms'
import { rememberedBackend } from './board'
import { S } from './strings'

const SECTION_ID = 'kanban:backlog'

// What the backlog is, by the backend known so far. A `backend` setting of local
// or github says that much before any board is found; with neither, a board.
const backlogOf = (
  info: KanbanBackendInfo | undefined,
  mode: KanbanBackendMode,
): string => {
  if (mode === 'local') return S.backlogIs.local
  if (info?.kind === 'github')
    return S.backlogIs.github(info.owner, info.projectNumber)
  if (mode === 'github') return S.backlogIs.githubAny
  if (info?.kind === 'local') return S.backlogIs.local

  return S.backlogIs.unknown
}

/**
 * The system prompt's sections with the one that names the board as this
 * project's backlog and says how to keep it current, added once at the end; the
 * one-line `--bare` prompt gets none.
 */
export function withBacklogSection(
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
  info: KanbanBackendInfo | undefined,
  mode: KanbanBackendMode,
): readonly PromptComposeSection[] {
  if (traits.includes('bare')) return sections
  if (sections.some(section => section.id === SECTION_ID)) return sections

  return [
    ...sections,
    {
      id: SECTION_ID,
      text: `${backlogOf(info, mode)} ${S.backlogRules}`,
      scope: 'session',
    },
  ]
}

/**
 * The sections with the backlog one added, worded for the backend known at this
 * render: the board's, else the one saved from an earlier session (no call to gh).
 */
export async function backlogSection(
  $: EngineInterface,
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
): Promise<readonly PromptComposeSection[]> {
  const { backend, mode } = await readBoard($)
  const info =
    backend ?? (mode === 'local' ? undefined : await rememberedBackend($, mode))

  return withBacklogSection(sections, traits, info, mode)
}

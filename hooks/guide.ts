import type {
  EngineInterface,
  PromptComposeSection,
  PromptComposeTrait,
} from 'claude-code'

import type { KanbanBackendInfo } from '../types'
import { readBoard } from './atoms'
import { S } from './strings'

const SECTION_ID = 'kanban:backlog'

// What the backlog is: the backend the board resolved, or just a board while it is still being found.
const backlogOf = (info: KanbanBackendInfo | null): string => {
  if (info === null) return S.backlogIs.unknown

  return info.kind === 'github'
    ? S.backlogIs.github(info.owner, info.projectNumber)
    : S.backlogIs.local
}

/**
 * The system prompt's sections with the one that names the board as this
 * project's backlog and says how to keep it current, added once at the end; the
 * one-line `--bare` prompt gets none.
 */
export function withBacklogSection(
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
  info: KanbanBackendInfo | null,
): readonly PromptComposeSection[] {
  if (traits.includes('bare')) return sections
  if (sections.some(section => section.id === SECTION_ID)) return sections

  return [
    ...sections,
    {
      id: SECTION_ID,
      text: `${backlogOf(info)} ${S.backlogRules}`,
      scope: 'session',
    },
  ]
}

/** The sections with the backlog one added, worded for the backend known at this render. */
export async function backlogSection(
  $: EngineInterface,
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
): Promise<readonly PromptComposeSection[]> {
  const { backend } = await readBoard($)

  return withBacklogSection(sections, traits, backend)
}

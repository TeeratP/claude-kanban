import type {
  EngineInterface,
  PromptComposeSection,
  PromptComposeTrait,
} from 'claude-code'

import type { KanbanBackendInfo } from '../types'
import { readBoard } from './atoms'
import { rememberedBackend } from './board'
import { S } from './strings'

const SECTION_ID = 'kanban:backlog'

// What the backlog is: the board known so far, else GitHub Issues.
const backlogOf = (info: KanbanBackendInfo | undefined): string =>
  info === undefined
    ? S.backlogIs.githubAny
    : S.backlogIs.github(info.owner, info.projectNumber)

/**
 * The system prompt's sections with the one that names the board as this
 * project's backlog and says how to keep it current, added once at the end; the
 * one-line `--bare` prompt gets none.
 */
export function withBacklogSection(
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
  info: KanbanBackendInfo | undefined,
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

/**
 * The sections with the backlog one added, worded for the backend known at this
 * render: the board's, else the one saved from an earlier session (no call to gh).
 */
export async function backlogSection(
  $: EngineInterface,
  sections: readonly PromptComposeSection[],
  traits: readonly PromptComposeTrait[],
): Promise<readonly PromptComposeSection[]> {
  const { backend } = await readBoard($)
  const info = backend ?? (await rememberedBackend($))

  return withBacklogSection(sections, traits, info)
}

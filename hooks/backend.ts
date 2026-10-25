import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
} from '../types'
import { appendLocal, detailLocal, loadLocal, moveLocal } from './local'
import { S } from './strings'

// A backend is a set of plain functions per kind: `$` may only be handed to
// named top-level functions, so these dispatch on `info.kind` instead of
// calling methods on an object.

export async function loadCards(
  $: EngineInterface,
  info: KanbanBackendInfo,
): Promise<KanbanCard[]> {
  if (info.kind === 'local') return loadLocal($)

  throw new Error(S.githubUnavailable)
}

/** Moves the card; resolves the fields that changed, throws on failure. */
export async function moveRemote(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  to: KanbanColumn,
): Promise<Partial<KanbanCard>> {
  if (info.kind === 'local') return moveLocal($, card, to)

  throw new Error(S.githubUnavailable)
}

export async function appendSection(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  if (info.kind === 'local') return appendLocal($, card, markdown)

  throw new Error(S.githubUnavailable)
}

export async function readDetail(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  if (info.kind === 'local') return detailLocal($, card)

  throw new Error(S.githubUnavailable)
}

/** Picks the backend for this directory; local until the GitHub backend lands. */
export async function detectBackend(
  _$: EngineInterface,
): Promise<KanbanBackendInfo> {
  return { kind: 'local' }
}

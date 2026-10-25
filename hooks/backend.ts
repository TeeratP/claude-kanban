import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
} from '../types'
import {
  appendGithub,
  detailGithub,
  diffGithub,
  loadGithub,
  moveGithub,
  parseClaudeMd,
  resolveGithub,
  runCommand,
} from './github'
import type { ParsedClaudeMd } from './github'
import {
  appendLocal,
  createLocal,
  detailLocal,
  loadLocal,
  moveLocal,
} from './local'
import { errorMessage } from './model'
import { S } from './strings'

// A backend is a set of plain functions per kind: `$` may only be handed to
// named top-level functions, so these dispatch on `info.kind` instead of
// calling methods on an object.

export async function loadCards(
  $: EngineInterface,
  info: KanbanBackendInfo,
): Promise<KanbanCard[]> {
  if (info.kind === 'local') return loadLocal($)

  return loadGithub($, info)
}

/** Moves the card; resolves the fields that changed, throws on failure. */
export async function moveRemote(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  to: KanbanColumn,
): Promise<Partial<KanbanCard>> {
  if (info.kind === 'local') return moveLocal($, card, to)

  return moveGithub($, info, card, to)
}

export async function appendSection(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  if (info.kind === 'local') return appendLocal($, card, markdown)

  return appendGithub($, info, card, markdown)
}

export async function readDetail(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  if (info.kind === 'local') return detailLocal($, card)

  return detailGithub($, info, card)
}

/** Creates a card and returns it; only the local backend does, GitHub cards come from issues. */
export async function createCard(
  $: EngineInterface,
  info: KanbanBackendInfo,
  title: string,
  spec: string,
  column: KanbanColumn,
): Promise<KanbanCard> {
  if (info.kind === 'local') return createLocal($, title, spec, column)

  throw new Error(S.createViaIssueSkill)
}

/** The card's pull request diff; undefined when the backend has none. */
export async function readDiff(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
): Promise<string | undefined> {
  if (info.kind === 'local') return undefined

  return diffGithub($, info, card)
}

export type BackendMode = 'auto' | 'github' | 'local'

const CLAUDE_MD = ['CLAUDE.md', '.claude/CLAUDE.md']

async function readProjectConfig(
  $: EngineInterface,
): Promise<ParsedClaudeMd | null> {
  for (const file of CLAUDE_MD) {
    if (!(await $.fs.exists(file))) continue

    const found = parseClaudeMd(await $.fs.read(file))
    if (found !== null) return found
  }

  return null
}

/**
 * Picks the backend for this directory: GitHub when a CLAUDE.md names a repo
 * and project and `gh` and `git` are usable there, local files otherwise.
 * Only `auto` is implemented; the other modes behave as `auto` until #10.
 */
export async function detectBackend(
  $: EngineInterface,
  _mode: BackendMode = 'auto',
): Promise<KanbanBackendInfo> {
  try {
    const found = await readProjectConfig($)
    if (found === null) return { kind: 'local' }

    await runCommand($, ['gh', 'auth', 'status'], { timeoutMs: 10000 })
    await runCommand($, ['git', 'remote', 'get-url', 'origin'], {
      timeoutMs: 10000,
    })

    return await resolveGithub($, found)
  } catch (error) {
    $.ui.log(S.githubDetectFailed(errorMessage(error)), { to: 'debug' })

    return { kind: 'local' }
  }
}

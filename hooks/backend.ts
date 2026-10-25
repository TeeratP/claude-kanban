import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanBackendMode,
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
} from '../types'
import {
  appendGithub,
  createGithub,
  detailGithub,
  diffGithub,
  moveGithub,
  parseClaudeMd,
  resolveGithub,
  runCommand,
  viewerLogin,
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
import { loadGithubPaced } from './rate-limit'
import { S } from './strings'

// A backend is a set of plain functions per kind: `$` may only be handed to
// named top-level functions, so these dispatch on `info.kind` instead of
// calling methods on an object.

export async function loadCards(
  $: EngineInterface,
  info: KanbanBackendInfo,
): Promise<KanbanCard[]> {
  if (info.kind === 'local') return loadLocal($)

  return loadGithubPaced($, info)
}

/**
 * Moves the card, after the card `after` in its section (first when null, last
 * when undefined); resolves the fields that changed, throws on failure.
 */
export async function moveRemote(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  to: KanbanColumn,
  after?: KanbanCard | null,
): Promise<Partial<KanbanCard>> {
  if (info.kind === 'local') return moveLocal($, card, to, after)

  return moveGithub($, info, card, to, after)
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

  return detailGithub($, info, card, await viewerLogin($))
}

/** Creates a card and returns it: a card file, or on GitHub an issue labeled `triage` on the board. */
export async function createCard(
  $: EngineInterface,
  info: KanbanBackendInfo,
  title: string,
  spec: string,
  column: KanbanColumn,
): Promise<KanbanCard> {
  if (info.kind === 'local') return createLocal($, title, spec, column)

  return createGithub($, info, title, spec, column)
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

export type BackendMode = KanbanBackendMode

/** The `backend` setting as a mode; anything but a listed value counts as `auto`. */
export function backendMode(value: unknown): BackendMode {
  return value === 'github' || value === 'local' ? value : 'auto'
}

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

// What a failed check says: `auto` logs the reason as it is, `github` adds
// the check that failed and how to fix it.
type Explain = {
  auth: (reason: string) => string
  remote: (reason: string) => string
  project: (reason: string) => string
}

const AS_IS = (reason: string) => reason
const AUTO: Explain = { auth: AS_IS, remote: AS_IS, project: AS_IS }
const GITHUB: Explain = {
  auth: S.githubSignedOut,
  remote: S.githubNoRemote,
  project: S.githubProjectFailed,
}

async function check<T>(
  work: () => Promise<T>,
  explain: (reason: string) => string,
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new Error(explain(errorMessage(error)))
  }
}

async function checkGithub(
  $: EngineInterface,
  found: ParsedClaudeMd,
  explain: Explain,
): Promise<KanbanGithub> {
  await check(
    () => runCommand($, ['gh', 'auth', 'status'], { timeoutMs: 10000 }),
    explain.auth,
  )
  await check(
    () =>
      runCommand($, ['git', 'remote', 'get-url', 'origin'], {
        timeoutMs: 10000,
      }),
    explain.remote,
  )

  return check(() => resolveGithub($, found), explain.project)
}

/**
 * Picks the backend for this directory. `local` is always local files. `auto`
 * is GitHub when a CLAUDE.md names a repo and project and `gh` and `git` are
 * usable there, local files otherwise. `github` is GitHub or an error that
 * names the check that failed and how to fix it; it never falls back.
 */
export async function detectBackend(
  $: EngineInterface,
  mode: BackendMode = 'auto',
): Promise<KanbanBackendInfo> {
  if (mode === 'local') return { kind: 'local' }

  if (mode === 'github') {
    const found = await readProjectConfig($)
    if (found === null) throw new Error(S.githubNoProject)

    return checkGithub($, found, GITHUB)
  }

  try {
    const found = await readProjectConfig($)
    if (found === null) return { kind: 'local' }

    return await checkGithub($, found, AUTO)
  } catch (error) {
    $.ui.log(S.githubDetectFailed(errorMessage(error)), { to: 'debug' })

    return { kind: 'local' }
  }
}

import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanBackendMode,
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
  KanbanGithub,
} from '../types'
import { readConfigText } from './config'
import { NAMED, PLAIN, check, choicesOf, detectZero } from './detect'
import type { Explain } from './detect'
import {
  appendGithub,
  createGithub,
  detailGithub,
  diffGithub,
  isRateLimited,
  mentionsBoard,
  moveGithub,
  parseClaudeMd,
  resolveGithub,
  runCommand,
  viewerLogin,
} from './github'
import type { ParsedClaudeMd, StatusOption } from './github'
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

/** What a load brings: the cards, and the Status options a GitHub board reported (none for local). */
export type Loaded = { cards: KanbanCard[]; statusOptions: StatusOption[] }

export async function loadCards(
  $: EngineInterface,
  info: KanbanBackendInfo,
): Promise<Loaded> {
  if (info.kind === 'local') {
    return { cards: await loadLocal($), statusOptions: [] }
  }

  return loadGithubPaced($, info)
}

/**
 * Moves the card, after the card `after` in its section (first when null, last
 * when undefined); resolves the fields that changed, throws on failure. With
 * `placeAsked` false, `after` is only the default place, and GitHub keeps a
 * move whose position could not be set.
 */
export async function moveRemote(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  to: KanbanColumn,
  after?: KanbanCard | null,
  placeAsked = true,
): Promise<Partial<KanbanCard>> {
  if (info.kind === 'local') return moveLocal($, card, to, after)

  return moveGithub($, info, card, to, after, placeAsked)
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

// What the config files say: the board they name, if the text can be read,
// and whether they mention one even if it cannot.
type Config = { found: ParsedClaudeMd | null; mentionsBoard: boolean }

async function readProjectConfig($: EngineInterface): Promise<Config> {
  const text = await readConfigText($)

  return { found: parseClaudeMd(text), mentionsBoard: mentionsBoard(text) }
}

// What a failed check says: `auto` logs the reason as it is, `github` adds
// the check that failed and how to fix it.
type Explainer = Explain & { project: (reason: string) => string }

const AS_IS = (reason: string) => reason
const AUTO: Explainer = { ...PLAIN, project: AS_IS }
const GITHUB: Explainer = { ...NAMED, project: S.githubProjectFailed }

async function checkGithub(
  $: EngineInterface,
  found: ParsedClaudeMd,
  explain: Explainer,
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
 * is GitHub when CLAUDE.md, AGENTS.md or a file they import names a repo and
 * project, or else when git and gh find a board for the origin's repo (see
 * `detectZero`), and `gh` and `git` are usable there; local files otherwise
 * (marked when a board is mentioned that could not be read, or none was found
 * for the repo). `github` is GitHub or an error that names the check that
 * failed and how to fix it; it never falls back. Both ask the person to pick
 * when boards tie (`choicesOf`), and `auto` does not settle for local on a
 * rate limit.
 */
export async function detectBackend(
  $: EngineInterface,
  mode: BackendMode = 'auto',
): Promise<KanbanBackendInfo> {
  if (mode === 'local') return { kind: 'local' }

  if (mode === 'github') {
    const { found } = await readProjectConfig($)
    if (found !== null) return checkGithub($, found, GITHUB)

    const detected = await detectZero($, GITHUB)
    if (detected.kind === 'local') {
      throw new Error(S.githubNoBoard(detected.noBoardFor))
    }

    return detected
  }

  let config: Config | undefined
  try {
    config = await readProjectConfig($)
    if (config.found !== null) return await checkGithub($, config.found, AUTO)

    const detected = await detectZero($, AUTO)
    if (detected.kind === 'github' || !config.mentionsBoard) return detected

    $.ui.log(S.githubDetectFailed(S.githubConfigUnclear), { to: 'debug' })

    return { kind: 'local', isConfigUnclear: true }
  } catch (error) {
    if (choicesOf(error) !== undefined || isRateLimited(error)) throw error

    $.ui.log(S.githubDetectFailed(errorMessage(error)), { to: 'debug' })

    return config?.found === null && config.mentionsBoard
      ? { kind: 'local', isConfigUnclear: true }
      : { kind: 'local' }
  }
}

import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanColumn,
  KanbanDetail,
} from '../types'
import { readConfigText } from './config'
import { NAMED, SetupNeeded, check, checkGh, detectZero } from './detect'
import {
  appendGithub,
  createGithub,
  detailGithub,
  diffGithub,
  mentionsBoard,
  moveGithub,
  parseClaudeMd,
  resolveGithub,
  runCommand,
  viewerLogin,
} from './github'
import type { ParsedClaudeMd, StatusOption } from './github'
import { loadGithubPaced } from './rate-limit'
import { S } from './strings'

// The board is GitHub Issues on a Projects board. These are plain functions:
// `$` may only be handed to named top-level functions, not to methods.

/** What a load brings: the cards, and the Status options the board reported. */
export type Loaded = { cards: KanbanCard[]; statusOptions: StatusOption[] }

export async function loadCards(
  $: EngineInterface,
  info: KanbanBackendInfo,
): Promise<Loaded> {
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
  return moveGithub($, info, card, to, after, placeAsked)
}

export async function appendSection(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
  markdown: string,
): Promise<void> {
  return appendGithub($, info, card, markdown)
}

export async function readDetail(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
): Promise<Pick<KanbanDetail, 'body' | 'sections'>> {
  return detailGithub($, info, card, await viewerLogin($))
}

/**
 * Creates a card and returns it: an issue labeled `triage` on the board. A
 * card made outside Backlog goes after the card `after` in its section (first
 * when null).
 */
export async function createCard(
  $: EngineInterface,
  info: KanbanBackendInfo,
  title: string,
  spec: string,
  column: KanbanColumn,
  after?: KanbanCard | null,
): Promise<KanbanCard> {
  return createGithub($, info, title, spec, column, after)
}

/** The card's pull request diff; undefined when it has none. */
export async function readDiff(
  $: EngineInterface,
  info: KanbanBackendInfo,
  card: KanbanCard,
): Promise<string | undefined> {
  return diffGithub($, info, card)
}

// What the config files say: the board they name, if the text can be read,
// and whether they mention one even if it cannot.
type Config = { found: ParsedClaudeMd | null; mentionsBoard: boolean }

async function readProjectConfig($: EngineInterface): Promise<Config> {
  const text = await readConfigText($)

  return { found: parseClaudeMd(text), mentionsBoard: mentionsBoard(text) }
}

async function checkGithub(
  $: EngineInterface,
  found: ParsedClaudeMd,
): Promise<KanbanBackendInfo> {
  await checkGh($, NAMED)
  await check(
    () => runCommand($, ['gh', 'auth', 'status'], { timeoutMs: 10000 }),
    NAMED.auth,
  )
  await check(
    () =>
      runCommand($, ['git', 'remote', 'get-url', 'origin'], {
        timeoutMs: 10000,
      }),
    NAMED.remote,
  )

  return check(() => resolveGithub($, found), S.githubProjectFailed)
}

/**
 * Finds the GitHub board for this directory: the one CLAUDE.md, AGENTS.md or a
 * file they import names (repo and project), else the one git and gh find for
 * the origin's repo (see `detectZero`). It never falls back: a failure names
 * the check that failed and how to fix it, and one that setup would fix (gh
 * missing or signed out, no github.com origin, no board, a board mention that
 * cannot be read) is a `SetupNeeded`. Boards that tie ask the person to pick
 * (`choicesOf`).
 */
export async function detectBackend(
  $: EngineInterface,
): Promise<KanbanBackendInfo> {
  const { found, mentionsBoard: isMentioned } = await readProjectConfig($)
  if (found !== null) return checkGithub($, found)

  try {
    return await detectZero($, NAMED)
  } catch (error) {
    // No board found, and the config mentions one it does not name clearly:
    // the config is what to fix.
    const isNoBoard = error instanceof SetupNeeded && error.step === 'board'
    if (isNoBoard && isMentioned) {
      throw new SetupNeeded('config', S.githubConfigUnclear)
    }

    throw error
  }
}

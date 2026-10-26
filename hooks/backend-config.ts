import type { Args, EngineInterface, Frozen, Next } from 'claude-code'

import type { KanbanGhState } from '../types'
import { readGhInstalled, updateGhInstalled } from './atoms'
import { PLAIN, checkGh, checkSignedIn } from './detect'
import { errorMessage } from './model'
import { ownField } from './settings'
import { S } from './strings'

// The /config menu waits on these checks, so they get a short timeout; a check
// that does not answer in time is unknown, and an unknown neither denies nor notes.
const MENU_CHECK_MS = 2000

// `$.process.run` rejects, rather than exits, when the command is still running at its timeout.
const STILL_RUNNING = /still running/i

const isTimeout = (error: unknown) => STILL_RUNNING.test(errorMessage(error))

async function askGh($: EngineInterface): Promise<KanbanGhState> {
  try {
    await checkGh($, PLAIN, MENU_CHECK_MS)

    return 'found'
  } catch (error) {
    return isTimeout(error) ? 'unknown' : 'missing'
  }
}

// What the last answered check found, asked again when it is not known. A
// missing `gh` is asked again for `isRecheck`: installing it between two picks must work.
async function ghState(
  $: EngineInterface,
  isRecheck: boolean,
): Promise<KanbanGhState> {
  const known = await readGhInstalled($)
  if (known === 'found' || (known === 'missing' && !isRecheck)) return known

  const asked = await askGh($)
  if (asked !== 'unknown') await updateGhInstalled($, () => asked)

  return asked
}

/** Why GitHub cannot be chosen now; undefined when it can, or when a check timed out. */
export async function githubDenial(
  $: EngineInterface,
): Promise<string | undefined> {
  const gh = await ghState($, true)
  if (gh === 'missing') return S.githubNeedsGh
  if (gh === 'unknown') return undefined

  try {
    await checkSignedIn($, PLAIN, MENU_CHECK_MS)
  } catch (error) {
    return isTimeout(error) ? undefined : S.githubNeedsSignIn
  }

  return undefined
}

/** Refuses choosing the GitHub backend while `gh` is not installed or not signed in; other rows pass. */
export async function guardBackend(
  $: EngineInterface,
  e: Frozen<Args<'config.set'>>,
  next: Next<'config.set'>,
) {
  if (ownField(e.key) !== 'backend' || e.value !== 'github') return next(e)

  const deny = await githubDenial($)

  return deny === undefined ? next(e) : { deny }
}

/** Adds a note to the backend row when `gh` is not installed; other rows pass. */
export async function describeBackend(
  $: EngineInterface,
  e: Frozen<Args<'config.describe'>>,
  next: Next<'config.describe'>,
) {
  const described = await next(e)
  if (ownField(e.key) !== 'backend') return described
  if ((await ghState($, false)) !== 'missing') return described

  return {
    ...described,
    description: [described.description, S.githubUnavailable]
      .filter(Boolean)
      .join(' '),
  }
}

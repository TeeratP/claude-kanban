import type { EngineInterface } from 'claude-code'

import type { KanbanGithub } from '../types'
import { readPausedUntil, updatePausedUntil } from './atoms'
import { isRateLimited, loadGithub } from './github'
import type { GithubLoad, RateLimitedError } from './github'
import { errorMessage } from './model'
import { S } from './strings'

// Below this many points left, polling waits for the budget to reset so other
// `gh` calls on the same token keep working.
const LOW_REMAINING = 100
// When GitHub does not say when its limit lifts (a secondary limit does not).
const FALLBACK_PAUSE_MS = 5 * 60_000
const MINUTE_MS = 60_000

/** A wait in whole minutes, at least one. */
export function minutesLeft(ms: number): number {
  return Math.max(1, Math.ceil(ms / MINUTE_MS))
}

/** Milliseconds polling still has to wait for the rate limit; 0 when it need not. */
export async function pauseLeft($: EngineInterface): Promise<number> {
  const until = await readPausedUntil($)

  return Math.max(0, until - (await $.clock.now()))
}

const pauseUntil = (now: number, resetAt: number | undefined) =>
  resetAt !== undefined && resetAt > now ? resetAt : now + FALLBACK_PAUSE_MS

/**
 * Loads the GitHub board and keeps polling from spending what the budget lacks:
 * a low budget, or a rate-limit error, pauses polling until the budget resets.
 * A load made while paused (the person's refresh) still runs, with a warning.
 */
export async function loadGithubPaced(
  $: EngineInterface,
  info: KanbanGithub,
): Promise<Omit<GithubLoad, 'rateLimit'>> {
  const left = await pauseLeft($)
  if (left > 0) $.ui.toast(S.refreshWhilePaused(minutesLeft(left)))

  try {
    const { rateLimit, ...loaded } = await loadGithub($, info)
    const now = await $.clock.now()
    const until =
      rateLimit !== undefined && rateLimit.remaining <= LOW_REMAINING
        ? pauseUntil(now, rateLimit.resetAt)
        : 0
    await updatePausedUntil($, () => until)

    return loaded
  } catch (error) {
    if (!isRateLimited(error)) throw error

    throw await limitHit($, error)
  }
}

/** Pauses polling until the rate limit lifts; resolves the error to show for it. */
export async function limitHit(
  $: EngineInterface,
  error: RateLimitedError,
): Promise<Error> {
  const now = await $.clock.now()
  const until = pauseUntil(now, error.resetAt)
  await updatePausedUntil($, () => until)
  $.ui.log(S.refreshFailed(errorMessage(error)), { to: 'debug' })

  return new Error(S.rateLimitHit(minutesLeft(until - now)))
}

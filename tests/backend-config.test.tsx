import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { S } from '../hooks/strings'

// What `gh --version` and `gh auth status` do: exit with a code, or (as the
// engine does for a command that cannot start, or is still running at its
// timeout) be rejected.
type Step = { exitCode: number; stderr?: string } | { deny: string }
type Gh = { version: Step; auth: Step }

const OK: Step = { exitCode: 0 }
const NOT_STARTED: Step = {
  deny: 'kanban: $.process.run(gh) failed to start: ENOENT: no such file or directory',
}
const TIMED_OUT: Step = {
  deny: 'kanban: $.process.run(gh) aborted: still running after 2000ms',
}
const SIGNED_OUT: Step = {
  exitCode: 1,
  stderr: 'You are not logged into any GitHub hosts.',
}

const SIGNED_IN: Gh = { version: OK, auth: OK }

/** Answers the `gh` commands from `gh`, and records each one. */
function fakeGh(on: On, gh: Gh) {
  const ran: string[] = []
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    ran.push(line)
    const step =
      line === 'gh --version'
        ? gh.version
        : line === 'gh auth status'
          ? gh.auth
          : undefined
    if (step === undefined) throw new Error(`fake gh: no route for ${line}`)
    if ('deny' in step) return { deny: step.deny }

    return {
      value: {
        exitCode: step.exitCode,
        stdout: '',
        stderr: step.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  return { gh, ran }
}

/** What the engine writes once no hook refused. */
function fakeWriter(on: On) {
  const written: unknown[] = []
  on('config.set', (_, e) => {
    written.push(e.value)

    return { value: e.value }
  })

  return written
}

const BACKEND_NOTE = 'Where cards live.'

function fakeRow(on: On) {
  on('config.describe', (_, e) => ({
    label: e.label,
    description: e.description,
    isHidden: e.isHidden,
  }))
}

const choose = ($: Engine, value: string) =>
  $.config.set({
    key: 'kanban.backend',
    value,
    previous: 'auto',
    provider: { plugin: 'kanban', tier: 'user' },
    origin: { kind: 'composer' },
  })

const describe = ($: Engine) =>
  $.config.describe({
    key: 'kanban.backend',
    label: 'Card backend',
    description: BACKEND_NOTE,
    isHidden: false,
    provider: { plugin: 'kanban', tier: 'user' },
  })

test('github with gh missing is denied with the install message', async ($, on) => {
  const { ran } = fakeGh(on, { ...SIGNED_IN, version: NOT_STARTED })
  const written = fakeWriter(on)

  expect(await choose($, 'github')).toEqual({ deny: S.githubNeedsGh })
  expect(S.githubNeedsGh).toContain('https://cli.github.com')
  expect(S.githubNeedsGh).toContain('brew install gh')
  expect(written).toEqual([])
  expect(ran).toEqual(['gh --version'])
})

test('a gh that exits non-zero for --version counts as missing', async ($, on) => {
  fakeGh(on, { ...SIGNED_IN, version: { exitCode: 127, stderr: 'not found' } })
  fakeWriter(on)

  expect(await choose($, 'github')).toEqual({ deny: S.githubNeedsGh })
})

test('github with gh present but signed out is denied with the sign-in message', async ($, on) => {
  const { ran } = fakeGh(on, { version: OK, auth: SIGNED_OUT })
  const written = fakeWriter(on)

  expect(await choose($, 'github')).toEqual({ deny: S.githubNeedsSignIn })
  expect(S.githubNeedsSignIn).toContain('gh auth login')
  expect(written).toEqual([])
  expect(ran).toEqual(['gh --version', 'gh auth status'])
})

test('github with gh present and signed in is allowed', async ($, on) => {
  fakeGh(on, SIGNED_IN)
  const written = fakeWriter(on)

  expect(await choose($, 'github')).toEqual({ value: 'github' })
  expect(written).toEqual(['github'])
})

test('auto and local are always allowed and ask gh nothing', async ($, on) => {
  const { ran } = fakeGh(on, { version: NOT_STARTED, auth: SIGNED_OUT })
  const written = fakeWriter(on)

  expect(await choose($, 'auto')).toEqual({ value: 'auto' })
  expect(await choose($, 'local')).toEqual({ value: 'local' })
  expect(written).toEqual(['auto', 'local'])
  expect(ran).toEqual([])
})

test('other rows are left alone', async ($, on) => {
  const { ran } = fakeGh(on, { ...SIGNED_IN, version: NOT_STARTED })
  fakeWriter(on)

  expect(
    await $.config.set({
      key: 'kanban.claudeLimit',
      value: 2,
      previous: 1,
      provider: { plugin: 'kanban', tier: 'user' },
      origin: { kind: 'composer' },
    }),
  ).toEqual({ value: 2 })
  expect(ran).toEqual([])
})

test('a timeout neither denies nor notes', async ($, on) => {
  const slowVersion = fakeGh(on, { ...SIGNED_IN, version: TIMED_OUT })
  fakeWriter(on)
  fakeRow(on)

  expect(await choose($, 'github')).toEqual({ value: 'github' })
  expect(await describe($)).toEqual({
    label: 'Card backend',
    description: BACKEND_NOTE,
    isHidden: false,
  })
  // A check that did not answer is asked again, and never made to look like "missing".
  expect(slowVersion.ran).toEqual(['gh --version', 'gh --version'])
})

test('a timeout of the sign-in check does not deny', async ($, on) => {
  fakeGh(on, { version: OK, auth: TIMED_OUT })
  fakeWriter(on)

  expect(await choose($, 'github')).toEqual({ value: 'github' })
})

test('describe adds the note only when gh is missing', async ($, on) => {
  const missing = fakeGh(on, { ...SIGNED_IN, version: NOT_STARTED })
  fakeRow(on)

  expect(await describe($)).toEqual({
    label: 'Card backend',
    description: `${BACKEND_NOTE} ${S.githubUnavailable}`,
    isHidden: false,
  })
  expect(S.githubUnavailable).toBe(
    'GitHub is unavailable here: gh is not installed.',
  )
  expect(missing.ran).toEqual(['gh --version'])
})

test('describe leaves the row as it is when gh is installed, and asks once', async ($, on) => {
  const { ran } = fakeGh(on, SIGNED_IN)
  fakeRow(on)

  const row = {
    label: 'Card backend',
    description: BACKEND_NOTE,
    isHidden: false,
  }
  expect(await describe($)).toEqual(row)
  expect(await describe($)).toEqual(row)
  expect(ran).toEqual(['gh --version'])
})

test('installing gh between two picks lets the second one through', async ($, on) => {
  const missing: Gh = { ...SIGNED_IN, version: NOT_STARTED }
  const gh = { current: missing }
  const ran: string[] = []
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    ran.push(line)
    const step = line === 'gh --version' ? gh.current.version : gh.current.auth
    if ('deny' in step) return { deny: step.deny }

    return {
      value: {
        exitCode: step.exitCode,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  fakeWriter(on)
  fakeRow(on)

  expect(await choose($, 'github')).toEqual({ deny: S.githubNeedsGh })
  expect((await describe($)).description).toContain(S.githubUnavailable)

  gh.current = SIGNED_IN
  expect(await choose($, 'github')).toEqual({ value: 'github' })
  expect((await describe($)).description).toBe(BACKEND_NOTE)
})

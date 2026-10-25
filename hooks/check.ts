import type { EngineInterface } from 'claude-code'

import type {
  KanbanBackendInfo,
  KanbanCard,
  KanbanCheckRun,
  KanbanSection,
} from '../types'
import { updateCheck, updateDetailState, updateTick } from './atoms'
import { appendSection, readDetail } from './backend'
import { ensureBackend } from './board'
import { escapeMarkers } from './handoff'
import { errorMessage, truncate } from './model'
import { S } from './strings'

export const CHECK_TIMEOUT_MS = 300_000
export const CHECK_TAIL_LINES = 20
const LINE_CHARS = 300
const SUMMARY_CELLS = 48
const BEAT_MS = 1000
// A run that outlives its timeout was lost with the plugin that started it.
const LOST_AFTER_MS = CHECK_TIMEOUT_MS + 30_000

const FENCE = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/
const SHELL_LANGUAGES = new Set(['sh', 'bash'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PROGRAM = /^[a-z][a-z0-9._+-]*$/
const SCRIPT_PATH = /^(?:\.{1,2}|~)\//

type Fence = { mark: string; isShell: boolean; lines: string[] }

/** The line index just past the closing run of exactly `size` backticks, or -1. */
function closeOfSpan(line: string, from: number, size: number): number {
  let at = from
  while (at < line.length) {
    if (line[at] !== '`') {
      at += 1
      continue
    }
    let run = 0
    while (line[at + run] === '`') run += 1
    if (run === size) return at
    at += run
  }

  return -1
}

function codeSpans(line: string): string[] {
  const spans: string[] = []
  let at = 0
  while (at < line.length) {
    if (line[at] !== '`') {
      at += 1
      continue
    }
    let size = 0
    while (line[at + size] === '`') size += 1
    const close = closeOfSpan(line, at + size, size)
    if (close < 0) {
      at += size
      continue
    }
    spans.push(line.slice(at + size, close).trim())
    at = close + size
  }

  return spans
}

// A span is a command when it starts with a lowercase program and gives it an
// argument (`npm test`), or is a script path (`./check.sh`). File names, UI
// labels and bare words in backticks are left out.
function looksLikeCommand(span: string): boolean {
  const words = span.split(/\s+/)
  const at = words.findIndex(word => !ASSIGNMENT.test(word))
  const program = words[at] ?? ''

  return (
    SCRIPT_PATH.test(program) ||
    (PROGRAM.test(program) && words.length - at >= 2)
  )
}

/**
 * The commands a handoff's Check text offers to run, in order and without repeats:
 * inline code spans that read as a command, and fenced `sh` / `bash` blocks (a whole
 * block is one command).
 */
export function extractCheckCommands(check: string): string[] {
  const found: string[] = []
  let fence: Fence | undefined

  for (const line of check.replaceAll('\r\n', '\n').split('\n')) {
    if (fence !== undefined) {
      const close = FENCE.exec(line)
      const mark = close?.[1] ?? close?.[3] ?? ''
      const isClosing =
        mark[0] === fence.mark[0] &&
        mark.length >= fence.mark.length &&
        (close?.[2] ?? close?.[4] ?? '').trim() === ''
      if (isClosing) {
        if (fence.isShell) found.push(fence.lines.join('\n').trim())
        fence = undefined
      } else {
        fence.lines.push(line)
      }
      continue
    }

    const open = FENCE.exec(line)
    if (open !== null) {
      const language = (open[2] ?? open[4] ?? '').trim().split(/\s+/)[0] ?? ''
      fence = {
        mark: open[1] ?? open[3] ?? '',
        isShell: SHELL_LANGUAGES.has(language.toLowerCase()),
        lines: [],
      }
      continue
    }

    found.push(...codeSpans(line).filter(looksLikeCommand))
  }
  // A fence left open runs to the end of the text.
  if (fence?.isShell === true) found.push(fence.lines.join('\n').trim())

  return [...new Set(found.filter(command => command !== ''))]
}

/**
 * The Check text of the newest handoff, unless feedback came after it. A section someone
 * else wrote on the issue (`byOther`) is never read: its command is not the person's to run.
 */
export function currentCheck(all: readonly KanbanSection[]): string {
  const sections = all.filter(one => one.byOther === undefined)
  const handoff = sections.findLastIndex(one => one.kind === 'handoff')
  const feedback = sections.findLastIndex(one => one.kind === 'feedback')

  return handoff > feedback ? (sections[handoff]?.fields?.check ?? '') : ''
}

/** A command as one short line for a button or status row; a cut or multi-line command gets an ellipsis. */
export function summary(command: string): string {
  const [first = '', ...rest] = command.split('\n')
  const line = truncate(first, SUMMARY_CELLS)

  return rest.length === 0 ? line : `${line} …`
}

/** A duration as `450 ms`, `12 s` or `3 min 5 s`. */
export function durationLabel(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`

  const seconds = Math.floor(ms / 1000)

  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

const ANSI =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
// Every control character but tab and newline, which a Code element refuses.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/**
 * The last `lines` lines of a command's output, cleaned for a Code element (colour codes
 * and control characters gone, long lines cut); `omitted` counts the lines before them.
 */
export function tailOf(
  output: string,
  lines = CHECK_TAIL_LINES,
): { text: string; omitted: number } {
  const all = output
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(ANSI, '')
    .replace(CONTROL, '')
    .trimEnd()
    .split('\n')
  const kept = all
    .slice(-lines)
    .map(line =>
      line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line,
    )

  return { text: kept.join('\n'), omitted: Math.max(0, all.length - lines) }
}

/** The one-line verdict of a finished run. */
export function resultLine(run: KanbanCheckRun): string {
  const took = durationLabel(run.durationMs)
  switch (run.outcome) {
    case 'passed':
      return S.checkPassed(run.exitCode, took)
    case 'failed':
      return S.checkFailed(run.exitCode, took)
    case 'timeout':
      return S.checkTimedOut(CHECK_TIMEOUT_MS / 60_000)
    default:
      return S.checkNotRun(run.error)
  }
}

// A fence longer than any run of backticks inside the text.
function fenced(text: string, language = ''): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map(one => one.length),
  )
  const mark = '`'.repeat(Math.max(3, longest + 1))

  return `${mark}${language}\n${text}\n${mark}`
}

/** The `## Check run` section a recorded run becomes, safe to write inside a card. */
export function formatCheckRun(run: KanbanCheckRun): string {
  const date = new Date(run.startedAt).toISOString().slice(0, 10)
  const output = [
    run.omitted > 0 ? S.checkEarlier(run.omitted) : '',
    run.output === '' ? '' : fenced(run.output),
    run.isCut ? S.checkCapped : '',
  ].filter(part => part !== '')

  const body = [
    `**${S.checkField.command}:**`,
    fenced(run.command, 'sh'),
    `**${S.checkField.result}:** ${resultLine(run)}`,
    ...(output.length === 0 ? [] : [`**${S.checkField.output}:**`, ...output]),
  ].join('\n')

  const heading = S.headingOf({ kind: 'check', date, text: '' })

  return `## ${heading}\n${escapeMarkers(body)}`
}

/** Whether a finished run can still be saved on its card. */
export function canAttach(run: KanbanCheckRun): boolean {
  const isFinished =
    run.outcome === 'passed' ||
    run.outcome === 'failed' ||
    run.outcome === 'timeout'

  return isFinished && (run.record === 'none' || run.record === 'failed')
}

/** Whether a run still marked running was lost with the plugin that started it. */
export function isLost(run: KanbanCheckRun, now: number): boolean {
  return run.outcome === 'running' && now - run.startedAt > LOST_AFTER_MS
}

/** Runs work no one waits on; a failure goes to the transcript, not nowhere. */
function detach($: EngineInterface, work: Promise<unknown>): void {
  work.catch((error: unknown) =>
    $.ui.log(S.checkLogFailed(errorMessage(error))),
  )
}

type Finish = Pick<
  KanbanCheckRun,
  'outcome' | 'exitCode' | 'output' | 'omitted' | 'isCut' | 'error'
>

async function runShell(
  $: EngineInterface,
  command: string,
  startedAt: number,
): Promise<Finish> {
  try {
    const done = await $.process.run(['sh', '-c', command], {
      timeoutMs: CHECK_TIMEOUT_MS,
    })
    // Standard error goes last: it is what the tail should keep.
    const tail = tailOf(
      [done.stdout.trimEnd(), done.stderr.trimEnd()]
        .filter(part => part !== '')
        .join('\n'),
    )

    return {
      outcome: done.exitCode === 0 ? 'passed' : 'failed',
      exitCode: done.exitCode,
      output: tail.text,
      omitted: tail.omitted,
      isCut: done.isStdoutTruncated || done.isStderrTruncated,
      error: '',
    }
  } catch (error) {
    // The engine kills a run at the timeout and rejects; it says nothing else apart.
    const isTimeout = (await $.clock.now()) - startedAt >= CHECK_TIMEOUT_MS

    return {
      outcome: isTimeout ? 'timeout' : 'error',
      exitCode: 0,
      output: '',
      omitted: 0,
      isCut: false,
      error: isTimeout ? '' : errorMessage(error),
    }
  }
}

function patchRun(
  $: EngineInterface,
  cardId: string,
  startedAt: number,
  patch: Partial<KanbanCheckRun>,
): Promise<Record<string, KanbanCheckRun>> {
  return updateCheck($, runs => {
    const run = runs[cardId]

    return run?.startedAt === startedAt
      ? { ...runs, [cardId]: { ...run, ...patch } }
      : runs
  })
}

// A saved run shows as a section at once, where the backend reads sections back.
async function showSections(
  $: EngineInterface,
  card: KanbanCard,
  info: KanbanBackendInfo,
): Promise<void> {
  const { body, sections } = await readDetail($, info, card)
  await updateDetailState($, detail =>
    detail?.cardId === card.id ? { ...detail, body, sections } : detail,
  )
}

// Writes a run already marked `saving` onto the card, then marks it saved or failed.
async function writeRecord(
  $: EngineInterface,
  card: KanbanCard,
  run: KanbanCheckRun,
): Promise<void> {
  try {
    const info = await ensureBackend($)
    await appendSection($, info, card, formatCheckRun(run))
    await patchRun($, card.id, run.startedAt, { record: 'saved', error: '' })
    await showSections($, card, info).catch((error: unknown) =>
      $.ui.log(S.checkLogFailed(errorMessage(error))),
    )
  } catch (error) {
    await patchRun($, card.id, run.startedAt, {
      record: 'failed',
      error: errorMessage(error),
    })
  }
}

async function execute(
  $: EngineInterface,
  card: KanbanCard,
  command: string,
  startedAt: number,
  isLocal: boolean,
): Promise<void> {
  // Redraws the elapsed time while the command runs.
  const beat = $.clock.every(BEAT_MS, () =>
    detach(
      $,
      updateTick($, count => count + 1),
    ),
  )
  let finish: Finish
  try {
    finish = await runShell($, command, startedAt)
  } finally {
    beat.cancel()
  }

  // A local card is the person's own file, so the run is saved there at once; a
  // GitHub comment is public and waits for the person's Attach.
  const isSaved = isLocal && finish.outcome !== 'error'
  const durationMs = (await $.clock.now()) - startedAt
  const runs = await patchRun($, card.id, startedAt, {
    ...finish,
    durationMs,
    record: isSaved ? 'saving' : 'none',
  })
  const run = runs[card.id]
  if (isSaved && run?.startedAt === startedAt) await writeRecord($, card, run)
}

/**
 * Runs one of the card's check commands. Only a press on its Run button calls this: the
 * command is text Claude wrote, so it never runs from a tool call or on its own.
 */
export async function startCheck(
  $: EngineInterface,
  card: KanbanCard,
  command: string,
): Promise<void> {
  const startedAt = await $.clock.now()
  const isLocal = await ensureBackend($).then(
    info => info.kind === 'local',
    () => false,
  )
  const claim = { isStarted: false }
  await updateCheck($, runs => {
    const current = runs[card.id]
    claim.isStarted =
      current === undefined ||
      current.outcome !== 'running' ||
      isLost(current, startedAt)
    if (!claim.isStarted) return runs

    const run: KanbanCheckRun = {
      cardId: card.id,
      command,
      outcome: 'running',
      startedAt,
      durationMs: 0,
      exitCode: 0,
      output: '',
      omitted: 0,
      isCut: false,
      record: 'none',
      error: '',
    }

    return { ...runs, [card.id]: run }
  })
  if (!claim.isStarted) return

  // A new dispatch, so the run and what follows it read the state as it then stands.
  $.clock.after(0, () =>
    detach($, execute($, card, command, startedAt, isLocal)),
  )
}

/** Saves the card's latest run on the card: a section in the file, a comment on GitHub. */
export async function attachRun(
  $: EngineInterface,
  card: KanbanCard,
): Promise<void> {
  const claim = { run: undefined as KanbanCheckRun | undefined }
  await updateCheck($, runs => {
    const run = runs[card.id]
    claim.run =
      run !== undefined && canAttach(run)
        ? { ...run, record: 'saving', error: '' }
        : undefined

    return claim.run === undefined ? runs : { ...runs, [card.id]: claim.run }
  })
  if (claim.run !== undefined) await writeRecord($, card, claim.run)
}

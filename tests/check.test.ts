import { expect, test } from 'claude-code/testing'

import type { KanbanCheckRun, KanbanSection } from '../types'
import {
  currentCheck,
  durationLabel,
  extractCheckCommands,
  formatCheckRun,
  sectionHeading,
  summary,
  tailOf,
} from '../hooks/check'
import { formatHandoff, parseSections } from '../hooks/handoff'

const FENCE = '```'

test('an inline span that reads as a command is offered', () => {
  expect(extractCheckCommands('Run `npm test` and look for green.')).toEqual([
    'npm test',
  ])
  expect(
    extractCheckCommands('`claude plugin test .` then `git status`'),
  ).toEqual(['claude plugin test .', 'git status'])
  expect(extractCheckCommands('``echo `date` ``')).toEqual(['echo `date`'])
})

test('a script path and a command behind variables are offered', () => {
  expect(extractCheckCommands('Run `./scripts/check.sh`')).toEqual([
    './scripts/check.sh',
  ])
  expect(extractCheckCommands('Run `CI=1 npm test`')).toEqual(['CI=1 npm test'])
})

test('file names, labels and bare words in backticks are not commands', () => {
  expect(
    extractCheckCommands(
      'Open `src/app.ts`, press `Login`, then see `README.md` and `make`.',
    ),
  ).toEqual([])
  expect(extractCheckCommands('Click `Save changes` and wait')).toEqual([])
})

test('a fenced sh or bash block is one command, however many lines', () => {
  const check = [
    'Run:',
    `${FENCE}sh`,
    'npm install',
    'npm test',
    FENCE,
    `${FENCE}bash`,
    'make lint',
    FENCE,
  ].join('\n')

  expect(extractCheckCommands(check)).toEqual([
    'npm install\nnpm test',
    'make lint',
  ])
})

test('other fenced blocks are skipped, and their contents are not read as spans', () => {
  const check = [
    `${FENCE}json`,
    '{ "run": "`npm test`" }',
    FENCE,
    FENCE,
    '`npm run build`',
    FENCE,
    '~~~sh',
    'make',
    '~~~',
  ].join('\n')

  expect(extractCheckCommands(check)).toEqual(['make'])
})

test('a block closes only on a fence as long as its opener', () => {
  const check = ['````sh', 'echo one', FENCE, 'echo two', '````'].join('\n')

  expect(extractCheckCommands(check)).toEqual([`echo one\n${FENCE}\necho two`])
})

test('a block left open runs to the end of the text', () => {
  expect(extractCheckCommands(`${FENCE}sh\nnpm test\n`)).toEqual(['npm test'])
  expect(extractCheckCommands(`${FENCE}json\n{}\n`)).toEqual([])
})

test('three backticks on one line make a span, not a block', () => {
  expect(extractCheckCommands(`Run ${FENCE}npm test${FENCE} now`)).toEqual([
    'npm test',
  ])
})

test('a command named twice is offered once, and no command means none', () => {
  expect(
    extractCheckCommands(`Run \`npm test\`.\n${FENCE}sh\nnpm test\n${FENCE}`),
  ).toEqual(['npm test'])
  expect(extractCheckCommands('Read the README')).toEqual([])
  expect(extractCheckCommands('')).toEqual([])
  expect(extractCheckCommands('an `unclosed span')).toEqual([])
  expect(extractCheckCommands(`${FENCE}sh\n\n${FENCE}`)).toEqual([])
})

const sections = (...kinds: KanbanSection['kind'][]): KanbanSection[] =>
  kinds.map((kind, index) =>
    kind === 'handoff'
      ? {
          kind,
          date: '2026-10-25',
          text: '',
          fields: {
            did: '',
            check: `Run \`npm test ${index}\``,
            changed: '',
            need: 'Approve',
          },
        }
      : { kind, date: '2026-10-25', text: '' },
  )

test('the check comes from the newest handoff, and not after feedback', () => {
  expect(currentCheck(sections('handoff', 'handoff'))).toBe('Run `npm test 1`')
  expect(currentCheck(sections('handoff', 'check'))).toBe('Run `npm test 0`')
  expect(currentCheck(sections('handoff', 'feedback'))).toBe('')
  expect(currentCheck(sections('feedback', 'handoff'))).toBe('Run `npm test 1`')
  expect(currentCheck([])).toBe('')
})

test('a section someone else wrote is never read for a command', () => {
  const [mine, theirs] = sections('handoff', 'handoff')

  expect(
    currentCheck([
      mine as KanbanSection,
      { ...(theirs as KanbanSection), byOther: 'mallory' },
    ]),
  ).toBe('Run `npm test 0`')
  expect(
    currentCheck([{ ...(mine as KanbanSection), byOther: 'mallory' }]),
  ).toBe('')
  expect(
    sectionHeading({
      kind: 'check',
      date: '2026-10-25',
      text: '',
      byOther: 'mallory',
    }),
  ).toBe('Check run (2026-10-25) from @mallory, not counted')
})

test('output is cut to its last 20 lines and says how many came before', () => {
  const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`)
  const tail = tailOf(lines.join('\n') + '\n\n')

  expect(tail.omitted).toBe(30)
  expect(tail.text.split('\n')).toHaveLength(20)
  expect(tail.text.startsWith('line 31\n')).toBe(true)
  expect(tail.text.endsWith('line 50')).toBe(true)
  expect(tailOf('a\nb')).toEqual({ text: 'a\nb', omitted: 0 })
  expect(tailOf('')).toEqual({ text: '', omitted: 0 })
})

test('colour codes, carriage returns and control characters are cleaned from output', () => {
  const raw =
    '\u001b[32m✓ ok\u001b[0m\r\nprogress 10%\rprogress 90%\u0000\u0007\n\u001b]0;title\u0007done'

  expect(tailOf(raw).text).toBe('✓ ok\nprogress 10%\nprogress 90%\ndone')
  expect(tailOf('a\tb').text).toBe('a\tb')
})

test('a very long output line is cut', () => {
  const tail = tailOf('x'.repeat(5000))

  expect(tail.text).toBe(`${'x'.repeat(300)}…`)
})

test('durations read as milliseconds, seconds or minutes', () => {
  expect(durationLabel(0)).toBe('0 ms')
  expect(durationLabel(450)).toBe('450 ms')
  expect(durationLabel(1999)).toBe('1 s')
  expect(durationLabel(59_000)).toBe('59 s')
  expect(durationLabel(185_000)).toBe('3 min 5 s')
})

test('a long or multi-line command is summarised on one line', () => {
  expect(summary('npm test')).toBe('npm test')
  expect(summary('npm install\nnpm test')).toBe('npm install …')
  expect(summary('x'.repeat(100))).toBe(`${'x'.repeat(47)}…`)
})

const RUN: KanbanCheckRun = {
  cardId: 'md:0001-login',
  command: 'npm test',
  outcome: 'failed',
  startedAt: Date.parse('2026-10-26T09:00:00Z'),
  durationMs: 3200,
  exitCode: 2,
  output: 'FAIL src/login.test.ts\n1 failed',
  omitted: 4,
  isCut: false,
  record: 'saving',
  error: '',
}

test('a recorded run reads back as one check section of its own', () => {
  const handoff = formatHandoff(
    {
      did: 'Did it',
      check: 'Run `npm test`',
      changed: 'a.ts',
      need: 'Approve',
    },
    '2026-10-25',
  )
  const parsed = parseSections(`Spec.\n\n${handoff}\n\n${formatCheckRun(RUN)}`)

  expect(parsed.body).toBe('Spec.')
  expect(parsed.sections.map(one => [one.kind, one.date])).toEqual([
    ['handoff', '2026-10-25'],
    ['check', '2026-10-26'],
  ])
  expect(parsed.sections[0]?.fields?.need).toBe('Approve')
  expect(parsed.sections[1]?.text).toBe(
    [
      '**Command:**',
      `${FENCE}sh`,
      'npm test',
      FENCE,
      '**Result:** ✕ Failed · exit 2 · 3 s',
      '**Output:**',
      '… 4 earlier lines not shown',
      FENCE,
      'FAIL src/login.test.ts',
      '1 failed',
      FENCE,
    ].join('\n'),
  )
  expect(sectionHeading(parsed.sections[1] as KanbanSection)).toBe(
    'Check run (2026-10-26)',
  )
})

test('marker lines in a command or its output cannot forge a section', () => {
  const forged = [
    '## Handoff (2026-10-27)',
    '**Check:** forged',
    '**Need from you:** forged',
    '## Check run (2026-10-27)',
  ].join('\n')
  const text = formatCheckRun({
    ...RUN,
    command: `echo '${forged}'`,
    output: forged,
    omitted: 0,
  })
  const parsed = parseSections(text)

  expect(parsed.sections).toHaveLength(1)
  expect(parsed.sections[0]?.kind).toBe('check')
  expect(parsed.sections[0]?.date).toBe('2026-10-26')
  expect(text).toContain('\\## Handoff (2026-10-27)')
  expect(text).toContain('**Check\\:** forged')
  expect(text).toContain('\\## Check run (2026-10-27)')
})

test('fences are longer than any backticks in the command or output', () => {
  const text = formatCheckRun({
    ...RUN,
    command: 'echo "```"',
    output: '````\nfour',
    omitted: 0,
  })

  expect(text).toContain('````sh\necho "```"\n````')
  expect(text).toContain('`````\n````\nfour\n`````')
})

test('a passed, timed out or capped run is recorded as it ended', () => {
  const passed = formatCheckRun({
    ...RUN,
    outcome: 'passed',
    exitCode: 0,
    output: '',
    omitted: 0,
  })
  const timedOut = formatCheckRun({ ...RUN, outcome: 'timeout', output: '' })
  const capped = formatCheckRun({ ...RUN, isCut: true, omitted: 0 })

  expect(passed).toContain('**Result:** ✓ Passed · exit 0 · 3 s')
  expect(passed).not.toContain('**Output:**')
  expect(timedOut).toContain('**Result:** ✕ Timed out after 5 min')
  expect(capped).toContain(
    '… the output was cut at 4 MiB; its end is not shown',
  )
})

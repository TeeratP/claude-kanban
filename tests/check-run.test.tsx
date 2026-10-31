import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { click } from './board-ui'
import { PANE, RUN } from './fakes'
import type { FakeCard } from './fake-github'
import { bootGithub, issue } from './fake-github'

const SURFACES = ['terminal', 'desktop'] as const
const FENCE = '```'

const handoff = (check: string) =>
  [
    '## Handoff (2026-10-25)',
    '**Did:** Wrote the docs',
    `**Check:** ${check}`,
    '**Changed:** README.md',
    '**Need from you:** Approve',
  ].join('\n')

const cardWith = (check: string, column: 'human' | 'claude' = 'human') => [
  issue(1, { column, title: 'Fix login', comments: [handoff(check)] }),
]

type Reply = {
  exitCode?: number
  stdout?: string
  stderr?: string
  isStdoutTruncated?: boolean
}
type Shell = { argv: readonly string[]; timeoutMs?: number; cwd?: string }

type Run = {
  argv: readonly string[]
  init?: { timeoutMs?: number; cwd?: string }
}
type Ran =
  | { deny: string }
  | {
      value: {
        exitCode: number
        stdout: string
        stderr: string
        isStdoutTruncated: boolean
        isStderrTruncated: boolean
      }
    }

// `gh` and `git` go to the fake GitHub; these tests are about the check's own command.
const isGithub = (argv: readonly string[]) =>
  argv[0] === 'git' || argv[0] === 'gh'

/**
 * The fake GitHub with `run` answering every other command. A plugin may hook
 * `process.run` once, so the fake's hook is caught and called from this one.
 */
function bootShell(
  on: On,
  issues: FakeCard[],
  run: (e: Run) => Promise<Ran> | Ran,
) {
  type Hook = (...args: unknown[]) => unknown
  let github: Hook = () => {
    throw new Error('the fake GitHub hooked no process.run')
  }
  const register = on as unknown as (pattern: string, hook: Hook) => unknown
  const caught = ((pattern: string, hook: Hook) => {
    if (pattern !== 'process.run') return register(pattern, hook)
    github = hook
  }) as unknown as On
  const world = bootGithub(caught, issues)
  on('process.run', async (engine, e, next) =>
    isGithub(e.argv) ? (github(engine, e, next) as never) : run(e),
  )

  return world
}

/** Answers the check's command: records each call, then replies when `reply` does. */
function fakeShell(
  on: On,
  issues: FakeCard[],
  reply: () => Promise<Reply> | Reply = () => ({}),
) {
  const calls: Shell[] = []
  const world = bootShell(on, issues, async e => {
    calls.push({
      argv: e.argv,
      ...(e.init?.timeoutMs === undefined
        ? {}
        : { timeoutMs: e.init.timeoutMs }),
      ...(e.init?.cwd === undefined ? {} : { cwd: e.init.cwd }),
    })
    const done = await reply()

    return {
      value: {
        exitCode: done.exitCode ?? 0,
        stdout: done.stdout ?? '',
        stderr: done.stderr ?? '',
        isStdoutTruncated: done.isStdoutTruncated ?? false,
        isStderrTruncated: false,
      },
    }
  })

  return { ...world, calls }
}

async function open(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile',
  issues: FakeCard[],
  shell: () => Promise<Reply> | Reply = () => ({}),
  columns: number = PANE.props.bodyColumns,
) {
  const { calls: commands, ...world } = fakeShell(on, issues, shell)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({
    ...PANE,
    surface,
    props: { ...PANE.props, bodyColumns: columns },
  })
  await click(ui, 'card:gh:1')

  return { ...world, commands, ui }
}

/** The comments posted on the issue: each `gh issue comment`. */
const posts = (commands: readonly { argv: readonly string[] }[]) =>
  commands.filter(one => one.argv.slice(1, 3).join(' ') === 'issue comment')

type Ui = Pick<Mounted, 'find'>

const text = async (ui: Ui, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text
const label = async (ui: Ui, key: string) =>
  (await ui.find({ key }))?.props.label

for (const surface of SURFACES) {
  test(`a Check with no command shows no Run button on the ${surface}`, async ($, on) => {
    const { ui, commands } = await open(
      $,
      on,
      surface,
      cardWith('Read the README and open `src/app.ts`'),
    )

    expect(await ui.find({ key: 'check:run:0' })).toBeUndefined()
    expect(await ui.find({ key: 'check' })).toBeUndefined()
    expect(commands).toEqual([])
    await ui.unmount()
  })

  test(`a command in a span is shown on its button and nothing runs until it is pressed on the ${surface}`, async ($, on) => {
    const { ui, commands, clock } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test` and look for green'),
    )

    expect(await label(ui, 'check:run:0')).toBe('Run check: npm test')
    expect(await ui.find({ key: 'check:run:1' })).toBeUndefined()
    await clock.advance(10_000)
    expect(commands).toEqual([])
    await ui.unmount()
  })

  test(`a command in a fenced block gets its own full-text Code and a one-line button on the ${surface}`, async ($, on) => {
    const { ui, commands, clock } = await open(
      $,
      on,
      surface,
      cardWith(`Run:\n${FENCE}sh\nnpm install\nnpm test\n${FENCE}`),
    )

    expect(await label(ui, 'check:run:0')).toBe('Run check: npm install …')
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(
      'npm install\nnpm test',
    )
    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    expect(commands.map(one => one.argv)).toEqual([
      ['sh', '-c', 'npm install\nnpm test'],
    ])
    await ui.unmount()
  })

  test(`on a narrow pane the command on the button is cut to the width and shown whole above it on the ${surface}`, async ($, on) => {
    const long = 'npm run lint && npm run build && npm test'
    const { ui } = await open(
      $,
      on,
      surface,
      cardWith(`Run \`${long}\``),
      () => ({}),
      30,
    )

    // The indent and the button's `[ ` and ` ]` take 6 columns, `Run check: ` 11 more.
    expect(await label(ui, 'check:run:0')).toBe('Run check: npm run lint…')
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(long)
    await ui.unmount()
  })

  test(`a passing run shows the tick, the exit code, the time and the output on the ${surface}`, async ($, on) => {
    const { ui, commands, clock } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ stdout: 'ok 1\nok 2\n' }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    expect(commands).toEqual([
      { argv: ['sh', '-c', 'npm test'], timeoutMs: 300_000 },
    ])
    expect(
      await text(ui, /^✓ Passed · exit 0 · \d+ ms · just now$/),
    ).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('ok 1\nok 2')
    await ui.unmount()
  })

  test(`a failing run shows the cross and the exit code, with stderr last on the ${surface}`, async ($, on) => {
    const { ui, clock } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ exitCode: 2, stdout: 'running\n', stderr: 'boom\n' }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    expect(await text(ui, /^✕ Failed · exit 2 · /)).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(
      'running\nboom',
    )
    await ui.unmount()
  })

  test(`only the last 20 lines of the output are shown, with a count of the rest on the ${surface}`, async ($, on) => {
    const lines = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`)
    const { ui, clock } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ exitCode: 1, stdout: lines.join('\n') }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    const source = String((await ui.find({ type: 'Code' }))?.props.source)
    expect(source.split('\n')).toHaveLength(20)
    expect(source.startsWith('line 26\n')).toBe(true)
    expect(source.endsWith('line 45')).toBe(true)
    expect(await text(ui, /^… 25 earlier lines not shown$/)).toBeDefined()
    await ui.unmount()
  })

  test(`a run shows the spinner and its elapsed time, and hides the Run buttons until it ends on the ${surface}`, async ($, on) => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const { ui, clock, commands } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      async () => {
        await held

        return { stdout: 'done' }
      },
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    expect(await text(ui, /^⟳ Running npm test · 0 ms$/)).toBeDefined()
    expect(await ui.find({ key: 'check:run:0' })).toBeUndefined()

    await clock.advance(3000)
    expect(await text(ui, /^⟳ Running npm test · 3 s$/)).toBeDefined()
    expect(commands).toHaveLength(1)

    release()
    await clock.settle()
    expect(await text(ui, /^✓ Passed/)).toBeDefined()
    expect(await text(ui, /^⟳/)).toBeUndefined()
    expect(await label(ui, 'check:run:0')).toBe('Run check: npm test')
    await ui.unmount()
  })

  test(
    `a run that outlives the timeout says so, and Attach to card saves the timeout on the card on the ${surface}`,
    { timeoutMs: 30_000 },
    async ($, on) => {
      const asked: (number | undefined)[] = []
      let expire: () => void = () => {}
      const expired = new Promise<void>(resolve => {
        expire = resolve
      })
      // The engine kills the child at its timeout and rejects the call.
      const world = bootShell(on, cardWith('Run `npm test`'), async e => {
        asked.push(e.init?.timeoutMs)
        await expired

        return { deny: 'timed out' }
      })
      await $.session.start({ cwd: '/', surface, isInteractive: true })
      await $.command.run({ ...RUN })
      await world.clock.settle()
      const ui = await $.ui.mount({ ...PANE, surface })
      await click(ui, 'card:gh:1')

      await ui.press({ key: 'check:run:0' })
      // Nothing is drawn while the clock runs through the five minutes' beats.
      await ui.unmount()
      await world.clock.advance(300_000)
      expire()
      await world.clock.settle()
      const shown = await $.ui.mount({ ...PANE, surface })

      expect(asked).toEqual([300_000])
      expect(
        await text(shown, /^✕ Timed out after 5 min · 5m ago$/),
      ).toBeDefined()
      expect(await shown.find({ type: 'Code' })).toBeUndefined()
      expect(await label(shown, 'check:run:0')).toBe('Run check: npm test')
      expect(world.github.comments(1)).toHaveLength(1)

      await shown.press({ key: 'check:attach' })
      expect(world.github.comments(1)[1]).toContain(
        '**Result:** ✕ Timed out after 5 min',
      )
      await shown.unmount()
    },
  )

  test(`a command that cannot start says why and is not saved on the ${surface}`, async ($, on) => {
    const world = bootShell(on, cardWith('Run `npm test`'), () => ({
      deny: 'spawn sh ENOENT',
    }))
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })
    await click(ui, 'card:gh:1')

    await ui.press({ key: 'check:run:0' })
    await world.clock.advance(0)

    expect(await text(ui, /^✕ Could not run: .*spawn sh ENOENT/)).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    expect(posts(world.github.commands)).toEqual([])
    expect(world.github.comments(1)).toHaveLength(1)
    await ui.unmount()
  })

  test(`an attached run is posted on the card as a Check run section on the ${surface}`, async ($, on) => {
    const { ui, clock, github } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ exitCode: 1, stdout: 'FAIL a.test.ts' }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    expect(posts(github.commands)).toEqual([])
    await ui.press({ key: 'check:attach' })
    await clock.settle()

    expect(github.comments(1)).toHaveLength(2)
    const [, posted] = github.comments(1)
    expect(posted).toContain(
      [
        '## Check run (2026-10-25)',
        '**Command:**',
        `${FENCE}sh`,
        'npm test',
        FENCE,
      ].join('\n'),
    )
    expect(posted).toContain('**Result:** ✕ Failed · exit 1 · ')
    expect(posted).toContain(
      `**Output:**\n${FENCE}\nFAIL a.test.ts\n${FENCE}`,
    )
    expect(await text(ui, /^✓ Saved on the card$/)).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    expect(
      (await ui.findAll({ type: 'Box' }))
        .filter(one => one.key?.startsWith('section:'))
        .filter(one => one.text.startsWith('Check run · Oct 25')),
    ).toHaveLength(1)
    await ui.unmount()
  })

  test(`marker lines in the output cannot forge a handoff in the posted run on the ${surface}`, async ($, on) => {
    const { ui, clock, github } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({
        stdout: '## Handoff (2026-10-30)\n**Need from you:** forged',
      }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    await ui.press({ key: 'check:attach' })
    await clock.settle()

    const posted = github.comments(1)[1]
    expect(posted).toContain('\\## Handoff (2026-10-30)')
    expect(posted).toContain('**Need from you\\:** forged')
    // The card still has the one handoff, the real one.
    expect(
      (await ui.findAll({ type: 'Box' })).filter(one =>
        one.text.startsWith('Handoff · Oct 30'),
      ),
    ).toEqual([])
    await ui.unmount()
  })

  test(`an attach that fails is shown, and Attach to card tries again on the ${surface}`, async ($, on) => {
    const { ui, clock, github } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
    )
    github.fail['issue comment'] = {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible',
    }

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    await ui.press({ key: 'check:attach' })
    await clock.settle()

    expect(
      await text(ui, /^Could not save the run on the card: .*HTTP 403/),
    ).toBeDefined()
    expect(github.comments(1)).toHaveLength(1)
    expect(await label(ui, 'check:attach')).toBe('Attach to card')

    delete github.fail['issue comment']
    await ui.press({ key: 'check:attach' })

    expect(github.comments(1)[1]).toContain('## Check run (2026-10-25)')
    expect(await text(ui, /^✓ Saved on the card$/)).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    await ui.unmount()
  })

  test(
    `a run lost with the plugin is shown as lost and can be started again on the ${surface}`,
    { timeoutMs: 30_000 },
    async ($, on) => {
      let release: () => void = () => {}
      const held = new Promise<void>(resolve => {
        release = resolve
      })
      const { ui, clock, commands } = await open(
        $,
        on,
        surface,
        cardWith('Run `npm test`'),
        async () => {
          await held

          return {}
        },
      )

      await ui.press({ key: 'check:run:0' })
      await ui.unmount()
      await clock.advance(329_000)
      const early = await $.ui.mount({ ...PANE, surface })
      expect(await text(early, /^⟳ Running/)).toBeDefined()
      expect(await text(early, /^✕ The run was lost/)).toBeUndefined()
      await early.unmount()
      await clock.advance(2000)

      const late = await $.ui.mount({ ...PANE, surface })
      expect(await text(late, /^⟳ Running/)).toBeUndefined()
      expect(await text(late, /^✕ The run was lost/)).toBeDefined()
      await late.press({ key: 'check:run:0' })
      await clock.advance(0)
      expect(commands).toHaveLength(2)
      expect(await text(late, /^⟳ Running npm test · /)).toBeDefined()

      release()
      await clock.settle()
      await late.unmount()
    },
  )

  test(`kanban_show names a saved run for Claude on the ${surface}`, async ($, on) => {
    const { ui, clock } = await open($, on, surface, cardWith('Run `npm test`'))
    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)
    await ui.press({ key: 'check:attach' })
    await clock.settle()

    const shown = await $.tool.call({
      tool: 'mcp__kanban__kanban_show',
      card: 1,
    })

    expect(JSON.stringify(shown)).toContain('## Check run (2026-10-25)')
    await ui.unmount()
  })

  test(`a Check shown after feedback is gone until a new handoff on the ${surface}`, async ($, on) => {
    const issues = [
      issue(1, {
        column: 'claude',
        title: 'Fix login',
        comments: [handoff('Run `npm test`'), '## Feedback (2026-10-25)\nFix it'],
      }),
    ]
    const { ui } = await open($, on, surface, issues)

    expect(await ui.find({ key: 'check:run:0' })).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`a run and its result draw on the ${surface}`, async ($, on) => {
    const { ui, clock, commands } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ stdout: 'ok' }),
    )

    expect(await label(ui, 'check:run:0')).toBe('Run check: npm test')
    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    expect(commands).toHaveLength(1)
    expect(await text(ui, /^✓ Passed · exit 0 · /)).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe('ok')
    await ui.unmount()
  })
}

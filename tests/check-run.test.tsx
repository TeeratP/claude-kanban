import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { click } from './board-ui'
import { PANE, RUN, boot, card, path } from './fakes'

const SURFACES = ['terminal', 'desktop'] as const
const FENCE = '```'

const handoff = (check: string) =>
  [
    'Spec text.',
    '',
    '## Handoff (2026-10-25)',
    '**Did:** Wrote the docs',
    `**Check:** ${check}`,
    '**Changed:** README.md',
    '**Need from you:** Approve',
  ].join('\n')

const CARD = path(1, 'login')
const cardWith = (check: string, status = 'human') => ({
  [CARD]: card(1, { status, title: 'Fix login' }, handoff(check)),
})

type Reply = {
  exitCode?: number
  stdout?: string
  stderr?: string
  isStdoutTruncated?: boolean
}
type Shell = { argv: readonly string[]; timeoutMs?: number; cwd?: string }

// The board looks for a GitHub board with git and gh; these tests are about the check, so none is found.
const NO_GITHUB = { deny: 'no GitHub board here' }
const isProbe = (argv: readonly string[]) =>
  argv[0] === 'git' || argv[0] === 'gh'

/** Answers `process.run` for the check: records each call, then replies when `reply` does. */
function fakeShell(on: On, reply: () => Promise<Reply> | Reply = () => ({})) {
  const calls: Shell[] = []
  on('process.run', async (_, e) => {
    if (isProbe(e.argv)) return NO_GITHUB

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

  return calls
}

async function open(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile',
  files: Record<string, string>,
  shell: () => Promise<Reply> | Reply = () => ({}),
) {
  const world = boot(on, files)
  const commands = fakeShell(on, shell)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run({ ...RUN })
  await world.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface })
  await click(ui, 'card:md:0001-login')

  return { ...world, files, commands, ui }
}

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
    expect(await text(ui, /^Check$/)).toBeUndefined()
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
    `a run that outlives the timeout says so, and the timeout is saved on the card on the ${surface}`,
    { timeoutMs: 30_000 },
    async ($, on) => {
      const files = cardWith('Run `npm test`')
      const world = boot(on, files)
      const asked: (number | undefined)[] = []
      let expire: () => void = () => {}
      const expired = new Promise<void>(resolve => {
        expire = resolve
      })
      // The engine kills the child at its timeout and rejects the call.
      on('process.run', async (_, e) => {
        if (isProbe(e.argv)) return NO_GITHUB

        asked.push(e.init?.timeoutMs)
        await expired

        return { deny: 'timed out' }
      })
      await $.session.start({ cwd: '/', surface, isInteractive: true })
      await $.command.run({ ...RUN })
      await world.clock.settle()
      const ui = await $.ui.mount({ ...PANE, surface })
      await click(ui, 'card:md:0001-login')

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
      expect(files[CARD]).toContain('**Result:** ✕ Timed out after 5 min')
      await shown.unmount()
    },
  )

  test(`a command that cannot start says why and is not saved on the ${surface}`, async ($, on) => {
    const world = boot(on, cardWith('Run `npm test`'))
    on('process.run', (_, e) =>
      isProbe(e.argv) ? NO_GITHUB : { deny: 'spawn sh ENOENT' },
    )
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })
    await click(ui, 'card:md:0001-login')
    const before = world.calls.writes.length

    await ui.press({ key: 'check:run:0' })
    await world.clock.advance(0)

    expect(await text(ui, /^✕ Could not run: .*spawn sh ENOENT/)).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    expect(world.calls.writes.length).toBe(before)
    await ui.unmount()
  })

  test(`a local run is saved on the card as a Check run section on the ${surface}`, async ($, on) => {
    const { ui, clock, files } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
      () => ({ exitCode: 1, stdout: 'FAIL a.test.ts' }),
    )

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    expect(files[CARD]).toContain(
      [
        'Spec text.',
        '',
        '## Handoff (2026-10-25)',
        '**Did:** Wrote the docs',
        '**Check:** Run `npm test`',
        '**Changed:** README.md',
        '**Need from you:** Approve',
        '',
        '## Check run (2026-10-25)',
        '**Command:**',
        `${FENCE}sh`,
        'npm test',
        FENCE,
      ].join('\n'),
    )
    expect(files[CARD]).toContain('**Result:** ✕ Failed · exit 1 · ')
    expect(files[CARD]).toContain(
      `**Output:**\n${FENCE}\nFAIL a.test.ts\n${FENCE}`,
    )
    expect(await text(ui, /^✓ Saved on the card$/)).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    expect(
      (await ui.findAll({ type: 'Markdown' }))
        .map(one => String(one.props.text))
        .filter(shown => shown.startsWith('**Check run (2026-10-25)**')),
    ).toHaveLength(1)
    await ui.unmount()
  })

  test(`marker lines in the output cannot forge a handoff in the card file on the ${surface}`, async ($, on) => {
    const { ui, clock, files } = await open(
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

    expect(files[CARD]).toContain('\\## Handoff (2026-10-30)')
    expect(files[CARD]).toContain('**Need from you\\:** forged')
    await ui.unmount()
  })

  test(`a save that fails is shown, and Attach to card tries again on the ${surface}`, async ($, on) => {
    const { ui, clock, files, calls } = await open(
      $,
      on,
      surface,
      cardWith('Run `npm test`'),
    )
    calls.denyWrite = 'EIO: disk error'

    await ui.press({ key: 'check:run:0' })
    await clock.advance(0)

    expect(
      await text(ui, /^Could not save the run on the card: .*EIO/),
    ).toBeDefined()
    expect(files[CARD]).not.toContain('## Check run')
    expect(await label(ui, 'check:attach')).toBe('Attach to card')

    calls.denyWrite = undefined
    await ui.press({ key: 'check:attach' })

    expect(files[CARD]).toContain('## Check run (2026-10-25)')
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

    const shown = await $.tool.call({
      tool: 'mcp__kanban__kanban_show',
      card: 1,
    })

    expect(JSON.stringify(shown)).toContain('## Check run (2026-10-25)')
    await ui.unmount()
  })

  test(`a Check shown after feedback is gone until a new handoff on the ${surface}`, async ($, on) => {
    const files = {
      [CARD]: card(
        1,
        { status: 'claude', title: 'Fix login' },
        `${handoff('Run `npm test`')}\n\n## Feedback (2026-10-25)\nFix it`,
      ),
    }
    const { ui } = await open($, on, surface, files)

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

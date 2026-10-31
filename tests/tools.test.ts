import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseSections } from '../hooks/handoff'
import { TOOL_SPECS } from '../hooks/tools'
import { click } from './board-ui'
import { NOW, PANE, RUN, SYNC_PAUSE } from './fakes'
import { bootGithub, issue } from './fake-github'
import type { FakeCard } from './fake-github'

const tool = (name: string): `mcp__${string}__${string}` =>
  `mcp__kanban__${name}`

const HANDOFF = [
  '## Handoff (2026-10-24)',
  '**Did:** Fixed the loop',
  '**Check:** Log in twice',
  '**Changed:** auth.ts',
  '**Need from you:** Approve',
].join('\n')

const FEEDBACK = '## Feedback (2026-10-25)\nAlso handle expiry.'

const QUESTION = '## Question (2026-10-25)\nWhich provider?'

const URL_OF = (n: number) =>
  `https://github.com/TeeratP/claude-kanban/issues/${n}`

/** Card #1 "Fix login" in Claude, with these comments. */
const withComments = (
  comments: string[] = [],
  column: 'claude' | 'backlog' | 'human' = 'claude',
) => issue(1, { column, title: 'Fix login', comments }, 'The spec.')

const moveToHuman = ($: Engine) =>
  $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'human' })

const moveToDone = ($: Engine) =>
  $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'done' })

/** The commands that closed an issue. */
const closes = (github: { commands: { argv: readonly string[] }[] }) =>
  github.commands.filter(
    call => call.argv[1] === 'issue' && call.argv[2] === 'close',
  )

test('a move to Human with no handoff is refused and the card stays put', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments()])

  const refused = await moveToHuman($)

  expect(refused).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In progress')
})

const EMPTY_HANDOFFS = {
  'an empty need': HANDOFF.replace(
    '**Need from you:** Approve',
    '**Need from you:**',
  ),
  'a check of n/a': HANDOFF.replace(
    '**Check:** Log in twice',
    '**Check:** N/A',
  ),
  'a check of an ellipsis': HANDOFF.replace(
    '**Check:** Log in twice',
    '**Check:** …',
  ),
  'a need of three dots': HANDOFF.replace(
    '**Need from you:** Approve',
    '**Need from you:** ...',
  ),
}

for (const [name, handoff] of Object.entries(EMPTY_HANDOFFS)) {
  test(`a handoff with ${name} does not let a card through to Human`, async ($, on) => {
    const { clock, github } = bootGithub(on, [withComments([handoff])])

    expect(await moveToHuman($)).toMatchObject({
      deny: expect.stringContaining('kanban_handoff'),
    })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(1).status).toBe('In progress')
  })
}

test('feedback newer than the handoff asks for a new handoff', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments([HANDOFF, FEEDBACK])])

  expect(await moveToHuman($)).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Handled expiry',
    check: 'Log in after expiry',
    need: 'Approve',
  })

  expect(await moveToHuman($)).toMatchObject({
    result: 'Moved #1 to Human (syncing).',
  })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In review')
})

test('a valid handoff lets the card move to Human', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments([HANDOFF])])

  const moved = await moveToHuman($)

  expect(moved).toMatchObject({ result: 'Moved #1 to Human (syncing).' })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In review')
})

test('a handoff does not gate Backlog and Claude', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments()])

  for (const to of ['backlog', 'claude']) {
    const moved = await $.tool.call({
      tool: tool('kanban_move'),
      card: 1,
      to,
    })

    expect(moved).toMatchObject({ result: expect.stringContaining('Moved #1') })
    await clock.advance(SYNC_PAUSE)
  }
  expect(github.card(1).status).toBe('In progress')
})

const CLOSING_REFUSED =
  'Card #1 cannot move to Done yet: record a handoff with kanban_handoff (what you did and how to check it), newer than any feedback.'

const NO_CLOSING_HANDOFF = {
  'no handoff': [],
  'a handoff older than feedback': [HANDOFF, FEEDBACK],
  'a question newer than the handoff': [HANDOFF, QUESTION],
  'a did of n/a': [
    HANDOFF.replace('**Did:** Fixed the loop', '**Did:** n/a'),
  ],
  'an empty check': [
    HANDOFF.replace('**Check:** Log in twice', '**Check:**'),
  ],
}

for (const [name, comments] of Object.entries(NO_CLOSING_HANDOFF)) {
  test(`a move to Done with ${name} is refused and the issue stays open`, async ($, on) => {
    const { clock, github } = bootGithub(on, [withComments(comments)])

    expect(await moveToDone($)).toEqual({ deny: CLOSING_REFUSED })
    await clock.advance(SYNC_PAUSE)
    expect(github.card(1)).toMatchObject({
      status: 'In progress',
      state: 'OPEN',
    })
    expect(closes(github)).toEqual([])
  })
}

test('a handoff someone else wrote on the issue does not let Claude close it', async ($, on) => {
  const { clock, github } = bootGithub(on, [
    issue(1, {
      column: 'claude',
      title: 'Fix login',
      comments: [{ body: HANDOFF, author: 'stranger' }],
    }),
  ])

  expect(await moveToDone($)).toEqual({ deny: CLOSING_REFUSED })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).state).toBe('OPEN')
})

test('after a handoff with what was done and how to check it, Claude closes the card as completed', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments([FEEDBACK])])

  const recorded = await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Handled expiry',
    check: 'Log in after expiry',
  })
  expect(recorded).toEqual({
    result:
      "Recorded a handoff on #1. If the work is finished, kanban_move it to done; move it to human only if it needs the person's approval or input.",
  })

  expect(await moveToDone($)).toEqual({ result: 'Moved #1 to Done (syncing).' })
  await clock.advance(SYNC_PAUSE)
  await clock.settle()

  expect(github.card(1)).toMatchObject({
    status: 'Done',
    state: 'CLOSED',
    stateReason: 'COMPLETED',
  })
  expect(closes(github).map(call => call.argv)).toEqual([
    [
      'gh',
      'issue',
      'close',
      '1',
      '--repo',
      'TeeratP/claude-kanban',
      '--reason',
      'completed',
    ],
  ])
})

test('a handoff with no need closes a card but does not send it to Human', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments()])

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Fixed the loop',
    check: 'Log in twice',
    need: ' ',
  })

  expect(await moveToHuman($)).toEqual({
    deny: 'Card #1 cannot move to Human yet: record a handoff with kanban_handoff (with a check and what you need from the person), newer than any feedback.',
  })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In progress')
  expect(await moveToDone($)).toEqual({ result: 'Moved #1 to Done (syncing).' })
})

test('a card that cannot be read for the check is a refusal with the reason', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])
  await $.tool.call({ tool: tool('kanban_list') })

  github.fail['issue view'] = { exitCode: 1, stderr: 'HTTP 502: Bad Gateway' }

  expect(await moveToHuman($)).toMatchObject({
    deny: expect.stringContaining('HTTP 502: Bad Gateway'),
  })
  expect(await moveToDone($)).toMatchObject({
    deny: expect.stringContaining('HTTP 502: Bad Gateway'),
  })
})

test('kanban_handoff writes the exact handoff format with the clock date', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])

  const recorded = await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Fixed the loop',
    check: 'Log in twice',
    changed: 'auth.ts',
    need: 'Approve',
  })

  expect(recorded).toMatchObject({
    result: expect.stringContaining('Recorded a handoff on #1'),
  })
  expect(new Date(NOW).toISOString().slice(0, 10)).toBe('2026-10-25')
  expect(github.comments(1)).toEqual([
    [
      '## Handoff (2026-10-25)',
      '**Did:** Fixed the loop',
      '**Check:** Log in twice',
      '**Changed:** auth.ts',
      '**Need from you:** Approve',
    ].join('\n'),
  ])
  expect(github.card(1).body).toBe('The spec.')
  expect(parseSections(github.comments(1)[0] ?? '').sections).toMatchObject([
    {
      kind: 'handoff',
      date: '2026-10-25',
      fields: {
        did: 'Fixed the loop',
        check: 'Log in twice',
        changed: 'auth.ts',
        need: 'Approve',
      },
    },
  ])
  expect(await moveToHuman($)).toMatchObject({
    result: 'Moved #1 to Human (syncing).',
  })
})

test('a handoff without the optional fields leaves them empty', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: ' Fixed it ',
    check: ' Run it ',
  })

  expect(github.comments(1)).toEqual([
    [
      '## Handoff (2026-10-25)',
      '**Did:** Fixed it',
      '**Check:** Run it',
      '**Changed:**',
      '**Need from you:**',
    ].join('\n'),
  ])
})

test('kanban_handoff refuses a placeholder, a missing did or check, a bad field and an unknown card', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])
  const handoff = (fields: Record<string, unknown>) =>
    $.tool.call({ tool: tool('kanban_handoff'), card: 1, ...fields })
  const incomplete = {
    deny: 'A handoff needs a real did and a real check: say what you did and how the work can be verified.',
  }

  expect(await handoff({ did: 'Fixed', check: 'N/A' })).toEqual(incomplete)
  expect(await handoff({ did: 'Fixed', check: ' ' })).toEqual(incomplete)
  expect(await handoff({ did: 'Fixed' })).toEqual(incomplete)
  expect(await handoff({ did: '…', check: 'Run it' })).toEqual(incomplete)
  expect(await handoff({ did: ' ', check: 'Run it' })).toEqual(incomplete)
  expect(await handoff({ check: 'Run it', need: 'Approve' })).toEqual(
    incomplete,
  )
  expect(await handoff({ did: 'Fixed', check: 7 })).toMatchObject({
    deny: 'check must be text.',
  })
  expect(await handoff({ check: 'Run it', need: 'x', did: 3 })).toMatchObject({
    deny: 'did must be text.',
  })
  expect(
    await handoff({ did: 'Fixed', check: 'Run it', need: 4 }),
  ).toMatchObject({ deny: 'need must be text.' })
  expect(
    await handoff({ card: 9, did: 'Fixed', check: 'Run it' }),
  ).toMatchObject({ deny: 'There is no kanban card #9.' })
  expect(
    await handoff({ card: 1.5, did: 'Fixed', check: 'Run it' }),
  ).toMatchObject({ deny: 'card must be a whole number.' })
  expect(github.comments(1)).toEqual([])
})

test('a handoff that cannot be written says why', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])
  await $.tool.call({ tool: tool('kanban_list') })

  github.fail['issue comment'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }
  const refused = await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Fixed it',
    check: 'Run it',
    need: 'Approve',
  })

  expect(refused).toMatchObject({
    deny: expect.stringMatching(
      /^Could not record the handoff: .*HTTP 403: Resource not accessible/,
    ),
  })
  expect(github.comments(1)).toEqual([])
})

test('kanban_handoff shows in a detail view that is open on the card', async ($, on) => {
  const { clock } = bootGithub(on, [withComments()])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await click(ui, 'card:gh:1')
  expect(await ui.find({ key: 'section:0' })).toBeUndefined()

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: 'Fixed it',
    check: 'Run it',
    need: 'Approve',
  })
  await clock.settle()

  expect((await ui.find({ key: 'section:0' }))?.text).toContain(
    'Handoff · Oct 25',
  )
  await ui.unmount()
})

test('kanban_show gives the spec, then each section, newest last', async ($, on) => {
  bootGithub(on, [
    withComments([HANDOFF, FEEDBACK]),
    issue(2, { title: 'Empty one' }, ''),
  ])

  const shown = await $.tool.call({ tool: tool('kanban_show'), card: 1 })
  const empty = await $.tool.call({ tool: tool('kanban_show'), card: 2 })

  expect(shown).toMatchObject({
    result: [
      '#1 [claude] Fix login updated 2026-10-11',
      'The spec.',
      `## Handoff (2026-10-24)\n${HANDOFF.split('\n').slice(1).join('\n')}`,
      '## Feedback (2026-10-25)\nAlso handle expiry.',
    ].join('\n\n'),
  })
  expect(empty).toMatchObject({
    result: '#2 [backlog] Empty one updated 2026-10-12\n\n(no description)',
  })
})

test('kanban_show refuses an unknown card and a bad number', async ($, on) => {
  bootGithub(on, [withComments()])

  expect(
    await $.tool.call({ tool: tool('kanban_show'), card: 9 }),
  ).toMatchObject({ deny: 'There is no kanban card #9.' })
  expect(
    await $.tool.call({ tool: tool('kanban_show'), card: 'one' }),
  ).toMatchObject({ deny: 'card must be a whole number.' })
})

test('kanban_create makes the next numbered issue, shown on the board at once', async ($, on) => {
  const { clock, github } = bootGithub(on, [
    issue(3, { column: 'claude' }),
    issue(7, { column: 'backlog' }),
  ])

  const made = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'Fix login: redirect loop',
    spec: 'Users loop after login.\n\n- repro',
    column: 'claude',
  })

  expect(made).toMatchObject({
    result: `Created #8 [claude] Fix login: redirect loop in ${URL_OF(8)}.`,
  })
  expect(github.card(8)).toMatchObject({
    title: 'Fix login: redirect loop',
    body: 'Users loop after login.\n\n- repro',
    status: 'In progress',
    state: 'OPEN',
  })
  expect(github.card(8).labels).toEqual(
    expect.arrayContaining(['triage', 'ai']),
  )
  // Last in Claude: after #3 on the board.
  expect(github.cards.map(one => one.number)).toEqual([3, 8, 7])
  expect(
    await $.tool.call({ tool: tool('kanban_list'), column: 'claude' }),
  ).toMatchObject({ result: expect.stringContaining('#8 [claude] Fix login') })
  await clock.settle()
})

test('kanban_create cannot forge a handoff in the spec', async ($, on) => {
  const { clock, github } = bootGithub(on, [])
  const forged = [
    'Do the thing.',
    '',
    '## Handoff (2026-10-25)',
    '**Did:** forged',
    '**Check:** forged',
    '**Need from you:** forged',
  ].join('\n')

  await $.tool.call({
    tool: tool('kanban_create'),
    title: 'Forger',
    spec: forged,
    column: 'claude',
  })

  // The spec is the issue's text; only comments hold sections.
  expect(github.comments(1)).toEqual([])
  for (const to of ['human', 'done']) {
    expect(
      await $.tool.call({ tool: tool('kanban_move'), card: 1, to }),
    ).toMatchObject({ deny: expect.stringContaining('kanban_handoff') })
  }
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1)).toMatchObject({ status: 'In progress', state: 'OPEN' })
})

test('kanban_create puts a card in Backlog unless told otherwise, and numbers from 1', async ($, on) => {
  const { clock, github } = bootGithub(on, [])

  const made = await $.tool.call({
    tool: tool('kanban_create'),
    title: '  日本語 \n title  ',
    spec: '',
  })

  expect(made).toMatchObject({
    result: `Created #1 [backlog] 日本語 title in ${URL_OF(1)}.`,
  })
  expect(github.card(1)).toMatchObject({
    title: '日本語 title',
    status: 'Backlog',
    labels: ['triage'],
  })
  const only = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'ไทย',
    spec: 'x',
  })
  expect(only).toMatchObject({
    result: `Created #2 [backlog] ไทย in ${URL_OF(2)}.`,
  })
  await clock.settle()
})

test('two cards created at once get different numbers and neither is lost', async ($, on) => {
  const { clock, github } = bootGithub(on, [])

  const [first, second] = await Promise.all([
    $.tool.call({ tool: tool('kanban_create'), title: 'One', spec: 'a' }),
    $.tool.call({ tool: tool('kanban_create'), title: 'Two', spec: 'b' }),
  ])

  const results = [first, second].map(one =>
    'result' in one ? String(one.result) : '',
  )
  expect(results.map(one => /^Created #(\d+)/.exec(one)?.[1]).sort()).toEqual(
    ['1', '2'],
  )
  expect(github.cards.map(one => one.title).sort()).toEqual(['One', 'Two'])
  await clock.settle()
  const listed = await $.tool.call({
    tool: tool('kanban_list'),
    column: 'backlog',
  })
  const lines = 'result' in listed ? String(listed.result).split('\n') : []
  expect(lines.map(line => line.replace(/ updated .*/, '')).sort()).toEqual([
    '#1 [backlog] One',
    '#2 [backlog] Two',
  ])
})

test('kanban_create refuses a bad title, a bad column and a start in Human', async ($, on) => {
  const { github } = bootGithub(on, [])
  const create = (fields: Record<string, unknown>) =>
    $.tool.call({
      tool: tool('kanban_create'),
      title: 'T',
      spec: 's',
      ...fields,
    })

  expect(await create({ title: '  ' })).toMatchObject({
    deny: 'title must be text that is not empty.',
  })
  expect(await create({ title: 4 })).toMatchObject({
    deny: 'title must be text that is not empty.',
  })
  expect(await create({ spec: 4 })).toMatchObject({
    deny: 'spec must be text.',
  })
  expect(await create({ column: 'later' })).toMatchObject({
    deny: expect.stringContaining('"later" is not a column'),
  })
  expect(await create({ column: 'human' })).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })
  expect(github.cards).toEqual([])
  expect(
    github.commands.filter(call => call.argv[2] === 'create'),
  ).toEqual([])
})

// The fake dates an issue's last update by its number (`2026-10-1<n % 9>`), so
// each section's two oldest are the numbers that fall on the 10th and 11th.
const DONE = [8, 2, 3, 4, 5, 6, 7, 11, 12, 13, 1, 9]
const CANCELLED = [107, 101, 102, 103, 104, 105, 106, 110, 111, 112, 109, 108]
const SUSPENDED = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212]

test('kanban_list takes any of the six columns, lists Done and Cancelled by their newest ten and Suspended whole', async ($, on) => {
  const cards: FakeCard[] = [
    ...DONE.map(n => issue(n, { column: 'done', title: `done ${n}` })),
    ...CANCELLED.map(n =>
      issue(n, { column: 'cancelled', title: `cancelled ${n}` }),
    ),
    ...SUSPENDED.map(n =>
      issue(n, { column: 'suspended', title: `suspended ${n}` }),
    ),
  ]
  bootGithub(on, cards)
  const call = (column?: string) =>
    $.tool.call({
      tool: tool('kanban_list'),
      ...(column === undefined ? {} : { column }),
    })
  const listed = async (column?: string) => {
    const answer = await call(column)
    if (!('result' in answer)) throw new Error('kanban_list refused')

    return String(answer.result).split('\n')
  }
  const numbers = (lines: string[]) =>
    lines.map(line => Number(/^#(\d+) /.exec(line)?.[1]))

  const done = await listed('done')
  expect(done).toHaveLength(10)
  expect(done[0]).toMatch(/^#8 \[done\] done 8 /)
  expect(numbers(done).sort((a, b) => a - b)).toEqual(
    DONE.slice(0, 10).sort((a, b) => a - b),
  )
  const cancelled = await listed('cancelled')
  expect(cancelled).toHaveLength(10)
  expect(cancelled[0]).toMatch(/^#107 \[cancelled\] cancelled 107 /)
  expect(numbers(cancelled).sort((a, b) => a - b)).toEqual(
    CANCELLED.slice(0, 10).sort((a, b) => a - b),
  )
  expect(await listed('suspended')).toHaveLength(12)
  // All six, in the order of the board: Done, Cancelled, Suspended.
  expect(await listed()).toHaveLength(32)
  expect(await call('later')).toMatchObject({
    deny: expect.stringContaining(
      'use backlog, claude, human, done, cancelled or suspended',
    ),
  })
})

test('Claude cannot move a card the person set aside, nor ask about it, but can still read it and hand it off', async ($, on) => {
  const { clock, github } = bootGithub(on, [
    issue(1, { column: 'suspended', title: 'On hold' }, 'Spec.'),
    issue(2, { column: 'cancelled', title: 'Dropped' }, 'Spec.'),
  ])
  const before = JSON.stringify(github.cards)

  for (const [number, word] of [
    [1, 'suspended'],
    [2, 'cancelled'],
  ] as const) {
    const refused = `Card #${number} is ${word} by the person; leave it unless they move it back.`
    for (const to of ['claude', 'human', 'backlog', 'done']) {
      expect(
        await $.tool.call({ tool: tool('kanban_move'), card: number, to }),
      ).toEqual({ deny: refused })
    }
    expect(
      await $.tool.call({
        tool: tool('kanban_ask'),
        card: number,
        question: 'Which one?',
      }),
    ).toEqual({ deny: refused })
    expect(
      await $.tool.call({ tool: tool('kanban_show'), card: number }),
    ).toMatchObject({ result: expect.stringContaining('Spec.') })
  }
  await clock.advance(SYNC_PAUSE)
  expect(JSON.stringify(github.cards)).toBe(before)

  // A handoff is only a comment on the issue; it moves nothing.
  expect(
    await $.tool.call({
      tool: tool('kanban_handoff'),
      card: 1,
      did: 'Looked again',
      check: 'Read it',
      need: 'Decide',
    }),
  ).toMatchObject({ result: expect.stringContaining('#1') })
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('Suspended')
  expect(github.comments(1)).toEqual([
    expect.stringMatching(/^## Handoff \(/),
  ])
})

for (const to of ['suspended', 'cancelled'] as const) {
  test(`a card the person ${to === 'suspended' ? 'suspends' : 'cancels'} while kanban_move reads its handoff stays ${to}`, async ($, on) => {
    const { clock, github, toasts } = bootGithub(on, [withComments([HANDOFF])])
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await $.command.run({ ...RUN })
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await click(ui, 'card:gh:1')
    await clock.settle()
    let release = () => {}
    github.holdReads = new Promise<void>(resolve => {
      release = resolve
    })

    const moving = moveToHuman($)
    await ui.press({ key: `move:${to}` })
    release()
    github.holdReads = undefined

    expect(await moving).toEqual({
      deny: `Card #1 is ${to} by the person; leave it unless they move it back.`,
    })
    await clock.advance(SYNC_PAUSE)
    await clock.settle()
    expect(github.card(1).status).toBe(
      to === 'suspended' ? 'Suspended' : 'Cancelled',
    )
    expect(await $.tool.call({ tool: tool('kanban_list') })).toMatchObject({
      result: expect.stringContaining(`#1 [${to}] Fix login`),
    })
    expect(toasts).toEqual([])
    await ui.unmount()
  })
}

test('Claude cannot move a card to Suspended or Cancelled, and the tool says it can not', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments()])
  const spec = (name: string) => TOOL_SPECS.find(one => one.name === name)
  const enumOf = (name: string, key: string): unknown => {
    const properties = spec(name)?.inputSchema?.properties as
      | Record<string, { enum?: unknown }>
      | undefined

    return properties?.[key]?.enum
  }

  expect(enumOf('kanban_move', 'to')).toEqual([
    'human',
    'claude',
    'backlog',
    'done',
  ])
  expect(enumOf('kanban_create', 'column')).toEqual([
    'claude',
    'backlog',
    'done',
  ])
  expect(enumOf('kanban_list', 'column')).toEqual([
    'backlog',
    'claude',
    'human',
    'done',
    'cancelled',
    'suspended',
  ])
  expect(spec('kanban_move')?.description).toContain(
    'Suspended and Cancelled are set by the person only.',
  )

  for (const to of ['suspended', 'cancelled', 'canceled']) {
    expect(
      await $.tool.call({ tool: tool('kanban_move'), card: 1, to }),
    ).toMatchObject({
      deny: expect.stringContaining(`"${to}" is not a column`),
    })
    expect(
      await $.tool.call({
        tool: tool('kanban_create'),
        title: 'T',
        spec: 's',
        column: to,
      }),
    ).toMatchObject({ deny: expect.stringContaining('is not a column') })
  }
  await clock.advance(SYNC_PAUSE)
  expect(github.card(1).status).toBe('In progress')
  expect(github.cards).toHaveLength(1)
})

test('the tools tell Claude to close finished cards and send only what needs the person to Human', () => {
  const spec = (name: string) => TOOL_SPECS.find(one => one.name === name)

  expect(spec('kanban_handoff')?.inputSchema?.required).toEqual([
    'card',
    'did',
    'check',
  ])
  expect(spec('kanban_handoff')?.description).toContain(
    'A card moves to Done or Human only after a handoff newer than the latest feedback.',
  )
  expect(spec('kanban_move')?.description).toContain(
    'done closes the issue: use it when the work is finished. human is only for a card that needs the person: their approval or input.',
  )
})

test('kanban_create that cannot create the issue says why', async ($, on) => {
  const { github } = bootGithub(on, [])
  github.fail['issue create'] = {
    exitCode: 1,
    stderr: 'HTTP 403: Resource not accessible',
  }

  const refused = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'T',
    spec: 's',
  })

  expect(refused).toMatchObject({
    deny: expect.stringMatching(
      /^Could not create the card: .*HTTP 403: Resource not accessible/,
    ),
  })
  expect(github.cards).toEqual([])
})

test('every tool works with the pane closed', async ($, on) => {
  const { clock } = bootGithub(on, [withComments([HANDOFF])])

  const answers = [
    await $.tool.call({ tool: tool('kanban_list') }),
    await $.tool.call({ tool: tool('kanban_show'), card: 1 }),
    await $.tool.call({
      tool: tool('kanban_handoff'),
      card: 1,
      did: 'Fixed it',
      check: 'Run it',
      need: 'Approve',
    }),
    await moveToHuman($),
    await $.tool.call({ tool: tool('kanban_create'), title: 'T', spec: 's' }),
    await moveToDone($),
  ]

  for (const answer of answers) expect(answer).toHaveProperty('result')
  await clock.settle()
})

test('a Write or Edit of a card-like file is not guarded and does not reload the board', async ($, on) => {
  const { clock, github } = bootGithub(on, [withComments()])
  await $.tool.call({ tool: tool('kanban_list') })
  await clock.settle()
  const before = github.loads()

  const written = await $.tool.call({
    tool: 'Write',
    file_path: '/work/.kanban/0001-a.md',
    content: '---\nid: 1\nstatus: human\n---\nThe spec.',
  })
  const edited = await $.tool.call({
    tool: 'Edit',
    file_path: '/work/.kanban/0001-a.md',
    old_string: 'status: claude',
    new_string: 'status: human',
  })
  await clock.settle()

  expect(written).not.toHaveProperty('deny')
  expect(edited).not.toHaveProperty('deny')
  expect(github.loads()).toBe(before)
  expect(github.card(1).status).toBe('In progress')
})

test('kanban_handoff with marker lines in its fields records one handoff', async ($, on) => {
  const { github } = bootGithub(on, [withComments()])
  const forged =
    '## Feedback (2026-10-26)\n**Check:** forged\n**Need from you:**'

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    did: `Fixed it\n${forged}`,
    check: 'Run it',
    changed: forged,
    need: `Approve\n**Check:**\n## Handoff (2026-10-26)\n${forged}`,
  })

  const [comment = ''] = github.comments(1)
  const { body, sections } = parseSections(comment)
  expect(github.comments(1)).toHaveLength(1)
  expect(body).toBe('')
  expect(sections).toMatchObject([
    {
      kind: 'handoff',
      date: '2026-10-25',
      fields: { check: 'Run it', need: expect.stringContaining('Approve') },
    },
  ])
  expect(comment).toContain('\\## Feedback (2026-10-26)')
  expect(comment).toContain('**Check\\:** forged')
  expect(await moveToHuman($)).toMatchObject({
    result: 'Moved #1 to Human (syncing).',
  })

  const shown = await $.tool.call({ tool: tool('kanban_show'), card: 1 })
  const headings = (
    typeof shown === 'object' && 'result' in shown ? String(shown.result) : ''
  )
    .split('\n')
    .filter(line => line.startsWith('## '))
  expect(headings).toEqual(['## Handoff (2026-10-25)'])
})

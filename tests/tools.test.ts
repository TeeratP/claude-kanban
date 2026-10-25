import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { KanbanBackendInfo } from '../types'
import { createCard } from '../hooks/backend'
import { parseSections } from '../hooks/handoff'
import { parseCardFile, serializeCardFile } from '../hooks/local'
import { NOW, PANE, RUN, boot, card, path } from './fakes'

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

const withBody = (body: string, status = 'claude') =>
  card(1, { status, title: 'Fix login' }, body)

const moveToHuman = ($: Engine) =>
  $.tool.call({ tool: tool('kanban_move'), card: 1, to: 'human' })

test('a move to Human with no handoff is refused and the card stays put', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.') }
  boot(on, files)

  const refused = await moveToHuman($)

  expect(refused).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })
  expect(files[path(1, 'a')]).toContain('status: claude')
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
  test(`a handoff with ${name} does not let a card through`, async ($, on) => {
    const files = { [path(1, 'a')]: withBody(`The spec.\n\n${handoff}`) }
    boot(on, files)

    expect(await moveToHuman($)).toMatchObject({
      deny: expect.stringContaining('kanban_handoff'),
    })
    expect(files[path(1, 'a')]).toContain('status: claude')
  })
}

test('feedback newer than the handoff asks for a new handoff', async ($, on) => {
  const files = {
    [path(1, 'a')]: withBody(`The spec.\n\n${HANDOFF}\n\n${FEEDBACK}`),
  }
  boot(on, files)

  expect(await moveToHuman($)).toMatchObject({
    deny: expect.stringContaining('kanban_handoff'),
  })

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    check: 'Log in after expiry',
    need: 'Approve',
  })

  expect(await moveToHuman($)).toMatchObject({
    result: 'Moved #1 to Human.',
  })
  expect(files[path(1, 'a')]).toContain('status: human')
})

test('a valid handoff lets the card move to Human', async ($, on) => {
  const files = { [path(1, 'a')]: withBody(`The spec.\n\n${HANDOFF}`) }
  boot(on, files)

  const moved = await moveToHuman($)

  expect(moved).toMatchObject({ result: 'Moved #1 to Human.' })
  expect(files[path(1, 'a')]).toContain('status: human')
})

test('a handoff does not gate the other columns', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.') }
  boot(on, files)

  for (const to of ['backlog', 'done', 'claude']) {
    const moved = await $.tool.call({
      tool: tool('kanban_move'),
      card: 1,
      to,
    })

    expect(moved).toMatchObject({ result: expect.stringContaining('Moved #1') })
  }
})

test('a card file that cannot be read for the check is a refusal with the reason', async ($, on) => {
  const { calls } = boot(on, { [path(1, 'a')]: withBody('The spec.') })
  await $.tool.call({ tool: tool('kanban_list') })

  calls.denyRead = 'EIO: disk error'
  const refused = await moveToHuman($)

  expect(refused).toMatchObject({
    deny: expect.stringContaining('EIO: disk error'),
  })
})

test('kanban_handoff writes the exact handoff format with the clock date', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.', 'claude') }
  boot(on, files)

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
  expect(files[path(1, 'a')]).toContain(
    [
      'The spec.',
      '',
      '## Handoff (2026-10-25)',
      '**Did:** Fixed the loop',
      '**Check:** Log in twice',
      '**Changed:** auth.ts',
      '**Need from you:** Approve',
      '',
    ].join('\n'),
  )
  expect(
    parseSections(
      parseCardFile('0001-a.md', files[path(1, 'a')] ?? '')?.body ?? '',
    ).sections,
  ).toMatchObject([
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
  expect(await moveToHuman($)).toMatchObject({ result: 'Moved #1 to Human.' })
})

test('a handoff without the optional fields leaves them empty', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('', 'claude') }
  boot(on, files)

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    check: ' Run it ',
    need: 'A look',
  })

  expect(files[path(1, 'a')]).toContain(
    [
      '## Handoff (2026-10-25)',
      '**Did:**',
      '**Check:** Run it',
      '**Changed:**',
      '**Need from you:** A look',
      '',
    ].join('\n'),
  )
})

test('kanban_handoff refuses a placeholder, a bad field and an unknown card', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.') }
  boot(on, files)
  const before = files[path(1, 'a')]
  const handoff = (fields: Record<string, unknown>) =>
    $.tool.call({ tool: tool('kanban_handoff'), card: 1, ...fields })

  expect(await handoff({ check: 'N/A', need: 'Approve' })).toMatchObject({
    deny: expect.stringContaining('real check'),
  })
  expect(await handoff({ check: 'Run it', need: ' ' })).toMatchObject({
    deny: expect.stringContaining('real check'),
  })
  expect(await handoff({ check: 'Run it' })).toMatchObject({
    deny: expect.stringContaining('real check'),
  })
  expect(await handoff({ check: 7, need: 'Approve' })).toMatchObject({
    deny: 'check must be text.',
  })
  expect(await handoff({ check: 'Run it', need: 'x', did: 3 })).toMatchObject({
    deny: 'did must be text.',
  })
  expect(
    await handoff({ card: 9, check: 'Run it', need: 'Approve' }),
  ).toMatchObject({ deny: 'There is no kanban card #9.' })
  expect(
    await handoff({ card: 1.5, check: 'Run it', need: 'Approve' }),
  ).toMatchObject({ deny: 'card must be a whole number.' })
  expect(files[path(1, 'a')]).toBe(before)
})

test('a handoff that cannot be written says why', async ($, on) => {
  const { calls } = boot(on, { [path(1, 'a')]: withBody('The spec.') })
  await $.tool.call({ tool: tool('kanban_list') })

  calls.denyWrite = 'EACCES: read-only'
  const refused = await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    check: 'Run it',
    need: 'Approve',
  })

  expect(refused).toMatchObject({
    deny: expect.stringContaining('EACCES: read-only'),
  })
})

test('kanban_handoff shows in a detail view that is open on the card', async ($, on) => {
  const { clock } = boot(on, { [path(1, 'a')]: withBody('The spec.') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'card:md:0001-a' })
  expect(await ui.find({ key: 'section:0' })).toBeUndefined()

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    check: 'Run it',
    need: 'Approve',
  })
  await clock.settle()

  expect((await ui.find({ key: 'section:0' }))?.text).toContain(
    'Handoff (2026-10-25)',
  )
  await ui.unmount()
})

test('kanban_show gives the spec, then each section, newest last', async ($, on) => {
  boot(on, {
    [path(1, 'a')]: withBody(`The spec.\n\n${HANDOFF}\n\n${FEEDBACK}`),
    [path(2, 'b')]: card(2, { title: 'Empty one' }, ''),
  })

  const shown = await $.tool.call({ tool: tool('kanban_show'), card: 1 })
  const empty = await $.tool.call({ tool: tool('kanban_show'), card: 2 })

  expect(shown).toMatchObject({
    result: [
      '#1 [claude] Fix login updated 2026-10-25',
      'The spec.',
      `## Handoff (2026-10-24)\n${HANDOFF.split('\n').slice(1).join('\n')}`,
      '## Feedback (2026-10-25)\nAlso handle expiry.',
    ].join('\n\n'),
  })
  expect(empty).toMatchObject({
    result: '#2 [backlog] Empty one updated 2026-10-25\n\n(no description)',
  })
})

test('kanban_show refuses an unknown card and a bad number', async ($, on) => {
  boot(on, { [path(1, 'a')]: withBody('The spec.') })

  expect(
    await $.tool.call({ tool: tool('kanban_show'), card: 9 }),
  ).toMatchObject({ deny: 'There is no kanban card #9.' })
  expect(
    await $.tool.call({ tool: tool('kanban_show'), card: 'one' }),
  ).toMatchObject({ deny: 'card must be a whole number.' })
})

test('kanban_create makes the next numbered card, shown on the board at once', async ($, on) => {
  const files = {
    [path(3, 'c')]: card(3, { status: 'claude', order: 4 }),
    [path(7, 'g')]: card(7, { status: 'backlog', order: 7 }),
  }
  boot(on, files)

  const made = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'Fix login: redirect loop',
    spec: 'Users loop after login.\n\n- repro',
    column: 'claude',
  })

  expect(made).toMatchObject({
    result:
      'Created #8 [claude] Fix login: redirect loop in .kanban/0008-fix-login-redirect-loop.md.',
  })
  const file = files[path(8, 'fix-login-redirect-loop')] ?? ''
  expect(file).toBe(
    [
      '---',
      'id: 8',
      'title: Fix login: redirect loop',
      'status: claude',
      'order: 5',
      `created: ${new Date(NOW).toISOString()}`,
      `updated: ${new Date(NOW).toISOString()}`,
      '---',
      'Users loop after login.\n\n- repro\n',
    ].join('\n'),
  )
  expect(
    await $.tool.call({ tool: tool('kanban_list'), column: 'claude' }),
  ).toMatchObject({ result: expect.stringContaining('#8 [claude] Fix login') })
})

test('kanban_create puts a card in Backlog unless told otherwise, and numbers from 1', async ($, on) => {
  const files: Record<string, string> = {}
  boot(on, files)

  const made = await $.tool.call({
    tool: tool('kanban_create'),
    title: '  日本語 \n title  ',
    spec: '',
  })

  expect(made).toMatchObject({
    result: 'Created #1 [backlog] 日本語 title in .kanban/0001-title.md.',
  })
  expect(files[path(1, 'title')]).toContain('title: 日本語 title\n')
  const only = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'ไทย',
    spec: 'x',
  })
  expect(only).toMatchObject({
    result: expect.stringContaining('.kanban/0002-card.md'),
  })
})

test('two cards created at once get different numbers and neither is lost', async ($, on) => {
  const files: Record<string, string> = {}
  boot(on, files)

  const [first, second] = await Promise.all([
    $.tool.call({ tool: tool('kanban_create'), title: 'One', spec: 'a' }),
    $.tool.call({ tool: tool('kanban_create'), title: 'Two', spec: 'b' }),
  ])

  expect(first).toMatchObject({ result: expect.stringContaining('Created #1') })
  expect(second).toMatchObject({
    result: expect.stringContaining('Created #2'),
  })
  expect(Object.keys(files).sort()).toEqual([path(1, 'one'), path(2, 'two')])
})

test('kanban_create refuses a bad title, a bad column and a start in Human', async ($, on) => {
  const files: Record<string, string> = {}
  boot(on, files)
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
  expect(files).toEqual({})
})

test('kanban_create that cannot write says why', async ($, on) => {
  const { calls } = boot(on, {})
  calls.denyWrite = 'EACCES: read-only'

  const refused = await $.tool.call({
    tool: tool('kanban_create'),
    title: 'T',
    spec: 's',
  })

  expect(refused).toMatchObject({
    deny: expect.stringMatching(/^Could not create the card: .*EACCES/),
  })
})

test('on a GitHub board kanban_create points to the /issue skill', async () => {
  const github: KanbanBackendInfo = {
    kind: 'github',
    repo: 'o/r',
    owner: 'o',
    projectNumber: 1,
    projectId: 'PVT_x',
    statusFieldId: 'PVTSSF_x',
    options: { backlog: 'a', inProgress: 'b', inReview: 'c', done: 'd' },
  }

  await expect(
    createCard({} as EngineInterface, github, 'T', 's', 'backlog'),
  ).rejects.toThrow('/issue skill')
})

test('every tool works with the pane closed', async ($, on) => {
  boot(on, { [path(1, 'a')]: withBody(`The spec.\n\n${HANDOFF}`) })

  const answers = [
    await $.tool.call({ tool: tool('kanban_list') }),
    await $.tool.call({ tool: tool('kanban_show'), card: 1 }),
    await $.tool.call({
      tool: tool('kanban_handoff'),
      card: 1,
      check: 'Run it',
      need: 'Approve',
    }),
    await moveToHuman($),
    await $.tool.call({ tool: tool('kanban_create'), title: 'T', spec: 's' }),
  ]

  for (const answer of answers) expect(answer).toHaveProperty('result')
})

test('unknown frontmatter keys survive a rewrite', () => {
  const text = [
    '---',
    'id: 1',
    'title: T',
    'status: claude',
    'order: 1',
    'created: 2026-10-25T10:00:00Z',
    'updated: 2026-10-25T11:00:00Z',
    'labels:',
    '  - ui',
    '  - api',
    'github:',
    '  id: 99',
    '  status: open',
    '# keep this note',
    'owner: teerat',
    '---',
    'Body',
    '',
  ].join('\n')

  const parsed = parseCardFile('0001-t.md', text)

  expect(parsed?.card).toMatchObject({ number: 1, column: 'claude' })
  expect(parsed?.extras).toEqual([
    'labels:',
    '  - ui',
    '  - api',
    'github:',
    '  id: 99',
    '  status: open',
    '# keep this note',
    'owner: teerat',
  ])
  expect(
    serializeCardFile(
      { ...(parsed?.card ?? ({} as never)), column: 'done' },
      parsed?.body ?? '',
      parsed?.extras,
    ),
  ).toBe(text.replace('status: claude', 'status: done'))
})

test('moving a card and recording a handoff keep the frontmatter keys they do not own', async ($, on) => {
  const extras = ['labels:', '  - ui', 'owner: teerat']
  const lines = withBody('The spec.').split('\n')
  lines.splice(lines.indexOf('---', 1), 0, ...extras)
  const files = { [path(1, 'a')]: lines.join('\n') }
  boot(on, files)

  await $.tool.call({
    tool: tool('kanban_handoff'),
    card: 1,
    check: 'Run it',
    need: 'Approve',
  })
  await moveToHuman($)

  const rewritten = files[path(1, 'a')] ?? ''
  expect(rewritten).toContain(
    `updated: 2026-10-25T11:00:00Z`.replace('11:00:00Z', '12:00:00.000Z'),
  )
  expect(rewritten).toContain(`${extras.join('\n')}\n---\n`)
  expect(rewritten).toContain('status: human')
  expect(rewritten).toContain('## Handoff (2026-10-25)')
})

const GUARD_DENY = { deny: expect.stringContaining('kanban_handoff') }
const write = ($: Engine, file: string, content: string) =>
  $.tool.call({ tool: 'Write', file_path: `/work/${file}`, content })
const edit = (
  $: Engine,
  file: string,
  old_string: string,
  new_string: string,
  extra: { replace_all?: boolean } = {},
) =>
  $.tool.call({
    tool: 'Edit',
    file_path: `/work/${file}`,
    old_string,
    new_string,
    ...extra,
  })

test('a Write that sets a card to Human without a valid handoff is denied', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.') }
  boot(on, files)
  const before = files[path(1, 'a')]

  const denied = await write($, path(1, 'a'), withBody('The spec.', 'human'))
  const fresh = await write($, path(2, 'b'), card(2, { status: 'human' }))
  const stale = await write(
    $,
    path(1, 'a'),
    withBody(`The spec.\n\n${HANDOFF}\n\n${FEEDBACK}`, 'human'),
  )

  expect(denied).toMatchObject(GUARD_DENY)
  expect(fresh).toMatchObject(GUARD_DENY)
  expect(stale).toMatchObject(GUARD_DENY)
  expect(files[path(1, 'a')]).toBe(before)
})

test('a Write that sets Human with a valid handoff in it goes through', async ($, on) => {
  boot(on, { [path(1, 'a')]: withBody('The spec.') })

  const allowed = await write(
    $,
    path(1, 'a'),
    withBody(`The spec.\n\n${HANDOFF}`, 'human'),
  )

  expect(allowed).not.toHaveProperty('deny')
})

test('a card already in Human can be rewritten without a handoff', async ($, on) => {
  boot(on, { [path(1, 'a')]: withBody('The spec.', 'human') })

  const rewritten = await write($, path(1, 'a'), withBody('New.', 'human'))

  expect(rewritten).not.toHaveProperty('deny')
})

test('a Write that leaves the card out of Human is never blocked', async ($, on) => {
  const { clock } = boot(on, { [path(1, 'a')]: withBody('The spec.') })

  for (const status of ['claude', 'backlog', 'done']) {
    expect(
      await write($, path(1, 'a'), withBody('New spec.', status)),
    ).not.toHaveProperty('deny')
  }
  expect(
    await write($, 'README.md', withBody('x', 'human')),
  ).not.toHaveProperty('deny')
  expect(
    await write($, '.kanban/notes.md', '---\nstatus: human\n---\nx'),
  ).not.toHaveProperty('deny')
  expect(
    await write($, '.kanban/readme.md', '# not a card\nstatus: human'),
  ).not.toHaveProperty('deny')
  await clock.settle()
})

test('an Edit that sets a card to Human without a handoff is denied', async ($, on) => {
  const files = { [path(1, 'a')]: withBody('The spec.') }
  boot(on, files)

  const denied = await edit($, path(1, 'a'), 'status: claude', 'status: human')
  const all = await edit($, path(1, 'a'), 'claude', 'human', {
    replace_all: true,
  })

  expect(denied).toMatchObject(GUARD_DENY)
  expect(all).toMatchObject(GUARD_DENY)
  expect(files[path(1, 'a')]).toContain('status: claude')
})

test('an Edit with a valid handoff in place, or one that is not about status, goes through', async ($, on) => {
  const { clock } = boot(on, {
    [path(1, 'a')]: withBody(`The spec.\n\n${HANDOFF}`),
    [path(2, 'b')]: card(2, { status: 'claude' }),
    [path(3, 'c')]: card(3, { status: 'human' }),
  })

  expect(
    await edit($, path(1, 'a'), 'status: claude', 'status: human'),
  ).not.toHaveProperty('deny')
  expect(
    await edit($, path(2, 'b'), 'Spec text.', 'Better text.'),
  ).not.toHaveProperty('deny')
  expect(
    await edit($, path(2, 'b'), 'not in the file', 'status: human'),
  ).not.toHaveProperty('deny')
  expect(
    await edit($, path(3, 'c'), 'Spec text.', 'Better text.'),
  ).not.toHaveProperty('deny')
  expect(
    await edit($, path(9, 'gone'), 'status: claude', 'status: human'),
  ).not.toHaveProperty('deny')
  await clock.settle()
})

test('a guard that breaks lets the edit through', async ($, on) => {
  const { calls } = boot(on, { [path(1, 'a')]: withBody('The spec.') })
  calls.denyRead = 'EIO: disk error'

  const edited = await edit($, path(1, 'a'), 'status: claude', 'status: human')
  const written = await write($, path(1, 'a'), withBody('x', 'human'))

  expect(edited).not.toHaveProperty('deny')
  expect(written).not.toHaveProperty('deny')
})

test('a card file that Claude writes still reloads the board', async ($, on) => {
  const { clock, calls } = boot(on, { [path(1, 'a')]: withBody('The spec.') })
  await $.tool.call({ tool: tool('kanban_list') })
  const before = calls.lists

  await write($, path(1, 'a'), withBody('New spec.', 'backlog'))
  await clock.settle()

  expect(calls.lists).toBe(before + 1)
})

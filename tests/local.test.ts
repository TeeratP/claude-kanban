import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { KanbanCard } from '../types'
import { parseSections } from '../hooks/handoff'
import { appendLocal, parseCardFile, serializeCardFile } from '../hooks/local'
import { NOW, boot, card, path } from './fakes'

const CARD: KanbanCard = {
  id: 'md:0007-fix-login',
  number: 7,
  title: 'Fix login: redirect loop',
  column: 'claude',
  order: 3,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  file: '.kanban/0007-fix-login.md',
}

test('a card file survives a round trip, colon in the title and all', () => {
  const text = serializeCardFile(CARD, 'The spec.\n\n- one\n- two')
  const parsed = parseCardFile('0007-fix-login.md', text)

  expect(text.split('\n').slice(0, 8)).toEqual([
    '---',
    'id: 7',
    'title: Fix login: redirect loop',
    'status: claude',
    'order: 3',
    'created: 2026-10-25T10:00:00Z',
    'updated: 2026-10-25T12:00:00Z',
    '---',
  ])
  expect(parsed).toEqual({ card: CARD, body: 'The spec.\n\n- one\n- two' })
})

test('a title that looks quoted or is padded is quoted and read back whole', () => {
  for (const title of ['"Quoted"', ' padded ', "'single'"]) {
    const text = serializeCardFile({ ...CARD, title }, '')

    expect(parseCardFile('0007-fix-login.md', text)?.card.title).toBe(title)
  }
  expect(serializeCardFile({ ...CARD, title: 'a\nb' }, '')).toContain(
    'title: a b\n',
  )
})

test('quotes around a title are stripped on reading', () => {
  const text = '---\nid: 1\ntitle: "Hello, world"\nstatus: backlog\n---\nbody\n'

  expect(parseCardFile('0001-x.md', text)?.card.title).toBe('Hello, world')
})

test('an unknown status lands in Backlog', () => {
  const text = '---\nid: 2\ntitle: T\nstatus: someday\n---\n'

  expect(parseCardFile('0002-t.md', text)?.card.column).toBe('backlog')
})

test('a card without an id takes its number from the file name', () => {
  const text = '---\ntitle: T\nstatus: human\n---\nbody'
  const parsed = parseCardFile('0042-t.md', text)

  expect(parsed?.card.number).toBe(42)
  expect(parsed?.card.order).toBe(42)
  expect(parsed?.card.id).toBe('md:0042-t')
})

test('a file without frontmatter or an id is not a card', () => {
  expect(parseCardFile('README.md', '# Notes\n')).toBeNull()
  expect(parseCardFile('notes.md', '---\ntitle: T\n---\n')).toBeNull()
  expect(
    parseCardFile('0001-x.md', '---\nid: 1\ntitle: never closed\n'),
  ).toBeNull()
})

test('windows line endings parse like unix ones', () => {
  const text = '---\r\nid: 5\r\ntitle: T\r\nstatus: done\r\n---\r\nbody\r\n'
  const parsed = parseCardFile('0005-t.md', text)

  expect(parsed?.card.column).toBe('done')
  expect(parsed?.body).toBe('body')
})

test('sections split into the spec, handoffs with fields, and feedback', () => {
  const { body, sections } = parseSections(
    [
      'The spec.',
      '',
      '## Handoff (2026-10-25)',
      '**Did:** Fixed the loop',
      'in two files.',
      '**Check:** Log in twice',
      '**Changed:** auth.ts',
      '**Need from you:** Approve',
      '',
      '## Feedback (2026-10-26)',
      'Also handle expiry.',
    ].join('\n'),
  )

  expect(body).toBe('The spec.')
  expect(sections).toEqual([
    {
      kind: 'handoff',
      date: '2026-10-25',
      text: expect.any(String),
      fields: {
        did: 'Fixed the loop\nin two files.',
        check: 'Log in twice',
        changed: 'auth.ts',
        need: 'Approve',
      },
    },
    { kind: 'feedback', date: '2026-10-26', text: 'Also handle expiry.' },
  ])
})

test('append adds a section after the spec and keeps the frontmatter', async () => {
  const files: Record<string, string> = {
    [CARD.file ?? '']: card(7, { title: 'Hi' }),
  }
  const fake = {
    fs: {
      read: async (file: string) => files[file] ?? '',
      write: async (file: string, text: string) => {
        files[file] = text
      },
    },
  } as unknown as EngineInterface

  await appendLocal(fake, CARD, '## Feedback (2026-10-26)\nMore please.')

  const parsed = parseCardFile(
    '0007-fix-login.md',
    files[CARD.file ?? ''] ?? '',
  )
  expect(parsed?.card.title).toBe('Hi')
  expect(parsed?.body).toBe(
    'Spec text.\n\n## Feedback (2026-10-26)\nMore please.',
  )
})

test('moving a card rewrites status, updated and order, and keeps the body', async ($, on) => {
  const files = {
    [path(1, 'a')]: card(1, { status: 'human' }),
    [path(2, 'b')]: card(
      2,
      { status: 'claude', order: 5 },
      'Body line\n\n## Feedback (2026-10-24)\nOld.',
    ),
    [path(3, 'c')]: card(3, { status: 'backlog' }),
  }
  const { clock } = boot(on, files)

  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 3,
    to: 'claude',
  })
  await clock.advance(300)

  expect(moved).toMatchObject({ result: 'Moved #3 to Claude (syncing).' })
  const parsed = parseCardFile('0003-c.md', files[path(3, 'c')] ?? '')
  expect(parsed?.card.column).toBe('claude')
  expect(parsed?.card.order).toBe(6)
  expect(parsed?.card.updatedAt).toBe(new Date(NOW + 300).toISOString())
  expect(parsed?.card.createdAt).toBe('2026-10-25T10:00:00Z')
  expect(parsed?.body).toBe('Spec text.')
  expect(files[path(2, 'b')]).toContain('Old.')
})

test('a move the backend refuses is answered at once and writes nothing', async ($, on) => {
  const files = { [path(1, 'a')]: card(1, { status: 'human' }) }
  const before = files[path(1, 'a')]
  const { clock, calls } = boot(on, files)
  await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  calls.denyWrite = 'EACCES: read-only'
  const moved = await $.tool.call({
    tool: 'mcp__kanban__kanban_move',
    card: 1,
    to: 'done',
  })
  await clock.advance(300)
  const after = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(moved).toMatchObject({ result: 'Moved #1 to Done (syncing).' })
  expect(files[path(1, 'a')]).toBe(before)
  expect(after).toMatchObject({ result: expect.stringContaining('#1 [done]') })
})

test('a board that cannot be read is an error to the tool, not an empty list', async ($, on) => {
  const { calls } = boot(on, { [path(1, 'a')]: card(1) })
  calls.denyRead = 'EIO: disk error'

  const listed = await $.tool.call({ tool: 'mcp__kanban__kanban_list' })

  expect(listed).toMatchObject({
    deny: expect.stringContaining('EIO: disk error'),
  })
})

import { expect, test } from 'claude-code/testing'

import { detectBackend } from '../hooks/backend'
import { importsOf, readConfigText } from '../hooks/config'
import { LOTTO, NAE, PUNN_AGENTS, PUNN_CLAUDE } from './configs'
import { fakeEngine } from './fake-gh'
import type { Route } from './fake-gh'
import { GH_VERSION, graphql, lines } from './zero'

const SIGNED_IN: Route = { match: ['gh', 'auth', 'status'], reply: {} }
const REMOTE: Route = {
  match: ['git', 'remote', 'get-url', 'origin'],
  reply: { stdout: 'git@github.com:TeeratP/attend-baby.git' },
}
const ROUTES = [SIGNED_IN, REMOTE]

const FIELDS = JSON.stringify({
  fields: [
    {
      id: 'PVTSSF_listed',
      name: 'Status',
      options: [
        { id: 'l-backlog', name: 'Backlog' },
        { id: 'l-ready', name: 'Ready' },
        { id: 'l-progress', name: 'In progress' },
        { id: 'l-review', name: 'In review' },
        { id: 'l-done', name: 'Done' },
      ],
    },
  ],
})

const PUNN_OPTIONS = {
  backlog: 'f75ad846',
  ready: '61e4505c',
  inProgress: '47fc9ee4',
  inReview: 'df73e18b',
  done: '98236657',
}

test('importsOf finds @path lines, relative to the file that has them', () => {
  expect(importsOf('CLAUDE.md', '# Title\n\n@AGENTS.md\n')).toEqual([
    'AGENTS.md',
  ])
  expect(
    importsOf('CLAUDE.md', 'See @docs/board.md, and @./notes/a.md.\n'),
  ).toEqual(['docs/board.md', 'notes/a.md'])
  expect(importsOf('.claude/CLAUDE.md', '@../AGENTS.md\n@rules.md')).toEqual([
    'AGENTS.md',
    '.claude/rules.md',
  ])
  expect(importsOf('CLAUDE.md', '@AGENTS.md\n@AGENTS.md')).toEqual([
    'AGENTS.md',
  ])
})

test('importsOf leaves out paths that leave the project and things that are not files', () => {
  const text = [
    '@../outside.md',
    '@docs/../../outside.md',
    '@/etc/board.md',
    '@~/notes.md',
    '@C:\\board.md',
    '@https://example.com/board.md',
    '@docs/',
    'Ask @TeeratP or mail a@b.com about it.',
    'Board "@TeeratP\'s Kanban" is shared.',
  ].join('\n')

  expect(importsOf('CLAUDE.md', text)).toEqual([])
  expect(importsOf('.claude/CLAUDE.md', '@../../outside.md')).toEqual([])
})

test('importsOf ignores @path in code, as Claude Code does', () => {
  const text = [
    'Use `@legacy.md` sparingly.',
    '```',
    '@fenced.md',
    '```',
    '~~~sh',
    '@tilde.md',
    '~~~',
    '@real.md',
  ].join('\n')

  expect(importsOf('CLAUDE.md', text)).toEqual(['real.md'])
})

test('detect follows the CLAUDE.md import to AGENTS.md (punn) and needs no gh lookups', async () => {
  const { $, calls } = fakeEngine(ROUTES, {
    'CLAUDE.md': PUNN_CLAUDE,
    'AGENTS.md': PUNN_AGENTS,
  })

  expect(await detectBackend($)).toEqual({
    kind: 'github',
    repo: 'TeeratP/attend-baby',
    owner: 'TeeratP',
    projectNumber: 2,
    projectId: 'PVT_kwHOAcCsLc4Bbjg2',
    statusFieldId: 'PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY',
    options: PUNN_OPTIONS,
  })
  expect(calls.map(call => call.argv.slice(0, 3))).toEqual([
    ['gh', 'auth', 'status'],
    ['git', 'remote', 'get-url'],
  ])
})

test('detect reads AGENTS.md even when no CLAUDE.md imports it', async () => {
  const { $ } = fakeEngine(ROUTES, { 'AGENTS.md': LOTTO })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/thai-lotto',
    projectNumber: 2,
    options: PUNN_OPTIONS,
  })
})

test('detect follows an import to any project file', async () => {
  const { $ } = fakeEngine(ROUTES, {
    'CLAUDE.md': '# Rules\n\nThe board is in @docs/board.md.\n',
    'docs/board.md': PUNN_AGENTS,
  })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/attend-baby',
  })
})

test('detect resolves an import in .claude/CLAUDE.md against that folder', async () => {
  const { $ } = fakeEngine(ROUTES, {
    '.claude/CLAUDE.md': '@board.md\n',
    '.claude/board.md': LOTTO,
  })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/thai-lotto',
  })
})

test('detect fills the ids a file leaves out from gh (nae lists only Ready)', async () => {
  const { $, calls } = fakeEngine(
    [
      ...ROUTES,
      { match: ['gh', 'project', 'field-list'], reply: { stdout: FIELDS } },
    ],
    { 'CLAUDE.md': NAE },
  )

  expect(await detectBackend($)).toEqual({
    kind: 'github',
    repo: 'TeeratP/nae',
    owner: 'TeeratP',
    projectNumber: 2,
    projectId: 'PVT_kwHOAcCsLc4Bbjg2',
    statusFieldId: 'PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY',
    options: {
      backlog: 'l-backlog',
      ready: '61e4505c',
      inProgress: 'l-progress',
      inReview: 'l-review',
      done: 'l-done',
    },
  })
  expect(calls.map(call => call.argv.slice(0, 3))).toContainEqual([
    'gh',
    'project',
    'field-list',
  ])
  expect(calls.map(call => call.argv.slice(0, 3))).not.toContainEqual([
    'gh',
    'project',
    'view',
  ])
})

test('detect ignores an import outside the project, and never asks the file system about it', async () => {
  const { $, fsCalls } = fakeEngine(ROUTES, {
    'CLAUDE.md': '@../board.md\n@/etc/board.md\n@~/board.md\n',
    '../board.md': PUNN_AGENTS,
    '/etc/board.md': PUNN_AGENTS,
    '~/board.md': PUNN_AGENTS,
  })

  expect(await detectBackend($)).toEqual({ kind: 'local' })
  expect(fsCalls.reads).toEqual(['CLAUDE.md'])
  expect(fsCalls.exists).toEqual([
    'CLAUDE.md',
    '.claude/CLAUDE.md',
    'AGENTS.md',
  ])
})

test('detect with imports that point at each other reads each file once', async () => {
  const { $, fsCalls } = fakeEngine(ROUTES, {
    'CLAUDE.md': '@AGENTS.md\n',
    'AGENTS.md': `@CLAUDE.md\n@AGENTS.md\n${LOTTO}`,
  })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/thai-lotto',
  })
  expect(fsCalls.reads).toEqual(['CLAUDE.md', 'AGENTS.md'])
})

test('detect follows imports one level deep', async () => {
  const { $, fsCalls } = fakeEngine(ROUTES, {
    'CLAUDE.md': '@a.md\n',
    'a.md': '@b.md\n',
    'b.md': LOTTO,
  })

  expect(await detectBackend($)).toEqual({ kind: 'local' })
  expect(fsCalls.reads).toEqual(['CLAUDE.md', 'a.md'])
})

test('a file that lists many imports reads only the first few', async () => {
  const imports = Array.from({ length: 30 }, (_, n) => `@docs/${n}.md`)
  const files = Object.fromEntries(
    imports.map((_, n) => [`docs/${n}.md`, `Note ${n}`]),
  )
  const { $, fsCalls } = fakeEngine(ROUTES, {
    'CLAUDE.md': imports.join('\n'),
    ...files,
  })

  await readConfigText($)

  expect(fsCalls.reads).toEqual([
    'CLAUDE.md',
    ...Array.from({ length: 8 }, (_, n) => `docs/${n}.md`),
  ])
})

test('the gathered text is capped, and config past the cap is not seen', async () => {
  const { $ } = fakeEngine(ROUTES, {
    'CLAUDE.md': `${'x'.repeat(1_200_000)}\n${LOTTO}`,
  })

  expect((await readConfigText($)).length).toBe(1_000_000)
  expect(await detectBackend($)).toEqual({ kind: 'local' })
})

test('a file that cannot be read is skipped, logged, and the rest still count', async () => {
  const { $, logs } = fakeEngine(ROUTES, {
    // Listed but not readable: exists answers yes, read fails.
    'CLAUDE.md': undefined as unknown as string,
    'AGENTS.md': LOTTO,
  })

  expect(await detectBackend($)).toMatchObject({
    kind: 'github',
    repo: 'TeeratP/thai-lotto',
  })
  expect(logs).toEqual([
    'kanban: could not read CLAUDE.md for the board config: ENOENT: CLAUDE.md',
  ])
})

test('auto marks a local fallback when a board is mentioned but cannot be read and none is found, and logs why', async () => {
  const { $, logs, calls } = fakeEngine([...ROUTES, GH_VERSION, graphql()], {
    'AGENTS.md':
      'Board id: `PVT_kwHOAcCsLc4Bbjg2`, number written down elsewhere.',
  })

  expect(await detectBackend($, 'auto')).toEqual({
    kind: 'local',
    isConfigUnclear: true,
  })
  expect(logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: CLAUDE.md or AGENTS.md mentions a project board, but no Repo and Project number could be read from it',
  ])
  // The config gave nothing to go on, so only the search for a board ran.
  expect(lines(calls)).toEqual([
    'git remote get-url origin',
    'gh --version',
    'gh auth status',
    'gh api graphql -f query=… -f o=TeeratP -f n=attend-baby',
    'gh api graphql -f query=… -f o=TeeratP',
  ])
})

test('auto does not mark a local fallback that mentions no board, or one gh refused', async () => {
  const plain = fakeEngine([...ROUTES, GH_VERSION, graphql()], {
    'CLAUDE.md': '# Notes\n\nA job board app.\n',
  })
  const refused = fakeEngine(
    [
      {
        match: ['gh', 'auth', 'status'],
        reply: { exitCode: 1, stderr: 'not logged in' },
      },
      REMOTE,
    ],
    { 'AGENTS.md': LOTTO },
  )

  expect(await detectBackend(plain.$, 'auto')).toEqual({
    kind: 'local',
    noBoardFor: 'TeeratP/attend-baby',
  })
  expect(plain.logs).toEqual([])
  expect(await detectBackend(refused.$, 'auto')).toEqual({ kind: 'local' })
  expect(refused.logs).toEqual([
    'kanban: using local cards, GitHub is not usable here: not logged in',
  ])
})

test('github mode with a board it cannot read looks for one itself, and says what the files need when none is linked', async () => {
  const { $ } = fakeEngine([...ROUTES, GH_VERSION, graphql()], {
    'AGENTS.md': 'Board id: `PVT_kwHOAcCsLc4Bbjg2`',
  })

  await expect(detectBackend($, 'github')).rejects.toThrow(
    'add Repo and Project board lines to CLAUDE.md or AGENTS.md',
  )
})

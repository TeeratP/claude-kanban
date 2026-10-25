import { expect, test } from 'claude-code/testing'

import { click } from './board-ui'
import { fakeProcess } from './fake-gh'
import type { Route } from './fake-gh'
import { PANE, RUN, boot } from './fakes'

const REPO = 'TeeratP/claude-kanban'

const CLAUDE_MD = [
  '## Task tracking',
  `- Repo: \`${REPO}\` (public).`,
  '- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).',
  '- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.',
].join('\n')

const HANDOFF = [
  '## Handoff (2026-10-25)',
  '**Did:** Wrote the docs',
  '**Check:** Run `npm test`',
  '**Changed:** README.md',
  '**Need from you:** Approve',
].join('\n')

// How the board and the issue are read is the GitHub backend's; this file is about the Check block.
const GITHUB: Route[] = [
  { match: ['gh', 'auth', 'status'], reply: {} },
  {
    match: ['git', 'remote', 'get-url', 'origin'],
    reply: { stdout: 'git@github.com:TeeratP/claude-kanban.git' },
  },
  {
    match: ['gh', 'project', 'item-list'],
    reply: {
      stdout: JSON.stringify({
        items: [
          {
            id: 'PVTI_1',
            title: 'Item 1',
            status: 'Human',
            content: {
              type: 'Issue',
              number: 1,
              title: 'Remote 1',
              url: `https://github.com/${REPO}/issues/1`,
              repository: REPO,
            },
          },
        ],
      }),
    },
  },
  {
    match: ['gh', 'issue', 'list'],
    reply: {
      stdout: JSON.stringify([
        {
          number: 1,
          state: 'OPEN',
          labels: [{ id: 'L_ai', name: 'ai', color: 'fff' }],
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-02T10:00:00Z',
          closedByPullRequestsReferences: [],
        },
      ]),
    },
  },
  {
    match: ['gh', 'issue', 'view'],
    reply: {
      stdout: JSON.stringify({
        body: 'Spec text.',
        comments: [{ body: HANDOFF, createdAt: '2026-10-25T10:00:00Z' }],
        url: `https://github.com/${REPO}/issues/1`,
        state: 'OPEN',
      }),
    },
  },
  { match: ['gh', 'issue', 'comment'], reply: {} },
  { match: ['sh', '-c'], reply: { stdout: 'ok 1\nok 2\n' } },
]

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`on GitHub a run is posted as a comment only when Attach to card is pressed on the ${surface}`, async ($, on) => {
    const world = boot(on, { 'CLAUDE.md': CLAUDE_MD })
    const commands = fakeProcess(on, GITHUB)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ ...RUN })
    await world.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface })
    await click(ui, 'card:gh:1')

    expect((await ui.find({ key: 'check:run:0' }))?.props.label).toBe(
      'Run check: npm test',
    )
    await ui.press({ key: 'check:run:0' })
    await world.clock.advance(0)
    await world.clock.advance(60_000)

    const posts = () =>
      commands.filter(
        one => one.argv.slice(0, 3).join(' ') === 'gh issue comment',
      )
    expect(commands.filter(one => one.argv[0] === 'sh')).toEqual([
      { argv: ['sh', '-c', 'npm test'] },
    ])
    expect(
      await ui.find({ type: 'Text', text: /^✓ Passed · exit 0 · / }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /^✓ Saved on the card$/ }),
    ).toBeUndefined()
    expect(posts()).toEqual([])
    expect((await ui.find({ key: 'check:attach' }))?.props.label).toBe(
      'Attach to card',
    )

    await ui.press({ key: 'check:attach' })

    expect(posts()).toHaveLength(1)
    expect(posts()[0]?.argv).toEqual([
      'gh',
      'issue',
      'comment',
      '1',
      '--repo',
      REPO,
      '--body-file',
      '-',
    ])
    expect(posts()[0]?.stdin?.split('\n').slice(0, 5)).toEqual([
      '## Check run (2026-10-25)',
      '**Command:**',
      '```sh',
      'npm test',
      '```',
    ])
    expect(posts()[0]?.stdin).toContain('**Output:**\n```\nok 1\nok 2\n```')
    expect(
      await ui.find({ type: 'Text', text: /^✓ Saved on the card$/ }),
    ).toBeDefined()
    expect(await ui.find({ key: 'check:attach' })).toBeUndefined()
    await ui.unmount()
  })
}

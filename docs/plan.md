# Kanban mod — implementation plan (Opus-authored, approved by orchestrator)

## Orchestrator decisions on the plan's open points
- In progress without `ai` label → Claude column (accepted).
- Moving to Human uses Status=In review (no label churn); moving to Claude adds `ai`, removes `human` if present (accepted).
- Phase 4 (Client drag) IS in scope — the user asked for drag. Do it after phases 1–3 are green. If wheel-over-Client breaks per-section scroll, keep Client only for the card rows and verify scroll still works; if a hard API blocker appears, stop and report instead of hacking around it.
- `kanban_create` tool: include (local backend creates file; GitHub backend uses `gh issue create` with `--label triage`, then adds it to the board in Backlog — decision 66, #23).
- Never run mutating `gh` commands against real repos while developing. Read-only `gh` (auth status, `gh issue list --json` field discovery, `gh project field-list`) is fine. All mutation paths are covered by tests with fakes.

All `d.ts:NNNN` refer to `/private/tmp/claude-501/bundled-skills/2.1.310/75928e3c9b934bca99fa180c48df41c0/plugin-authoring/types/claude-code.d.ts`. Mod folder: `/Users/teeratp/.claude/dev-mods/399de62a-c3ce-57f0-92a6-1f6601ddec6b/kanban/`.

## 0. Constraints found in this build, with fallbacks

| Design item | Verdict | Fallback / decision |
|---|---|---|
| Per-section wheel scroll | Feasible. `ui.scroll` fires on a Pane body "at its edges too" (d.ts:4170-4179); `e.pointer.row` = body row under wheel (UiScrollPointer d.ts:15341); answering `{}` without `next` keeps the engine's window still (d.ts:4174). | Keyboard scroll has no `pointer` → pass to `next(e)`. Hit-testing is cell-exact only on terminal; on desktop/vscode a Button row may be taller than one cell, so clickable `↑/↓ N more` rows are the reliable path there. |
| Drag & drop | Possible, but not v1. Needs a `Client` surface module (ClientProps d.ts:1535, ClientSurface d.ts:1586, `onPointer` d.ts:1626, pointer capture d.ts:1480-1486, `post` d.ts:1640 → `ui.message` d.ts:4153 / UiMessageArgument d.ts:14973). `Client` exists only on terminal and desktop (Elements d.ts:3926-3975). Inside a Client, Buttons lose the pane's Tab/hotkey model unless re-implemented with `onKey`. | v1 = buttons (move buttons in detail view, clickable headers/indicators). Phase 4 swaps the board's list rows for a `Client` on terminal/desktop (§7). |
| Feedback `Input` | No `Input` on mobile (d.ts:3964). | On mobile: Send back disabled with hint; narrow with `'Input' in els`. |
| Diff view | `Code` with `format: 'diff'` (CodeProps d.ts:1662, `format` d.ts:1701). Text past 100k chars cut. | Cap diff ~90k chars at the last `\ndiff --git` boundary, note truncation. Local backend: no diff ("No linked PR"). |
| Deleting card files | `$.fs` has read/write/list/exists/stat, no delete (d.ts:3312-3440). | Not needed: Done cards stay as files with `status: done`. |
| Invalidate after scroll | Not needed: `$.state.set` redraws readers (d.ts:3470). | Keep view state in `$.state` atoms. |
| ⟳ spinner | Can't rotate in a cell. | Pulse: alternate `color="warning"` / `dimColor` every 400 ms via tick atom. |
| Fading ✓ | No opacity in terminal. | 0–1 s `color="success"`, 1–2 s success+dimColor, then removed. |

## 1. File layout

```
kanban/
  .claude-plugin/plugin.json      {"name":"kanban","version":"0.1.0","description":"…","types":"./types/index.d.ts"}
  hooks/hooks.json                {"modules":["./register.tsx"]}
  hooks/register.tsx              wiring only: every on(...) call
  hooks/strings.ts                every user-facing string/prompt (centralized strings rule)
  hooks/model.ts                  constants, COLUMNS order, cellWidth/truncate/age, pure helpers
  hooks/atoms.ts                  atom(...) definitions (board, ui, sync, detail, tick)
  hooks/layout.ts                 PURE: layoutBoard(), capFor(), hitTest(), clampOffset()
  hooks/board.ts                  controller: ensureBoard, refresh, poll loop, cache, status line, merge
  hooks/sync.ts                   optimistic move queue / state machine, ticker
  hooks/handoff.ts                PURE: format/parse Handoff+Feedback sections, isHandoffValid
  hooks/backend.ts                Backend interface + detectBackend()
  hooks/local.ts                  .kanban/*.md backend (frontmatter parse/serialize)
  hooks/github.ts                 gh backend: parseClaudeMd (pure), mapItem (pure), planMove (pure), exec
  hooks/tools.ts                  tool specs + handlers (kanban_list/show/handoff/move/create)
  hooks/view-board.tsx            renderBoard($, e, …) → tree
  hooks/view-detail.tsx           renderDetail($, e, …) → tree
  hooks/board-client.tsx          PHASE 4: Client surface module
  types/index.d.ts                PluginState contract
  tsconfig.json                   copy of the header tsconfig (d.ts:68-77), include adds "tests"
  tests/fakes.ts                  fakeFs(on, files), fakeGh(on, routes), fixtures (not a *.test file)
  tests/layout.test.ts  tests/local.test.ts  tests/pane.test.tsx  tests/scroll.test.tsx   (phase 1)
  tests/github.test.ts  tests/sync.test.tsx  tests/poll.test.tsx                           (phase 2)
  tests/tools.test.ts   tests/detail.test.tsx                                              (phase 3)
```

Imports between plugin files are ES `import` declarations; a module containing `import()` fails to load. First run `claude plugin validate` with an extensionless specifier (`'./layout'`); if refused, switch to `'./layout.ts'`. Settle this before writing much code.

## 2. PluginState contract (`types/index.d.ts`)

```ts
export type KanbanColumn = 'human' | 'claude' | 'backlog' | 'done'
export type KanbanTag = 'review' | 'human'            // why a GitHub card is in Human
export type KanbanCard = {
  id: string            // 'md:0007-fix-login' | 'gh:123'
  number: number        // shown as #N; local = frontmatter id, gh = issue number
  title: string
  column: KanbanColumn
  order: number         // local: frontmatter order; gh: index among the board's issues
  createdAt: string; updatedAt: string   // ISO
  tag?: KanbanTag
  file?: string         // local: '.kanban/0007-fix-login.md'
  itemId?: string; status?: string; labels?: string[]; isClosed?: boolean
  url?: string; prNumbers?: number[]
}
export type KanbanGithub = {
  kind: 'github'; repo: string; owner: string; projectNumber: number; projectId: string
  statusFieldId: string
  options: { backlog: string; ready?: string; inProgress: string; inReview: string; done: string }
}
export type KanbanBackendInfo = { kind: 'local' } | KanbanGithub
export type KanbanBoard = {
  backend: KanbanBackendInfo | null; cards: KanbanCard[]
  fetchedAt: number; isLoading: boolean; error?: string
}
export type KanbanSyncPhase = 'pending' | 'ok' | 'failed'
export type KanbanSync = {
  cardId: string; from: KanbanColumn; to: KanbanColumn; queued?: KanbanColumn
  phase: KanbanSyncPhase; attempts: number; error?: string; settledAt?: number
  onConfirm?: 'work' | 'resume'          // prompt to submit once the move is confirmed
}
export type KanbanView = { mode: 'board' } | { mode: 'detail'; cardId: string; tab: 'card' | 'diff' }
export type KanbanUi = {
  view: KanbanView
  offsets: Record<KanbanColumn, number>
  collapsed: Record<KanbanColumn, boolean>   // initial: done=true
  draft: string                               // feedback Input text
}
export type KanbanSection = {
  kind: 'handoff' | 'feedback'; date: string; text: string
  fields?: { did: string; check: string; changed: string; need: string }
}
export type KanbanDetail = {
  cardId: string; isLoading: boolean; body: string; sections: KanbanSection[]
  diffState: 'none' | 'loading' | 'ready' | 'absent' | 'error'; diff?: string; error?: string
}
declare module 'claude-code' {
  interface PluginState {
    kanban: {
      board: Shaped<KanbanBoard>
      ui: Shaped<KanbanUi>
      sync: Shaped<Record<string, KanbanSync>>
      detail: Shaped<KanbanDetail | null>
      tick: number
    }
  }
}
```

`hooks/atoms.ts`, following `examples/pane.tsx` (`atom`/`read`/`update` d.ts:15675/15700/15709):

```ts
export const boardAtom  = atom({ plugin: 'kanban', key: 'board' } as const, EMPTY_BOARD, { shape: 'board-1' })
export const uiAtom     = atom({ plugin: 'kanban', key: 'ui' } as const, INITIAL_UI, { shape: 'ui-1' })
export const syncAtom   = atom({ plugin: 'kanban', key: 'sync' } as const, {}, { shape: 'sync-1' })
export const detailAtom = atom({ plugin: 'kanban', key: 'detail' } as const, null, { shape: 'detail-1' })
export const tickAtom   = atom({ plugin: 'kanban', key: 'tick' } as const, 0)
```

Bump a shape tag whenever its type changes. Rules:
- Render hooks never write: `$.state.set` is denied while drawing (d.ts:3497).
- Every write goes through `update($, atom, fn)` from a handler, timer, tool or event.
- Never write a value captured at draw time.
- `$.state` values are JSON: drop optional fields, never store `undefined`.

## 3. Card model and column mapping

- Order top to bottom: `COLUMNS = ['human','claude','backlog','done']`.
- Sorting: Human, Claude, Backlog by `order` ascending. Done by `updatedAt` descending, `.slice(0, 10)`; header shows `Done 10 of 57`.
- Local status values: `human | claude | backlog | done` (the file stores the column directly).

GitHub mapping, pure `columnOf(status, labels, isClosed)`, checked in this order:
1. Status `Done`, or issue closed → `done`.
2. Status `Backlog`, `Ready` or empty → `backlog`.
3. Status `In review` → `human`, tag `review`.
4. Label `human` → `human`, tag `human`.
5. Status `In progress` → `claude`.

So a backlog issue labeled `human` stays in Backlog: column = who holds the ball now, not the ownership label.

GitHub moves: pure `planMove(card, to, cfg): string[][]` returns argv lists. Reopen a closed issue first when target ≠ `done`. The label edit comes before the Status edit, so a failure leaves the Status as it was. The `human` label is matched case-insensitively and removed under the spelling the card has.

| to | argv sequence |
|---|---|
| backlog | `item-edit`→Backlog (skip if already Backlog or Ready) |
| claude | `gh issue edit N --repo R --add-label ai`, plus `--remove-label <human, as spelled>` only if the card has it; then `item-edit`→In progress. `moveGithub` first creates the `ai` label (`gh label create ai --color 5319e7 --force`) when a read-only `gh label list` shows the repo lacks it and the card does not carry it |
| human | `item-edit`→In review |
| done | `item-edit`→Done; `gh issue close N --repo R`; verify `gh issue view N --repo R --json state --jq .state` == `CLOSED` (close can fail silently) |

`item-edit` = `gh project item-edit --id ITEM --project-id PID --field-id FID --single-select-option-id OPT`. Reopen = `gh issue reopen N --repo R`.

Execution: each argv via `$.process.run(argv, { timeoutMs: 30000 })` (d.ts:3604, ProcessRunResult d.ts:8230). Non-zero `exitCode` throws `Error(firstLine(stderr) || 'gh exited N')`. On success patch the card's `status`, `labels`, `isClosed` locally so the next plan is correct.

## 4. Backend interface (`hooks/backend.ts`)

```ts
export type Backend = {
  info: KanbanBackendInfo
  load($: EngineInterface): Promise<KanbanCard[]>
  move($: EngineInterface, card: KanbanCard, to: KanbanColumn): Promise<Partial<KanbanCard>> // patch on success; throws
  append($: EngineInterface, card: KanbanCard, kind: 'handoff' | 'feedback', markdown: string): Promise<void>
  detail($: EngineInterface, card: KanbanCard): Promise<Omit<KanbanDetail, 'diffState' | 'diff' | 'isLoading' | 'cardId'>>
  diff?($: EngineInterface, card: KanbanCard): Promise<string | undefined>       // gh only
  create?($: EngineInterface, title: string, spec: string, column: KanbanColumn): Promise<KanbanCard> // local
}
export function backendFor(info: KanbanBackendInfo): Backend
export async function detectBackend($: EngineInterface): Promise<KanbanBackendInfo>
```
(`EngineInterface` = the `$` type from `'claude-code'`.)

`detectBackend` (on `/kanban` open, or on a tool call with no cached backend):
1. Read `CLAUDE.md`, falling back to `.claude/CLAUDE.md`, via `$.fs.read` (d.ts:3331). `parseClaudeMd(text)`; null → `{ kind: 'local' }`.
2. `$.process.run(['gh','auth','status'], { timeoutMs: 10000 })` must exit 0.
3. `$.process.run(['git','remote','get-url','origin'])` must exit 0.
4. Missing field/option ids → `gh project field-list N --owner O --format json` (find `name === 'Status'`, take `id`, `options[{id,name}]`) and `gh project view N --owner O --format json --jq .id`.
5. Any failure → local.

`parseClaudeMd(text): Partial<KanbanGithub> | null` — tolerant regexes; write fixtures from the real files `~/Developer/projects/{carcast,job-app,horo}/CLAUDE.md` (read them; copy the relevant lines into test fixtures):
- repo: on a line matching `/repo/i`, capture `` /`([\w.-]+\/[\w.-]+)`/ ``.
- projectNumber: `/Project(?: board)?\**:?\**\s*#(\d+)/i`.
- projectId: first `/\bPVT_[A-Za-z0-9_-]+/` that is not `PVTSSF_`.
- statusFieldId: `/PVTSSF_[A-Za-z0-9_-]+/` on a line matching `/status field/i` or `Status field ID:`.
- options: on the status line plus next two lines, ``/(Backlog|Ready|In progress|In review|Done)\s*`([0-9a-f]{6,})`/gi``.
- owner = repo's owner. Return null when repo or projectNumber is missing.

GitHub `load` — one `gh api graphql` query per page of 100 board items, `-f query=… -F projectId=<PVT_…>` and `-f cursor=<endCursor>` from the second page on (at most 30 pages; a larger board shows its first 3000 items and says so in the debug log). The query reads `node(id: $projectId) { … on ProjectV2 { items(first: 100, after: $cursor) { pageInfo, nodes { id, fieldValueByName(name: "Status"), content { … on Issue { number title url state createdAt updatedAt repository labels(first: 20) closedByPullRequestsReferences(first: 5) } } } } } }` and `rateLimit { cost remaining resetAt }`. Keep issues whose repository equals the repo (case-insensitive); pull requests and drafts come back without issue fields. Measured live against board #7: `cost` 2 per page, where `gh project item-list` plus `gh issue list` took about 104 per refresh.

Rate limit (`hooks/rate-limit.ts`): a load whose `remaining` is 100 or less, or that fails with a "rate limit" error, pauses polling until `resetAt` (an error's reset time comes from the free `gh api rate_limit`; with none, 5 minutes). Polls skip while paused; the toolbar says `limit low · paused Nm` / `limit hit · paused Nm`. A refresh the person asks for still runs, with a toast.

GitHub `append`: `gh issue comment N --repo R --body-file -` with `init.stdin = markdown` (ProcessRunInit d.ts:8203).
GitHub `detail`: `gh issue view N --repo R --json body,comments,url,state`; sections = comments whose body starts with `## Handoff (` or `## Feedback (`, createdAt order. A section whose comment was written by anyone but the signed-in user (`gh api user --jq .login`, kept for the session) carries `byOther`: it is shown, labeled, and ignored by `isHandoffValid`.
GitHub `diff`: `gh pr diff <first prNumber> --repo R`.

Local backend (`hooks/local.ts`):
- `$.fs.list('.kanban')` (d.ts:3352); rejection → empty board. Keep `kind==='file' && name.endsWith('.md')`. Read each, cache by `mtimeMs` in a module `Map`.
- File format:
```
---
id: 7
title: Fix login: redirect loop
status: claude
order: 3
created: 2026-10-25T10:00:00Z
updated: 2026-10-25T12:00:00Z
---
<spec markdown>

## Handoff (2026-10-25)
**Did:** …
**Check:** …
**Changed:** …
**Need from you:** …

## Feedback (2026-10-26)
<text>
```
- `parseCardFile(name, text): { card; body } | null` — split on first `': '` (titles may contain colons), strip surrounding quotes, unknown status → `backlog`.
- `serializeCardFile(card, body): string` — quote title only if it starts/ends with a space.
- `move`: re-read file, set `status`, `updated = new Date(await $.clock.now()).toISOString()`, `order = max(order in target)+1`, `$.fs.write` (d.ts:3338).
- `append`: re-read, add `\n\n` + section.
- `create`: number = max+1; filename `.kanban/${pad4(n)}-${slug(title)}.md`.

## 5. Modules and exact `$` usage

### `register.tsx` (wiring only)
```ts
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kanban', description: S.commandDescription })   // d.ts:1922, 3177
    for (const spec of TOOL_SPECS) await $.tool.register(spec)                       // ToolSpec d.ts:14033, register d.ts:3137
    void bootstrap($)   // if pane open: load cache + refresh; startPolling; resumePendingSyncs
    return next(e)
  })
  on('command.run', { command: 'kanban' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Kanban', rows: 30, columns: 44 })   // d.ts:2536, PaneOpenArgs d.ts:7589
    void openBoard($)
    return { text: opened.isPlaced ? S.opened : S.notPlaced(opened.reason) }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = await read($, uiAtom)
    return ui.view.mode === 'board' ? renderBoard($, e) : renderDetail($, e, ui.view)
  })
  on('ui.scroll', { requestId: PANE }, onBoardScroll)
  for (const name of TOOL_NAMES)
    on('tool.call', { tool: `mcp__kanban__${name}` }, toolHandler(name))
      .catch(($, e, next) => next.called ? next(e) : { deny: S.toolFailed(name) })
  on('tool.call', { tool: 'Write' }, kanbanFileWatch).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' },  kanbanFileWatch).catch(($, e, next) => next(e))
}
```
`PANE = 'kanban'`. `session.start` re-fires on hot reload (d.ts:4463-4467) — the single bootstrap; timers are dropped on reload so polling/ticker restart there. Verify the exact tool name the engine assigns (from `tool.register`'s result) rather than assuming `mcp__kanban__`.

### `board.ts`
- `openBoard($)`: `cwd = await $.session.cwd()` (d.ts:2834); `cached = await $.store.get('cache:' + cwd)` (d.ts:3440) → if present `update(boardAtom, …cached, isLoading: true)`; detect backend if none cached; `refresh($)`; `startPolling($)`.
- `refresh($)`: guarded by module flag `isRefreshing`. `backend.load` → `mergeRemote(remote, local, sync)` → write board + `$.store.set('cache:'+cwd, {backend, cards, fetchedAt})` → `announceHumanChanges` + `updateStatusLine`. On error keep cards, set `error` (shown in toolbar).
- `mergeRemote` (pure): remote authoritative, except a card with a `pending`/`failed` sync entry keeps its local `column` and `order`. Missing remotely → dropped unless pending.
- `startPolling($)`: `pollTimer?.cancel(); pollTimer = $.clock.every(45000, () => void pollOnce($))` (d.ts:3553/13491, cancel d.ts:13480). `pollOnce` skips when the pane isn't open (`$.ui.panes()`, d.ts:2563).
- `updateStatusLine($, cards)`: `$.ui.status(n ? S.waiting(n) : undefined)` (d.ts:2513), n = Human count. Call after every board write via a `setBoard` helper.
- `announceHumanChanges(prev, next, causedLocally)`: each card newly in Human not moved by the person's own UI action → `$.ui.toast(S.handedToYou(card))` (d.ts:2483).

### `sync.ts` — optimistic state machine
Module state (lost on reload): `inFlight: Set<string>`, `debounce: Map<string, Timer>`, `tickTimer`.
```
moveCard($, cardId, to, opts?: { onConfirm?: 'work'|'resume' })
  card = board.cards[cardId]; prev = card.column; if to === prev && !sync[cardId] → return
  update(board): card.column = to, card.order = maxOrder(to)+1         // optimistic, instant
  update(sync, s => {
    e = s[cardId]
    if (!e || e.phase === 'ok')        → s[cardId] = { cardId, from: prev, to, phase:'pending', attempts:0, onConfirm }
    else if inFlight.has(cardId)       → e.queued = to
    else /* pending-not-sent | failed */ → e.to = to; e.phase='pending'; e.attempts=0; drop e.error
    if (!inFlight.has(cardId) && s[cardId].to === s[cardId].from) delete s[cardId]   // moved back: no call
  })
  debounce(cardId, 300ms) → dispatch      // $.clock.after (d.ts:3543)
  ensureTicker($)

dispatch($, cardId)
  e = sync[cardId]; if !e || e.phase !== 'pending' → return
  inFlight.add; attempts += 1 (written)
  try   patch = await backend.move($, card, e.to); patch card
        if e.queued && e.queued !== e.to → e.to = e.queued; drop queued; attempts = 0; inFlight.delete; dispatch again
        else e.phase='ok'; e.settledAt = now; fire e.onConfirm (§8); $.clock.after(2000, delete if still ok with same settledAt)
  catch err
        if e.attempts >= 4 (initial + 3 retries) → card.column = e.from (snap back); delete entry;
                                                    $.ui.toast(S.movedBack(card, e.to, reason))
        else e.phase='failed'; e.error = reason
  finally inFlight.delete

retry($, cardId)       → phase='pending' → dispatch (no debounce)
resumePendingSyncs($)  → on bootstrap re-dispatch every 'pending' entry (moves are idempotent)
ensureTicker($)        → if no tickTimer: tickTimer = $.clock.every(400, tick); tick increments tickAtom,
                         cancels itself when no entry is pending or ok
```
Retries are manual: Retry button in detail view; toolbar shows `✕N retry` when any card failed. Render reads `tickAtom` and `$.clock.now()` (d.ts:3522) for pulse, fade and card ages.

### `handoff.ts` (pure)
- `formatHandoff({did, check, changed, need}, date)` → exactly:
```
## Handoff (YYYY-MM-DD)
**Did:** …
**Check:** …
**Changed:** …
**Need from you:** …
```
- `formatFeedback(text, date)` → `## Feedback (YYYY-MM-DD)\n<text>`.
- `parseSections(markdown): { body; sections }` — header regex `/^## (Handoff|Feedback) \((\d{4}-\d{2}-\d{2})\)\s*$/m`; field regex `/^\*\*(Did|Check|Changed|Need from you):\*\*\s*/m`, field runs until the next field.
- `isHandoffValid(sections)`: newest handoff must be after the newest feedback; its `check` and `need`, trimmed, non-empty and not `…`, `...`, `n/a`.

### `tools.ts`
Register each with `isDeferred: false`. Results `{ result: string }` (d.ts:13566, pattern d.ts:3296). Refusals `{ deny: text }`. Each handler first runs `ensureBoard($)` so tools work with the pane closed.

| tool | inputSchema | behaviour |
|---|---|---|
| `kanban_list` | `{column?: enum}` | one line per card: `#N [column] title (tag) updated` |
| `kanban_show` | `{card: integer}` req | spec + all sections, newest last |
| `kanban_handoff` | `{card, did?, check, changed?, need}` req card,check,need | `backend.append(formatHandoff…)`, refresh detail |
| `kanban_move` | `{card, to: enum}` | `to==='human'` && !isHandoffValid → `{deny: S.needHandoff(n)}`. Else `moveCard` (no onConfirm). to human → toast + `$.ui.notify` (d.ts:2501). Result "Moved #N to X (syncing)." |
| `kanban_create` | `{title, spec, column?}` | local: a card file; GitHub: `gh issue create --label triage`, `gh project item-add`, Status Backlog (then the usual move for any other column) |
| `kanban_suggest` | `{title, spec, why?}` req title,spec | creates nothing: adds a suggestion to the `suggestions` atom (kept per cwd in `$.store`), toast once; shown in a strip under the toolbar with Add (quick-add path) and Dismiss (#24) |

### `kanbanFileWatch` (tool.call on Write/Edit)
- Phase 1: `const ran = await next(e); if (/(^|\/)\.kanban\/[^/]+\.md$/.test(e.file_path)) void refresh($); return ran`.
- Phase 3, before `next`: compute resulting text (Write: `e.content`; Edit: read file, apply `old_string`→`new_string` honouring `replace_all`). If frontmatter status becomes `human` and `!isHandoffValid(parseSections(result))` → `{ deny: S.useKanbanMove }`. `.catch` passes through so a broken guard never blocks editing.

## 6. Layout and scroll hit-testing (`layout.ts`, pure)
```ts
export type Row =
  | { kind: 'toolbar' }
  | { kind: 'header'; column: KanbanColumn; shown: number; total: number }
  | { kind: 'more'; column: KanbanColumn; dir: 'up' | 'down'; n: number }
  | { kind: 'card'; column: KanbanColumn; card: KanbanCard }
  | { kind: 'empty'; column: KanbanColumn }
export type LayoutInput = { cards: KanbanCard[]; ui: KanbanUi; bodyRows: number }
export function capFor(bodyRows: number, openSections: number): number
export function sectionList(cards: KanbanCard[], col: KanbanColumn): KanbanCard[]
export function clampOffset(offset: number, len: number, cap: number): number
export function layoutBoard(input: LayoutInput): Row[]
export function hitTest(rows: Row[], treeRow: number): KanbanColumn | undefined
```
- `capFor`: `clamp(floor((bodyRows - 1 - 4) / k) - 2, 1, 5)`, k = expanded sections, so the tree fits `bodyRows` and the engine window never moves in board view.
- `sectionList`: sorted list for a column; Done sort+slice(10) here.
- `clampOffset`: `[0, max(0, len - cap)]`.
- `layoutBoard`: `toolbar`, then per column a `header`; if expanded: `empty`, or `more↑` (offset>0), up to `cap` `card`s, `more↓` (rows remain). No blank rows; every Row = exactly one terminal row.
- `hitTest`: `rows[treeRow]?.column` for header/card/more/empty; `undefined` for toolbar / out of range.

One-row guarantee: each row is a single `Button plain`, or a row `Box` with a Button and Text. Pre-truncate strings to `bodyColumns` via `truncate(str, width)` + `cellWidth()` (CJK/emoji = 2). Every Text `wrap="truncate-end"`. Card row: `left = '  #' + n + ' ' + (tag ? tagShort + ' ' : '')`, `right = ' ' + glyph + ' ' + age`, `title = truncate(title, bodyColumns - w(left) - w(right))`, padded so age aligns right; if title width < 4, drop age.

`renderBoard` reads boardAtom, uiAtom, syncAtom, tickAtom, plus `e.props.bodyColumns` and `e.props.scroll` (Pane props d.ts:10877, SiteScroll d.ts:12562). Records `lastBody = { rows, offset, columns }` in a module variable (hit-test cache only, default `{rows: 24, offset: 0}`). Rows map 1:1 to elements:
- toolbar: `<Box flexDirection="row"><Button key="refresh" plain onPress={() => refresh($)}>↻</Button><Text dimColor wrap="truncate-end"> {backendLabel} · {ago}{error ? ' · ' + error : ''}</Text>{failed > 0 && <Button key="retry-all" plain …><Text color="error">✕{failed} retry</Text></Button>}</Box>`
- header: `<Button key={'hdr:' + col} plain onPress={toggleCollapse}>{collapsed ? '▸' : '▾'} <Text bold>{S.col[col]}</Text> <Text dimColor>{countLabel}</Text></Button>`
- more: `<Button key={'more:' + col + ':' + dir} plain onPress={() => shift(col, ±cap)}><Text dimColor>  {dir === 'up' ? '↑' : '↓'} {n} more</Text></Button>`
- card: `<Button key={'card:' + card.id} plain onPress={() => openDetail($, card.id)}>{left}{title}<Text color={glyphColor} dimColor={dim}>{glyph}</Text><Text dimColor> {age}</Text></Button>` (Buttons hold strings and Text only; unique `key` each).
- empty: `<Text dimColor>  (empty)</Text>`; empty local board: explanatory line (S.noCards).

Glyph colours (ThemeKey d.ts:13455): pending ⟳ `warning` pulsing on tick parity; ok ✓ `success`, +dimColor after 1 s; failed ✕ `error`.

`onBoardScroll($, e, next)` (UiScrollInput d.ts:15258, result d.ts:15361):
```ts
const ui = await read($, uiAtom)
if (ui.view.mode !== 'board' || e.pointer === undefined) return next(e)
const { cards } = await read($, boardAtom)
const rows = layoutBoard({ cards, ui, bodyRows: lastBody.rows })
const col = hitTest(rows, e.pointer.row + lastBody.offset)               // d.ts:15349-15353
if (col === undefined || ui.collapsed[col]) return next(e)
const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by)))
const len = sectionList(cards, col).length, cap = capFor(lastBody.rows, openCount(ui))
const nextOffset = clampOffset(ui.offsets[col] + step, len, cap)
if (nextOffset !== ui.offsets[col]) await update($, uiAtom, u => ({ ...u, offsets: { ...u.offsets, [col]: nextOffset } }))
return {}
```

## 7. Detail view (`view-detail.tsx`) + Phase 4 drag
`renderDetail($, e, view)` reads detailAtom, boardAtom, syncAtom, uiAtom, tickAtom. Free height; engine scrolls it. `els = $.ui.resolve(e)`; Input only when `'Input' in els`.
1. `<Button key="back" hotkey="b" label="← Board" …/>`, then `<Text bold>#N title</Text>`.
2. Meta line: column · tag · updated age · sync text (`⟳ syncing to Claude` / `✓ saved` / `✕ <error> (attempt 2/4)`). Failed adds `<Button key="retry" variant="primary" label="Retry"/>`. GitHub adds a `Link` to url.
3. If column is human: `<Button key="approve" hotkey="a" variant="primary" label="Approve"/>`, `<Button key="sendback" hotkey="s" label="Send back"/>`, `<Button key="park" hotkey="p" label="Park"/>`; `<Input key="feedback" label="Feedback" placeholder={S.feedbackPlaceholder} rows={3} value={ui.draft} onInput={v => update($, uiAtom, u => ({...u, draft: v}))} onSubmit={v => sendBack($, id, v)}/>` (InputProps d.ts:5627).
4. `Move to:` + `move:<col>` Buttons for each other column.
5. Tabs `tab:card` / `tab:diff` (diff only for GitHub cards with `prNumbers`; pressing loads diff into detailAtom).
6. Body: card tab `<Markdown key="spec" text={body}/>` (d.ts:5879) then one Markdown per section, newest last; diff tab `<Code source={diff} format="diff"/>`; loading `<Text dimColor>Loading…</Text>`.

`openDetail($, id)`: set view, detailAtom `{isLoading:true}`, then fill from `backend.detail` + `parseSections`.
Actions: Approve → `moveCard(id,'done')`. Park → `moveCard(id,'backlog')`. Send back → empty draft: toast `S.feedbackFirst`; else `await backend.append('feedback', formatFeedback(draft, today))` (failure → toast, stop), clear draft, `moveCard(id,'claude',{onConfirm:'resume'})`, back to board. Move buttons → `moveCard(id, col, from === 'backlog' && col === 'claude' ? {onConfirm:'work'} : undefined)`.

Phase 4 drag: on terminal/desktop, `renderBoard` replaces the list rows (below toolbar) with `<Client key="board" module="./board-client.tsx" props={{ rows: RowView[], columns }} width="100%"/>` (`module` must be a string literal, d.ts:3936-3943). `RowView` = pre-truncated text + colour per `layoutBoard` row; the Client module is self-contained (no imports of other plugin files). In it, `surface.onPointer`: `down` on card row → `setState({drag:{cardId,y}})`; `move` → highlight hovered header with `inverse`; `up` on same row without move → `post({type:'open',cardId})`; `up` on header → `post({type:'drop',cardId,column})`; click on header/more → `post({type:'toggle'|'page',…})`. Hooks module adds `on('ui.message', ($, e, next) => e.element === 'board' ? handleBoardMessage($, e.data) : next(e))` calling `moveCard`/`openDetail`. vscode/mobile keep Button rows. Test with `ui.pointer` / `ui.post` (Mounted d.ts:16678/16691). Verify wheel-over-Client still raises pane `ui.scroll` with a pointer; if not, handle scroll inside the Client if the API offers it, else report.

## 8. Prompts
`onConfirm` fires only after backend confirms:
- `'work'` → `void $.prompt.submit({ text: S.workPrompt(n, title) })` (d.ts:3023): `Work on kanban card #N "title": read it with kanban_show, do the work, then record a handoff with kanban_handoff and move it to human with kanban_move.` (use the real registered tool names)
- `'resume'` → `S.resumePrompt(n)`: `Resume kanban card #N: read the newest feedback (kanban_show) and continue.`
Only person-initiated UI moves set `onConfirm`; `kanban_move` from Claude never submits a prompt.

## 9. Phases (each ends with validate + test + tsc green)
- Phase 1: plugin.json, hooks.json, register, strings, model, atoms, layout, board (refresh only), sync, handoff (parse), backend (local), local, view-board, view-detail (move buttons + spec), tools kanban_list + kanban_move (no handoff rule yet), Write/Edit refresh watcher, `/kanban`.
- Phase 2: github.ts, detectBackend, full sync machine (debounce, coalesce, retries, snap-back), ticker, polling, `$.store` cache, merge.
- Phase 3: kanban_show, kanban_handoff, kanban_create, handoff rule in kanban_move, Write/Edit guard, Approve/Send back/Park, feedback Input, prompts, diff tab, status line, toasts, notify.
- Phase 4: Client drag (§7).

## 10. Tests
Test-kit facts: tests get engine `$` and `on` whose hooks are the bottom. No real fs/process — answer events: `on('fs.list', (_, e) => ({ value: entries }))`, `on('fs.read', (_, e) => ({ value: files[e.path] }))`, `on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })`, `on('process.run', (_, e) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))` (shapes d.ts:7243-7262, 7344). Mocks: `mock.clock(on)` with `.advance` (d.ts:16513), `mock.store(on, entries)`. Registration answers as in `examples/pane.test.tsx`. Capture `ui.toast`, `ui.status`, `prompt.submit` (PromptSubmitResult d.ts:9581). Engine calls take the whole event input (EngineNoun d.ts:16076): `$.command.run` needs `origin` + `presentation`; `$.ui.scroll` takes a full UiScrollInput — let tsc confirm. UI acts: `ui.find`, `findAll`, `press`, `input` (d.ts:16612-16648). Loop UI tests over `['terminal','desktop'] as const`; one mobile mount asserting no Input and Send back hint.

| Phase | File | Cases |
|---|---|---|
| 1 | layout.test.ts | column order; Done collapsed → header only; cap 5 + `↓ N more`; offset 3 → `↑ 3 more`; clampOffset bounds; Done = 10 newest; capFor shrinks for small bodyRows; every row's text width ≤ bodyColumns (CJK title); hitTest toolbar→undefined, card/more/header→column |
| 1 | local.test.ts | parse/serialize round-trip (colon in title, quotes); bad status → backlog; move rewrites status/updated/order, body intact; parseSections splits Handoff/Feedback with fields |
| 1 | pane.test.tsx | fake fs with 3 cards → `/kanban` → mount → find `#1`; press `hdr:done` expands; press card → detail; press `move:claude` → file has `status: claude`; back → card under Claude |
| 1 | scroll.test.tsx | 8 backlog cards, bodyRows 30: pointer on backlog card row → `{}`, `↑ 1 more` shown, Human offset unchanged; pointer on toolbar → passed to next; no pointer → passed; detail view → passed; press `more:backlog:down` pages |
| 2 | github.test.ts | parseClaudeMd on carcast/offr/horo fixtures → exact ids; columnOf precedence; planMove argv per target incl. reopen/close/verify, `--remove-label human` only when present; load pages one GraphQL query per 100 items and filters other repos, cost fixture, rate-limit backoff and recovery, `ai` label ensured once, handoff author rule |
| 2 | sync.test.tsx | success ⟳ → ✓ → gone after 2000 ms; failure ✕ + Retry; 3 retries fail → card back + toast with reason; debounce: 3 moves in 300 ms → one sequence for final target; in-flight: deferred first call, move again → exactly one more sequence; move back to origin before dispatch → no call |
| 2 | poll.test.tsx | advance 45000 → the board loads again; merge keeps a pending card's local column; pane closed → no poll; cached store → cards visible before process.run resolves |
| 3 | tools.test.ts | kanban_move human with no handoff → deny; handoff missing Need → deny; valid handoff then newer feedback → deny; valid → moved + toast + status `1 card waiting on you`; kanban_handoff exact format with mock-clock date; Write guard denies `status: human` w/o handoff, allows other edits; Write to `.kanban/x.md` triggers fs.list again |
| 3 | detail.test.tsx | input feedback + press `sendback` → Feedback appended, card → Claude, after confirm prompt `Resume kanban card #N…`; empty draft → toast, no move; backlog→claude press → `Work on kanban card #N`; Approve on GitHub → close + verify argv; diff tab → `Code` element present |
| 4 | drag.test.tsx | Client present on terminal/desktop, absent on vscode/mobile; pointer down on card row, move, up on Human header → card moves to Human; click card → detail opens |

## 11. Validation
```
M=/Users/teeratp/.claude/dev-mods/399de62a-c3ce-57f0-92a6-1f6601ddec6b/kanban
claude plugin validate $M
claude plugin test $M
npx -y -p typescript@5.6 tsc -p $M
```
Until the engine lays `.claude-plugin/types/`, type-check with a temp tsconfig kept OUTSIDE the mod folder pointing at the skill's d.ts.

## 12. Risks
1. Desktop hit-testing: buttons may be >1 row; clickable indicators cover it.
2. Small inline pane: cap may drop to 1; `rows: 30` is only a request.
3. gh JSON variance across versions; check field names once against installed gh.
4. Reloads drop module state; pending moves re-dispatched from `$.state` on `session.start`.
5. `command.run` / `session.start` must not await gh — run in background with `void`.
6. Import specifier form unverified — settle at first validate.
7. Wheel over a `Client` (phase 4) unverified.

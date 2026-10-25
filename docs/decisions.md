# Decision log

Decisions made while building v1, newest last. Each entry: what was decided, why, and where it applies.

## 2026-10-25

1. **Sections, top to bottom: Human, Claude, Backlog, Done.** What needs the person sits on top and never scrolls off. Done is collapsed by default and shows the 10 most recent cards.
2. **Rows, not columns.** The side pane is narrow; stacked sections fit. Each section shows at most 5 cards and scrolls on its own with the wheel (`ui.scroll` hook + pointer hit-testing). Clickable `↑/↓ N more` rows are the reliable fallback where hit-testing is imprecise (desktop).
3. **Buttons first, drag later.** Drag needs a `Client` element, which exists only on the terminal and desktop surfaces. v1 ships button moves everywhere (#2); drag is #8 and leaves VS Code and mobile on buttons.
4. **GitHub mapping onto the existing board, no board restructuring.** Backlog = Status Backlog or Ready; Claude = Status In progress (with or without the `ai` label); Human = Status In review or label `human`; Done = Status Done or closed. A backlog issue labeled `human` stays in Backlog: the column is who holds the ball now.
5. **Move to Human sets Status In review, no label change. Move to Claude adds `ai` and removes `human` if present.** Least label churn while keeping the ownership label right for the person's own `gh issue list --label ai` workflow.
6. **Approve = Done + close the issue, then verify it is closed.** Matches "Done means closed"; `gh issue close` can fail silently, so the state is re-read.
7. **Optimistic sync.** The card moves at once; ⟳ pulses (a cell can't rotate), ✓ bright for 1 s then dim for 1 s then gone, ✕ with Retry. After the first try plus 3 retries fail, the card snaps back and a toast gives the reason. Rapid moves of one card collapse into one request for the final target (300 ms debounce, plus queueing while a request is in flight).
8. **Prompts to Claude fire only after the move is confirmed.** Dropping Backlog→Claude submits "Work on kanban card #N"; Send back submits "Resume kanban card #N". Claude's own `kanban_move` calls never submit prompts (no loops).
9. **Handoff is enforced, not suggested.** `kanban_move` to Human is refused unless the newest handoff comes after the newest feedback and has non-empty **Check** and **Need from you**. A Write/Edit guard applies the same rule to direct `.kanban/*.md` edits; the guard fails open so it can never block unrelated editing.
10. **One backend per project, no sync between them.** Two sources of truth means sync bugs. Choice is a `backend` setting (`auto` / `github` / `local`, #10); `github` never silently falls back.
11. **Polling every 45 s while the pane is open**, plus a refresh button. GitHub has no push to a local process; 45 s is well inside API rate limits for one person.
12. **Cache per working directory in `$.store`** so the pane opens instantly; remote data wins on refresh except for cards with a pending or failed move.
13. **No mutating `gh` commands during development.** All write paths are tested against fakes; only read-only `gh` calls touch real repos.
14. **Repo and tracking.** Public repo `TeeratP/claude-kanban`, board #7, code `KANB`. Epic #1 with sub-issues #2–#10. Foundation (#2) lands on `main` first; the rest branch from `changes-20261025` in `.worktrees/<branch>` and run in parallel.
15. **Live dev copy.** The engine hot-reloads from the session's `dev-mods/.../kanban/` folder; that folder is synced from the repo's `main` (rsync) after each merge rather than symlinked, because symlink handling in the watcher is not something worth depending on.
16. **Backends are plain functions, not objects.** The validator rejects passing `$` to a method call, so `backend.ts` dispatches on `info.kind` to top-level functions (`loadCards`, `moveRemote`, …). (#2)
17. **Atoms live only in `atoms.ts` behind accessors.** The validator only accepts `read`/`update` in the atom's own file. (#2)
18. **`tsconfig.json` drops `claude-code-mcp` types.** On TypeScript 5.6 the 434 KB MCP typings hit TS2589 on the first `tool.call` matcher; the mod needs no other server's tool types. (#2)
19. **Phase-1 `moveCard` awaits the backend; #4 replaces it with the debounced optimistic machine.** Kept phase 1 simple and testable. (#2)
20. **Parallel wave split by file ownership.** `handoff.ts`: #6 owns `formatHandoff`/`isHandoffValid`, #7 owns `formatFeedback`. `sync.ts`: #4 owns the state machine and prompt firing; #7 only passes `onConfirm`. Diff: #7 adds the `readDiff` dispatcher, #3 fills the GitHub branch. `detectBackend` gets a `mode` parameter now (#3) so the `backend` setting (#10) is a small follow-up.
21. **Merge order into `changes-20261025`:** #3 → #4 → #5 → #6 → #7 → #8 → #9, then #10. Backend and sync first because the most files depend on them; drag last because it rewrites board rendering.
22. **Merge as branches finish, not strictly in the planned order.** Docs (#9) and polling (#5) finished first and touch few shared files; waiting would idle the integration branch. Conflicts are resolved at each merge with full gates.
23. **Cache never counts as "loaded".** A cache-painted board keeps `fetchedAt: 0`, so tools wait for a real load and never act on stale columns. (#5)
24. **"Newly in Human" toasts come only from loads, plus one from Claude's `kanban_move`.** The person's own moves are already on the board when a refresh compares, so they never toast; refused or snapped-back moves never announce. Toast text is neutral ("Waiting on you: #N title") because a card can arrive from several sources. (#5)
25. **Backend setting must invalidate the cache.** The cache restores `backend`; #10 drops it when the setting changes. (#5 → #10)
26. **Handoff check is ordered by section position, dates are day-granular; placeholders (`…`, `...`, `n/a`, empty) don't count.** (#6)
27. **No duplicate announcements.** `kanban_move` does not toast itself; #5's `announceHandoff` gives exactly one toast + notification. (#6, #5)
28. **Write/Edit guard blocks only a transition into Human**, so Claude can still edit the spec of a card the person moved to Human. It is a guard rail, not a security boundary (Bash/sed edits are not covered). (#6)
29. **`kanban_create` cannot create into Human** — that would bypass the handoff rule. Local only; on GitHub it points to the /issue skill. (#6)
30. **Unknown frontmatter keys are preserved**, and indented lines are values, not keys, so nested `id:`/`status:` can't override a card's own. (#6)
31. **Card creation is serialized** so two parallel creates can't pick the same number. (#6)
32. **`gh project item-list` output is trimmed with `--jq`** to the fields used, to stay under the engine's 4 MiB stdout cap on big boards. (#3)
33. **Repo is parsed only from a `Repo:`-style label with a backticked `owner/name`.** Stricter than the plan, because a move writes to that repo; a wrong match must not happen. (#3)
34. **CLAUDE.md ids win; `gh project field-list`/`view` only fill gaps. Any detection failure → local with a debug log** (under `auto`). (#3)
35. **A partially-applied GitHub move is not rolled back remotely.** The card snaps back locally and the next refresh shows the true remote state; retry reruns the idempotent sequence. (#3)
36. **Mobile is detected by `e.surface`, not by element presence.** The mobile element table still contains `Input` at runtime even though the types omit it. (#7)
37. **The feedback draft is cleared when another card opens**, so feedback can't be sent to the wrong card. (#7)
38. **Send back records feedback before moving.** If the move is refused, the card snaps back to Human but the feedback stays recorded. (#7)
39. **Commit trailers from implementers name the model that wrote the code** (harness attribution), so branch commits say Sonnet and orchestrator commits say Opus. Left as is. (all)
40. **Integration moved to its own worktree** (`.worktrees/integration`) once merges needed conflict work, so the repo root stays on `main` (== `origin/main`). A Sonnet integrator resolves conflicts; the orchestrator reviews and logs.
41. **`moveCard` no longer reports success synchronously; `kanban_move` answers "Moved #N to X (syncing)."** The Human announcement moved to the confirm path, so it fires only after the backend confirms. (#4, integration)
42. **No refresh after a confirmed move; the backend patch is applied only if the card still shows that move's column.** A stale patch never overwrites a newer optimistic move. A card leaving Human drops its `tag` in the patch itself. (#4, #3, integration)
43. **After a snap-back the card lands at the bottom of its old section, then a refresh restores its real position.** Avoids storing a `fromOrder`. (#4)
44. **A move made while one is in flight is queued; only the last target is sent.** If the in-flight call fails after a newer target was asked for, the newer one is sent with attempts reset. (#4)
45. **Drag targets are section headers only; drag Backlog→Claude submits the work prompt like the move buttons.** (#8, integration)
46. **Surface is detected by `e.surface`, not by element presence**, for the Client too: `$.ui.resolve(e)` returns a `Client` on every surface, a no-op fragment on vscode/mobile. (#8)
47. **The toolbar stays outside the Client** so layout row index = tree row and wheel hit-testing is unchanged. The Client has no wheel event, so the pane's `ui.scroll` still drives per-section scroll. Unverified in a live renderer. (#8)
48. **Keyboard access to Client board rows is a follow-up (#11, p1)**, not shipped in v1. The detail view's Buttons stay keyboard-reachable. Also opened #12 (status line at session start), #13 (paging past 500 GitHub items), #14 (escape section markers in handoff text).
49. **`announce` rides on the sync entry** like `onConfirm`: it survives reloads and retries, and is dropped if the person retargets the move. (integration)
50. **One rule for "Backlog→Claude by the person sends the work prompt": `moveOptions(from, to)` in `sync.ts`**, used by both the move buttons and drag drops. (integration)
51. **Tests assert behaviour on both Button rows and Client rows through shared helpers** (`tests/board-ui.ts`), so no assertion passes vacuously on a surface that draws rows differently. (integration)
52. **The backend setting's mode is stored on the board.** The engine keeps the board atom across the reload that a setting change causes, so `session.start` compares modes and resets the board when it differs; the same mode keeps the board across a hot reload. (#10)
53. **`github` mode surfaces the failing check with a fix hint and re-checks on every refresh**, so it recovers by itself once `gh` is fixed. `auto` keeps logging quietly and falling back to local. (#10)
54. **A cache saved under another mode is ignored, not deleted**, and overwritten by the next successful load. (#10)
55. **Toolbar label is `GitHub (auto)` / `GitHub` / `Local (auto)` / `Local`, empty until the backend is known under `auto`**, so it never claims Local while GitHub may be about to load. (#10)
56. **At session start with the pane closed, only the status line comes from the cache**; cached cards are not written to the board, so no stuck `isLoading` and no flood of "newly in Human" toasts on the next load. The cache only speaks for an unloaded board under the same mode. (#12)

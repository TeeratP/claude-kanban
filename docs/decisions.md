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

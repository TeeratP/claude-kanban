# claude-kanban

Claude Code mod (plugin): a kanban side pane with two groups of sections: Active (Backlog, Human, Claude) and Inactive (Done, Cancelled, Suspended). Cards are backed by GitHub Issues + a Projects-v2 board, or by local `.kanban/*.md` files when GitHub isn't set up.

Design and API notes: `docs/plan.md` (authoritative spec; cites line numbers in the plugin-authoring types file).

## Task tracking
- Repo: `TeeratP/claude-kanban` (public).
- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).
- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.
- Issue titles: plain task name, no prefix.

## Layout
- `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/*.ts(x)`, `types/index.d.ts`, `tests/`.
- The live dev copy loads from `~/.claude/dev-mods/<session>/kanban/`, synced from this repo's `main` after each merge (`rsync -a --delete --exclude .git --exclude .worktrees ./ <dev-mods>/kanban/`).

## Gates (run all before merging)
```
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6 tsc -p .
```

## Rules
- All user-facing strings live in `hooks/strings.ts`.
- `hooks/register.tsx` is wiring only; add `on(...)` calls there, logic in its own module.
- Never run mutating `gh` commands against real repos from tests; use the fakes in `tests/fakes.ts`.

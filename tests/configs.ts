// Lines copied verbatim from the instruction files this plugin is meant to read.

/** punn's CLAUDE.md: only an import of AGENTS.md. */
export const PUNN_CLAUDE = ['# CLAUDE.md', '', '@AGENTS.md'].join('\n')

/** punn's AGENTS.md: the Task Tracking section, with the board in a `project number` line. */
export const PUNN_AGENTS = [
  '## Task Tracking — GitHub Issues + Project board',
  '',
  'Repo + project binding for this project. The **protocol** (5-state board, set-Status-`In progress`-before-coding, In-review before Done, work-plan comments, single-source-of-truth, `Closes #n` trailer, don\'t restructure fields/labels) lives in the global agent instructions (`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md`) "Task Tracking — GitHub Issues + Project board" section — follow it.',
  '',
  '- **Repo: `TeeratP/attend-baby`** (the `origin` remote). `gh` is authed.',
  '- **Project code (PRJ): `PUNN`** — issue titles are `[PUNN-<AREA>] <task>`, AREA from the shared taxonomy in the global agent instructions.',
  '- **Project board: "@TeeratP\'s Kanban"** — project number `2`, owner `TeeratP`, project id `PVT_kwHOAcCsLc4Bbjg2`. `Status` field id `PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY`; option ids: Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Done `98236657`. (Stable — don\'t re-query each session. Needs `gh auth refresh -s project` once per machine.)',
].join('\n')

/** agentic-framework (nae): `project **2**` and a single `Ready (To Do) option`. */
export const NAE = [
  '## Task Tracking',
  '',
  '- **PRJ code:** `NAE` (used in issue titles, e.g. `[NAE-DAT] ...`). AREA codes come from the shared taxonomy in global `~/.claude/CLAUDE.md`.',
  '- **Repo:** `TeeratP/nae`.',
  '- **Board:** "@TeeratP\'s Kanban" — project **2**, owner `TeeratP` (shared across all repos). Project id `PVT_kwHOAcCsLc4Bbjg2`; Status field `PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY`; Ready (To Do) option `61e4505c`.',
].join('\n')

/** lotto: `**Board: "..."**` with `project number` and a backticked `Status` field. */
export const LOTTO = [
  '## Task Tracking — GitHub Issues + Project board',
  'Protocol lives in global `~/.claude/CLAUDE.md`. Bindings for this repo:',
  '- **Repo: `TeeratP/thai-lotto`** (`origin`). **PRJ code: `LOTO`** — titles `[LOTO-<AREA>] <task>`.',
  '- **Board: "@TeeratP\'s Kanban"** — project number `2`, owner `TeeratP`, project id `PVT_kwHOAcCsLc4Bbjg2`. `Status` field id `PVTSSF_lAHOAcCsLc4Bbjg2zhWTPOY`; options: Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Done `98236657`.',
].join('\n')

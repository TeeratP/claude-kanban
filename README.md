# claude-kanban

A Claude Code mod that puts a kanban board in a side pane: four sections that show, at a glance, who holds the ball on every task. Cards live in your GitHub Issues and Projects board, or in plain `.kanban/*.md` files when GitHub isn't set up.

<!-- screenshot: the board pane (Human / Claude / Backlog / Done) -->

## Sections

| Section | Who holds the ball | What it means |
|---|---|---|
| Human | You | Claude handed the card over and is waiting on your review or answer. Always the first section. |
| Claude | Claude | Claude is working on it. |
| Backlog | Nobody yet | Parked or not started. |
| Done | Nobody | Finished. Collapsed by default; shows the 10 most recent (`Done 10 of 57`). |

Each section shows at most 5 cards (fewer in a short pane, so the board fits it) and scrolls on its own with the mouse wheel; clickable `↑ N more` / `↓ N more` rows page through the rest. When a section's list is already at the end the wheel points to, the wheel scrolls the pane instead. Click a section header to collapse or expand it. A card row shows `#number`, the title, a sync glyph and its age.

A card moves between sections when you move it in the pane, when Claude moves it with its tools, or (GitHub) when its board status changes elsewhere.

## Install

At the prompt of a terminal session:

```
/plugin install kanban --marketplace TeeratP/claude-kanban
```

Answer `y` to `Add marketplace?`, then choose a scope. The install flow then shows a settings screen with the `backend` option (see [Backends](#backends)).

From a shell:

```
claude plugin install kanban --marketplace TeeratP/claude-kanban
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `TeeratP/claude-kanban`, then Add plugin.

The GitHub backend also needs the [`gh` CLI](https://cli.github.com), signed in (`gh auth login`). The local backend needs nothing.

## Use

Type `/kanban` to open the board in a side pane. Click a card to open its detail view: the spec, the handoffs and feedback, and the move buttons. Click `← Board` to go back.

Claude can work the board without the pane open (see [Claude's tools](#claudes-tools-and-the-handoff)).

The toolbar shows the refresh button, the active backend, when the board was last updated, and any error. When a move has failed it also shows `✕N retry`, and on the terminal and desktop, when it fits the pane's width, a key hint (`↑↓ ⏎ open · m move`). While the pane is open the board refreshes every 45 seconds. The status line shows `1 card waiting on you` or `N cards waiting on you`, and a toast (`Waiting on you: #7 Fix login`) appears when a card newly lands in Human; if Claude moved it, you are notified as well. Cards you moved yourself don't toast.

### Moving cards

- **Terminal and desktop:** drag a card onto a section header to move it. Click a card (press and release without moving) to open it.
- **Terminal and desktop, by keyboard:** the board takes keys once you have clicked it (Esc gives them back). The first key shows the cursor; then `↑`/`↓` (or `k`/`j`) move it, `Enter` does what a click does (open a card, fold a section, page a section), and `m` followed by `1`-`4` or `h`/`c`/`b`/`d` moves the card under the cursor to Human, Claude, Backlog or Done. Any other key cancels the move.
- **VS Code and mobile:** there is no drag. Open the card and press a `Move to:` button.

A move shows at once, then syncs in the background: `⟳` pulses while it is sent, `✓` confirms (bright for a second, then dim, then gone), `✕` marks a failure on the card's row; open the card for the reason and a Retry button, or press `✕N retry` in the toolbar to send every failed move again. Several quick moves of one card are sent as one request. After the first try and three retries fail, the card snaps back to where it was and a toast gives the reason.

## Backends

A project uses one backend. They do not sync with each other.

| Backend | Cards are |
|---|---|
| GitHub | Issues of one repo, laid out by one Projects-v2 board's Status field. |
| Local | Markdown files in `.kanban/` in the working directory. |

The `backend` setting picks which. You choose it on the settings screen at install, and can change it later in the plugin's settings in the config menu; changing it reloads the plugin with the new value. A stored value that is not one of the three counts as unset (`auto`).

| `backend` | Behaviour |
|---|---|
| `auto` (default) | GitHub when [CLAUDE.md names a repo and a project board](#how-github-is-detected), `gh` is signed in and the repo has a git remote; otherwise local. |
| `github` | GitHub only. If a check fails there is no silent fallback: the toolbar shows the failing check and how to fix it (for example `gh auth login`, or add the board IDs to CLAUDE.md). |
| `local` | Always `.kanban/*.md`, even when GitHub is available. |

The toolbar names the active backend and, when `auto` chose it, says so: `GitHub (auto)`, `Local (auto)`, or just `GitHub` / `Local` when you set it.

**Switching backends does not migrate cards.** Cards created on GitHub stay on GitHub and `.kanban/` files stay on disk; the board shows only the active backend's cards. When the backend changes, the board and the saved copy of it from the old setting are set aside, so cards from the old one never show.

### How GitHub is detected

The board reads `CLAUDE.md` in the working directory (falling back to `.claude/CLAUDE.md`) and looks for the repo and the Projects board. This repo's own `CLAUDE.md` is an example:

```markdown
- Repo: `TeeratP/claude-kanban` (public).
- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).
- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.
```

| Read from the line | As |
|---|---|
| A line containing `repo` with a backticked `owner/name` | The repo. The board's owner is the repo's owner. |
| `Project board: #7` (or `Project: #7`, bold allowed) | The project number. |
| The first `PVT_…` ID | The project ID. |
| A `PVTSSF_…` ID on a line mentioning `Status field` | The Status field ID. |
| `Backlog` / `Ready` / `In progress` / `In review` / `Done`, each followed by a backticked ID, on the status line or the two after it | The Status option IDs. |

The repo and the project number are required; without both, `auto` uses local. Missing IDs are looked up with `gh project field-list` and `gh project view`, so the minimal CLAUDE.md is just those two lines. The matching is tolerant of wording and formatting, not of missing pieces.

Besides CLAUDE.md, `auto` needs `gh auth status` to succeed and `git remote get-url origin` to succeed. Any failure means local.

### GitHub mapping

The board maps onto your existing Projects board without restructuring it. The Status field needs the options Backlog, In progress, In review and Done (Ready is optional). Section means who holds the ball now, not the ownership label.

| Section | A card is there when |
|---|---|
| Done | Status is Done, or the issue is closed. |
| Backlog | Status is Backlog, Ready or empty, even if the issue has the `human` label. Any other Status the board does not know goes here too, unless the issue has the `human` label. |
| Human | Status is In review (tagged `rev`), or Status is In progress (or one the board does not know) and the issue has the `human` label (tagged `hum`). |
| Claude | Status is In progress and the issue has no `human` label. |

Moving a card on GitHub:

| To | What happens |
|---|---|
| Backlog | Status becomes Backlog. |
| Claude | Status becomes In progress; label `ai` is added and `human` is removed if present. |
| Human | Status becomes In review. No label changes. |
| Done | Status becomes Done and the issue is closed. The close is re-read to make sure it took. |

Moving a closed issue out of Done reopens it first. Handoffs and feedback are posted as issue comments; the Diff tab of a card with a linked pull request shows `gh pr diff`.

## Claude's tools and the handoff

Claude gets these tools. They work with the pane closed.

| Tool | Does |
|---|---|
| `kanban_list` | Lists cards, one line each: `#number [column] title`. Done lists only its 10 newest. |
| `kanban_show` | Reads one card: the spec and every handoff and feedback, newest last. |
| `kanban_handoff` | Records a handoff on a card. |
| `kanban_move` | Moves a card to `human`, `claude`, `backlog` or `done`. |
| `kanban_create` | Creates a card (local backend only; on GitHub, Claude is told to use the `/issue` skill). The spec cannot open a handoff or feedback section: marker lines in it are escaped. |

### Handoff format

When Claude finishes or needs you, it records a handoff, in this exact shape:

```markdown
## Handoff (2026-10-25)
**Did:** what was done
**Check:** what you should look at
**Changed:** files or areas touched
**Need from you:** the decision or review needed
```

Handoffs are enforced, not suggested. `kanban_move` to Human is refused unless the card's newest handoff is newer than its newest feedback, and its **Check** and **Need from you** are filled in. The same rule guards direct edits: a `Write` or `Edit` that sets `status: human` in a `.kanban/*.md` file without a valid handoff is denied. The guard fails open, so it never blocks unrelated editing.

## The feedback loop

Open a card in Human to review it. The detail view has:

- **Approve:** moves the card to Done. On GitHub this closes the issue.
- **Send back:** type feedback in the box first, then press the button. The feedback is appended to the card (a `## Feedback (date)` section, or an issue comment on GitHub), the card moves to Claude, and once that move is confirmed Claude is prompted to resume the card: read the newest feedback and continue. An empty box shows a toast and moves nothing.
- **Park:** moves the card to Backlog.

The Human queue can be reviewed from the keyboard: `a` approve, `s` send back, `p` park, `f` write feedback (moves the cursor to the box), `n` / `k` next / previous Human card (wrapping), `b` back to the board. The line under the title reads `Human 2 of 5`, and a dim line lists the keys. After Approve, Send back or Park the next Human card opens by itself, or the board when none is left. The keys work while the pane has the keyboard; `Esc` is the engine's and hands the keyboard back to the prompt.

Moving a card from Backlog to Claude with the move buttons, by drag or by key prompts Claude to start: work on the card, then hand it off. Prompts are sent only after the backend confirms the move and only for moves you make in the pane; Claude's own `kanban_move` never prompts, so the two cannot loop.

On mobile there is no text box, so Send back is not shown; the detail view says to use the terminal or desktop.

The loop: Claude works a card, writes a handoff, and moves it to Human; you review, then Approve, Send back or Park; Send back returns it to Claude with your feedback.

## Card file format

The local backend keeps one file per card in `.kanban/`, named `NNNN-slug.md` (for example `.kanban/0007-fix-login.md`). Create one by hand, or let Claude use `kanban_create`:

```markdown
---
id: 7
title: Fix login: redirect loop
status: claude
order: 3
created: 2026-10-25T10:00:00Z
updated: 2026-10-25T12:00:00Z
---
The spec, in markdown.

## Handoff (2026-10-25)
**Did:** …
**Check:** …
**Changed:** …
**Need from you:** …

## Feedback (2026-10-26)
Your feedback.
```

- `status` is one of `human`, `claude`, `backlog`, `done`; anything else counts as `backlog`.
- `id` is the card number (`#7`); a missing `id` falls back to the filename's number. Titles may contain colons.
- `order` sorts a section, lowest first. Done sorts by `updated`, newest first.
- The Handoff and Feedback sections are appended below the spec. The board rewrites `status`, `order` and `updated` when a card moves, and leaves the body alone.
- Done cards stay as files with `status: done`. The pane never deletes a file.
- Files Claude writes or edits show on the board straight away.

Whether to commit `.kanban/` is up to you.

## Development

Layout: `.claude-plugin/plugin.json`, `hooks/` (the hooks module), `types/index.d.ts`, `tests/`. Strings live in `hooks/strings.ts`. The design is in `docs/plan.md`, the decision log in `docs/decisions.md`.

Run the mod from a checkout:

```
claude --plugin-dir .
```

Gates, all green before merging:

```
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6 tsc -p .
```

Tests use fakes for the filesystem and for `gh`; no test runs a mutating `gh` command against a real repo.

## License

[MIT](LICENSE)

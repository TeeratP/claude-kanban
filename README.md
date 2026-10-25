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

Answer `y` to `Add marketplace?`, then choose a scope. The install flow then shows a settings screen with the `backend` option (see [Backends](#backends)) and the `claudeLimit` option (see [How many cards Claude works on at once](#how-many-cards-claude-works-on-at-once)).

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

- **Terminal and desktop:** drag a card onto any row of a section: its header or the `(empty)` row puts it first, a card puts it before that card or after it, and a `↑`/`↓ N more` row puts it at that edge of the cards shown. Which side of a card is the lower half of its row on a terminal that reports the pointer finer than a cell (kitty, Ghostty, iTerm2, WezTerm, foot); on any other, the way the pointer came: dragged down onto a card the card goes after it, dragged up it goes before it (so the end of a section is reachable by dragging down onto its last card). A line under a row shows where it will land. Dropped in its own section it is reordered; in Done, which lists by update time, it simply moves there. Click a card (press and release without moving) to open it.
- **Terminal and desktop, by keyboard:** the board takes keys once you have clicked it (Esc gives them back). The first key shows the cursor; then `↑`/`↓` (or `k`/`j`) move it, `Enter` does what a click does (open a card, fold a section, page a section), and `m` followed by `1`-`4` or `h`/`c`/`b`/`d` moves the card under the cursor to Human, Claude, Backlog or Done. Any other key cancels the move. `Shift`+`K` and `Shift`+`J` move the card under the cursor one place up or down in its section.
- **VS Code and mobile:** there is no drag. Open the card and press a `Move to:` button, or `↑`/`↓` to move it a place in its section.

A move shows at once, then syncs in the background: `⟳` pulses while it is sent, `✓` confirms (bright for a second, then dim, then gone), `✕` marks a failure on the card's row; open the card for the reason and a Retry button, or press `✕N retry` in the toolbar to send every failed move again. Several quick moves of one card are sent as one request. After the first try and three retries fail, the card snaps back to where it was and a toast gives the reason.

### Who is working on a card

A card in Claude that Claude has worked on gets a dim second row under it: a coloured dot for each agent that took part (`Claude` for the main session, or the subagent's name or type; the same agent always gets the same colour), the name of the one that acted last, what it is doing (`⟳ Edit src/auth.ts`, `⟳ Bash npm test`, or `idle 3m` once nothing has run for a minute) and the cost so far, for example `12m · 48k tok`. The row fits the pane: the stats keep their room first, the activity takes what is left (a path loses its front before its file name) and a long agent name is shortened. The card's own row never changes, so rows stay one line each. A card waiting in the queue (see below) has no second row until it starts. The row belongs to its card: a click on it opens the card, and a card dropped on it lands right after that card (the insertion line is drawn under the row). Dragging from it moves nothing, and the keyboard cursor skips it.

A turn belongs to the card whose work or resume prompt started it, or to the card in Claude that Claude last touched with `kanban_show`, `kanban_handoff` or `kanban_move`; subagents it spawns work for the same card. Time counts while a turn runs on the card, tokens come from each model request in it (input and output, with tokens written to the cache counted as input; cache reads are shown apart, in the detail view). A round is one trip through Claude: it ends when the card leaves Claude and a new one starts when the card is worked on again. Totals are kept per directory and card, so they survive a restart. Open the card to see the agents by name and a breakdown by round.

### How many cards Claude works on at once

The `claudeLimit` setting is a whole number, `1` by default; `0` means no limit. You set it on the settings screen at install and can change it later in the plugin's settings in the config menu (the plugin reloads with the new value). A decimal is rounded down; a negative value or anything but a number counts as unset (`1`).

When Claude is at its limit and you move another card to Claude (the moves that prompt Claude: Backlog to Claude, Send back, and answering a question), the card goes into the Claude section marked `queued N` and dim, and no prompt is sent. The Claude header reads `Claude 1/1 · 2 queued`. When a card leaves Claude (to Human, Done or Backlog, or its move to Claude is given up), the backend confirms that, and the top queued card starts: its work or resume prompt is sent then, never two at once. Queue order is the order of the section. Moving a queued card out of Claude takes it out of the queue.

A queued card is in Status In progress on GitHub like any card in Claude: a column means who holds the ball. The queue itself is local, saved per working directory and `backend` setting, so it survives a restart; the waiting cards start at the first load of the board once a slot is free. Lowering the limit stops no card that is already working. Cards Claude moves itself with `kanban_move` are never queued (they carry no prompt), though they use up a slot; `kanban_list` marks a waiting card `(queued)` so Claude leaves it alone.

### Adding a card

Press `+` in the toolbar (or `n` while the pane has the keys) to open a title field at the top of the board. `Enter` adds the card to Backlog; `Add details` opens a second, taller field for the spec (a new line is typed there as in the prompt box; `Enter` in either field adds the card). `Cancel`, or `+` again, closes the form and drops what you typed; `Esc` only gives the keys back to the prompt, so a half-typed card is not lost. An empty title is refused with a toast. The button is not shown on mobile, which has no text field.

The card shows at once with a pulsing `⟳` (`#0` until its backend has numbered it) and `✓` when it exists. On the local backend it is written to `.kanban/NNNN-slug.md`. On GitHub it is an issue with the `triage` label (created in the repo if missing, never overwritten), added to the project board with Status Backlog: that label marks it for grooming. If the backend refuses, the card disappears, a toast gives the reason and the form comes back with your text. If GitHub made the issue but could not add it to the board, the toast names the issue.

### Suggestions from Claude

When Claude notices a follow-up, a deferred item or out-of-scope work, it calls `kanban_suggest` instead of only mentioning it. The suggestion appears in a dim `Suggested (N)` strip under the toolbar (three rows at most, then `+N more`), with a toast `Claude suggests a card: <title>`. Nothing is created until you press `Add`, which makes a Backlog card exactly as the `+` form does (on GitHub, an issue labeled `triage` on the board; the reason Claude gave is added to the card text). `✕` dismisses it. If the backend refuses, the card goes and the suggestion comes back. A suggestion whose title matches an open card or another suggestion (any case) is not added again. Suggestions are kept per directory until you handle them, also across restarts. The plugin adds one short section to Claude's system prompt asking for this; Claude is told not to create cards itself unless you ask.

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
| Claude | The label `ai` is added and `human` is removed if present (whatever its case), then Status becomes In progress. If the repo has no `ai` label, it is created first. |
| Human | Status becomes In review. No label changes. |
| Done | Status becomes Done and the issue is closed. The close is re-read to make sure it took. |

Moving a closed issue out of Done reopens it first. Handoffs and feedback are posted as issue comments; the Diff tab of a card with a linked pull request shows `gh pr diff`.

Only comments written by the account `gh` is signed in as count toward the handoff rule. Anyone else's Handoff, Feedback, Question or Answer comment is shown on the card, marked with its author, and ignored when deciding whether a card may move to Human.

The board is read with one GraphQL query per 100 items (about 3 points of GitHub's 5000 an hour per page, which includes each issue's newest comments so an open question shows on its row). When the budget runs low or out, polling pauses until it resets and the toolbar says so; the refresh button still works.

## Claude's tools and the handoff

Claude gets these tools. They work with the pane closed.

| Tool | Does |
|---|---|
| `kanban_list` | Lists cards, one line each: `#number [column] title`. Done lists only its 10 newest. |
| `kanban_show` | Reads one card: the spec and every handoff, feedback, question and answer, newest last. |
| `kanban_handoff` | Records a handoff on a card. |
| `kanban_ask` | Asks you a blocking question on a card (see below). |
| `kanban_move` | Moves a card to `human`, `claude`, `backlog` or `done`. |
| `kanban_create` | Creates a card: a file on the local backend, an issue labeled `triage` on the project board on GitHub. The spec cannot open a handoff or feedback section: marker lines in it are escaped (local backend). |
| `kanban_suggest` | Proposes a card for a follow-up. Creates nothing: the suggestion waits in the strip for you to add or dismiss it. |

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

### Questions

When Claude cannot go on without a decision only you can make, it calls `kanban_ask` with the card and the question. The question is recorded on the card (a `## Question (date)` section, or an issue comment on GitHub) and the card moves to Human with a `?` tag on its row. A question counts as a handoff for the move, so no Check or Need is required. You get a toast and a notification that say `Claude asks: …`.

In the detail view of a question card the question is shown at the top and the box is labelled **Answer**. Pressing **Answer** records a `## Answer (date)` section, moves the card to Claude and, once that move is confirmed, prompts Claude that you answered. The rule for a card to move to Human is that its newest Question or Handoff comes after its newest Feedback or Answer. Claude is told to use the tool only for decisions it cannot make, not for progress updates.

## The feedback loop

Open a card in Human to review it. The detail view has:

- **Approve:** moves the card to Done. On GitHub this closes the issue.
- **Send back:** type feedback in the box first, then press the button. The feedback is appended to the card (a `## Feedback (date)` section, or an issue comment on GitHub), the card moves to Claude, and once that move is confirmed Claude is prompted to resume the card: read the newest feedback and continue. An empty box shows a toast and moves nothing.
- **Park:** moves the card to Backlog.
- **Run check:** shown when the newest handoff's **Check** holds a command, as an inline code span (`` `npm test` ``) or a fenced `sh` / `bash` block. The button shows the exact command; nothing runs until you press it, and Claude cannot start it. It runs through `sh -c` in the session's directory and ends at 5 minutes. The result row shows ✓ or ✕, the exit code, the time and the last 20 lines of output. A local card gets a `## Check run (date)` section at once; on GitHub the run is posted as an issue comment only when you press **Attach to card**. There is no Stop: the engine cannot cancel a run in progress.

The Human queue can be reviewed from the keyboard: `a` approve, `s` send back, `p` park, `f` write feedback (moves the cursor to the box), `n` / `k` next / previous Human card (wrapping), `b` back to the board. The line under the title reads `Human 2 of 5`, and a dim line lists the keys. After Approve, Send back (or Answer) or Park the next Human card opens by itself, or the board when none is left; that card ignores Approve, Send back and Park for 0.6 s, so a key pressed twice decides one card, and the walking keys are never held back. The keys work while the pane has the keyboard; `Esc` is the engine's and hands the keyboard back to the prompt.

Moving a card from Backlog to Claude with the move buttons, by drag or by key prompts Claude to start: work on the card, then hand it off. Reordering a card within a section never prompts. Prompts are sent only after the backend confirms the move and only for moves you make in the pane; Claude's own `kanban_move` never prompts, so the two cannot loop.

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
- `order` sorts a section, lowest first. Done sorts by `updated`, newest first. Reordering a card writes only its `order`, between its neighbours' when there is a gap and otherwise renumbering the section by tens (10, 20, 30, …), rewriting only the cards whose number changed. On GitHub the order is the project item's position (`updateProjectV2ItemPosition`).
- The Handoff, Feedback, Question, Answer and Check run sections are appended below the spec. The board rewrites `status`, `order` and `updated` when a card moves, and leaves the body alone.
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

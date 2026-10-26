# claude-kanban

A Claude Code mod that puts a kanban board in a side pane: six sections in two groups that show, at a glance, who holds the ball on every task. Cards live in your GitHub Issues and Projects board, or in plain `.kanban/*.md` files when GitHub isn't set up.

<!-- screenshot: the board pane (Active open: Backlog / Human / Claude, Inactive folded), with the two-row toolbar: the dim status row over `r: Refresh   n: New   f: Find` -->

## Sections

Six sections in two groups. **Active** is the work in hand, **Inactive** is what is over or on hold.

| Group | Section | Who holds the ball | What it means |
|---|---|---|---|
| Active | Backlog | Nobody yet | Parked or not started. |
| Active | Human | You | Claude handed the card over and is waiting on your review or answer. |
| Active | Claude | Claude | Claude is working on it. |
| Inactive | Done | Nobody | Finished. Shows the 10 most recent. |
| Inactive | Cancelled | Nobody | Dropped, not to be done. Shows the 10 most recent. |
| Inactive | Suspended | Nobody | Put on hold, to come back to. Lists every card, in the order you put them. |

One group is open at a time: Active when the pane opens. Press a group's header (`▾ Active`, `▸ Inactive`) to open it, which folds the other; press the open one to fold both. A folded group's header says what it holds (`▸ Inactive   12 Done · 2 Cancelled · 1 Suspended`, shorter in a narrow pane). The three sections of the open group are always the same height, a third of the room each, so nothing jumps when a card moves: a section shows its cards, then `↓ N more` where there are more; the room left under its cards is marked with a quiet dot under the numbers, and an empty section says what it is for (`✓ All clear, nothing needs you` in Human, `Idle · drag a card here` in Claude, `Nothing yet · n adds a card` in Backlog, `Nothing finished yet`, `Nothing on hold`, `Nothing dropped`; shorter in a narrow pane). On the terminal and desktop the first spare row at the bottom of the list is a dim key legend (`⏎ open · m move · ⇧J/K reorder`, which becomes `↑↓ walk · ⏎ open · m+key move` after your first key). While the board loads for the first time it draws dim bars where the cards will be, not an empty board. Each section scrolls on its own with the mouse wheel; the clickable `↑ N more` / `↓ N more` rows page through the rest. When a section's list is already at the end the wheel points to, the wheel scrolls the pane instead. A section header reads `Human 2` followed by a rule to the right edge, and on the right of Claude's the limit (see [How many cards Claude works on at once](#how-many-cards-claude-works-on-at-once)) and of Done's and Cancelled's `10 newest` once they hold more. A card row shows its number, the title and, flush right, a sync glyph and its age. The numbers are right-aligned in a column as wide as the widest on the board, so every title in every section starts at the same cell (the `#` goes when the numbers would take a quarter of the row); a question shows `?12` in the colour for what needs you, and a card still being made `new`. Ages read `now`, `5m`, `3h`, `13d`, `8w`, `2y`: never more than three cells. Done is dim, Cancelled dim with a struck title, Suspended has a dim title, and a failed move turns its number red.

A card moves between sections when you move it in the pane, when Claude moves it with its tools, or (GitHub) when its board status changes elsewhere.

## Install

At the prompt of a terminal session:

```
/plugin install kanban --marketplace TeeratP/claude-kanban
```

Answer `y` to `Add marketplace?`, then choose a scope. The install flow then shows a settings screen with the `backend` option (see [Backends](#backends)), the `claudeLimit` option (see [How many cards Claude works on at once](#how-many-cards-claude-works-on-at-once)) and the `reconcile` option (see [How Claude keeps the board current](#how-claude-keeps-the-board-current)).

From a shell:

```
claude plugin install kanban --marketplace TeeratP/claude-kanban
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `TeeratP/claude-kanban`, then Add plugin.

The GitHub backend also needs the [`gh` CLI](https://cli.github.com), signed in (`gh auth login`). The local backend needs nothing.

## Use

Type `/kanban` to open the board in a side pane. Click a card to open its detail view: its title and where it stands (the section, how long ago it changed, a link to the issue on GitHub), the spec, the handoffs and feedback, and two rows of links to move it. Click `b: ← Board` to go back.

Claude can work the board without the pane open (see [Claude's tools](#claudes-tools-and-the-handoff)).

The toolbar is two rows. The first is dim status text: the active backend (`Local (auto)`, without the `(auto)` in a pane under 40 columns), when the board was last updated (`updated just now`, `updated 5m ago`), and any error (an error is red), and on the terminal and desktop, when it fits the pane's width, a key hint (`↑↓ ⏎ open · m move`). In a narrow pane a status that does not fit beside the backend's name is shown without the name rather than cut. The second row is the buttons, each with its key: `r: Refresh   n: New   f: Find` (on mobile, which has no text field, only `r: Refresh`). When a move has failed it ends with `✕N retry` in red. In a narrow pane the row gives way in this order: the filter's text, the spacing between buttons, then `r: Refresh`, then `n: New`; the filter, its `✕` and the retry stay. While the pane is open the board refreshes every 45 seconds and its ages (the status row's, each card's) redraw every 30. While cards wait in Human the pane's title reads `Kanban · N`, which shows as its tab when several panes are open. The status line shows `1 card waiting on you` or `N cards waiting on you`, and a toast (`Waiting on you: #7 Fix login`) appears when a card newly lands in Human; if Claude moved it, you are notified as well. Cards you moved yourself don't toast.

### Moving cards

- **Terminal and desktop:** drag a card onto any row of a section of the open group: its header or the empty-state line puts it first, a card puts it before that card or after it, a blank row under the cards puts it last, and a `↑`/`↓ N more` row puts it at that edge of the cards shown. The closed group takes a drop too: while you drag, its header turns into three chips (` Done  Cancelled  Suspended `) and the one under the pointer lights; dropped there the card goes last in that section. The open group's own header takes nothing. Which side of a card is the lower half of its row on a terminal that reports the pointer finer than a cell (kitty, Ghostty, iTerm2, WezTerm, foot); on any other, the way the pointer came: dragged down onto a card the card goes after it, dragged up it goes before it (so the end of a section is reachable by dragging down onto its last card). A line under a row shows where it will land, the card you drag is dim and slanted with a `›` in front of it, and the name of the section it would land in is lit. A pointer resting on a card, a `more` row or a group header (no button down) marks it with a `›` in the same place, and underlines a group's name. Dropped in its own section it is reordered; in Done and Cancelled, which list by update time, it simply moves there. Click a card (press and release without moving) to open it.
- **Terminal and desktop, by keyboard:** the board takes keys once you have clicked it (Esc gives them back). The first key shows the cursor; then `↑`/`↓` (or `k`/`j`) move it, `Enter` does what a click does (open a card, open or fold a group, page a section), and `m` followed by `1`-`6` or `b`/`h`/`c`/`d`/`x`/`s` moves the card under the cursor to Backlog, Human, Claude, Done, Cancelled or Suspended, a folded group's sections too: while `m` waits, the headers show the keys (`4/d 5/x 6/s`). Any other key cancels the move. The cursor rests on group headers, cards and `more` rows, not on the section headers. `Shift`+`K` and `Shift`+`J` move the card under the cursor one place up or down in its section.
- **VS Code and mobile:** there is no drag. Open the card and press a link on its `Move to` row (the other Active sections) or its `Set aside` row (`Done`, `Cancel`, `Suspend`, without the card's own section), or `↑`/`↓` to move it a place in its section (not in Done or Cancelled). The group headers are buttons here; the section headers are labels.

A move shows at once, then syncs in the background: `⟳` pulses while it is sent, `✓` confirms (bright for a second, then dim, then gone), `✕` marks a failure on the card's row; open the card for the reason and a Retry button, or press `✕N retry` in the toolbar to send every failed move again. Several quick moves of one card are sent as one request. After the first try and three retries fail, the card snaps back to where it was and a toast gives the reason.

### Who is working on a card

A card in Claude that Claude has worked on gets a dim second row under it: a coloured dot for each agent that took part (`Claude` for the main session, or the subagent's name or type; the same agent always gets the same colour), the name of the one that acted last, what it is doing (`⟳ Edit src/auth.ts`, `⟳ Bash npm test`, or `idle 3m` once nothing has run for a minute) and the cost so far, for example `●● Explore · idle 3m · 12m · 48k`, joined by dots and starting under the card's title. The main session's dot is always Claude's colour; a subagent's is never Claude's nor the one for what needs you. The row fits the pane: the stats keep their room first, the activity takes what is left (a path loses its front before its file name), and when there is less than a few cells for it the activity goes, then the name. The detail view keeps the longer form (`48k tok`). The card's own row never changes, so rows stay one line each. A card waiting in the queue (see below) has no second row until it starts. The row belongs to its card: a click on it opens the card, and a card dropped on it lands right after that card (the insertion line is drawn under the row). Dragging from it moves nothing, and the keyboard cursor skips it.

A turn belongs to the card whose work or resume prompt started it, or to the card in Claude that Claude last touched with `kanban_show`, `kanban_handoff` or `kanban_move`; subagents it spawns work for the same card. Time counts while a turn runs on the card, tokens come from each model request in it (input and output, with tokens written to the cache counted as input; cache reads are shown apart, in the detail view). A round is one trip through Claude: it ends when the card leaves Claude and a new one starts when the card is worked on again. Totals are kept per directory and card, so they survive a restart. Open the card to see the agents by name and a breakdown by round.

### How many cards Claude works on at once

The `claudeLimit` setting is a whole number, `1` by default; `0` means no limit. You set it on the settings screen at install and can change it later in the plugin's settings in the config menu (the plugin reloads with the new value). A decimal is rounded down; a negative value or anything but a number counts as unset (`1`).

When Claude is at its limit and you move another card to Claude (the moves that prompt Claude: taking a card up from Backlog, Suspended, Cancelled or Done, Send back, and answering a question), the card goes into the Claude section dim, with `queued N` (`qN` in a narrow pane) where its age goes, and no prompt is sent. The Claude header reads `Claude 3 ── limit 1 · 2 queued`, and `limit 1 · 1 over` in a warning colour when more cards sit in Claude than the limit (Claude moved them in itself). When a card leaves Claude (to Human, Done, Backlog, Suspended or Cancelled, or its move to Claude is given up), the backend confirms that, and the top queued card starts: its work or resume prompt is sent then, never two at once. Queue order is the order of the section. Moving a queued card out of Claude takes it out of the queue. Suspending or cancelling the card Claude is working on does not stop its turn (the mod cannot interrupt one): a toast says `Claude is still working on #12. Press Esc in the prompt to stop it.`

A queued card is in Status In progress on GitHub like any card in Claude: a column means who holds the ball. The queue itself is local, saved per working directory and `backend` setting, so it survives a restart; the waiting cards start at the first load of the board once a slot is free. Lowering the limit stops no card that is already working. Cards Claude moves itself with `kanban_move` are never queued (they carry no prompt), though they use up a slot; `kanban_list` marks a waiting card `(queued)` so Claude leaves it alone.

### Adding a card

Press `n: New` in the toolbar (or the `n` key while the pane has the keys) to open a title field at the top of the board. `Enter` adds the card to Backlog. A dim line under the field says so (`⏎ adds to Backlog`) and holds two links: `Add details` opens a second, taller field for the spec (a new line is typed there as in the prompt box; `Enter` in either field adds the card), and while it is open the link reads `Hide details` and folds the field away, keeping what was typed in it for when it is shown again; hidden details are not added to the card. The wording shortens to fit a narrow pane. `Cancel`, or `n: New` again, closes the form and drops what you typed; `Esc` only gives the keys back to the prompt, so a half-typed card is not lost. An empty title is refused with a toast. The button is not shown on mobile, which has no text field.

The card shows at once with a pulsing `⟳` (`new` in the number column until its backend has numbered it) and `✓` when it exists. On the local backend it is written to `.kanban/NNNN-slug.md`. On GitHub it is an issue with the `triage` label (created in the repo if missing, never overwritten), added to the project board with Status Backlog: that label marks it for grooming. If the backend refuses, the card disappears, a toast gives the reason and the form comes back with your text. If GitHub made the issue but could not add it to the board, the toast names the issue.

### Filtering the board

Press `f: Find` in the toolbar (or the `f` key while the pane has the keys) to open a filter field under it. The board follows what you type, in every section at once:

| You type | It shows |
| --- | --- |
| `login retry` | cards whose title has every word (any case); `"login retry"` in quotes is one phrase |
| `#12` | card number 12 (`#12 #15` shows either) |
| `label:ai`, `-label:human` | cards with that GitHub label, or without it; every `label:` must hold; `label:"good first issue"` names a label with spaces (local cards have no labels) |
| `[KANB-UIX]`, `[KANB]`, `area:UIX` | cards whose title starts with that `[PRJ-AREA]` prefix, its project, or its area (several are alternatives) |
| `@claude`, `@human`, `@backlog`, `@done`, `@cancelled` (or `@canceled`), `@suspended` | cards in those sections only |
| `@active`, `@inactive` | cards in the three sections of that group |

The words, labels and kinds of term all have to hold together: `@backlog label:ai area:UIX retry`. A key with nothing after it yet (`label:`) asks for nothing, and an unknown `@name` is a word.

Each header counts the cards shown out of all it holds while a filter is on (`Backlog 3/41`), the group that has matches is drawn open for as long as the filter is on (the open one if it has any, else Active, else Inactive; the group you chose is not changed, and pressing a group while a filter is on picks which one is drawn until the text changes), a folded group says how many cards match (`3 matches`), and Done's and Cancelled's ten newest are taken from the cards that match. A section with none says `No matches`. The text shows in the toolbar as `f: Find "fix login"` followed by a `✕` that clears it (cut with an ellipsis to fit the row, and left out when there is no room); `Enter` in the field shuts the field and keeps the filter, so the board can be walked by key. `Esc` only gives the keys back to the prompt (it is the engine's), so clearing is the `✕`. The filter is not saved: it lasts until the session ends.

The filter only changes what is drawn. Everything you do acts on the cards you can see: the keyboard cursor, a click, a drop, the wheel and `J`/`K` all use the visible rows. A card put at a place in a section goes right after the nearest visible card above that place, ahead of any hidden cards that followed it (first in the section when none is above), so the visible order is the one you made and the hidden cards keep their order among themselves. The field is not shown on mobile, which has no text field. While the field is open the wheel scrolls the pane, not a section.

### Suggestions from Claude

When Claude notices a follow-up, a deferred item or out-of-scope work, it calls `kanban_suggest` instead of only mentioning it. The suggestion appears in a dim `Suggested (N)` strip under the toolbar (three rows at most, then `+N more`), with a toast `Claude suggests a card: <title>`. Nothing is created until you press `Add`, which makes a Backlog card exactly as the `n: New` form does (on GitHub, an issue labeled `triage` on the board; the reason Claude gave is added to the card text). `✕` dismisses it. If the backend refuses, the card goes and the suggestion comes back. A suggestion whose title matches an open card (anything but Done and Cancelled, so a card on hold counts) or another suggestion (any case) is not added again. Suggestions are kept per directory until you handle them, also across restarts.

A dismissed suggestion is remembered (the last 200 per directory, also across restarts): if Claude suggests the same title again, nothing is added, no toast is shown, and Claude is told you dismissed it. A dim `Show dismissed (N)` row under the strip lists the newest three (`Hide dismissed (N)` shuts them again, then `+N more`); `Restore` puts one back at the top of the strip. The plugin adds one short section to Claude's system prompt asking for this; Claude is told not to create cards itself unless you ask.

### How Claude keeps the board current

A session with the plugin knows the board is the project's backlog without a line in CLAUDE.md or AGENTS.md. The plugin adds one short section to Claude's system prompt (to every request but a `--bare` one) that names the backlog and states the rules:

- On a GitHub board: `This project's backlog is GitHub Issues on board <owner>/#<n>.`
- On local cards: `This project's backlog is the .kanban/*.md cards.`
- While the backend is not known yet: `This project's backlog is a kanban board.`

The backend is named from the `backend` setting and what is already known, with no call to `gh`. `local` says the `.kanban` cards at once; `github` says `GitHub Issues.` (and the board, once it is known). Under `auto` it is the backend the board has, else the one the last load saved for the directory, else the board an earlier detection found (see [How GitHub is detected](#how-github-is-detected)). When none of those exists, the first session in a directory detects it in the background at its start, as the pane would on opening, without opening the pane; an error there, a rate limit among them, only goes to the debug log, and the only toast is the one-time note that a board has no In review status. The section names the backend from the next request, and later sessions read what was saved.

The rules are the same for all three. Asked to work the backlog, or given no task, Claude takes the top Backlog card (`kanban_list`) and moves it to Claude before writing code. When the work a card tracks is done it records `kanban_handoff` and moves the card to Human; it never moves a card to Done, which you approve. Blocked on a decision only you can make, it calls `kanban_ask`. For follow-ups it calls `kanban_suggest`, and it creates a card with `kanban_create` only when asked. It never moves a card into or out of Suspended or Cancelled, and it uses the kanban tools, not `gh issue` or `gh project` edits or hand edits of `.kanban` files, so the board stays in sync.

Claude can forget the last step, so the plugin checks when a turn ends. The `reconcile` setting (on by default; off turns off only what follows, not the section above) covers a turn of the main session that Claude answered: not one you interrupted, one that ended in an error or a refusal, a subagent's, nor one the check itself started.

- **A card still in Claude.** The turn worked on a card if it began with that card's work, resume or answer prompt, or called `kanban_show`, `kanban_handoff`, `kanban_move` or `kanban_ask` on it. If the card is still in Claude and the turn left it no handoff, no question and no move out of Claude (a move into Claude says nothing about the work), the plugin sends one prompt: `Card #12 is still in Claude. If the work is done, record a handoff and move it to Human; if you need a decision, kanban_ask; if you are still working, say so and continue.` A card waiting in the queue is not asked about.
- **Work with no card.** If the turn changed files (`Edit`, `Write` or `NotebookEdit`, other than a `.kanban/*.md` card file), touched no card and no card is in Claude, a toast says `This turn changed files with no card in Claude. If it is backlog work, move or create its card.` once a session. It is a toast, not a prompt, so it costs no turn and Claude creates no card you did not ask for.

The check cannot loop. A turn that a check prompt started is never checked; a card is asked about once per round (a round ends when the card leaves Claude, and a new one starts when it is worked on again), however many turns it takes; nothing is sent while a prompt that starts work is on its way (a card moved to Claude whose move the backend has not yet confirmed); a card waiting in the queue is no reason to wait, since it starts the moment a slot is free; and the work-with-no-card toast shows once a session.

## Backends

A project uses one backend. They do not sync with each other.

| Backend | Cards are |
|---|---|
| GitHub | Issues of one repo, laid out by one Projects-v2 board's Status field. |
| Local | Markdown files in `.kanban/` in the working directory. |

The `backend` setting picks which. You choose it on the settings screen at install, and can change it later in the plugin's settings in the config menu; changing it reloads the plugin with the new value. A stored value that is not one of the three counts as unset (`auto`). Choosing `github` there is refused while `gh` is not installed or not signed in, and the row says so when `gh` is missing.

| `backend` | Behaviour |
|---|---|
| `auto` (default) | GitHub when [CLAUDE.md or AGENTS.md names a repo and a project board](#how-github-is-detected), or, with no such config, when `git` and `gh` find a GitHub Project linked to the origin remote's repo; and `gh` is signed in. Otherwise local. |
| `github` | GitHub only. If a check fails there is no silent fallback: the toolbar shows the failing check and how to fix it (for example install `gh`, `gh auth login`, link a Project to the repo, or add the board to CLAUDE.md or AGENTS.md). |
| `local` | Always `.kanban/*.md`, even when GitHub is available. |

The toolbar names the active backend and, when `auto` chose it, says so: `GitHub (auto)`, `Local (auto)`, or just `GitHub` / `Local` when you set it. A board found without config is named: `GitHub (auto) · #2 @TeeratP's Kanban` (cut to fit the pane; press it to [change the board](#no-config-needed)). When `auto` fell back to local because a CLAUDE.md or AGENTS.md mentions a project board that could not be read, it says `Local (auto) · board config not understood`; when it found no board for the repo, `Local (auto) · no GitHub board for owner/repo`. An empty local board under `auto` also says how to point the mod at GitHub. Setting `backend` to `github` shows the exact check that fails.

**Switching backends does not migrate cards.** Cards created on GitHub stay on GitHub and `.kanban/` files stay on disk; the board shows only the active backend's cards. When the backend changes, the board and the saved copy of it from the old setting are set aside, so cards from the old one never show.

### How GitHub is detected

`auto` and `github` look in this order: explicit config in CLAUDE.md or AGENTS.md first, and only without it the [zero-config search](#no-config-needed).

#### Explicit config

The board reads `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` in the working directory, plus the files they import with Claude Code's `@path` syntax (so a `CLAUDE.md` that is only `@AGENTS.md` works). Imports are followed one level deep, each file is read once, and only project-relative paths count: an import of an absolute path, a home path or a file outside the project is ignored. The texts are joined (at most 1,000,000 characters) and read as one. This repo's own `CLAUDE.md` is an example:

```markdown
- Repo: `TeeratP/claude-kanban` (public).
- Project board: #7 "claude-kanban" (owner `TeeratP`, project ID `PVT_kwHOAcCsLc4BorgL`).
- Status field `PVTSSF_lAHOAcCsLc4BorgLzhnKcpg` options: Backlog `1a1cd0bb` · Ready `61b99878` · In progress `b15c285e` · In review `5f34c9ff` · Done `201b4a64`.
```

| Read from the line | As |
|---|---|
| A line containing `repo` with a backticked `owner/name` | The repo. The board's owner is the repo's owner. |
| `Project board: #7` (or `Project: #7`, bold allowed), `project number 2` or `project 2` (the number may be in backticks or bold), a `github.com/users/<owner>/projects/2` (or `orgs`) URL, or a `#N` right after the word project or board (case does not matter; when several appear, a URL wins, then `Project board: #N`, then the others) | The project number. |
| The first `PVT_…` ID | The project ID. |
| A `PVTSSF_…` ID on a line mentioning `Status field` (backticks around `Status` are fine) | The Status field ID. |
| `Backlog` / `Ready` / `In progress` / `In review` / `Done`, each followed by a backticked ID (a label like `Ready (To Do) option` is fine), on the status line or the two after it | The Status option IDs. |

The repo and the project number are required; without both, `auto` uses local. Missing IDs are looked up with `gh project field-list` and `gh project view`, so the minimal CLAUDE.md is just those two lines. The matching is tolerant of wording and formatting, not of missing pieces; the repo line stays strict (a backticked `owner/name` after a `Repo:` label), because a move writes to that repo.

Besides the config, `auto` needs `gh --version`, `gh auth status` and `git remote get-url origin` to succeed. Any failure means local.

#### No config needed

With no repo and project number in the config files, the board is found from `git` and `gh` alone. Everything it runs only reads.

1. `git remote get-url origin` must be a github.com URL (`https://github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `git://…`); `owner/repo` is taken from it.
2. `gh --version` and `gh auth status` must succeed.
3. One GraphQL query (1 point) lists the open Projects linked to the repo with the repo of each of their first 100 items.
   - **One board:** it is used.
   - **Several:** the one with the most items from this repo wins (a board shared by several repos counts only this repo's items). On a tie, a one-row picker shows `Pick board: [#2 @TeeratP's Kanban] [#6 Car Cast]`; nothing loads until you press one (under `auto` and `github` alike, and Claude's tools say so).
   - **None linked:** the signed-in user's and the repo owner's open projects (first 20 of each, one more query) are scanned the same way, using only those that hold issues of this repo.
   - **No board anywhere:** `auto` uses local files (`Local (auto) · no GitHub board for owner/repo`); `github` shows an error.
4. The Status field comes from `gh project field-list`. Option names are matched without regard to case: Backlog, Todo, To Do (Ready if there are none) for Backlog; Ready is kept as Ready; In progress or Doing; In review or Review; Done or Closed. A board without In review keeps working: Human is then the `human` label on a card in progress, and a toast says so once. A board with no Backlog, In progress or Done cannot be used, and `github` names which.

Only the first 100 items of a board are counted, so a repo whose items on a large shared board all sit past the first page looks like it has none there.

The result is kept per directory (`detect:<cwd>` in the plugin's store) with the origin URL, so later sessions only read the origin. It is searched for again when the origin changes, when a load says the project is not found, or when you press the board name in the toolbar: that looks at the repo's boards again and shows `Change board: [#2 …] [#6 …]` (or a toast, `No other GitHub board is linked to owner/repo.`). Your pick is local state only; nothing is written to GitHub. A result that is not a board (local, or a tie) is not kept, so it is looked for again next session. If GitHub's rate limit stops the search, `auto` does not settle for local: the toolbar shows the pause, as for a board load.

### GitHub mapping

The board maps onto your existing Projects board without restructuring it, and never adds an option to it. The Status field needs the options Backlog, In progress, In review and Done (Ready is optional); a few other names are understood (see [No config needed](#no-config-needed)), and a board found without config may lack In review. Section means who holds the ball now, not the ownership label.

| Section | A card is there when |
|---|---|
| Cancelled | The issue is closed as not planned (or as a duplicate), or its Status is named like Cancelled, Won't do or Not planned. |
| Done | The issue is closed any other way, or its Status is Done. |
| Suspended | Its Status is named like Suspended, On hold, Paused, Icebox, Someday or Deferred, or the issue has the label `suspended`. Not Blocked: blocked work is active work that waits. |
| Backlog | Status is Backlog, Todo, Ready or empty, even if the issue has the `human` label. Any other Status the board does not know goes here too, unless the issue has the `human` label. |
| Human | Status is In review (the card's detail view says `in review`), or Status is In progress (or one the board does not know) and the issue has the `human` label (the detail view says `labelled human`). |
| Claude | Status is In progress and the issue has no `human` label. |

The first page of the board query also lists the Status field's options (a list, so it costs no more: 3 points a page, with it or without), which is how a board's own Cancelled and Suspended options are found even when CLAUDE.md names only five.

Moving a card on GitHub:

| To | What happens |
|---|---|
| Backlog | Status becomes Backlog. |
| Claude | The label `ai` is added and `human` is removed if present (whatever its case), then Status becomes In progress. If the repo has no `ai` label, it is created first. |
| Human | Status becomes In review. No label changes. (A board without In review: the label `human` is added, created in the repo if missing, and Status becomes In progress.) |
| Done | Status becomes Done and the issue is closed as completed. The close is re-read, reason included, to make sure it took. |
| Cancelled | Status becomes the board's Cancelled option, or Done on a board with none (the board keeps closed items in its Done column), and the issue is closed as not planned and re-read. |
| Suspended | Status becomes the board's Suspended option. On a board with none, the issue gets the label `suspended` (created in the repo once, never overwritten; `human` is removed if present) and rests in Backlog. |

Moving a card out of Suspended takes the `suspended` label off, as the repo spells it. Without a Cancelled or Suspended option, GitHub's own board shows those cards in Done and Backlog; the difference is the issue's close reason ("Closed as not planned") and the label. Moving a closed issue out of Done or Cancelled reopens it first, and so does moving a Done issue to Cancelled or the other way (`gh issue close` on a closed issue changes nothing, so the reason would stay). Handoffs and feedback are posted as issue comments; the Diff tab of a card with a linked pull request shows `gh pr diff`.

Only comments written by the account `gh` is signed in as count toward the handoff rule. Anyone else's Handoff, Feedback, Question or Answer comment is shown on the card, marked with its author, and ignored when deciding whether a card may move to Human.

The board is read with one GraphQL query per 100 items (about 3 points of GitHub's 5000 an hour per page, which includes each issue's newest comments so an open question shows on its row). When the budget runs low or out, polling pauses until it resets and the toolbar says so; the refresh button still works.

## Claude's tools and the handoff

Claude gets these tools. They work with the pane closed.

| Tool | Does |
|---|---|
| `kanban_list` | Lists cards, one line each: `#number [column] title`. Any of the six columns. Done and Cancelled list only their 10 newest. |
| `kanban_show` | Reads one card: the spec and every handoff, feedback, question and answer, newest last. |
| `kanban_handoff` | Records a handoff on a card. |
| `kanban_ask` | Asks you a blocking question on a card (see below). |
| `kanban_move` | Moves a card to `human`, `claude`, `backlog` or `done`. Suspended and Cancelled are your calls: Claude cannot move a card there, and it is refused a move (or a question) on a card you set aside until you move it back. `kanban_show` and `kanban_handoff` still work on it. |
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

When Claude cannot go on without a decision only you can make, it calls `kanban_ask` with the card and the question. The question is recorded on the card (a `## Question (date)` section, or an issue comment on GitHub) and the card moves to Human and its row shows `?` in place of `#` (`?12`). A question counts as a handoff for the move, so no Check or Need is required. You get a toast and a notification that say `Claude asks: …`.

In the detail view of a question card the question is shown at the top and the box is labelled **Answer**. Pressing **Answer** records a `## Answer (date)` section, moves the card to Claude and, once that move is confirmed, prompts Claude that you answered. The rule for a card to move to Human is that its newest Question or Handoff comes after its newest Feedback or Answer. Claude is told to use the tool only for decisions it cannot make, not for progress updates.

## The feedback loop

Open a card in Human to review it. The detail view shows the nav row, the title and where the card stands, then the actions, then the handoff to review (Claude's newest handoff, or its open question) as a short list of Did, Check, Changed and Need, the Check with its **Run check** button, the `Move to` and `Set aside` rows, the spec, and a History of every other section, oldest first, each with its date and colored by who wrote it (Claude or you). Nothing runs past the edge of a narrow pane: the buttons wrap, and the nav row gives up its arrows, then its place, then its words. The actions are:

- **Approve:** moves the card to Done. On GitHub this closes the issue.
- **Send back:** type feedback in the box first, then press the button. The feedback is appended to the card (a `## Feedback (date)` section, or an issue comment on GitHub), the card moves to Claude, and once that move is confirmed Claude is prompted to resume the card: read the newest feedback and continue. An empty box shows a toast and moves nothing.
- **Park:** moves the card to Backlog.
- **Run check:** shown when the newest handoff's **Check** holds a command, as an inline code span (`` `npm test` ``) or a fenced `sh` / `bash` block. The button shows the exact command (on a narrow pane it is cut to fit, with the whole command above it); nothing runs until you press it, and Claude cannot start it. It runs through `sh -c` in the session's directory and ends at 5 minutes. The result row shows ✓ or ✕, the exit code, the time and the last 20 lines of output. A local card gets a `## Check run (date)` section at once; on GitHub the run is posted as an issue comment only when you press **Attach to card**. There is no Stop: the engine cannot cancel a run in progress.

The Human queue can be reviewed from the keyboard: `a` approve, `s` send back, `p` park, `f` write feedback (moves the cursor to the box), `n` / `k` next / previous Human card (wrapping), `b` back to the board. The nav row reads `k: ‹ Prev  2/5  n: Next ›`, and every key is drawn on its button, so there is no separate list of keys. After Approve, Send back (or Answer) or Park the next Human card opens by itself, or the board when none is left; that card ignores Approve, Send back and Park for 0.6 s, so a key pressed twice decides one card, and the walking keys are never held back. The keys work while the pane has the keyboard; `Esc` is the engine's and hands the keyboard back to the prompt.

Moving a card to Claude from Backlog, Suspended, Cancelled or Done with the move buttons, by drag or by key prompts Claude to start: work on the card, then hand it off. (From Human it is Send back, with its own prompt.) Reordering a card within a section never prompts. Prompts are sent only after the backend confirms the move and only for moves you make in the pane; Claude's own `kanban_move` never prompts, so the two cannot loop.

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

- `status` is one of `human`, `claude`, `backlog`, `done`, `suspended`, `cancelled` (`canceled` is read as `cancelled` and written back as `cancelled`); anything else counts as `backlog`.
- `id` is the card number (`#7`); a missing `id` falls back to the filename's number. Titles may contain colons.
- `order` sorts a section, lowest first. Done and Cancelled sort by `updated`, newest first; Suspended keeps its `order`, like Backlog. Reordering a card writes only its `order`, between its neighbours' when there is a gap and otherwise renumbering the section by tens (10, 20, 30, …), rewriting only the cards whose number changed. On GitHub the order is the project item's position (`updateProjectV2ItemPosition`); a card moved to another section with no place asked is positioned after the last card there, so a reload keeps the order it arrived in.
- The Handoff, Feedback, Question, Answer and Check run sections are appended below the spec. The board rewrites `status`, `order` and `updated` when a card moves, and leaves the body alone.
- Done and Cancelled cards stay as files with `status: done` or `cancelled`. The pane never deletes a file.
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

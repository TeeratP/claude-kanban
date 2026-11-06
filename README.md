<h1 align="center">claude-kanban</h1>

<p align="center"><b>See who holds the ball.</b><br>
A Claude Code mod that puts a kanban board in a side pane. Cards are your GitHub Issues, laid out by a Projects board. Claude works the board with its own tools, and you review what it hands back.</p>

<!-- video: kanban intro -->

<!-- screenshot: the board pane (Active open: Backlog / Claude / Me, Inactive folded), with the two-row toolbar: the dim status row over `r: Refresh   n: New   v: Mine + open   f: Find` -->

```
/plugin install kanban --marketplace TeeratP/claude-kanban
```

<sub>Needs the <a href="https://cli.github.com"><code>gh</code> CLI</a>, a github.com repo and a GitHub Projects board. You don't have to set them up first: the pane says what is missing and offers to have Claude set it up.</sub>

## What it adds

| | What you get |
| --- | --- |
| Board | Six sections in two groups. **Active**: Backlog, Claude, Me. **Inactive**: Done, Cancelled, Suspended. |
| Cards | Your GitHub Issues, placed by a Projects board's Status field. There is no other backend. |
| Moves | Drag, keys or links. A move shows at once and syncs in the background. |
| Claude's tools | Six `kanban_*` tools to list, read, hand off, ask, move and create cards. They work with the pane closed. |
| Handoffs | Enforced. Claude can't close a card without a handoff that says what it did and how to check it. |
| Review | Approve, Send back, Park or Run check on any card that waits on you. |
| Turn-end check | If Claude forgets to hand off or move a card, the mod reminds it once. |
| Setup | When GitHub isn't ready, one button (`g: Set up with Claude`) asks Claude to fix it. |

## Highlights

- **Who holds the ball, at a glance.** Backlog is nobody's yet, Claude is Claude's, Me is yours.
- **No config needed.** The board is found from your `origin` remote and `gh` alone, or named in CLAUDE.md or AGENTS.md.
- **Claude knows the board.** The mod tells Claude the backlog and its rules, with no line in CLAUDE.md.
- **Handoffs, not guesses.** Each finished card carries **Did**, **Check**, **Changed** and **Need from you**.
- **Review from the keyboard.** `a` approve, `s` send back, `p` park, `n` / `k` next and previous.
- **Run the check.** A command in the handoff's **Check** becomes a **Run check** button. Nothing runs until you press it.
- **See the work.** A card in Claude shows which agents worked on it, what they are doing now, and the time and tokens spent.
- **Find any card.** `f: Find` filters every section by words, numbers, labels and sections.
- **Share a board.** Cards belong to their GitHub assignee. Each person gets a colour and a name.

## Good to know

- **Where it works:** the terminal, the desktop app, VS Code and mobile.
  - VS Code and mobile have no drag. You move a card from its detail view.
  - Mobile has no text field, so it has no `n: New`, no `f: Find`, no Send back and no name `Change`.
- **What it needs:** the `gh` CLI, signed in (`gh auth login`), a github.com `origin` remote, and a GitHub Projects board for the repo. See [Setting up GitHub](#setting-up-github).
- **What it costs:** GitHub API points, not Claude turns. One page of 100 board items costs about 3 of GitHub's 5000 points an hour. The board refreshes every 45 seconds while the pane is open. When the budget runs low, polling pauses.
- **What it writes to GitHub:** issue Status, close and reopen, issue comments (handoffs, feedback, questions, answers), and the labels `triage`, `ai`, `human` and `suspended` (created in the repo when missing). Your name goes in a block at the end of the board's README. It never adds an option to your board.
- **What it tells Claude:** one short section in Claude's system prompt. See [How Claude keeps the board current](#how-claude-keeps-the-board-current).
- **Claude asks before it adds a card.** It never adds a card to the board without a clear yes from you in chat.

## Install

At the prompt of a terminal session:

```
/plugin install kanban --marketplace TeeratP/claude-kanban
```

1. Answer `y` to `Add marketplace?`.
2. Choose a scope.
3. A settings screen shows the `reconcile` option. See [How Claude keeps the board current](#how-claude-keeps-the-board-current).

From a shell:

```
claude plugin install kanban --marketplace TeeratP/claude-kanban
```

In the desktop app, `/plugin` does not run. Instead:

1. Click + next to the prompt box, then Plugins.
2. Add marketplace with `TeeratP/claude-kanban`.
3. Add plugin.

The board needs the [`gh` CLI](https://cli.github.com), signed in (`gh auth login`), a github.com `origin` remote and a GitHub Projects board for the repo. You don't have to set those up first; see [Setting up GitHub](#setting-up-github).

## Sections

Six sections in two groups. **Active** is the work in hand. **Inactive** is what is over or on hold.

| Group | Section | Who holds the ball | What it means |
|---|---|---|---|
| Active | Backlog | Nobody yet | Parked or not started. |
| Active | Claude | Claude | Claude is working on it. |
| Active | Me | You | Claude needs you: your approval or an answer. (Claude's tools call it `human`.) |
| Inactive | Done | Nobody | Finished: Claude closed it after a handoff, or you approved it. Shows the 10 most recent. |
| Inactive | Cancelled | Nobody | Dropped, not to be done. Shows the 10 most recent. |
| Inactive | Suspended | Nobody | Put on hold, to come back to. Lists every card, in the order you put them. |

A card moves between sections in three ways:

- you move it in the pane;
- Claude moves it with its tools;
- its board status changes on GitHub.

### Groups

- One group is open at a time. Active is open when the pane opens.
- Press a group's header (`▾ Active`, `▸ Inactive`) to open it. That folds the other group.
- Press the open group's header to fold both.
- A folded group's header says what it holds: `▸ Inactive   12 Done · 2 Cancelled · 1 Suspended` (shorter in a narrow pane).

The three sections of the open group are always the same height, a third of the room each. So nothing jumps when a card moves.

### Inside a section

- A section shows its cards, then `↓ N more` when there are more.
- The room left under its cards is marked with a quiet dot under the numbers.
- Each section scrolls on its own with the mouse wheel. The clickable `↑ N more` and `↓ N more` rows page through the rest.
- When a section's list is already at the end the wheel points to, the wheel scrolls the pane instead.
- While the board loads for the first time, it draws dim bars where the cards will be, not an empty board.
- On the terminal and desktop, the first spare row at the bottom of the list is a dim key legend: `⏎ open · m move · ⇧J/K reorder`. After your first key it becomes `↑↓ walk · ⏎ open · m+key move`.

An empty section says what it is for (shorter in a narrow pane):

| Section | Empty text |
|---|---|
| Me | `✓ All clear, nothing needs you` |
| Claude | `Idle · drag a card here` |
| Backlog | `Nothing yet · n adds a card` |
| Done | `Nothing finished yet` |
| Suspended | `Nothing on hold` |
| Cancelled | `Nothing dropped` |

### Section headers

A section header shows its name and count, then a rule to the right edge.

- **An active section** shows your cards and all its cards: `Backlog 3 mine · 10 all`. This holds whatever the [view](#whose-cards).
  - It reads `3 · 10` when the pane is too narrow for the words.
  - It reads the filter's `shown/total` while a filter is on.
- **An inactive section** shows its total: `Done 12`.
- Done and Cancelled show `10 newest` on the right once they hold more than 10.

### Copying cards

- Backlog, Claude and Me headers end in `[copy]`. It copies the cards the section shows, one per line, as `#12 Fix login`. That is the whole list, with the view and the filter applied.
- A card in those sections shows its own `[copy]` in place of its age while the pointer rests on it. A press there copies that card alone. A press anywhere else on the row still opens the card.
- A toast says how many cards were copied.
- On VS Code and mobile, which have no pointer to rest, a press anywhere on an active section's header copies the section.

### Card rows

A card row shows its number, its title and, flush right, a sync glyph and its age.

- The numbers are right-aligned in a column as wide as the widest on the board. So every title in every section starts at the same cell.
- The `#` goes when the numbers would take a quarter of the row.
- A question shows `?12`, in the colour for what needs you.
- A card still being made shows `new`.
- Ages read `now`, `5m`, `3h`, `13d`, `8w`, `2y`. They never take more than three cells.

| Card | Looks |
|---|---|
| Done | Dim. |
| Cancelled | Dim, with a struck title. |
| Suspended | Dim title. |
| Failed move | Red number. |

## Use

Type `/kanban` to open the board in a side pane.

Click a card to open its detail view. It shows:

- its title and where it stands: the section, how long ago it changed, and a link to the issue on GitHub;
- the spec;
- the handoffs and feedback;
- two rows of links to move it.

Click `b: ← Board` to go back.

Claude can work the board without the pane open (see [Claude's tools](#claudes-tools-and-the-handoff)).

### The toolbar

The toolbar has two rows.

**Row 1: status (dim text).** It shows:

- `GitHub` and, for a board found without config, its number and name;
- when the board was last updated (`updated just now`, `updated 5m ago`);
- any error, in red;
- on the terminal and desktop, when it fits the pane's width, a key hint (`↑↓ ⏎ open · m move`).

At the right end of the row, a dim `s: Settings` opens the Settings view.

- The status gives way to it; the age goes first.
- In a pane too narrow for both, it reads `s: Set…`, then is left out. The backend's name stays.
- In a narrow pane, a status that does not fit beside the backend's name is shown without the name rather than cut.

**Row 2: buttons, each with its key.**

```
r: Refresh   n: New   v: Mine + open   f: Find
```

- On mobile, which has no text field, the row is `r: Refresh   v: Mine + open`.
- `v` picks [whose cards](#whose-cards) show.
- When a move has failed, the row ends with `✕N retry` in red.

In a narrow pane the row gives way in this order:

1. the filter's text;
2. the spacing between buttons;
3. `r: Refresh`;
4. `n: New`;
5. the view's long name (it becomes `Mine+` or `All`);
6. the `v` button.

The filter, its `✕` and the retry always stay. While a filter is on, its text keeps its place: tighter spacing, then `r: Refresh` giving way, make room for it.

### Refresh and alerts

- While the pane is open, the board refreshes every 45 seconds.
- Its ages (the status row's and each card's) redraw every 30 seconds.
- While cards wait in Me, the pane's title reads `Kanban · N`. That shows as its tab when several panes are open.
- The status line shows `1 card waiting on you` or `N cards waiting on you`.
- A toast (`Waiting on you: #7 Fix login`) appears when a card newly lands in Me. If Claude moved it, you get a notification as well.
- Cards you moved yourself don't toast.

### Moving cards

#### Terminal and desktop: drag

Drag a card onto any row of a section of the open group:

| Drop on | The card goes |
|---|---|
| The section's header or its empty-state line | First. |
| A card | Before or after that card (see below). |
| A blank row under the cards | Last. |
| A `↑ N more` or `↓ N more` row | At that edge of the cards shown. |

- **Before or after a card.** On a terminal that reports the pointer finer than a cell (kitty, Ghostty, iTerm2, WezTerm, foot), the lower half of the row means after. On any other terminal, it goes by the way the pointer came: dragged down onto a card, it goes after; dragged up, before. So the end of a section is reachable by dragging down onto its last card.
- **The closed group takes a drop too.** While you drag, its header turns into three chips (` Done  Cancelled  Suspended `) and the one under the pointer lights. Dropped there, the card goes last in that section.
- The open group's own header takes nothing.
- A line under a row shows where the card will land. The card you drag is dim and slanted, with a `›` in front of it. The name of the section it would land in is lit.
- A pointer resting on a card, a `more` row or a group header (no button down) marks it with a `›` in the same place. It also underlines a group's name.
- Dropped in its own section, the card is reordered. In Done and Cancelled, which list by update time, it simply moves there.
- Click a card (press and release without moving) to open it.

#### Terminal and desktop: keyboard

The board takes keys once you have clicked it. Esc gives them back.

| Key | Does |
|---|---|
| any first key | Shows the cursor. |
| `↑` / `↓` (or `k` / `j`) | Move the cursor. |
| `Enter` | What a click does: open a card, open or fold a group, page a section. |
| `m` then `1`-`6`, or `b` / `c` / `h` / `d` / `x` / `s` | Move the card under the cursor to Backlog, Claude, Me, Done, Cancelled or Suspended. |
| `Shift`+`K` / `Shift`+`J` | Move the card under the cursor one place up or down in its section. |

- `m` reaches a folded group's sections too. While `m` waits, the headers show the keys (`4/d 5/x 6/s`). Any other key cancels the move.
- The cursor rests on group headers, cards and `more` rows, not on section headers.

#### VS Code and mobile

There is no drag. Open the card, then press:

- a link on its `Move to` row (the other Active sections);
- a link on its `Set aside` row (`Done`, `Cancel`, `Suspend`, without the card's own section);
- `↑` / `↓` to move it a place in its section (not in Done or Cancelled).

Here the group headers are buttons and the section headers are labels.

#### How a move syncs

A move shows at once, then syncs in the background.

| Glyph | Means |
|---|---|
| `⟳` (pulsing) | The move is being sent. |
| `✓` | Confirmed: bright for a second, then dim, then gone. |
| `✕` | Failed. Open the card for the reason and a Retry button. |

- Press `✕N retry` in the toolbar to send every failed move again.
- Several quick moves of one card are sent as one request.
- After the first try and three retries fail, the card snaps back to where it was, and a toast gives the reason.

#### Moves that prompt Claude

These moves to Claude prompt it: taking a card up from Backlog, Suspended, Cancelled or Done; Send back; and answering a question.

- The prompt is sent as soon as the backend confirms the move, however many cards are already in Claude.
- Suspending or cancelling the card Claude is working on does not stop its turn. The mod cannot interrupt one. A toast says `Claude is still working on #12. Press Esc in the prompt to stop it.`

### Who is working on a card

A card in Claude that Claude has worked on gets a dim second row under it, for example:

```
●● Explore · idle 3m · 12m · 48k
```

The row starts under the card's title. Its parts, joined by dots:

- **A coloured dot for each agent that took part.** `Claude` is the main session; a subagent goes by its name or type. The same agent always gets the same colour. The main session's dot is always Claude's colour. A subagent's dot is never Claude's colour, nor the colour for what needs you.
- **The name of the agent that acted last.**
- **What it is doing:** `⟳ Edit src/auth.ts`, `⟳ Bash npm test`, or `idle 3m` once nothing has run for a minute.
- **The cost so far:** time and tokens.

The row fits the pane:

- The stats keep their room first. The activity takes what is left.
- A path loses its front before its file name.
- When there are fewer than a few cells for it, the activity goes, then the name.
- The detail view keeps the longer form (`48k tok`).

The card's own row never changes, so rows stay one line each. The second row belongs to its card:

- a click on it opens the card;
- a card dropped on it lands right after that card (the insertion line is drawn under the row);
- dragging from it moves nothing;
- the keyboard cursor skips it.

**Which card a turn counts for.** A turn belongs to the card whose work or resume prompt started it. Otherwise it belongs to the card in Claude that Claude last touched with `kanban_show`, `kanban_handoff` or `kanban_move`. Subagents it spawns work for the same card.

**What is counted.**

- Time counts while a turn runs on the card.
- Tokens come from each model request in the turn: input and output, with tokens written to the cache counted as input. Cache reads are shown apart, in the detail view.
- A round is one trip through Claude. It ends when the card leaves Claude. A new one starts when the card is worked on again.
- Totals are kept per directory and card, so they survive a restart.
- Open the card to see the agents by name and a breakdown by round.

### Adding a card

Press `n: New` in the toolbar (or the `n` key while the pane has the keys). A title field opens at the top of the board.

- `Enter` adds the card to Backlog. A dim line under the field says so: `⏎ adds to Backlog`.
- That line holds two links:
  - `Add details` opens a second, taller field for the spec. A new line is typed there as in the prompt box. `Enter` in either field adds the card.
  - While the details field is open, the link reads `Hide details`. It folds the field away and keeps what you typed for when it is shown again. Hidden details are not added to the card.
- The wording shortens to fit a narrow pane.
- `Cancel`, or `n: New` again, closes the form and drops what you typed.
- `Esc` only gives the keys back to the prompt, so a half-typed card is not lost.
- An empty title is refused with a toast.
- The button is not shown on mobile, which has no text field.

**What happens next.**

- The card shows at once with a pulsing `⟳`, and `new` in the number column until GitHub has numbered it. It shows `✓` when it exists.
- It is an issue with the `triage` label, added to the project board with Status Backlog. The label marks it for grooming. It is created in the repo if missing, never overwritten.
- If GitHub refuses, the card disappears, a toast gives the reason, and the form comes back with your text.
- If GitHub made the issue but could not add it to the board, the toast names the issue.

### Filtering the board

Press `f: Find` in the toolbar (or the `f` key while the pane has the keys). A filter field opens under it. The board follows what you type, in every section at once.

| You type | It shows |
| --- | --- |
| `login retry` | cards whose title has every word (any case); `"login retry"` in quotes is one phrase |
| `#12` | card number 12 (`#12 #15` shows either) |
| `label:ai`, `-label:human` | cards with that GitHub label, or without it; every `label:` must hold; `label:"good first issue"` names a label with spaces |
| `[KANB-UIX]`, `[KANB]`, `area:UIX` | cards whose title starts with that `[PRJ-AREA]` prefix, its project, or its area (several are alternatives) |
| `@claude`, `@me` (or `@human`), `@backlog`, `@done`, `@cancelled` (or `@canceled`), `@suspended` | cards in those sections only |
| `@active`, `@inactive` | cards in the three sections of that group |

- The words, labels and kinds of term all have to hold together: `@backlog label:ai area:UIX retry`.
- A key with nothing after it yet (`label:`) asks for nothing.
- An unknown `@name` is a word.

**While a filter is on:**

- Each header counts the cards shown out of all it holds: `Backlog 3/41`.
- The group that has matches is drawn open for as long as the filter is on: the open one if it has any, else Active, else Inactive. The group you chose is not changed. Pressing a group while a filter is on picks which one is drawn, until the text changes.
- A folded group says how many cards match: `3 matches`.
- Done's and Cancelled's ten newest are taken from the cards that match.
- A section with no matches says `No matches`.
- The toolbar shows the text as `f: Find "fix login"`, followed by a `✕` that clears it. The text is cut with an ellipsis to fit the row, and left out when there is no room.

**The field.**

- `Enter` shuts the field and keeps the filter, so you can walk the board by key.
- `Esc` only gives the keys back to the prompt (it is the engine's key). To clear the filter, press the `✕`.
- The filter is not saved. It lasts until the session ends.
- The field is not shown on mobile, which has no text field.
- While the field is open, the wheel scrolls the pane, not a section.

**What you act on.** The filter only changes what is drawn. Everything you do acts on the cards you can see: the keyboard cursor, a click, a drop, the wheel and `J` / `K` all use the visible rows.

A card put at a place in a section goes right after the nearest visible card above that place, ahead of any hidden cards that followed it. With no visible card above, it goes first in the section. So the visible order is the one you made, and the hidden cards keep their order among themselves.

### Whose cards

A card belongs to whoever its issue is assigned to, by GitHub login. The board shows one of three views. `v` on the toolbar's second row (`v: Mine + open`) steps through them.

| View | Shows |
|---|---|
| `Mine + open` (when the pane opens) | Yours, and cards nobody is assigned. |
| `Everyone` | Every card. |
| `Mine` | Cards assigned to you. |

- In `Mine + open` and `Everyone`, a card someone else has shows their name, dim, after its title. The name takes at most 8 cells, and it goes first when the title needs the room.
- Moves, drags and reordering go by the cards the view shows, as they do under a filter.
- The status line, the pane's `Kanban · N` and the `Waiting on you` toasts count only your cards and nobody's.

**Colours.** An assigned card's title is drawn in its owner's colour.

- Each GitHub login has one colour, the same in every session.
- Your own card takes your colour when it has several assignees.
- While any card on the board is assigned, the last row of the list names each person in their colour: `● Ann  ● Bo`. You come first, then the rest by name, with `+N` for those that do not fit.

**How cards get an owner.** Cards are tagged by login, not by name.

- A card you add with `n: New`, or that Claude adds with `kanban_create` in your session, is assigned to you.
- A card nobody has becomes yours when it moves to Claude (by you or by Claude).
- In a card's detail view, the **Owner** row lists you, the others the board knows (named in its README or assigned a card) and `nobody`. The current one is marked `✓`. Press one to give the card to them. A refusal from GitHub is toasted and the card goes back.

**For Claude.** `kanban_list` lists your cards and nobody's, and says how many it left out. With `all: true` it lists everyone's, marking a card someone else has `@login`. Claude is told to leave other people's cards alone unless you ask.

### Your name

Settings has a **Your name** row. It shows the name you go by on the board, and `Change`, which opens a field (not on mobile).

Saving writes the name to a block at the end of the project board's README. The README is read fresh first, so a teammate's change is kept:

```
<!-- kanban:people
TeeratP: Teerat
alice: Alice Smith
-->
```

- Everyone on the board reads names from there with each load.
- A name is one line of at most 40 characters.
- Saving an empty name takes your line out, and you go by your login again.
- The rest of the README is left as it is.
- Cards are assigned by login, so a new name changes no issue.

### How Claude keeps the board current

A session with the plugin knows the board is the project's backlog, without a line in CLAUDE.md or AGENTS.md. The plugin adds one short section to Claude's system prompt, on every request but a `--bare` one. The section names the backlog and states the rules.

- Once the board is known: `This project's backlog is GitHub Issues on board <owner>/#<n>.`
- Before: `This project's backlog is GitHub Issues.`

**How the board is named.** It is named from what is already known, with no call to `gh`, in this order:

1. the board in use;
2. else the one the last load saved for the directory;
3. else the board an earlier detection found (see [How GitHub is detected](#how-github-is-detected)).

When none of those exists, the first session in a directory detects the board in the background at its start, as the pane would on opening, without opening the pane.

- An error there, a rate limit among them, only goes to the debug log.
- The only toast is the one-time note that a board has no In review status.
- The section names the board from the next request. Later sessions read what was saved.

**The rules Claude is given:**

- Asked to work the backlog, or given no task, Claude takes the top Backlog card (`kanban_list`) and moves it to Claude before writing code.
- When the work a card tracks is finished, it records `kanban_handoff` (what it did, how to check it) and moves the card to Done. That closes the issue.
- It moves a card to Me only when the card needs you: an approval the card asks for, or something only you can do or verify. The handoff then says what it needs.
- Blocked on a decision only you can make, it calls `kanban_ask`.
- It never adds a card to the board, by any route (`kanban_create`, `gh issue create`, a sub-issue, or adding an existing issue), without first asking you in chat and getting a clear yes. It proposes the card with a direct question instead. A plan you approved is a yes only for the cards that plan names.
- It never moves a card into or out of Suspended or Cancelled.
- It uses the kanban tools, not raw `gh issue` or `gh project` edits, so the board stays in sync.

#### The turn-end check (`reconcile`)

Claude can forget the last step, so the plugin checks when a turn ends.

- The `reconcile` setting is on by default.
- Turning it off turns off only this check, not the system-prompt section above.
- It covers a turn of the main session that Claude answered. It skips a turn you interrupted, one that ended in an error or a refusal, a subagent's turn, and a turn the check itself started.

It looks for two things.

**A card still in Claude.** The turn worked on a card if it began with that card's work, resume or answer prompt, or called `kanban_show`, `kanban_handoff`, `kanban_move` or `kanban_ask` on it. If the card is still in Claude and the turn left it no handoff, no question and no move out of Claude, the plugin sends one prompt. (A move into Claude says nothing about the work.) The prompt:

```
Card #12 is still in Claude. If the work is done, record a handoff and move it to Done (or to Me if it needs the person's approval); if you need a decision, kanban_ask; if you are still working, say so and continue.
```

**Work with no card.** The turn changed files (`Edit`, `Write` or `NotebookEdit`), touched no card, and no card is in Claude. Then a toast says, once a session:

```
This turn changed files with no card in Claude. If it is backlog work, move or create its card.
```

It is a toast, not a prompt. So it costs no turn, and Claude adds no card you did not say yes to.

**The check cannot loop:**

- A turn that a check prompt started is never checked.
- A card is asked about once per round, however many turns the round takes. A round ends when the card leaves Claude; a new one starts when the card is worked on again.
- Nothing is sent while a prompt that starts work is on its way (a card moved to Claude whose move the backend has not yet confirmed).
- The work-with-no-card toast shows once a session.

### Settings

Press `s: Settings` at the right end of the status row (or the `s` key while the pane has the keys). The Settings view opens in the pane; `b: ← Board` returns.

It lists every setting the mod has. These are the same rows `/config` shows for the plugin, each with its name, its value and one line of help.

| Setting | Row | What it takes |
|---|---|---|
| Reconcile at turn end (`reconcile`) | `on` and `off`, the current one marked | on or off |

- The value a setting starts with is marked `(default)`. It is read from the `(default: X)` that ends each setting's title in `/config`.
- Pressing the other value changes the setting through the engine, which applies the same checks as `/config`. If a check refuses, the value stays, and the reason shows under the row and in a toast.
- A setting an organization's policy sets shows its value with no buttons.
- Like a change in `/config`, a change reloads the plugin with the new value. The view stays open.

Under the settings:

- **[Your name](#your-name)** shows the name you go by and lets you change it.
- **Board** names the board in use: `GitHub · owner/repo` and the board's number and name, or `setup needed`.
  - For a board found without config, a `Change board` link opens the board picker on the board, or says there is no other.
  - A board named in CLAUDE.md or AGENTS.md is changed there.
  - Which board a project uses is not a setting, because settings are for every project.
- The last line, `Also in /config`, is a reminder that `/config` edits the same settings.

## GitHub

Cards are the issues of one repo, laid out by one Projects-v2 board's Status field. There is no other backend.

### Setting up GitHub

The board needs four things. It checks them in this order each time it loads:

1. the `gh` CLI;
2. `gh` signed in;
3. a github.com `origin` remote;
4. a Projects board for the repo, named in CLAUDE.md or AGENTS.md, or [found without config](#no-config-needed).

There is no fallback. While one is missing, the pane shows what it is under the toolbar, in the warning colour, with a button under it:

```
 GitHub needs the gh CLI, which is not installed.
 g: Set up with Claude
```

The status row reads `GitHub · setup needed`. An empty board says `Cards show here once GitHub is set up.`

Pressing the button (or `g`) sends Claude a prompt with what is missing and the steps to fix it. It skips any step already done:

1. Install `gh`.
2. Ask you to run `! gh auth login` and `! gh auth refresh -s project` yourself (they are interactive).
3. Create the repo with `gh repo create`, or add an origin.
4. Create a board with `gh project create` and link it with `gh project link`.
5. Write the `Repo:` and `Project board:` lines to CLAUDE.md.

Claude asks before it creates anything on GitHub. The board checks again on every refresh (every 45 seconds while the pane is open), so it loads by itself once the last piece is in place.

A CLAUDE.md or AGENTS.md that mentions a project board without a repo and number that can be read also counts as missing setup, unless the search without config finds a board.

### How GitHub is detected

The board is looked for in this order: explicit config in CLAUDE.md or AGENTS.md first. Only without it is the [zero-config search](#no-config-needed) used.

#### Explicit config

The board reads these files in the working directory:

- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `AGENTS.md`
- the files they import with Claude Code's `@path` syntax (so a `CLAUDE.md` that is only `@AGENTS.md` works).

Imports:

- are followed one level deep;
- read each file once;
- count only project-relative paths. An import of an absolute path, a home path or a file outside the project is ignored.

The texts are joined (at most 1,000,000 characters) and read as one. This repo's own `CLAUDE.md` is an example:

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

- The repo and the project number are required. Without both, the search without config is used.
- Missing IDs are looked up with `gh project field-list` and `gh project view`. So the minimal CLAUDE.md is just those two lines.
- The matching is tolerant of wording and formatting, not of missing pieces.
- The repo line stays strict (a backticked `owner/name` after a `Repo:` label), because a move writes to that repo.

Besides the config, `gh --version`, `gh auth status` and `git remote get-url origin` must succeed. A failure is shown as [missing setup](#setting-up-github).

#### No config needed

With no repo and project number in the config files, the board is found from `git` and `gh` alone. Everything it runs only reads.

1. `git remote get-url origin` must be a github.com URL (`https://github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `git://…`). `owner/repo` is taken from it.
2. `gh --version` and `gh auth status` must succeed.
3. One GraphQL query (1 point) lists the open Projects linked to the repo, with the repo of each of their first 100 items.
   - **One board:** it is used.
   - **Several:** the one with the most items from this repo wins. A board shared by several repos counts only this repo's items. On a tie, a one-row picker shows `Pick board: [#2 @TeeratP's Kanban] [#6 Car Cast]`. Nothing loads until you press one, and Claude's tools say so.
   - **None linked:** the signed-in user's and the repo owner's open projects (first 20 of each, one more query) are scanned the same way. Only those that hold issues of this repo are used.
   - **No board anywhere:** shown as [missing setup](#setting-up-github): `The repo has no GitHub Project board.`
4. The Status field comes from `gh project field-list`. Option names are matched without regard to case:

   | Status | Option names |
   |---|---|
   | Backlog | Backlog, Todo, To Do (Ready if there are none) |
   | Ready | Ready (kept as Ready) |
   | In progress | In progress or Doing |
   | In review | In review or Review |
   | Done | Done or Closed |

   - A board without In review keeps working. Me is then the `human` label on a card in progress, and a toast says so once.
   - A board with no Backlog, In progress or Done cannot be used, and the toolbar names which is missing.

Only the first 100 items of a board are counted. So a repo whose items on a large shared board all sit past the first page looks like it has none there.

**What is kept.** The result is kept per directory (`detect:<cwd>` in the plugin's store) with the origin URL, so later sessions only read the origin. It is searched for again when:

- the origin changes;
- a load says the project is not found;
- you press the board name in the toolbar. That looks at the repo's boards again and shows `Change board: [#2 …] [#6 …]`, or a toast: `No other GitHub board is linked to owner/repo.`

Your pick is local state only; nothing is written to GitHub. A tie is not kept, so it is looked for again next session. If GitHub's rate limit stops the search, the toolbar shows the pause, as for a board load.

### GitHub mapping

The board maps onto your existing Projects board without restructuring it, and never adds an option to it.

- The Status field needs the options Backlog, In progress, In review and Done. Ready is optional.
- A few other names are understood (see [No config needed](#no-config-needed)). A board found without config may lack In review.
- A section means who holds the ball now, not the ownership label.

| Section | A card is there when |
|---|---|
| Cancelled | The issue is closed as not planned (or as a duplicate), or its Status is named like Cancelled, Won't do or Not planned. |
| Done | The issue is closed any other way, or its Status is Done. |
| Suspended | Its Status is named like Suspended, On hold, Paused, Icebox, Someday or Deferred, or the issue has the label `suspended`. Not Blocked: blocked work is active work that waits. |
| Backlog | Status is Backlog, Todo, Ready or empty, even if the issue has the `human` label. Any other Status the board does not know goes here too, unless the issue has the `human` label. |
| Me | Status is In review (the card's detail view says `in review`), or Status is In progress (or one the board does not know) and the issue has the `human` label (the detail view says `labelled human`). |
| Claude | Status is In progress and the issue has no `human` label. |

The first page of the board query also lists the Status field's options. That is a list, so it costs no more: 3 points a page, with it or without. This is how a board's own Cancelled and Suspended options are found, even when CLAUDE.md names only five.

**Moving a card on GitHub:**

| To | What happens |
|---|---|
| Backlog | Status becomes Backlog. |
| Claude | The label `ai` is added and `human` is removed if present (whatever its case), then Status becomes In progress. If the repo has no `ai` label, it is created first. |
| Me | Status becomes In review. No label changes. (A board without In review: the label `human` is added, created in the repo if missing, and Status becomes In progress.) |
| Done | Status becomes Done and the issue is closed as completed. The close is re-read, reason included, to make sure it took. |
| Cancelled | Status becomes the board's Cancelled option, or Done on a board with none (the board keeps closed items in its Done column), and the issue is closed as not planned and re-read. |
| Suspended | Status becomes the board's Suspended option. On a board with none, the issue gets the label `suspended` (created in the repo once, never overwritten; `human` is removed if present) and rests in Backlog. |

- Moving a card out of Suspended takes the `suspended` label off, as the repo spells it.
- Without a Cancelled or Suspended option, GitHub's own board shows those cards in Done and Backlog. The difference is the issue's close reason ("Closed as not planned") and the label.
- Moving a closed issue out of Done or Cancelled reopens it first. So does moving a Done issue to Cancelled, or the other way. (`gh issue close` on a closed issue changes nothing, so the reason would stay.)
- Handoffs and feedback are posted as issue comments.
- The Diff tab of a card with a linked pull request shows `gh pr diff`.

**Whose comments count.** Only comments written by the account `gh` is signed in as count toward the handoff rule. Anyone else's Handoff, Feedback, Question or Answer comment is shown on the card, marked with its author. It is ignored when deciding whether a card may move to Me or Done.

**Rate limit.** The board is read with one GraphQL query per 100 items. A page costs about 3 points of GitHub's 5000 an hour, and includes each issue's newest comments, so an open question shows on its row. When the budget runs low or out, polling pauses until it resets, and the toolbar says so. The refresh button still works.

## Claude's tools and the handoff

Claude gets these tools. They work with the pane closed.

| Tool | Does |
|---|---|
| `kanban_list` | Lists cards, one line each: `#number [column] title`. Any of the six columns. Done and Cancelled list only their 10 newest. |
| `kanban_show` | Reads one card: the spec and every handoff, feedback, question and answer, newest last. |
| `kanban_handoff` | Records a handoff on a card, as an issue comment. |
| `kanban_ask` | Asks you a blocking question on a card (see [Questions](#questions)). |
| `kanban_move` | Moves a card to `human`, `claude`, `backlog` or `done` (which closes the issue). |
| `kanban_create` | Creates a card: an issue labeled `triage` on the project board. Claude calls it only after you have said yes to that card in chat. |

Suspended and Cancelled are your calls:

- Claude cannot move a card there.
- On a card you set aside, Claude is refused a move or a question until you move it back.
- `kanban_show` and `kanban_handoff` still work on it.

### Handoff format

When Claude finishes a card or needs you, it records a handoff in this exact shape:

```markdown
## Handoff (2026-10-25)
**Did:** what was done
**Check:** what you should look at
**Changed:** files or areas touched
**Need from you:** the approval or decision needed (empty for a card going to Done)
```

Handoffs are enforced, not suggested:

- A handoff needs **Did** and **Check** filled in.
- `kanban_move` to Done is refused unless the card's newest handoff is newer than its newest feedback or answer.
- `kanban_move` to Me also needs **Need from you** filled in.

### Questions

When Claude cannot go on without a decision only you can make, it calls `kanban_ask` with the card and the question.

- The question is recorded on the card as an issue comment (`## Question (date)`).
- The card moves to Me, and its row shows `?` in place of `#` (`?12`).
- A question counts as a handoff for the move, so no Check or Need is required.
- You get a toast and a notification that say `Claude asks: …`.

In the detail view of a question card:

- the question is shown at the top, and the box is labelled **Answer**;
- pressing **Answer** records a `## Answer (date)` comment and moves the card to Claude. Once that move is confirmed, Claude is prompted that you answered.

A card may move to Me when its newest Question or Handoff comes after its newest Feedback or Answer. Claude is told to use the tool only for decisions it cannot make, not for progress updates.

## The feedback loop

The loop:

1. Claude works a card, writes a handoff, and closes it as Done.
2. A card that needs your approval goes to Me instead.
3. In Me you Approve, Send back or Park it.
4. Send back returns it to Claude with your feedback.

### The detail view

Open a card in Me to approve it or answer it. The detail view shows, top to bottom:

1. the nav row;
2. the title and where the card stands;
3. the actions;
4. the handoff to review (Claude's newest handoff, or its open question), as a short list of Did, Check, Changed and Need;
5. the Check, with its **Run check** button;
6. the `Move to` and `Set aside` rows;
7. the spec;
8. a History of every other section, oldest first. Each has its date and is coloured by who wrote it (Claude or you).

Nothing runs past the edge of a narrow pane. The buttons wrap, and the nav row gives up its arrows, then its place, then its words.

### The actions

- **Approve:** moves the card to Done. On GitHub this closes the issue.
- **Send back:** type feedback in the box first, then press the button.
  - The feedback is posted on the issue as a `## Feedback (date)` comment, and the card moves to Claude.
  - Once that move is confirmed, Claude is prompted to resume the card: read the newest feedback and continue.
  - An empty box shows a toast and moves nothing.
  - On mobile there is no text box, so Send back is not shown. The detail view says to use the terminal or desktop.
- **Park:** moves the card to Backlog.
- **Run check:** shown when the newest handoff's **Check** holds a command, as an inline code span (`` `npm test` ``) or a fenced `sh` / `bash` block.
  - The button shows the exact command. On a narrow pane it is cut to fit, with the whole command above it.
  - Nothing runs until you press it, and Claude cannot start it.
  - It runs through `sh -c` in the session's directory and ends at 5 minutes.
  - The result row shows ✓ or ✕, the exit code, the time and the last 20 lines of output.
  - The run is posted as an issue comment only when you press **Attach to card**.
  - There is no Stop: the engine cannot cancel a run in progress.

### Review keys

Cards in Me can be reviewed from the keyboard:

| Key | Does |
|---|---|
| `a` | Approve |
| `s` | Send back |
| `p` | Park |
| `f` | Write feedback (moves the cursor to the box) |
| `n` / `k` | Next / previous card in Me (wrapping) |
| `b` | Back to the board |

- The nav row reads `k: ‹ Prev  2/5  n: Next ›`. Every key is drawn on its button, so there is no separate list of keys.
- After Approve, Send back (or Answer) or Park, the next card in Me opens by itself, or the board when none is left.
- That card ignores Approve, Send back and Park for 0.6 s, so a key pressed twice decides one card. The walking keys are never held back.
- The keys work while the pane has the keyboard. `Esc` is the engine's and hands the keyboard back to the prompt.

### Moves that start Claude

Moving a card to Claude from Backlog, Suspended, Cancelled or Done prompts Claude to start. That holds for the move buttons, a drag or a key. Claude is asked to work on the card, then hand it off and close it, or move it to Me if it needs you. (From Me the move is Send back, with its own prompt.)

- Reordering a card within a section never prompts.
- Prompts are sent only after the backend confirms the move.
- Prompts are sent only for moves you make in the pane. Claude's own `kanban_move` never prompts, so the two cannot loop.

## Card order

- A section's order is the order of the project items on the board (`updateProjectV2ItemPosition`).
- Done and Cancelled sort by update time, newest first.
- A card moved to another section with no place asked is positioned after the last card there. So a reload keeps the order it arrived in.

## Development

Layout:

- `.claude-plugin/plugin.json`
- `hooks/`: the hooks module. Strings live in `hooks/strings.ts`.
- `types/index.d.ts`
- `tests/`

The design is in `docs/plan.md`, the decision log in `docs/decisions.md`.

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

Tests use a fake GitHub (`tests/fake-github.ts`) that answers every `gh` command the plugin runs. No test runs a mutating `gh` command against a real repo.

## License

[MIT](LICENSE)

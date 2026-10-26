# Design spec: section groups (#35) and UI polish (#36)

Author: design lead (Opus), 2026-10-26. Read with `docs/plan.md` (the v1 spec) and `docs/decisions.md` (ends at 98; the Decisions section below continues it at 99).

The two requests, verbatim:

1. "instead of 4 drop down, possible to make 2 drop down instead * active: backlog, human, ai with fix equal height * inactive: done, cancel, suspend with fix equal height. when open one, the other close but possible to close both at same time"
2. "review UI make it best looking not just work, any detail element that make user feel like you really attentive to detail is encourage to add"

All mocks are drawn as the terminal shows them, inside a frame that is not part of the pane. Widths are body columns (`e.props.bodyColumns`). Every mock line was checked to fit its width. `{dim}`, `{b}` and `{color}` in style notes mean `dimColor`, `weight="bold"` and `color="<ThemeKey>"`.

---

## 0. What the board looks like today (before)

Rendered through the test kit (`ui.drawn()`, Client rows inlined from `ui.drawn({ in: 'board' })`) with realistic cards, terminal surface, `bodyRows` 30.

Local, many cards, 44 columns:

```
┌────────────────────────────────────────────┐
│ Local (auto) · updated now                 │
│ r: Refresh   n: New   f: Find              │
│▾ Human 2                                   │
│  #12 Fix login redirect loop on Safa…   12m│
│  #7 Rewrite the onboarding flow so th…   1d│
│▾ Claude 2/1                                │
│  #31 Build the sync API                  3m│
│    ●● Explore idle · 12m · 48k tok         │
│  #32 Add a dark theme                    3h│
│▾ Backlog 8                                 │
│  #40 Write docs                         20h│
│  #41 Ship 1.0                            1d│
│  #42 [KANB-UIX] Polish the board         2d│
│  #43 Investigate flaky test in sync      3d│
│  #44 Rate-limit banner                   4d│
│  ↓ 3 more                                  │
│▸ Done 10 of 12                             │
└────────────────────────────────────────────┘
```

The same at 30 columns:

```
┌──────────────────────────────┐
│ Local (auto) · updated now   │
│ r: Refresh   n: New   f: Find│
│▾ Human 2                     │
│  #12 Fix login redirec…   12m│
│  #7 Rewrite the onboard…   1d│
│▾ Claude 2/1                  │
│  #31 Build the sync API    3m│
│    ●● Explore · 12m · 48k tok│
│  #32 Add a dark theme      3h│
│▾ Backlog 8                   │
│  #40 Write docs           20h│
│  ...                         │
│▸ Done 10 of 12               │
└──────────────────────────────┘
```

GitHub with a failed and a pending move (44):

```
┌────────────────────────────────────────────┐
│ GitHub (auto) · updated now                │
│ r: Refresh   n: New   f: Find   ✕2 retry   │
│▾ Human 3                                   │
│  #21 rev Review the toolbar copy        12d│
│  #22 hum Needs a call on pricing        11d│
│  #23 ? Which auth provider?             10d│
│▾ Claude 1/1                                │
│  (empty)                                   │
│▾ Backlog 1                                 │
│  #5 In flight                         ✕ 10d│
│▸ Done 2                                    │
└────────────────────────────────────────────┘
```

Empty local board (44), and the first load with no cache, which looks exactly the same apart from `loading…`:

```
┌────────────────────────────────────────────┐
│ Local (auto) · loading…                    │
│ r: Refresh   n: New   f: Find              │
│▾ Human 0                                   │
│  (empty)                                   │
│▾ Claude 0/1                                │
│  (empty)                                   │
│▾ Backlog 0                                 │
│  (empty)                                   │
│▸ Done 0                                    │
│No cards yet. Add .kanban/0001-title.md     │
│GitHub board? Link a Project to the repo, o…│
│Not picked up? Set backend: github to see w…│
└────────────────────────────────────────────┘
```

Detail view of a Human card (44). Lines that run past the frame overflow the pane:

```
┌────────────────────────────────────────────┐
│[ b: ← Board ][ k: ‹ Prev ][ n: Next › ]    │
│#12 Fix login redirect loop on Safari       │
│Human 1 of 2 · 12m                          │
│[ a: Approve ][ s: Send back ][ p: Park ]   │
│[ f: Write feedback ]                       │
│[Feedback: What should Claude change?]      │
│a approve · s send back · p park · f write · n next · k prev · b board
│Move to:[ Claude ][ Backlog ][ Done ]       │
│Spec text.                                  │
│**Handoff (2026-10-25)**                    │
│**Did:** Wrote the docs                     │
│**Check:** Read the README                  │
│...                                         │
└────────────────────────────────────────────┘
```

At 30 columns the three button rows, the hint line and `Move to:` all run past the edge.

Quick add (44): `[New card: New card title]` then `[ Add details ][ Cancel ]`, with the two buttons touching.

What is wrong, in short:

- **Alignment.** Titles start at a different column per card (`#12 Fix` vs `#7 Rewrite`), and GitHub tags (`rev`, `hum`, `?`) push titles further. There is no shared title column.
- **Dead space.** Every card row keeps one blank cell for a sync mark, so most rows end in `…   12m`.
- **Claude `2/1`** reads as a fraction, and does not say "over the limit" when Claude moved a second card in itself.
- **Activity row** says `Explore idle` with no separator, and is not aligned with the title above.
- **Empty states** are `(empty)` everywhere. They don't say anything useful.
- **Loading looks like an empty board**, including `No cards yet` and the GitHub hints. That's a bug, not just a style issue.
- **Hints are cut** with `…` mid-sentence at 44 and 30 columns.
- **Detail view.** The key hint line duplicates hotkeys the buttons already show, and overflows. Buttons touch each other. `Move to:` is glued to its buttons. Handoff fields are raw `**Did:**` markdown with ragged alignment.
- **No rhythm.** Headers, cards and `more` rows all start at the same indent, so a section's end is only visible from the next header.

---

## Part A — Two groups (#35)

### A.1 Sections and groups

| Group | Sections, top to bottom | Section ids | Labels |
|---|---|---|---|
| Active | Backlog, Human, Claude | `backlog`, `human`, `claude` | `Backlog`, `Human`, `Claude` |
| Inactive | Done, Cancelled, Suspended | `done`, `cancelled`, `suspended` | `Done`, `Cancelled`, `Suspended` |

- New column ids: `suspended`, `cancelled` (British spelling in ids and labels, matching `Cancelled` in GitHub's own UI copy; `canceled` is read as an alias everywhere input is parsed).
- `KanbanColumn = 'human' | 'claude' | 'backlog' | 'done' | 'suspended' | 'cancelled'`.
- `COLUMNS` (top to bottom, also the `1`–`6` move keys): `backlog, human, claude, done, cancelled, suspended`.
- Active follows the request's order, Backlog, Human, Claude (orchestrator override, decision 100). With equal fixed heights every section of the open group is always visible, so Human never scrolls off. Snapshots and tests in this spec that show Human first must use this order.
- Inactive follows the request's order too: Done, Cancelled, Suspended (orchestrator override, decision 101).
- The "ai" section keeps the label **Claude**. It matches the brand color, the prompts ("Work on kanban card"), the tool values (`claude`) and the README. "AI" would be a second name for the same thing.

`hooks/model.ts`:

```ts
export type KanbanGroup = 'active' | 'inactive'          // also in types/index.d.ts
export const GROUPS: Record<KanbanGroup, readonly KanbanColumn[]> = {
  active: ['backlog', 'human', 'claude'],
  inactive: ['done', 'cancelled', 'suspended'],
}
export const GROUP_ORDER: readonly KanbanGroup[] = ['active', 'inactive']
export const COLUMNS: readonly KanbanColumn[] = [...GROUPS.active, ...GROUPS.inactive]
export const groupOf = (column: KanbanColumn): KanbanGroup =>
  GROUPS.active.includes(column) ? 'active' : 'inactive'
/** Sections listed by update time, newest first, with no manual order. */
export const isOrdered = (column: KanbanColumn) => column !== 'done' && column !== 'cancelled'
/** Done and Cancelled show their newest ten (was DONE_LIMIT). */
export const NEWEST_LIMIT = 10
export const SECTIONS_PER_GROUP = 3
export const MIN_SECTION_BODY = 2
// The key after `m` that sends a card to a section; digits 1-6 follow COLUMNS.
export const MOVE_KEY: Record<KanbanColumn, string> = {
  human: 'h', claude: 'c', backlog: 'b', done: 'd', suspended: 's', cancelled: 'x',
}
```

`x` is for Cancelled because `c` is Claude's; `x` reads as "cross out". Every literal `'done'` test that really means "unordered" (`reorder.ts:57,84`, `view-detail.tsx:348`, `sync.ts:164,358`, `board-rows.ts isOrdered`) becomes `!isOrdered(column)`.

### A.2 Accordion state

```ts
export type KanbanUi = {
  view: KanbanView
  offsets: Record<KanbanColumn, number>        // six keys, all 0 initially
  /** The group drawn open; 'none' when both are folded. */
  openGroup: KanbanGroup | 'none'
  draft: string
  filter: string
  isFilterOpen: boolean
  /** The group a header press chose while filtering; dropped when the filter text changes. */
  filterGroup?: KanbanGroup | 'none'           // absent, never undefined (JSON rule)
}
```

- `collapsed` and `filterCollapsed` are removed.
- `INITIAL_UI.openGroup = 'active'`: Active is open the first time the pane opens.
- A press on a group header: `openGroup = openGroup === g ? 'none' : g`. Opening one closes the other, and pressing the open one closes both, exactly as the request says.
- Sections no longer fold one at a time: equal fixed heights would make no sense if one could fold. A section header is a label and a drop target, not a toggle (decision 103).
- **Migration.** `hooks/atoms.ts` ui atom shape `ui-3` → `ui-4`. The ui atom is never written to `$.store`; it lives across hot reloads only. The engine drops a value whose shape tag differs and starts from `INITIAL_UI`. So after the upgrade, the open group is Active, which matches the old default too (Done collapsed, the rest open). No mapping code is needed. Today's `collapsed` flags, if they could be read, map as: any of human/claude/backlog open → `'active'`, else done open → `'inactive'`, else `'none'`. Write that mapping only if a later change persists the ui atom.
- Other shapes stay. `board-3`, `sync-3`, the board cache and the queue/activity/detect store values only gain new union members and optional fields, so old values stay valid (decision 104).
- `quick-add.ts:132` (open Backlog when the form opens) becomes `openGroup: 'active'` and clears `filterGroup` when that is `'inactive'` or `'none'`.

### A.3 Rows and the equal-height rule

New and changed `Row` kinds in `hooks/layout.ts`:

```ts
| { kind: 'group'; group: KanbanGroup; isOpen: boolean;
    counts: Record<KanbanColumn, { shown: number; total: number }> }   // its three sections only
| { kind: 'header'; column: KanbanColumn; shown: number; total: number } // no toggle any more
| { kind: 'blank'; column: KanbanColumn }      // filler: keeps the section's height
| { kind: 'legend' }                           // key hint in the slack row (Part B, B.9)
```

`empty`, `more`, `card`, `detail`, `note` and `hint` stay as they are.

**Tree order.** Toolbar (2 rows); picker, filter field, quick add and suggestions (as today, outside the layout); then the list:

```
group(active)
  [if open] header(human), body(human) · header(claude), body(claude) · header(backlog), body(backlog)
group(inactive)
  [if open] header(done), body · header(suspended), body · header(cancelled), body
[slack rows: legend, blanks]
[note + hint rows, only on an empty board]
```

**Body height B** (rows under each section header, the same for all three sections of the open group):

```
avail = bodyRows - TOOLBAR_ROWS - extraRows - 2 /*group headers*/ - 3 /*section headers*/ - footRows
B     = max(MIN_SECTION_BODY, floor(avail / 3))
slack = max(0, avail - 3 * B)        // 0, 1 or 2 rows, at the very bottom
```

- `extraRows` is new in `LayoutInput`: the rows the picker, filter field, quick add form and suggestions strip take. `renderBoard` already knows them via `pickRows(board)`, `stripRows(n)`, plus 1 for an open filter field and `quickAddRows(q)` (1 for the title field and 1 for its button row, plus the details field's `rows` when open). Without them the fixed-height board would overflow the moment the filter opens.
- `footRows` = the `note` + `hint` rows of an empty board (A.3.4), else 0.
- When the remainder is not divisible by 3, the leftover (`slack`, at most 2 rows) goes **below** everything, never to one section. "Fix equal height" means equal, so no section grows by one row. The slack row carries the key legend on terminal/desktop (B.9) and is blank elsewhere.
- **No maximum.** A taller pane gives every section more rows. The height depends on the pane, never on the cards, so nothing jumps when a card moves.
- **Pane too short** (`avail < 3 * MIN_SECTION_BODY`): B stays 2 (one card and one `↓ n more`), the tree is taller than the pane, and the engine scrolls the pane. This is the same as today's cap of 1, and the wheel already passes to the engine when a section can't move (decision 64).
- **Both groups folded:** the list is the two group header rows plus one dim slack line, `S.groupsFolded` = `  Press a group to open it` (dropped below 30 columns).

#### A.3.1 Packing a section body into exactly B rows

The window offset stays in cards (`ui.offsets[column]`). Blocks: a card is 1 row, or 2 when it has an activity second row (`details.has(id)`, Claude only).

```
sectionWindow(list, offset, B, details) -> { offset, rows: Row[] }   // rows.length === B
  if list.length === 0:
    rows = [empty] + (B-1) × blank
  else:
    offset = clamp(offset, 0, maxOffset(list, B, details))
    up     = offset > 0 ? 1 : 0
    room   = B - up
    if sum(blocks[offset..]) <= room:             // the rest fits: no down row
      take all from offset
    else:
      room -= 1                                   // keep a row for ↓ n more
      take cards from offset while their blocks fit in room;
      always take at least one card; if its 2-row block does not fit, drop its detail row
    rows = [up? more(up, offset)] + taken blocks + [down? more(down, len - offset - taken)]
           + blank rows up to B
maxOffset = the smallest o such that the cards from o to the end fit in B - (o > 0 ? 1 : 0)
```

This replaces `capFor`, `detailReserve` and `clampOffset`'s cap argument. `scrollSection`, `keepInView` and `handleBoardScroll` page by the number of cards the window shows (`taken`).

#### A.3.2 Section header row

```
  Human 2 ─────────────────────────────────    {b,permission}Human {dim}2 {dim}─…
  Claude 3 ──────────────── limit 1 · 2 queued {b,claude}Claude {dim}3 … {dim}limit 1 · 2 queued
  Backlog 8 ───────────────────────────────    {b}Backlog {dim}8
  Done 12 ───────────────────────── 10 newest  all dim, label {b,dim}
```

- Indent 2, label bold, count dim, then a dim `─` rule to the right edge, with right-aligned dim meta when there is any. The rule is what ends one equal-height block and starts the next, since blank filler rows alone don't show where a section stops (decision 105).
- Count: the section total; while filtering `shown/total` (`1/8`).
- Claude meta when `limit > 0`: `limit 1`, `limit 1 · 2 queued`. When Claude holds more cards than the limit (its own `kanban_move`s), the meta reads `limit 1 · 1 over` in `warning`. This replaces `2/1`, which read as a fraction (decision 106). Below 36 columns: `lim 1 · 2q`.
- Done/Cancelled meta: `10 newest` when the total is over 10. This replaces `10 of 12`; the count already says 12.
- Section label colors: Human `permission` (the color the engine uses when it needs the person), Claude `claude` (brand), Backlog default `text`. Inactive section labels are bold and dim, with no color (decision 107).

#### A.3.3 Group header row

Open: `▾ Active` (bold), nothing on the right. The section headers carry the counts.
Closed: `▸ Inactive` (bold), then a right-aligned dim summary of the non-zero sections:

```
▸ Inactive             12 Done · 3 Suspended      (44)
▸ Active      2 Human · 2 Claude · 8 Backlog      (44)
▸ Active              2H 2C 8B                    (30: initials when the words don't fit)
▸ Inactive                       empty            (every section 0)
```

- In the summary, the Human part is colored `permission` whenever it is above 0. So a folded Active group still says "something waits on you".
- If the words don't fit, initials are used (`12D 3S 4C`); if those don't fit either, the total alone.
- While filtering the summary is `3 matches` / `no matches`.
- The chevrons (`▸` closed, `▾` open) are `S.expand`/`S.collapse`, unchanged.

Row keys: `grp:active`, `grp:inactive` (new); `hdr:<column>` stays for section headers; `blank:<column>:<i>`.

#### A.3.4 Empty board, empty section

- An empty section's first body row is its empty-state line (Part B, B.4), then blanks to B.
- An empty board (no cards at all, loaded) draws the groups normally, then the `note`/`hint` rows (`footRows`). They must not show while loading (B.5).

#### A.3.5 Hit-testing, wheel and drops

- `hitTest` returns the column for `header`, `card`, `detail`, `more`, `empty` and `blank` rows. So the wheel anywhere in a section's block scrolls that section, and the toolbar, group headers, legend and notes return `undefined`.
- Drop targets (Client `dropTarget`):
  - `blank` row: after the last card shown. The line goes under that card's block. With no cards it is the top.
  - Closed group header, while dragging: the header row is redrawn as **drop chips**, one per section of that group:

    ```
    ▸ Inactive  Done  Suspended  Cancelled        (≥ 40 columns; the chip under the pointer is inverse)
    ▸ Done  Suspended  Cancelled                  (narrower: the chips replace the label)
    ▸ Active  Human  Claude  Backlog
    ```

    The pointer's `x` picks the chip. `dropTarget(rows, pointerRow, fineY, isDown, x)` gains `x`. A group `RowView` carries `chips: { column, from, to }[]` (cell ranges computed in `board-rows.ts`). The drop posts `{ type: 'drop', cardId, column }` with no place: the card goes last in an ordered section, or by date in Done/Cancelled. A drop on the label part of the header does nothing.
  - Groups never spring open during a drag. Opening one would fold the other, the dragged row would vanish mid-gesture, and `finish` would find no row (decision 108).
  - The open group's own header is not a drop target.

### A.4 Status semantics

#### A.4.1 Local backend

- Frontmatter `status:` takes `human | claude | backlog | done | suspended | cancelled`. `canceled` is read as `cancelled` and written back as `cancelled` on the next move. Anything else is still `backlog`.
- `move` is unchanged: it writes `status`, `updated` and `order = max(target)+1`.
- Done and Cancelled are sorted by `updated`, newest first, and each shows its 10 newest.
- Suspended keeps manual order, like Backlog: reorder, drop places and `J`/`K` all work.

#### A.4.2 GitHub backend

Reading (in `hooks/github.ts`):

- The board query (`BOARD_QUERY`) adds `stateReason` to `... on Issue { ... }` (a scalar, no extra cost).
- On the **first page only** (no cursor), it also reads `field(name: "Status") { ... on ProjectV2SingleSelectField { options { id name } } }` on the project node. `options` is a list, not a connection, so the cost should not change. The implementer measures it on board #7 (`rateLimit.cost` before and after) and records it in the decision. Why: with full CLAUDE.md config, `resolveGithub` never runs `field-list` (decision 34), so this is the only way to learn a board's Cancelled/Suspended option ids, and it picks up an option the person adds later without re-detecting.
- `loadGithub` returns `statusOptions: { id, name }[]`. `board.ts` matches names and writes `backend.options.cancelled` / `backend.options.suspended` (optional, new in `KanbanGithub.options`) when they changed, then re-caches.
- Name matching (lower case, trimmed), added to `KEY_OF_NAME` logic as patterns:
  - cancelled: `/^(cancel+ed|cancel|won'?t (do|fix)|not planned|dropped|abandoned)$/`
  - suspended: `/^(suspended?|on[ -]?hold|paused?|ice ?box|someday|deferred)$/`
  - Not `blocked`: blocked work is active work that waits; it belongs in Claude or Human.
- `columnOf(status, labels, isClosed, stateReason)`, checked in this order:
  1. Closed and (`stateReason` is `NOT_PLANNED` or `DUPLICATE`, or Status is a cancelled name) → `cancelled`.
  2. Closed (any other reason, or none) → `done`.
  3. Status is a cancelled name (open issue) → `cancelled`.
  4. Status is a suspended name, or the issue has the label `suspended` (any case) → `suspended`.
  5. Status `Done` (open issue) → `done`.
  6. Today's rules (backlog, In review → human `review`, label `human` → human, In progress → claude).

  This is how loading tells done from cancelled: GitHub's own close reason, `stateReason`. It is present on every issue and costs nothing extra to read.

Writing (`planMove`, label edits before Status edits as today, `reopen` first when the issue is closed and the target is not a closed state):

| To | With a matching board option | Fallback (no option: the common case, the user's boards have none) |
|---|---|---|
| suspended | reopen if closed; remove `human` label if present; `item-edit` → Suspended option | reopen if closed; `gh issue edit N --add-label suspended` (plus `--remove-label <human>` if present); `item-edit` → Backlog unless already parked. `ensureLabel` creates `suspended` (color `#cfd3d7`, description `S.suspendedLabelDescription` = `on hold (kanban Suspended)`) once, never overwriting |
| cancelled | if closed as COMPLETED: reopen first; `item-edit` → Cancelled option; `gh issue close N --repo R --reason "not planned"`; verify | same, with `item-edit` → Done, so the GitHub board keeps closed items in its Done column |
| done | if closed as NOT_PLANNED: reopen first; then today's sequence with `gh issue close N --repo R --reason completed` | same |
| any active section | as today; if the card has the `suspended` label, the `gh issue edit` that runs anyway (claude), or a new one before the Status edit (backlog, human), adds `--remove-label <suspended, as spelled>` | same |

- `--reason` takes `completed` and `"not planned"` in gh 2.x.
- Verify becomes `gh issue view N --repo R --json state,stateReason --jq '.state + " " + (.stateReason // "")'`. It must be `CLOSED COMPLETED` for done (an empty reason is accepted for older issues) and `CLOSED NOT_PLANNED` for cancelled. Otherwise it throws `S.closeNotVerified`.
- Why reopen first: `gh issue close` on an already closed issue exits 0 and leaves its reason as it was, so Done ↔ Cancelled would silently not change.
- `moveGithub` patches `isClosed`, `stateReason` (new optional `KanbanCard.stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED'`), `status`, and `labels` (adding or removing `suspended`).

**What the fallback costs.**
- On GitHub's own board page, Cancelled cards sit in Done and Suspended cards sit in Backlog. The difference shows only as the issue's close reason ("Closed as not planned", a grey icon in GitHub) and the `suspended` label.
- One `gh label create` the first time a card is suspended in a repo.
- A Done ↔ Cancelled switch takes 4 commands (reopen, item-edit, close, verify) instead of 1.
- No extra API points on load.

We never add Status options to the person's board (decision 4).

#### A.4.3 Limits, WIP, queue, prompts

- **10 newest** applies to Done and Cancelled (header meta `10 newest`, `kanban_list` the same). Suspended lists everything, because it is a to-do list on hold, not history.
- **WIP slot.** A card Claude holds that moves to Suspended or Cancelled is a card leaving Claude, as with Backlog today. `holdsSlot` keeps its slot until the move is confirmed, then frees it, and the top queued card starts. A **queued** card moved there leaves the queue. The activity round closes as on any exit from Claude. Nothing new in `queue.ts` beyond tests that prove it.
- **A turn still running on that card** (`activity.live.cardId === card.id && live.isRunning`) is not stopped: the mod can't interrupt a turn. The person gets one toast, `S.stillWorking(card, to)` = `Claude is still working on #12. Press Esc in the prompt to stop it.`
- **Claude can't undo the person's decision.** `kanban_move` on a card in Suspended or Cancelled is refused, `S.setAside(card)` = `Card #12 is suspended by the person; leave it unless they move it back.` (`cancelled` wording for Cancelled). `kanban_show` and `kanban_handoff` still work on it.
- **Reopening** = dragging (or `m`+key, or a detail button) back into an Active section. GitHub reopens the issue first (see table). A person's move into Claude from **Backlog, Suspended, Cancelled or Done** submits the work prompt once confirmed. `moveOptions(from, to)`: `to === 'claude' && from !== 'human' && from !== 'claude'`. Human→Claude stays Send back with its resume prompt (decision 109).
- **Handoff rule.** Unchanged and nothing new. Moving into Human from anywhere needs a valid handoff (or a question). Moving into the inactive group needs nothing. The Write/Edit guard still only blocks a transition into Human.
- **`kanban_move` `to` enum stays `human | claude | backlog | done`.** Suspending and cancelling are the person's calls. Claude asks with `kanban_ask` instead (decision 110). The description adds: "Suspended and Cancelled are set by the person only."
- `kanban_list` `column` enum: all six; lines read `#47 [cancelled] Export to CSV …`.
- `kanban_create` `column` enum: unchanged (claude, backlog, done).
- **Detail view move menu** (`view-detail.tsx`). Two rows, other sections only:

  ```
  Move to    Human · Claude · Backlog
  Set aside  Done · Suspend · Cancel
  ```

  Verbs for the inactive targets (`S.setAsideTo.suspended = 'Suspend'`, `cancelled = 'Cancel'`, `done = 'Done'`). Keys stay `move:<column>`. Styling is in B.10.
- **Keyboard** (`board-client.tsx`): `m` then `1`–`6` or `h c b d s x`. Header `moveKeys` come from `MOVE_KEY` and the digit. Because a folded group's section headers aren't drawn, a **group** `RowView` carries `sections: { column, moveKeys, hint }[]`, and the `m` lookup searches section headers and group rows. While carrying, each closed group header shows its sections' keys (`  d/5 s/6 x/7`, cut to fit), the open headers as today.
- **Filter.**
  - New terms: `@suspended`, `@cancelled` (and `@canceled`), and the group terms `@active` and `@inactive` (each the three columns of its group, alternatives like other `@` terms).
  - The drawn group while filtering: `filterGroup` if set; else `openGroup` if it has a match; else the first group with a match (Active, then Inactive); else `openGroup`. The stored `openGroup` never changes under a filter (the same idea as decision 90).
  - A group press under a filter toggles the drawn group into `filterGroup`. Changing the filter text drops `filterGroup`.
- **Status line.** Unchanged: `N cards waiting on you` counts Human only. Suspended and Cancelled cards never toast.
- **Suggestions.** Dedupe (`suggest.ts:112`) compares against cards not in Done or Cancelled. Suspended counts as open, so an idea already on hold isn't suggested again.

### A.5 Files to change (Part A)

| File | Change |
|---|---|
| `types/index.d.ts` | `KanbanColumn` +2, `KanbanGroup`, `KanbanUi` (A.2), `KanbanGithub.options.cancelled?/suspended?`, `KanbanCard.stateReason?` |
| `hooks/model.ts` | `GROUPS`, `GROUP_ORDER`, `COLUMNS`, `groupOf`, `isOrdered`, `NEWEST_LIMIT` (replaces `DONE_LIMIT`), `MIN_SECTION_BODY`, `MOVE_KEY`, `INITIAL_UI` |
| `hooks/atoms.ts` | ui shape `ui-4` |
| `hooks/layout.ts` | Row kinds, `sectionBody`, `sectionWindow`, `layoutBoard` groups, `applyFilter` → drawn group, `hitTest`, `extraRows`/`footRows`; remove `capFor`, `openCount`, `detailReserve` |
| `hooks/board-rows.ts` | group rows (summary, chips, sections' move keys), section headers (rule, meta), `blank`, `legend`; `parseBoardMessage` accepts `toggleGroup` |
| `hooks/board-client.tsx` | group `RowView`, `{ type: 'toggleGroup', group }` post, chips + `x` in `dropTarget`, blank-row drops, `m` lookup over group rows, cursor stops (group headers, cards, `more`; not section headers, blanks, legend) |
| `hooks/view-board.tsx` | `toggleGroup`, `extraRows`, Button rows for group headers on vscode/mobile (section headers become Text), `scrollSection`/`keepInView` on `sectionWindow` |
| `hooks/github.ts` | query (`stateReason`, Status options on page 1), `columnOf`, name patterns, `planMove`, verify, `moveGithub` patch, `ensureLabel` for `suspended` |
| `hooks/board.ts` | merge `statusOptions` into `backend.options`, re-cache |
| `hooks/local.ts` | parse `canceled` alias (`isColumn` covers the rest) |
| `hooks/sync.ts` | `moveOptions` (A.4.3); `isOrdered` in place of `'done'` |
| `hooks/reorder.ts`, `hooks/suggest.ts`, `hooks/quick-add.ts` | `isOrdered`; dedupe; `openGroup` |
| `hooks/queue.ts` | `headerCount` → section meta strings (A.3.2) |
| `hooks/tools.ts` | enums, `setAside` refusal, `stillWorking` toast lives in `sync.ts` confirm or `view-*` move path (wherever the person's move starts) |
| `hooks/filter.ts` | `@suspended`, `@cancelled`/`@canceled`, `@active`, `@inactive` |
| `hooks/view-detail.tsx` | two move rows (A.4.3) |
| `hooks/strings.ts` | `col` +2, `group` labels, summaries, empty-state lines (B.4), `setAside`, `stillWorking`, `setAsideTo`, `groupsFolded`, `suspendedLabelDescription`, chips, tool descriptions |
| `README.md`, `docs/plan.md`, `docs/decisions.md` | sections table, mapping tables, file format, keys; decisions 99–118 |
| `.claude-plugin/plugin.json` | version `0.4.0` (decision 97) |
| `tests/fake-gh.ts`, `tests/github-board.ts`, `tests/board-ui.ts`, `tests/fakes.ts` | `issueNode({ stateReason })`, `boardReply` Status options, `ROW_KEY` adds `grp|blank|legend`, a `group(ui, g)` press helper |

### A.6 Tests (Part A)

Add:

- `layout.test.ts` (rewrite the cap cases):
  - B is equal for all three sections at `bodyRows` 30, 31 and 32, with the slack 0/1/2 at the bottom.
  - B = 2 at `bodyRows` 10, and the tree is taller than the pane.
  - `extraRows` shrinks B.
  - An empty section is `empty` + blanks.
  - Overflow gives `↑`/`↓` rows inside B.
  - A 2-row activity block that doesn't fit drops its detail row, never its card.
  - `maxOffset` with mixed blocks.
  - Done and Cancelled show 10 newest; Suspended shows all.
  - `openGroup` `'none'` gives 2 rows + hint; Inactive open draws Active folded on top.
  - `hitTest` on `blank` gives its column, and on `group`/`legend` gives `undefined`.
  - The filter picks the group with matches; `filterGroup` wins.
  - Every row fits its width at 24, 30, 44 and 80 columns (CJK title included).
- `github.test.ts`:
  - The `columnOf` precedence table (all six rules, plus closed + `suspended` label → done/cancelled by reason).
  - Name patterns, positive and negative (`Blocked` is not suspended).
  - `planMove` to suspended and cancelled, with and without an option, from open/closed-completed/closed-not-planned.
  - Done from cancelled (reopen, close `--reason completed`, verify).
  - Leaving suspended removes the label in its real spelling.
  - The verify string.
  - Page 1 sends the Status options field and page 2 doesn't; `statusOptions` fill `options.cancelled/suspended`.
  - The `moveGithub` patch.
  - `ensureLabel('suspended')` runs once and never overwrites.
- `local.test.ts`: `status: suspended|cancelled|canceled` round-trip; a move writes them.
- `pane.test.tsx`:
  - The first open shows Active open and Inactive folded.
  - `grp:inactive` opens Inactive and folds Active.
  - Pressing it again folds both.
  - Section headers have no press on vscode/mobile.
- `drag.test.tsx`:
  - Dragging onto the closed Inactive header's `Suspended` chip moves the card there.
  - Dropping on the label part does nothing.
  - Dropping on a blank filler row places the card last.
  - The open group's header is not a target.
- `keyboard.test.tsx`: `m s`, `m x`, `m 6` move to folded sections; cursor stops skip section headers and blanks.
- `scroll.test.tsx`: the wheel over a blank row scrolls its section; offsets for all six columns.
- `filter.test.ts` / `filter-pane.test.tsx`:
  - The new `@` terms.
  - Inactive is drawn open when only it matches, and `openGroup` stays.
  - A group press under a filter sets `filterGroup`, and changing the text drops it.
- `queue.test.tsx`:
  - A running card moved to Cancelled frees its slot after confirm and the next queued card starts.
  - A queued card moved to Suspended leaves the queue.
  - The "still working" toast fires only for the live card.
- `sync.test.tsx`: `moveOptions` from suspended/cancelled/done → claude sends the work prompt; human → claude does not.
- `tools.test.ts`: `kanban_list column: 'suspended'`; `kanban_move` on a suspended or cancelled card is refused; `to: 'cancelled'` is refused by the enum.
- `reorder.test.tsx`: Cancelled refuses a reorder, Suspended reorders.
- `detail.test.tsx`: the two move rows and their keys; Suspend from Claude.
- `quick-add.test.tsx`: opening the form with Inactive open switches to Active.
- `suggest.test.tsx`: a suggestion that matches a Cancelled card is added; one that matches a Suspended card is folded.

Update every test that presses `hdr:done` to open Done (`pane`, `activity`, `check-run`, `poll`, `review`, `zero-config`) to press `grp:inactive`, and every assertion on `▾ Human 2`-style header text.

---

## Part B — Polish (#36)

### B.0 Principles

- **One title column.** Every card's title starts at the same cell across all six sections, and its meta (sync mark, age) ends flush right.
- **Color means something**, and only four things:

  | Color | Means |
  |---|---|
  | `permission` | needs you |
  | `claude` | Claude |
  | `success` / `warning` / `error` | sync state |
  | dim | inactive or secondary |

  Nothing else is colored. The one exception is agent dots, which use their fixed palette.
- **One glyph set**, all text-presentation, one cell in the engine's width table (`cellWidth`). No emoji, which some terminals draw two cells wide.

  | Glyph | Use |
  |---|---|
  | `▸` `▾` | fold |
  | `⟳` `✓` `✕` | sync (`✕` dim when it means dismiss or clear) |
  | `●` | agent |
  | `↑` `↓` | more |
  | `─` | rule |
  | `›` | hover |
  | `…` | cut |
  | `·` | separator |
  | `?` | question |
  | `⏎` `⇧` | key hints |

  `🔍` and any emoji stay banned (decision 111).
- **Every string lives in `hooks/strings.ts`.** Each one has a short variant where a narrow pane needs it: `{ long, short }` objects, chosen by `fit(text, room)`.
- **Narrow-width degradation order** (board), applied one step at a time until the row fits:
  1. Long → short copy (empty states, group summaries, Claude meta).
  2. Section-header meta dropped (the rule stays).
  3. Activity row: activity text, then the agent name; the stats stay.
  4. Card age dropped when the title would get fewer than 8 cells.
  5. Number column: `#` dropped when the numbers would take more than a quarter of the row.

  The toolbar keeps its own order (decision 98).

### B.1 Card row (P1)

Now: `  #12 Fix login redirect loop on Safa…   12m` / `  #7 Rewrite…` (titles don't align; a reserved blank glyph cell; GitHub tags shift titles).

Target (44):

```
   #12 Fix login redirect loop on Safa…  12m
    #7 Rewrite the onboarding flow so …   1d
   ?23 Which auth provider?             10d
    #5 In flight                      ⟳ 10d
   new Write the README                 ⟳
  #111 Finished task 0                   1d
```

- Layout: indent 2, then the number right-aligned in a column as wide as the widest `#N` on the **whole board** (so it is stable while scrolling and across sections), 1 space, the title, at least 2 spaces, the meta.
- Meta: the age right-aligned in 3 cells. While a sync mark shows, it is `glyph + space` before the age. The title shrinks only while the mark is shown, and no cell is reserved otherwise.
- Question cards use `?` in place of `#` (`?23`, `permission` + bold). The 3-letter tags `rev`/`hum` leave the row. Both mean "your turn", which the section already says. They stay in the detail meta line and in `kanban_list` (decision 112).
- The pending quick-add card shows `new` in the number column (dim), not `#0`.
- Styles:
  - Number dim.
  - Title default.
  - Age dim.
  - Done rows dim throughout.
  - Cancelled rows dim, with `strikethrough` on the title.
  - Suspended rows dim title, normal number.
  - Queued Claude cards dim, with meta `queued 1` (`q1` below 36 columns) in place of the age.
- Age labels (`ageLabel`): `now`, `Nm`, `Nh`, `Nd` up to 13 days, `Nw` up to 52 weeks, then `Ny`. Never more than 3 cells, so `365d` can't push the column.
- At 30 columns:

  ```
     #12 Fix login redirec…  12m
      #7 Rewrite the onboa…   1d
  ```

### B.2 Section and group headers (P1)

As specified in A.3.2 and A.3.3. Part A implements these final forms, so they are not redrawn twice. Target, Active open, 44 columns, `bodyRows` 30 (B = 7, slack 2):

```
┌────────────────────────────────────────────┐
│ Local · updated just now                   │
│ r: Refresh   n: New   f: Find              │
│▾ Active                                    │
│  Human 2 ──────────────────────────────────│
│   #12 Fix login redirect loop on Safa…  12m│
│    #7 Rewrite the onboarding flow so …   1d│
│                                            │
│                                            │
│                                            │
│                                            │
│                                            │
│  Claude 2 ──────────────── limit 1 · 1 over│
│   #31 Build the sync API                 3m│
│       ●● Explore · ⟳ Edit session.ts · 12m…│
│   #32 Add a dark theme                   3h│
│                                            │
│                                            │
│                                            │
│                                            │
│  Backlog 8 ────────────────────────────────│
│   #40 Write docs                        20h│
│   #41 Ship 1.0                           1d│
│   #42 [KANB-UIX] Polish the board        2d│
│   #43 Investigate flaky test in sync     3d│
│   #44 Rate-limit banner                  4d│
│   #45 Cache warmup                       5d│
│         ↓ 2 more                           │
│▸ Inactive                           12 Done│
│                                            │
│  ⏎ open · m move · ⇧J/K reorder            │
└────────────────────────────────────────────┘
```

(`limit 1 · 1 over` because both cards are in Claude with a limit of 1. In `warning`.)

Inactive open, 44:

```
┌────────────────────────────────────────────┐
│ Local · updated 3m ago                     │
│ r: Refresh   n: New   f: Find              │
│▸ Active      2 Human · 2 Claude · 8 Backlog│
│▾ Inactive                                  │
│  Done 12 ──────────────────────── 10 newest│
│  #111 Finished task 0                    1d│
│  #110 Finished task 1                    2d│
│  #109 Finished task 2                    3d│
│  #108 Finished task 3                    5d│
│         ↓ 6 more                           │
│  Suspended 1 ──────────────────────────────│
│   #46 Keyboard help overlay              2w│
│                                            │
│                                            │
│                                            │
│                                            │
│  Cancelled 1 ──────────────────────────────│
│   #47 Export to CSV                      3w│
│                                            │
│                                            │
│                                            │
│                                            │
└────────────────────────────────────────────┘
```

(`#47`'s title is drawn dim with `strikethrough`.) At 30 the Active summary becomes `2H 2C 8B`, the Done meta stays (`10 newest` fits), and `Suspended 1 ───` keeps its rule.

### B.3 Activity row (P2)

Now: `    ●● Explore idle · 12m · 48k tok` (fixed 4-cell indent, no separator after the name).

Target: aligned to the title column, separators everywhere, shorter stats.

```
   #31 Build the sync API                 3m
       ●● Explore · ⟳ Edit session.ts · 12m…    (44, tool running)
       ●● Explore · idle 3m · 12m · 48k         (44, idle)
       ●● Explore · 12m · 48k                   (30)
```

- `detailSegs` takes the title column as its indent (`titleColumn(board)` from `layout.ts`).
- Joins name, activity and stats with `S.statsSep`.
- Stats `12m · 48k` (drop ` tok` on the row; the detail view keeps `48k tok · 90k cached`, where there is room to explain it).
- The main session's dot is always `claude`. Subagents hash into the palette **without** `claude` and `permission`, so a dot never looks like a section color (decision 113).

### B.4 Empty states (P1)

One dim line, indented to the title column. The long form is used where it fits, else the short one. Under a filter every section says `No matches`.

| Section | Long (≥ 40) | Short |
|---|---|---|
| Human | `✓ All clear, nothing needs you` (`✓` in `success`) | `✓ All clear` |
| Claude | `Idle · drag a card here` (terminal/desktop), `Idle · open a card to move it` (vscode/mobile) | `Idle` |
| Backlog | `Nothing yet · n adds a card` (mobile: `Nothing parked`) | `n adds a card` |
| Done | `Nothing finished yet` | `None yet` |
| Suspended | `Nothing on hold` | `None` |
| Cancelled | `Nothing dropped` | `None` |

Empty board (44), replacing `No cards yet. Add .kanban/0001-title.md` and the two cut hint lines:

```
┌────────────────────────────────────────────┐
│ Local (auto) · updated just now            │
│ r: Refresh   n: New   f: Find              │
│▾ Active                                    │
│  Human 0 ──────────────────────────────────│
│       ✓ All clear, nothing needs you       │
│                                            │
│  Claude 0 ───────────────────────── limit 1│
│       Idle · drag a card here              │
│                                            │
│  Backlog 0 ────────────────────────────────│
│       Nothing yet · n adds a card          │
│                                            │
│▸ Inactive                             empty│
│                                            │
│  Cards live in .kanban/*.md here.          │
│  On GitHub? Link a Project to the repo     │
│  or set backend: github to see why.        │
└────────────────────────────────────────────┘
```

At 30: `Cards live in .kanban/` · `GitHub? Link a Project` · `or set backend: github`. Every hint line has a short form that fits 30, so nothing is cut mid-word. `S.noCards` and `S.githubHint` become `{ long, short }[]`.

### B.5 Loading (P1, also a bug)

Now: the first load with no cache draws an empty board with `No cards yet` and the GitHub hints.

Target: `layoutBoard` takes `isLoading` (board `isLoading && fetchedAt === 0 && cards.length === 0`). Then:

- Headers show no counts.
- Each Active section body is skeleton bars, `color="subtle" dimColor`, of `─` at 60 %, 40 % and 75 % of the title room. They are deterministic, never random, so a redraw doesn't flicker.
- Inactive stays folded.
- There are no note or hint rows.

```
┌────────────────────────────────────────────┐
│ GitHub · loading…                          │
│ r: Refresh   n: New   f: Find              │
│▾ Active                                    │
│  Human ────────────────────────────────────│
│       ────────────────────                 │
│       ─────────────                        │
│  Claude ───────────────────────────────────│
│       ───────────────────────              │
│                                            │
│  Backlog ──────────────────────────────────│
│       ───────────────                      │
│       ──────────────────────               │
│▸ Inactive                                  │
└────────────────────────────────────────────┘
```

The section-header rule is the same glyph but sits on the label row. The skeleton bars are indented to the title column and `subtle`, so the two don't read alike. A cached board stays as today (cards from the cache, `loading…` in the status row).

### B.6 Sync marks (P2)

- The placement is in B.1: before the age, flush right. The title gives way only while a mark shows.
- Pulse and fade are as today: `⟳` `warning`, blinking dim on the 400 ms tick; `✓` `success`, dimming after 1 s, gone after 2 s; `✕` `error`.
- A failed row's number turns `error` too, so a failure in a long list is visible from the left edge, where the eye scans.
- The toolbar `✕2 retry` is unchanged.

### B.7 Selection, hover, drag (P2)

- **Keyboard cursor**: the whole row inverse, padded to the edge (as today).
- **Hover** (Client, terminal/desktop). `ClientPointerEvent` sends `move` with no button, plus `enter` and `leave`.
  - The module keeps `hover: string | null` (a row key) in its state. On a button-less move it sets the row under the pointer, and on `leave` it clears it. It calls `setState` only when the key changes.
  - Today the module drops the gesture on a button-less move: keep that, and add the hover.
  - A hovered card, `more` row or group header shows `›` in column 0 (bold, default color). It's the cell the indent leaves free, so no text moves.
  - vscode/mobile Button rows already invert under the pointer, so nothing to add there.
- **Drag ghost.** The dragged row: dim + `italic`, with `›` in column 0 so the eye finds it. The insertion line stays an underline padded to the edge. During a drag the target section's header label turns `inverse`, so you can see which section a drop lands in even when the line sits under a row of the section above. Closed groups show chips (A.3.5).
- **Hover on the toolbar Buttons**: none needed, the engine inverts them.

### B.8 Toolbar status row (P2)

- `updated now` → `updated just now`; `updated 5m` → `updated 5m ago`. Strings `S.updated(age)` with `age === 'now'`.
- The age **ticks**. A 30 s `$.clock.every` (`ageTicker` in `board.ts`) starts with polling and is cancelled with it, and bumps `tickAtom` while the pane is open. Today ages only change when a poll or a sync redraws, so `updated 2m` can sit for 45 s. It costs one redraw per 30 s (decision 114).
- Below 40 columns ` (auto)` is dropped before the backend name is (`Local · just now`).
- The rest is unchanged (decision 98).

### B.9 Key legend in the slack row (P2, delight)

On terminal/desktop, when `slack ≥ 1`, the first slack row is a dim legend:

```
  ⏎ open · m move · ⇧J/K reorder          (≥ 40)
  ⏎ open · m move                          (30)
```

After the first key it changes to the cursor keys:

```
  ↑↓ walk · ⏎ open · m+key move            (≥ 40)
```

It costs no rows (it uses the leftover from the equal-height split) and makes the Client keys discoverable without the cut-or-nothing status hint (decision 61). The status-row hint stays for panes with no slack. The legend is a `RowView` of kind `text` with no column, so the cursor skips it.

### B.10 Detail view (P1)

Now: buttons touch, the key-hint line overflows, `Move to:` is glued on, and the handoff is raw markdown.

Target (44, a Human card on GitHub):

```
┌────────────────────────────────────────────┐
│b: ← Board         k: ‹ Prev  1/2  n: Next ›│
│                                            │
│#12 Fix login redirect loop on Safari       │
│Human · in review · updated 12m ago · GitHub│
│                                            │
│[ a: Approve ] [ s: Send back ] [ p: Park ] │
│[Feedback: What should Claude change?]      │
│f: Write feedback                           │
│                                            │
│Claude's handoff · Oct 25                   │
│  Did      Wrote the docs                   │
│  Check    Read the README                  │
│  Changed  README.md                        │
│  Need     Approve                          │
│                                            │
│Move to    Claude · Backlog                 │
│Set aside  Done · Suspend · Cancel          │
│                                            │
│Spec text.                                  │
│                                            │
│History                                     │
│  Feedback · Oct 24 …                       │
└────────────────────────────────────────────┘
```

- **Nav row**: `Box flexDirection="row" justifyContent="space-between"`. The left side is `← Board` (plain, hotkey `b`). The right side is `‹ Prev` (k), `1/2` dim, `Next ›` (n), with 2 spaces between them. Degrade: drop `›`/`‹`, then `1/2`, then the Prev/Next labels become `‹`/`›` alone (`k: ‹ n: ›`).
- **Title**: bold, wraps (the detail view has free height). The number is dim.
- **Meta line** (dim): section (in its section color, not dim) · tag in words (`in review`, `labelled human`, `question`) · `updated 12m ago` · `GitHub` as a `Link` to the issue (`suggestion` color, the engine's link style). The sync text stays as today when there is one.
- **One blank row** between blocks: nav / title+meta / actions / pinned handoff / move rows / body.
- **Actions**:
  - `Box flexDirection="row" flexWrap="wrap" columnGap={1}` with Approve as `variant="primary"`. At 30 it wraps to two rows, never past the edge.
  - The feedback Input directly under it, then `f: Write feedback` (plain, dim).
  - The `reviewHint` line is **removed**: every key it listed is already drawn on its button (`a: Approve`, `k: ‹ Prev`). `S.reviewHint`/`reviewKeys` go.
- **Pinned handoff** (Human cards): the newest counted Handoff, or the open Question (as today's ask block), right under the actions, titled `Claude's handoff · Oct 25` (bold, `claude` color for "Claude's"). Its fields are a two-column list: `Box flexDirection="row"`, a label `Box width={9}` (dim), and a value `Text wrap="wrap"`. That block is left out of the History below.
- **Move rows** (A.4.3): a label `Box width={10}` dim (`Move to`, `Set aside`), then plain Buttons with `Text color="suggestion"` labels, joined by dim ` · `. Plain Buttons invert under the pointer and focus, which is the click affordance on the terminal.
- **Body**: the spec Markdown, then `History` (bold): every section oldest first, each headed `Handoff · Oct 24` / `Feedback · Oct 24` / `Question · …` / `Answer · …` / `Check run · …` in bold, colored by who wrote it (Claude `claude`, the person `permission`), `from @login, not counted` dim. Fields use the same two-column list as the pinned handoff.
- **Dates** read `Oct 25` (`S.shortDate(iso)` in strings.ts, English month names, no locale lookup).
- Claude card (activity): the `Agents:` line and the totals as today, but `Total` and `Round N` go in the same two-column list (`Total    12m · 48k tok · 90k cached`).
- 30 columns: the same structure. Buttons wrap, the label boxes shrink to 8 (`Move to`, `Aside`), and the nav row degrades as above.

### B.11 Quick add and filter (P2)

Quick add now: `[New card: New card title]` / `[ Add details ][ Cancel ]`.

Target (44):

```
 [New card: New card title                 ]
  ⏎ adds to Backlog · Add details · Cancel
```

The second row is dim Text `⏎ adds to Backlog`, then the plain Buttons `Add details` and `Cancel` (`suggestion` color), joined by dim ` · ` (`Box columnGap={1}` on the graphical surfaces). At 30: `⏎ add · Details · Cancel`. With details open, the label is `⏎ adds · Hide details · Cancel`.

Filter now: `[Filter: docs]`. Target: the same Input, placeholder `words, #12, label:ai, @done` (the new `@` terms are discoverable). The header counts (`1/8`) and the group summary (`3 matches`) carry the result. Every section with no match says `No matches`, from B.4.

### B.12 Toasts and microcopy (P2)

Tone: short, plain, the card's number first, no exclamation marks, and always say what happens next. New and changed strings (all in `hooks/strings.ts`):

| Key | Text |
|---|---|
| `stillWorking(card)` | `Claude is still working on #12. Press Esc in the prompt to stop it.` |
| `setAside(card)` (tool deny) | `Card #12 is suspended by the person; leave it unless they move it back.` / `… is cancelled …` |
| `suspendedToast(card)` (GitHub fallback, once per session) | `Suspended #12: GitHub has no Suspended status, so it carries the suspended label.` |
| `cancelledToast(card)` (GitHub, once per session) | `Cancelled #12: closed as not planned on GitHub.` |
| `updated(age)` | `updated just now` / `updated 5m ago` |
| `groupsFolded` | `  Press a group to open it` |
| empty states, hints, chips, legend | B.4, B.9, A.3.5 |

Existing toasts stay; they already follow this tone.

### B.13 Pane title badge (P3, delight, guarded)

While at least one card is in Human, the pane's title is `Kanban · 2` (`S.paneTitleCount(n)`). It is set by calling `$.ui.open({ id: PANE, title })` again with the same `rows`/`columns`, only when `$.ui.panes()` lists the pane as open, and only when the count changes. Per `PaneOpenArgs`, "opening an open id delivers the new title, never a second instance", and the person's own size wins.

The title only shows as a tab when several panes are open. So first write a test that a second `ui.open` without `focus` keeps the pane where it is. If the live pane raises or refocuses, drop this item. Nothing else depends on it (decision 115).

### B.14 What is not possible (and so not specified)

- No custom background colors for rows beyond theme keys. Hover uses a glyph, not a fill, so it looks right in every theme.
- No toast actions ("Undo"): `$.ui.toast` takes text only.
- No sub-cell insertion line: the underline is the only row-free marker.
- No spinning `⟳`: a cell can't rotate (plan §0).

### B.15 Implementation chunks

Part A goes first as one branch (`groups`, issue #35), because it changes the row model every polish item draws. The Part B chunks own disjoint files. Each adds its strings in its own labelled block at the end of `S`, so `strings.ts` merges trivially.

| Chunk | Issue | Owns | Items | Depends on |
|---|---|---|---|---|
| **A** groups | #35 | everything in A.5 | A.1–A.6, plus the final header forms (B.2) and drop chips | — |
| **B1** board list | #36 (sub-issue) | `layout.ts`, `board-rows.ts`, `board-client.tsx`, `view-board.tsx`, `activity-view.ts`, `model.ts` (`ageLabel`), `toolbar.ts`; tests `layout`, `activity-view`, `drag`, `drop-target`, `pane`, `toolbar`, `client-fine` | B.1, B.3, B.4, B.5, B.6, B.7, B.8 (status copy only), B.9 | **must follow A** (same files) |
| **B2** detail and forms | #36 (sub-issue) | `view-detail.tsx`, `view-quick-add.tsx`, `view-filter.tsx`, `view-suggest.tsx`, `view-pick.tsx`, `view-check.tsx`; tests `detail`, `review`, `quick-add`, `ask`, `check-run` | B.10, B.11 | can start with A; rebase on A before its move rows (A.4.3 adds them as one flat row; B2 splits it into two) |
| **B3** time and chrome | #36 (sub-issue) | `board.ts` (age ticker, title badge), `register.tsx` (wiring only), toast copy in `sync.ts`/`tools.ts` call sites, README screenshots text | B.8 ticker, B.12, B.13 | parallel with A; merges after A if it touches `tools.ts` |

The merge order into the integration branch is A → B2 → B3 → B1. B1 is last because it re-renders every board row and its snapshots are the final word.

Model tiers (global rule): A and B1 are Sonnet at `xhigh` working from this spec, with an Opus review. B2 and B3 are Sonnet `xhigh`. One Opus review of the accumulated diff before `main`.

Each chunk ends with the three gates, plus a text render of the board at 30/44/80 columns. The throwaway renderer used for section 0 inlines Client rows via `ui.drawn({ in: 'board' })`. Commit it as `tests/render.ts` (a helper, not a `*.test` file) so the polish can be checked by eye in review.

---

## Decisions

Numbered to continue `docs/decisions.md` (which ends at 98); append under a `## 2026-10-26 (groups and polish)` heading.

99. **Two groups replace four folds: Active (Backlog, Human, Claude) and Inactive (Done, Cancelled, Suspended).** Requested by the user. One group is open at a time, and pressing the open one folds both. Section folds are gone. (#35)
100. **Active is Backlog, Human, Claude top to bottom, the order the user listed.** The design pass proposed keeping Human on top; the orchestrator overrode it to follow the request literally. With equal fixed heights every section of the open group is always visible, so Human can no longer scroll off, which removes the reason for keeping it first. One constant (`GROUPS`) flips it. (#35)
101. **Inactive is Done, Cancelled, Suspended, the order the user listed** (the design pass proposed Suspended before Cancelled; overridden for the same reason as 100). (#35)
102. **The "ai" section stays labelled Claude.** It is the brand, the prompts, the tool value and the README word; "AI" would be a second name for one thing. (#35)
103. **Equal height:** each section of the open group gets `B = max(2, floor(avail / 3))` body rows. It is filled with cards, `↑`/`↓ N more`, the empty-state line and blank filler. The 0–2 leftover rows go below everything, never to one section. There is no maximum: the height follows the pane, never the cards, so nothing jumps when a card moves. The rows the picker, filter and quick add take come off first. A pane too short for 2 rows each scrolls as a whole. (#35)
104. **The ui atom's shape goes to `ui-4` with `openGroup: 'active'` as the default; no other shape changes.** The ui atom is never stored, so the engine's reset on a shape change is the whole migration. Other atoms and store values only gain union members and optional fields. (#35)
105. **Section headers carry a dim rule to the right edge** (`Human 2 ────`). Equal-height blocks with blank filler need a visible boundary. A rule costs no row. (#35, #36)
106. **Claude's header says `limit 1 · 2 queued`, and `limit 1 · 1 over` in warning when Claude moved more in than the limit**, replacing `2/1`, which read as a fraction. (#35, #36)
107. **Color semantics:** Human = `permission` (the engine's "needs you" color), Claude = `claude`, Backlog plain, the inactive group dim. A folded Active group still shows a non-zero Human count in `permission`. (#36)
108. **Folded groups take drops through chips, not by springing open.** While a card is dragged, a folded group's header shows its sections as chips and the pointer's column picks one. Springing a group open would fold the other and pull the dragged row from under the pointer. Keyboard `m` reaches folded sections through the group row's move keys (`1`–`6`, `h c b d s x`). (#35)
109. **A person's move into Claude from Backlog, Suspended, Cancelled or Done sends the work prompt**; from Human it stays Send back. Taking a card up again is starting work. (#35)
110. **Suspending and cancelling are the person's calls.** `kanban_move` keeps `human | claude | backlog | done`, and it refuses to move a card out of Suspended or Cancelled. Claude asks with `kanban_ask`. A card Claude is still working on keeps its turn running (the mod can't interrupt it); the person gets a toast saying how to stop it. Its WIP slot is freed and the queue moves on once the move is confirmed, as for any card leaving Claude. (#35)
111. **One glyph set, text-presentation only, one cell each** (`▸▾ ⟳✓✕ ● ↑↓ ─ › … · ? ⏎⇧`); no emoji. Emoji draw two cells wide in some terminals and break the one-row guarantee. (#36)
112. **One title column for the whole board.** The number is right-aligned to the widest `#N` on the board. The sync mark takes room only while shown. `?` replaces `#` on a question card. The `rev`/`hum` tags leave the row (both mean "your turn", which the section says) and stay in the detail meta and `kanban_list`. (#36)
113. **The main session's agent dot is always `claude`; subagents hash into the palette without `claude` and `permission`**, so a dot never reads as a section color. (#36)
114. **Relative times tick:** a 30 s ticker runs while the pane is open, so `updated 2m ago` and card ages are never a poll behind. One redraw per 30 s. (#36)
115. **The pane title shows the Human count (`Kanban · 2`) only if re-opening an open pane is proven not to move or focus it.** It is a tab label seen only with several panes, so it is not worth any risk. (#36)
116. **GitHub: Cancelled = closed as not planned, read from `stateReason`; Suspended = a Status option named like suspended/on hold/paused/icebox, else the `suspended` label with Status Backlog.** A board option named like cancelled/won't do/not planned is used when present, but the issue is still closed as not planned, so the close reason stays the source of truth. The Status options come from the first page of the board query, so no extra `gh` call is needed and an option added later is picked up. No options are added to the person's board (decision 4). Without the options, the GitHub board page shows cancelled cards in Done and suspended ones in Backlog with the label. (#35)
117. **Done ↔ Cancelled reopens the issue before closing it again with the other reason**, and the verify reads `state` and `stateReason`. `gh issue close` on a closed issue changes nothing and exits 0. (#35)
118. **Done and Cancelled show their 10 newest; Suspended shows every card in manual order.** Suspended is a to-do list on hold, not history. (#35)

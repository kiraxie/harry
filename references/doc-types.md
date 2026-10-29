# `.local/` Item Store

harry keeps work products as items under `.local/items/` (backlog + active)
and `.local/archive/` (done), plus two tracking files (`INDEX.md`,
`HISTORY.md`). A work unit is one item: `status: backlog → active → done`,
where `active` holds `## Why / What` (ending in its acceptance criteria) and an
append-only `## Progress`; `INDEX.md` maps active and backlog work and opens with
the `## In flight` list; completion appends one line to `HISTORY.md`. This
reference is the full item format, milestone semantics, and lifecycle. **Read this whenever you create, graduate, or archive any
`.local/` item.**

## The item model

One work unit = one `.md` file that accumulates sections as it matures and
moves through exactly one `status` field — never a new file per stage:

`backlog` (idea, not yet decided) → `active` (design + acceptance criteria
agreed, being worked) → `done` (moved to `.local/archive/`, read-only).

```yaml
---
id: <slug>
status: backlog        # backlog | active | done
milestone: <slug>      # optional key — omit entirely if standalone
---
```
```markdown
# <title>

## Notes           <!-- backlog stage: freeform accumulation — findings,
                        research, open questions -->
## Why / What      <!-- filled when promoted to active — its acceptance criteria, after the design when one was weighed (below) -->
### Acceptance criteria  <!-- last subsection of Why / What; approved with the design -->
## Progress        <!-- append-only, filled during execution -->
## Follow-ups      <!-- sources: Writers, below; flushed to backlog items at finish -->
```

Sections accumulate — never delete an earlier section when filling a later
one (`## Notes` stays as history once `## Why / What` is written).

A `## Notes` entry a writer files in a backlog item — a new item's first, or one
merged into a similar item — is one block per line: a `From <source> …:` line, then
the quote as a `>` blockquote. The block ends where its blockquote ends; other text
in `## Notes` (finishing's discard line, an archive back-link, research notes)
belongs to no block. `<source>` is one rule, applied in order: the item the line
came from; with no item, the slash command that filed it and what it ran on; with
neither, the branch. After it comes where in that source the line sat and when, a
sha or a date. For example: `From scope-rule-followups' Follow-ups (94af1a1):`, `From
/grill on the cache design (2026-10-27):`, `From /debt's DEBT: row at
src/cache.ts:40 (2026-10-27):`, `From /distill's ruling on anthropics/skills
(2026-10-27):`, `From fix/init-typo's leftover check (abc1234):`. Lines ruled into
one new item each keep their own block. `/sync`'s migration is the exception
(**Writers**, below; its `## Notes` is set in `references/sync-migration.md`
**Phase 3**, Step A0's case 3).

`### Acceptance criteria` is a numbered `AC-1, AC-2, …` list. Each AC is an
**outcome** ("invalid input returns 400"), never a step ("add `validate()`"),
and carries its own verification — a command, a test, or a named manual check.
They are approved with the design; execution cites their IDs and never rewrites
them (a wrong or impossible AC stops and asks). An AC appended later may name
an AC it supersedes (a **fix now** ruling, in executing or finishing, drafts one that way); the
superseded AC keeps its text and is judged by its successor, not on its own.

`## Why / What` holds only `### Acceptance criteria` unless a real design decision was
weighed (alternatives existed); then the sections above `skills/brainstorming/SKILL.md`
**Item Template**'s `### Acceptance criteria` precede them. The tier does not change
this: a Major unit that weighed no decision holds the AC list alone.

`## Progress` is append-only and cites AC IDs and commit ranges. Approved AC
text is never edited to record progress — progress goes here instead. The
lines that rules read back: `complete (commits …)` (the AC is done; resuming
builds from the first AC without one), the review and fix-wave lines (where
the review stands, and the findings file each names, holding what is open), the probe
lines `AC-<n>: probe: …` and `AC-<n>: no probe ran: …` (handed to the review beside
their AC, whose spec verdict reads them), adjudication rulings, and the **leave as is**
records (below), which `/debt` reads from the archive. `small fix: <what> (commit <sha7>)`
is a record only; no rule reads it back.

A **leave as is** record is one `## Progress` line in one of two forms: `leave as is ·
<where> · <gist> · <reason>` (a review finding or a leftover), or `architecture review
<round>: leave as is · <where> · <gist> · <reason>` (an architecture finding, `<round>`
as the round's head line names it: `round <n>`, or `follow-up`). `<where>` is a
`file:line`, a shape's name, or its source (a turn, an AC id, the `## Follow-ups` line it
was);
`<gist>` is one line, a leftover's original words; `<reason>` is what the writer's own
rule sets. Every writer produces this shape and `/debt` reads it from the archive
(`references/debt-audit.md`), so it is defined here and nowhere else.

**Legacy items.** An item written under the older shape keeps its `## Plan` and
is read as-is; nothing migrates it, and no acceptance criteria are invented for it.

A file `## Progress` names is unit state: it is kept until finishing's cleanup
deletes the unit's tmp dir.

## Milestone items

A milestone is a `type: milestone` item in the same `.local/items/` directory
— not a separate folder. It holds no decisions of its own, only links:

```yaml
---
id: <slug>
type: milestone
status: active
---
```
```markdown
# <title>

## Goal / Why      <!-- cross-item goal/constraint; leave empty if none -->
## References      <!-- read-only links to done items in archive/, for background -->
## Members         <!-- items currently being worked toward this goal -->
## Delivered       <!-- members moved here once done -->
```

`## References` and `## Members` hold only links (an `id` or a relative
path) — the content lives **downward** (milestone → item): a milestone knows
its members, a member does not need to enumerate its milestones. The one
exception is a lightweight index key pointing back **up**: an item may carry
an optional `milestone: <slug>` frontmatter key so finishing can find the
right milestone in O(1) without a repo-wide search. This caps an item at
**one** milestone at a time (many-to-many was deliberately not
supported) and creates a small sync obligation: the `milestone:` key and
that milestone's `## Members` list must agree, kept in lockstep by
finishing's membership step below. Adding or removing a member is a
one-line edit to `## Members`; `archive/` is never touched by a
milestone edit.

## Naming & location

- **One store per repo, resolved via the git common dir.** `.local/` lives in
  the MAIN checkout only. From inside any linked worktree, resolve the store
  root as the parent directory of `git rev-parse --path-format=absolute --git-common-dir` — worktrees
  share the main repo's `.git`, so this lands every worktree on the same `.local/` without configuration
  or absolute-path conventions. (Caveat: worktrees off a bare-repo hub have
  no main checkout — the formula lands beside the bare dir; confirm a store
  location with the user there.) Never create a `.local/` inside a worktree;
  if one exists there, it is a stray — merge its content back, then delete it (confirm the deletion with the user first).
  Resolve it inside the same command that uses it, as `$STORE`:

  ```bash
  STORE="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  ```

- **If the project has no `.local/` at all, set it up or confirm it with the user first:**
  don't scatter untracked docs into a repo whose `.gitignore` lacks harry's block.

- File: `.local/items/<slug>.md` (backlog or active). `<slug>` is kebab-case,
  derived from the title — **no date prefix**: `status` is now the temporal
  signal, not the filename.
- Archived (`status: done`): moved to `.local/archive/<slug>.md`, content
  otherwise unchanged. Archive is **read-only** — never edit a file after it
  lands there; extend the idea in a new `.local/items/` item instead (see
  Lifecycle rules).

## Lifecycle rules

- **Backlog → active promotion**: brainstorming fills `## Why / What`,
  ending in its `### Acceptance criteria`, and sets `status: active` once the
  user approves the design and those criteria (its shape: **The item model**
  above) — the file does not move, same path, updated frontmatter + sections.
- **Active → done (archive)**: on finishing (wired into the finishing
  skill), set `status: done` and move `.local/items/<slug>.md` →
  `.local/archive/<slug>.md`.
- **Follow-ups flush**: before archiving, every line under the item's
  `## Follow-ups` becomes a `status: backlog` item in `.local/items/` — its
  own new one (title + one `## Notes` entry, **The item model** above), or merged into
  a similar one (**Similar backlog items**, below) — then the source item's
  `## Follow-ups` section is cleared. The flush treats
  every entry the same, whatever its source. Before the merge menu, finishing's
  triage (`skills/finishing/SKILL.md` **Ask: merge or PR?**) has already taken each
  line ruled **leave as is** out of the section and sent each **fix now** back into
  the unit, so the flush files only what the user ruled **backlog** or kept after
  the menu.
- **Active → backlog (discard)**: finishing's Discard, when the user
  chooses Back to backlog, sets `status: backlog`, appends a `## Notes`
  line, removes its `## In flight` line and flips its `INDEX.md` item line
  to backlog; the file does not move.
- **Similar backlog items**: a writer about to open a new `status: backlog` item,
  `/sync`'s migration excepted (**Writers**, below), first looks for a similar one — an open `status: backlog` item whose work would
  land in the same unit: the same files, or the same rule. Found → the line is
  appended to that item's `## Notes` as one entry (**The item model**, above), the
  text a new item's `## Notes` would hold; no new file and no new `INDEX.md` line, and the
  target's `INDEX.md` summary is updated when its scope widens. An `active` item is
  never a target (its AC is approved, and a merge would grow it), nor is the item the
  writer is itself promoting or finishing, nor anything in the archive (read-only). Lines in one list that are similar to each other, with
  no target, open one new item together. The writer names each line's target —
  "merge into `<slug>`" or "new item `<slug>`" — in the list the user rules, so the ruling
  confirms it; a writer with no list (an author promoting a Non-Goal after the design,
  as **Non-Goals do not survive archiving** below allows) applies the rule itself. A writer that files the line later (finishing's flush) reads the
  target from the line's marker (**Writers**, below): lines whose markers name one
  new-item slug open that one item; a new-item slug an item already holds at flush
  time opens the item under another slug; a marker with no target, or a merge-into
  target no longer an open `status: backlog` item (promoted, archived, deleted),
  opens a new item. Each of these departures from the ruled target is said in the
  reply.
- **Writers**: who adds work to the store besides the flush and the discard.
  - Backlog items are also created directly by, each but one through **Similar backlog
    items** above:
    - brainstorming's residue manifest, at design time, for a destination-outside line
      the user names as a backlog item;
    - `/grill`'s residue manifest, for a line the user names as a backlog item;
    - finishing's **backlog** ruling on an architecture finding, on the user's naming;
    - finishing's leftover check for a unit with no item (a leftover the user keeps,
      in step c and before a PR opens);
    - `/debt`, on request, for its rows that need acting on and for its sweep candidates;
    - `/sync`'s legacy migration, for an old backlog or research file — the one writer
      outside **Similar backlog items**: it opens one item per legacy file and never
      merges;
    - an author promoting a Non-Goal (**Non-Goals do not survive archiving**, below).
  - `## Follow-ups` entries come from:
    - brainstorming's residue manifest (deferred discussion items);
    - executing: follow-on work found mid-build, and the review findings it
      does not fix:
      - Critical and Important findings outside the fix range;
      - findings adjudicated to Follow-ups;
      - findings the user rules backlog before the fix wave;
    - finishing's leftover check, on the user's say (work from the session or the
      files with no outcome, in step c and before a PR opens);
    - an author copying in a Non-Goal (**Non-Goals do not survive archiving**, below).

    Any entry written on the user's own ruling — a finding the user rules backlog, a
    leftover the user keeps — ends `(ruled backlog)`, so finishing's triage keeps that
    ruling instead of asking again; its merge target is still put to the user there, and
    the reply confirms or changes it. Once the user has ruled the target, the marker
    carries it: `(ruled backlog → merge into <slug>)` or `(ruled backlog → new item <slug>)`,
    a new item's slug chosen when the user rules the target and shared by the lines the
    user ruled into one new item.
    The triage writes it on every line it leaves ruled backlog; step c and Option 2
    write it on a leftover the user keeps.
- **Milestone membership**: if the finishing item's frontmatter has
  `milestone: <slug>`, move its link from that milestone item's
  `## Members` to `## Delivered`.
- **Milestone self-archival**: after that move, if the milestone's
  `## Members` is now empty (every member delivered), archive the milestone
  itself the same way as any other item — `status: done`, move
  `.local/items/<slug>.md` → `.local/archive/<slug>.md`. A milestone with an
  empty `## Members` and no `status: done` is a bug: it means every unit of
  work toward that goal finished but nobody closed the goal.
- **Never reopen archive.** Extending an already-`done` item means opening
  a **new** `.local/items/` item and linking back to the old item's archive
  path in the new item's `## Notes` — archive is immutable history, not a
  working copy.
- **No auto-expiry.** Same manual discipline as before: check
  `.local/items/` for the topic before a new brainstorm/audit session
  touches the same area, the same way `.local/INDEX.md` `## In flight` is
  checked at session start.

## `/debt` and backlog

`/debt` re-judges deferred *decisions* (`DEBT:` markers, and Scope &
Non-Goals / follow-up lines inside an active item's `## Why / What` /
`## Progress`) by checking whether each one's premise still holds, and
separately re-judges every `status: backlog` item by asking whether it's
still open. `status: backlog` is the **only** deferred-work source read from
`.local/items/` — there is no separate research/Non-Goals corpus anymore;
those cases now live as `## Notes` inside a backlog or active item. The verdict
vocabulary is defined in `references/debt-audit.md`, which `commands/debt.md`
reads — go there rather than to the command.

**Non-Goals do not survive archiving.** `/debt` reads Scope & Non-Goals only in `status: active`
items (from the archive it reads `## Progress` leave-as-is lines alone,
`references/debt-audit.md`), and finishing's Follow-ups flush (above) only carries `## Follow-ups` forward —
a Scope & Non-Goals bullet in an item that reaches `status: done` is gone
the moment it's archived, with nothing left to re-judge it. This is a
deliberate discipline, not an automated sweep: a Non-Goal worth revisiting
later must be copied into `## Follow-ups` (or promoted straight to a `status: backlog`
item, new or merged by **Similar backlog items**, above) before the item is archived — do not rely on `/debt`
or finishing to catch it for you.

## Global index `.local/INDEX.md`

A live, content-oriented map, one line per item:
`<topic> · <path> · <one-line summary> · <status>`. An entry is removed when
an item is deleted outright (backlog item settled without graduating) or
once an item is archived — `HISTORY.md` already holds the permanent record
of anything that leaves it. Update it when an item is created or promoted
(wired into the brainstorming skill), and whenever a backlog item is created,
graduates, or a milestone's Members/Delivered set changes.

### `## In flight` — the active-work list

`.local/INDEX.md` opens with an `## In flight` section, one line per active
unit of work, `<topic> · <branch> · <started YYYY-MM-DD>`. Gitignored,
**NOT auto-loaded** (lazy) — check it yourself at session start so you don't
duplicate an in-flight item. Mark a unit started when you begin it (wired
into the executing skill), update at commit time; on completion move a
one-line conclusion to `HISTORY.md` and remove the In-flight line (wired
into finishing).

## Chronological archive `.local/HISTORY.md`

The permanent one-line-per-unit completion log
(`- YYYY-MM-DD · <topic> · <squash SHA> · PR #<n> (or "local merge, no PR") · <one-line outcome>`,
newest first) — a unit that never opened a PR writes the literal
`local merge, no PR` in that slot rather than leaving it blank.
On-demand, gitignored, NOT auto-loaded — a thin pointer; the detail lives
in git/PR. **Yearly rotation:** when adding the first entry of a new year,
first move the previous year's entries to `.local/history/<year>.md`,
leaving `HISTORY.md` holding only the current year.

## State (current shape of a feature) — lazy, not maintained

There is no canonical "current state" document kept in sync as items land.
When "what does feature X look like right now" is needed, derive it on
demand by reading the relevant `done` items in `.local/archive/` (newest
first) plus the current code — do not try to keep a running state doc
current; that sync burden is what this model deliberately avoids. The
**only** exception: a handful of long-lived, frequently-referenced features
may earn a hand-maintained thin state note (its own `.local/items/<slug>.md`,
`status: active`, no `type:` key) — create one only after noticing you're
re-deriving the same state repeatedly, never preemptively.

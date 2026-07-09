# `.local/` Item Store — full detail for HARRY.md §5

harry keeps work products as items under `.local/items/` (backlog + active)
and `.local/archive/` (done), plus two tracking files (`INDEX.md`,
`HISTORY.md`). HARRY.md §5 carries the one-paragraph summary and the load
trigger; this reference is the full item format, milestone semantics, and
lifecycle. **Read this whenever you create, graduate, or archive any
`.local/` item.**

## The item model

One work unit = one `.md` file that accumulates sections as it matures and
moves through exactly one `status` field — never a new file per stage:

`backlog` (idea, not yet decided) → `active` (design+plan agreed, being
worked) → `done` (moved to `.local/archive/`, read-only).

```yaml
---
id: <slug>
status: backlog        # backlog | active | done
milestone: <slug>      # optional key — omit entirely if standalone
---
```
```markdown
# <title>

## Notes           <!-- backlog stage: freeform accumulation; absorbs what
                        used to be a separate "research" doc -->
## Why / What      <!-- filled when promoted to active — what a spec used to hold -->
## Plan            <!-- filled when promoted to active — what a plan used to hold -->
## Follow-ups      <!-- filled during execution; flushed to new backlog items at finish -->
```

Sections accumulate — never delete an earlier section when filling a later
one (`## Notes` stays as history once `## Why / What` is written).

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
path) — pointers always go **downward** (milestone → item); an item never
records which milestone it belongs to except via its own optional
`milestone:` frontmatter key. Adding or removing a member is a one-line edit
to `## Members`; `archive/` is never touched by a milestone edit.

## Naming & location

- File: `.local/items/<slug>.md` (backlog or active). `<slug>` is kebab-case,
  derived from the title — **no date prefix**: `status` is now the temporal
  signal, not the filename.
- Archived (`status: done`): moved to `.local/archive/<slug>.md`, content
  otherwise unchanged. Archive is **read-only** — never edit a file after it
  lands there; extend the idea in a new `.local/items/` item instead (see
  Lifecycle rules).

## Lifecycle rules

- **Backlog → active promotion**: brainstorming fills `## Why / What` and
  sets `status: active` once the user approves the design — the file does
  not move, same path, updated frontmatter + sections.
- **Active → done (archive)**: on finishing (wired into the finishing
  skill), set `status: done` and move `.local/items/<slug>.md` →
  `.local/archive/<slug>.md`.
- **Follow-ups flush**: before archiving, every line under the item's
  `## Follow-ups` becomes its own new `status: backlog` item in
  `.local/items/` (title + a `## Notes` line quoting the follow-up), then
  the source item's `## Follow-ups` section is cleared. This is the only
  place new backlog items get created from execution output.
- **Milestone membership**: if the finishing item's frontmatter has
  `milestone: <slug>`, move its link from that milestone item's
  `## Members` to `## Delivered`.
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
`## Plan`) by checking whether each one's premise still holds, and
separately re-judges every `status: backlog` item by asking whether it's
still open. `status: backlog` is the **only** deferred-work source read from
`.local/items/` — there is no separate research/Non-Goals corpus anymore;
those cases now live as `## Notes` inside a backlog or active item. See
`/debt`'s own definition for the verdict vocabulary.

## Global index `.local/INDEX.md`

Unchanged in role: a live, content-oriented map, one line per item:
`<topic> · <path> · <one-line summary> · <status>`. An entry is removed when
an item is deleted outright (backlog item settled without graduating) or
once an item is archived — `HISTORY.md` already holds the permanent record
of anything that leaves it. Update it when an item is created or promoted
(wired into the brainstorming skill), and whenever a backlog item is created,
graduates, or a milestone's Members/Delivered set changes.

### `## In flight` — the active-work list

Unchanged: `.local/INDEX.md` opens with an `## In flight` section, one line
per active unit of work, `<topic> · <branch> · <started YYYY-MM-DD>`.
Gitignored, **NOT auto-loaded** (lazy) — check it yourself at session start
so you don't duplicate an in-flight item. Mark a unit started when you begin
it (wired into the executing skill), update at commit time; on completion
move a one-line conclusion to `HISTORY.md` and remove the In-flight line
(wired into finishing).

## Chronological archive `.local/HISTORY.md`

Unchanged: the permanent one-line-per-unit completion log
(`- YYYY-MM-DD · <topic> · <squash SHA> · PR #<n> · <one-line outcome>`,
newest first). On-demand, gitignored, NOT auto-loaded — a thin pointer; the
detail lives in git/PR. **Yearly rotation:** when adding the first entry of
a new year, first move the previous year's entries to
`.local/history/<year>.md`, leaving `HISTORY.md` holding only the current
year.

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

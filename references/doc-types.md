# `.local/` Doc Types — full detail for HARRY.md §5

harry keeps five long-lived/short-lived document types under `.local/`, plus three
tracking files (`INDEX.md`, `STATUS.md`, `HISTORY.md`). HARRY.md §5 carries the
one-paragraph summary and the load trigger; this reference is the full taxonomy,
naming, and lifecycle. **Read this whenever you create, graduate, or archive any
`.local/` doc.**

## The five doc types (keep them separate; non-trivial work has spec before plan)

- **Spec/Design** `*-design.md` — what the system should be and why it was decided (includes decision records: Discussion → Decision → considered-but-rejected). Long-term. In `.local/specs/`.
- **Plan/Follow-up** `*-plan.md` / `*-followup.md` — how to proceed, execution steps. Short-term, archived after execution. In `.local/plans/`.
- **Backlog** `*-backlog.md` — identified but NOT decided: options an exploration surfaced without picking one, risks an audit found with no fix scheduled, long-range directions worth remembering but not committed to. Not a prioritized to-do queue (that's a plan, once something IS decided) — a holding pen for "here's X, still open." Long-term, accumulates like specs, per-topic file (not a single running list — entries need "why is this undecided" context a flat list would lose). In its own `.local/backlog/` directory, kept separate from decided specs.
- **Milestone** `*-milestone.md` — a thin aggregator/tracker over a cluster of specs/backlogs working toward one mid-size goal. Holds no decisions itself (those stay in the member specs) — just goal, member links, overall status, completion criteria, and an optional link up to the Research doc that spawned it. In its own `.local/milestones/` directory.
- **Research** `*-research.md` — an ongoing, open-ended investigation of a broad area that spawns multiple milestones over time (the original motivating case for Backlog, at a larger scope). Holds no findings content itself — the wiki (specs/backlog) already is the synthesis; this just points at it and tracks what it has spawned. Long-term, accumulates like specs — never archived (an investigation has no natural completion point). In its own `.local/research/` directory.

## Naming & archival

- Naming `YYYY-MM-DD-<topic>-<design|plan|followup|backlog|milestone|research>.md`.
- **Specs, backlogs, and research accumulate** as long-term records — never archived.
- **Plans and milestones archive on completion** → `.local/plans/archived/` / `.local/milestones/archived/`.

## Lifecycle rules

- **Backlog graduation**: once an item is decided, move the decision into a spec (Discussion → Decision) or a plan (execution steps), then delete that item from the backlog file — delete the whole file once empty. No tombstones — the item's content moved wholesale into the spec/plan, which is now the durable record (unlike a STATUS.md pointer, nothing is left behind to summarize). No auto-expiry — the discipline is manual: check existing `.local/backlog/` files for the topic before a new brainstorm/audit session touches the same area, the same way `.local/STATUS.md` is checked at session start.
- **Backlog vs `/debt`**: `/debt` re-judges deferred *decisions* (DEBT: markers, spec Non-Goals, plan deferrals) by checking whether each one's premise still holds. Backlog items never had a premise — so `/debt` sweeps them too, but asks a different question: still open, now urgent, or already settled elsewhere? This is what keeps backlog from becoming a write-only graveyard; see `/debt`'s own definition for the verdict vocabulary.
- **Milestone lifecycle**: update the Members checklist and Status as member specs/backlogs get decided or graduate. Once the goal is achieved, archive the file to `.local/milestones/archived/` (like a plan), add one `.local/HISTORY.md` line, and remove its `.local/INDEX.md` entry. A milestone never gains its own `/debt` sweep — it holds no deferred decisions; its members already are covered by `/debt`.
- **Research lifecycle**: track spawned milestones in the checklist as they're created; update Status as the investigation continues or goes dormant. Never archives — unlike a milestone, an investigation has no fixed completion point. No `/debt` sweep — it holds no decisions itself; spawned milestones (and their members) are already covered.

## Global index `.local/INDEX.md`

A live, content-oriented map over specs/backlog/milestones/research (not plans — `STATUS.md`/`HISTORY.md` already cover active/completed execution), one line per doc grouped by category: `<topic> · <path> · <one-line summary> · <status>`. It is a snapshot of what currently exists, not a log — an entry is removed when its file is deleted (backlog graduation) or archived (milestone completion); `HISTORY.md` already holds the permanent record of anything that leaves it. Update it when you create a spec (wired into the brainstorming skill's spec-writing step), and whenever a backlog is created or graduates, a milestone is created or archives, or a research doc is created or its spawned-milestones list changes (prose discipline, same as the doc types themselves — no dedicated skill hooks them).

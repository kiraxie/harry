# Distilling — evaluating an external repo for principles worth absorbing

A distill session takes a candidate repo (someone else's skills, laws, or plugin),
surveys it against harry's current laws and skills, rules on every candidate principle,
and records the outcome in harry's upstream tracking. It exists to prevent two failure
modes observed in practice:

- **Untracked influence** — a repo gets studied, ideas get absorbed, and nothing records
  where they came from or which commit was current, so the next philosophy shift
  upstream is never checked. (This happened with the grill family: distilled 2026-07-26,
  tracked only a day later when someone asked.)
- **Re-imported rejects** — harry deliberately deviates from its upstreams (the
  correctness-over-cost recalibration, the residue manifest, phase-hybrid delivery). A
  survey that doesn't read the deviation record first will "discover" and re-import the
  very thing a previous ruling removed.

The session is read-only with respect to harry's laws and skills: its outputs are a
ruling report, tracking-file bookkeeping, and (with the user's nod) backlog items.
Actual law or skill changes always go through the normal pipeline (brainstorm → plan →
execute) as their own units — never inline in a distill session.

## Inputs

- **repo** (required): a URL or `owner/name` (resolve to `https://github.com/owner/name`).
- **focus** (optional): paths or topics to prioritize ("their skills/ only", "their
  review flow"). Without it, survey the whole repo but weight by relevance to harry's
  domains: workflow laws, TDD/review discipline, skill authoring, agent orchestration.

## Procedure

### 1. Route: onboard or re-sync

This procedure maintains HARRY's upstream tracking and requires the harry checkout
(`upstream.json` at the repo root). Anywhere else, stop and tell the user: cloning
would drop an un-ignored `.references/` tree into their project, and there is no
tracking file to record the survey in.

If the repo is already a source in `upstream.json`, this is a **re-sync**, not an
onboard: follow `references/upstream-sync.md`'s check procedure (path-scoped diff since
the pinned commit) and stop here. A repo recorded in `upstream-sync.md`'s intro as a
historical influence gets a fresh comparison only if the user asks for one.

### 2. Clone and capture pin data

Clone into `.references/<name>` in the MAIN checkout — the same main-checkout store rule
as `.local/` (HARRY.md §5): from a worktree, resolve the main checkout as the parent of
`git rev-parse --path-format=absolute --git-common-dir`. The directory is gitignored.
Record the full 40-char HEAD SHA, a version if the repo declares one (package.json,
plugin manifest, or latest tag), and today's date. Write nothing to `upstream.json` yet —
pinning waits for the outcome (step 7).

### 3. Read harry's deviation record FIRST

Before judging anything, read:

- `upstream.json` `derived[].note` entries — each names what harry changed or removed on
  purpose, and why.
- `references/upstream-sync.md`'s provenance notes — per-source warnings about what not
  to "restore".
- `HARRY.md` — the laws are the calibration target; every candidate is judged against
  them, not against novelty.

This ordering is the point: the deviation record is what separates "gap harry should
close" from "gap harry chose".

### 4. Inventory the candidate repo

Enumerate its principles: skills, rule files, README claims, distinctive techniques.
Note the repo's real directory layout — any path recorded later must be a **literal
pathspec** that resolves in the clone (`git -C .references/<name> log -1 -- <path>`
returns a commit), because sync checks feed these paths straight into `git diff`. A
dropped category prefix (`skills/grilling` for what is really
`skills/productivity/grilling`) silently empties that diff and a future sync wrongly
concludes "nothing changed".

### 5. Rule on every candidate

Issue one ruling per candidate principle, each with a stated reason (HARRY.md §6:
dismissals need declared reasons — "not relevant" without a why is a silent dismissal):

- **pull** — adopt substantially as-is: it closes a real gap and fits harry's
  calibration.
- **adapt** — the insight is right but the calibration differs; name what changes in
  harry's version and why.
- **skip** — with the reason category: *already covered* (name the law/skill),
  *deliberately deviated* (name the derived[].note or provenance line), *conflicts with
  a law* (name it), *upstream-specific infrastructure* (their harness plumbing, not a
  principle), or *speculative* (no observed failure it would prevent — YAGNI).

### 6. Report

Deliver in chat, in this shape:

- Repo overview: what it is, layout, license, version/commit surveyed.
- Ruling table: candidate · source path (literal) · ruling · reason.
- For each pull/adapt: what would change in harry (which law section, skill, or
  reference) — one or two lines, enough to seed a backlog item.
- Coverage statement: what was and wasn't surveyed. If only part of a large repo was
  read, say which part — silent truncation reads as "covered everything".

### 7. Bookkeeping — by outcome, never skipped

The boundary is one question: **does a derived file exist in harry?** A pin plus
`derived[]` entries exist exactly when derived files do — a ruling alone creates
nothing to track.

- **Ports exist** (made before this session, or landing in it): add the repo to
  `upstream.json` `sources` (repo URL, version, full SHA, date) plus one `derived[]`
  entry per derived area, with `from` paths literal per step 4 and a `note` naming
  harry's deviations — the note is what protects the NEXT survey (step 3). Add the
  source's row to `references/upstream-sync.md`'s table and a provenance bullet there.
  Update the source count where prose states it (CLAUDE.md, README.md — grep for the
  spelled-out count; a stale "three upstreams" is drift).
- **No ports yet** — comparison-only, everything skipped, or pull/adapt rulings still
  awaiting the user's acceptance (every headless run): record the repo in
  `references/upstream-sync.md`'s intro (the i-have-adhd pattern: date, what was
  compared, why nothing is pinned), noting any pending proposals. When the first
  proposal is actually ported, that pipeline unit adds the pin and `derived[]` and
  upgrades this record.

Either way the survey leaves a durable trace. A surveyed repo with no record is exactly
the failure mode this skill exists to close.

### 8. Backlog items — with the user's nod

Each accepted candidate becomes a `.local/items/<slug>.md` with `status: backlog`
quoting its ruling line, plus an `.local/INDEX.md` entry — only after the user confirms
which ones to keep (present the list; let them cut). Deliver the confirmation via the
harness's structured picker when one exists (on Claude Code, AskUserQuestion with
multi-select); plain text otherwise. If no user is available (headless/batch run),
create nothing: leave the proposals in the report and say so. Backlog items are
proposals for future pipeline runs, not commitments.

## Boundaries

- Never modify the cloned repo; never commit `.references/` content into harry.
- The bookkeeping edits (upstream.json, upstream-sync.md, count mentions) are the only
  writes to tracked files a distill session makes, and they go on a branch like any
  other change — branch-first still applies (HARRY.md §5).
- Note the upstream's license before porting text or code; anything ported carries
  attribution per the repo's existing NOTICE pattern.

# `/sync` — gitignore + legacy migration

The body of harry's `/sync` — Phase 2's description of what the gitignore initializer
does, plus the whole of Phase 3's legacy migration. The command keeps only its shell:
its frontmatter, its invocation surface, and `commands/sync.md` **Phase 1**
(`install.mjs` + the `@`-import + the optional Explore override).

---

## Phase 2 — Gitignore

`commands/sync.md` runs harry's gitignore initializer,
`${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs` — see it for the argument form.

What it does:

- Appends plain entries (no marker block, no tool-name comment — `.gitignore` is
  shared with the whole team) to the target project's `.gitignore` listing the
  paths harry keeps out of version control: `.local/` (`items/`, `archive/`,
  `tmp/` scratch, `INDEX.md`/`HISTORY.md`), `*worktrees/` (worktree sandboxes, at
  any depth — covers both `.worktrees/` and `.claude/worktrees/`), and
  `CLAUDE.local.md` (the user's per-project specialization rules).
- Idempotent per entry — an entry already present anywhere in the file (exact
  line match) is never duplicated.
- `--remove` strips any line matching one of those three entries. Trade-off: with
  no marker to distinguish origin, this also removes a line the user typed in by
  hand that happens to match exactly.

Return the command output verbatim. If init exits non-zero — for a bad target it
prints one `harry: <message>` line — say that Phase 2 failed and stop before
Phase 3, which would scan that same target.

## Phase 3 — Legacy migration (agent-driven)

After the earlier phases, help adopt this repo into harry by migrating pre-existing
design/plan artifacts into harry's format. Phase 2 owns `.gitignore`; this phase
owns nothing deterministically — every move is gated on the user's answers.

**Skip conditions:**

- If `$ARGUMENTS` contains `--remove`, STOP here — do not scan or migrate.
  (Uninstalling harry must not migrate anything. `--remove` wins over `--force`.)
- Skip if init failed in Phase 2 (the stop rule there).

**Step A0 — Migrate harry's own pre-convergence layout, if present.** Before
the generic scan below, check for the old per-type `.local/` directories this
project may already have from before the item-store model:
`.local/specs/`, `.local/plans/` (+ `.local/plans/archived/`),
`.local/backlog/`, `.local/research/`, `.local/milestones/` (+
`.local/milestones/archived/`). If none exist, skip to Step A.

For each topic found, using the filename's `<topic>` slug to match across
directories:

1. **Spec + matching plan** (same topic) → merge into one
   `.local/items/<topic>.md`: `## Why / What` = the spec's five numbered sections as
   prose (the item schema in `references/doc-types.md` numbers nothing inside
   that section), and the plan's content kept verbatim under `## Plan`, opening
   with `_(legacy plan — migrated as-is, no acceptance criteria)_` — the heading
   stays literally `## Plan`, which is what later readers key on, and a migration
   never invents `### Acceptance criteria`.
   `status: active` if the plan is in `.local/plans/` (not yet
   archived), `status: done` if the plan is in `.local/plans/archived/` (and
   write straight to `.local/archive/<topic>.md` instead).
2. **Spec alone** (no matching plan) → `.local/items/<topic>.md` with just
   `## Why / What`, `status: active`.
3. **Backlog or research file** (any topic under `.local/backlog/` or
   `.local/research/`) → `.local/items/<topic>.md`, `status: backlog`, its
   content becomes `## Notes` verbatim (research's tracked-milestones list,
   if any, becomes a `## Notes` bullet list of links instead of being
   dropped).
4. **Milestone** (`.local/milestones/` or `.local/milestones/archived/`) →
   `.local/items/<topic>.md`, `type: milestone`, `status: active` (or
   `done` → write to `.local/archive/<topic>.md` instead) — carry the
   existing member list into `## Members` (rewriting each member's old path
   to its new `.local/items/` or `.local/archive/` path), and leave
   `## Delivered` empty unless the source already distinguished completed
   members.

Never fabricate content — a section with nothing to carry over gets
`_(not present in source)_`. Its topic→target rows join Step B's one table
below, and the same Step C questions below — the "which candidates to
migrate", "which existing targets to overwrite" and "keep or delete originals"
decisions — cover this harry-native set together with the generic candidates
from Step A. Step A's archive rule and Step B's distinct-target rule apply to
it too.

**Step A — Scan for candidates.** In the target directory, look for legacy
design/plan artifacts. Default candidate set:

- spec-class: `docs/**/*design*.md`, `SPEC.md`, `DESIGN.md`, `ADR*/`, `RFC*/`, `decisions/`
- plan-class: `PLAN.md`, `TODO.md`, `ROADMAP.md`, `tasks/`, `planning/`
- misnamed `.local/` files: present under `.local/items` or `.local/archive`
  but missing the `id:`/`status:` frontmatter the item schema requires
  (`references/doc-types.md`).

Exclude: already-conformant `.local/` files, `.references/`, `node_modules/`,
`.git/`, vendored dirs, and clearly non-design docs (`README.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, license/notice files). Use light judgment —
read a candidate's head if its kind is unclear.

**Archived topics:** a candidate whose topic (as Step B derives it) already has a
harry-format item (with `id:`/`status:` frontmatter) in `.local/archive/` is
skipped, `--force` or not, and the report names it as archived — the archive is
read-only (`references/doc-types.md` **Naming & location**). A `.local/archive/` file without that frontmatter is not an
archived item: it is a misnamed candidate like any other.

**Re-run safety:** a candidate that already has a conforming `.local/items/`
counterpart (same topic, already in harry format) is "already migrated" — exclude
it by default. If `$ARGUMENTS` contains `--force`, do NOT exclude these. That is
all `--force` does: it never means overwrite, and an existing target is written
only as Q_C in Step C allows.

**If no candidates remain:** print one line (e.g. "No legacy spec/plan content to
migrate."), naming any candidate skipped as archived, and stop. Do not prompt.

**Step B — Classify & propose.** For each candidate, decide item vs milestone and
propose a target path `.local/items/<topic>.md` (or `.local/archive/<topic>.md`
if already complete). Topic: kebab-case, derived from the filename/content.
Every candidate gets a distinct target, across Step A0's set and Step A's
together. A spec-class and a plan-class candidate with one topic are one item —
spec → `## Why / What`, plan → `## Plan`, as Step A0 case 1 merges them — and
one candidate from here on. Any other candidates that share a topic get
distinct topics (from their filenames, with their directory when the filenames
match too). Present the full candidate list as one table, one row per target
(source(s) → proposed kind → target path).

**Step C — Ask what's needed to migrate, one question at a time:**

- Q_A — Which candidates to migrate? (multiselect; offer "all" and "skip".)
- **If nothing was selected** (empty, or "skip"): close with the report and stop —
  nothing was chosen to rewrite, so there is nothing to ask about disposing of.
- **Q_C — asked when any selected candidate's target already exists**, `--force`
  or not (a misnamed `.local/` file's target is the file itself): which existing
  targets to overwrite? List each with its state: its `status` (or "no
  frontmatter"), whether it has `### Acceptance criteria`, and its `## Progress`
  line count. Default keep — `.local/` is gitignored, so an overwritten target is
  gone for good. One target: options "keep (Recommended)" and "overwrite". Two to
  four: multiSelect, one option per target; a target not picked is kept. More than
  four: the list goes in the question text, options "keep all (Recommended)" and
  "overwrite all", and the user names a subset through Other. A candidate whose
  target is kept is not written.
- **If no selected candidate is left to write** after Q_C: close with the report
  and stop, without asking Q_B — every original stays.
- **If no candidate left to write has its original at another path than its
  target** (each is a misnamed `.local/` file rewritten in place): skip Q_B and
  go on to Step D.
- **Otherwise ask Q_B** — After rewriting, keep the originals in place or delete
  them? It covers only originals at another path than their target. (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

How to ask each one:

`AskUserQuestion`, one call per question. When Q_C cannot be asked (no interactive
answer, e.g. a headless run), every existing target is kept and named in the
report.

**Step D — Execute.** For each candidate left to write after Q_C:

1. Rewrite its content into harry's item format, faithfully — never fabricate
   decisions or content. spec-class → the item's `## Why / What` (Context (SCQA)
   / Approaches Considered / Design / Scope & Non-Goals / Constraints
   subsections). plan-class → `## Plan` (that literal heading), opening with
   `_(legacy plan — migrated as-is, no acceptance criteria)_` and carrying the
   source's steps as they stand; harry no longer writes plans, and a migration
   never invents `### Acceptance criteria` — a legacy `## Plan` is read as-is
   (`references/doc-types.md`). A merged spec and plan are one write, holding
   both. Where
   the source lacks a section, write `_(not present in source)_` rather than
   invent.
2. Write the new file at its target path (create `.local/items` /
   `.local/archive` as needed). An existing target is overwritten only when Q_C
   picked it; any other existing target is left as is, its candidate is not
   written, and its original is kept whatever Q_B said.
3. Per Q_B: keep the original untouched, or delete it ONLY after its new file is
   successfully written. An original whose target is its own path (a misnamed
   `.local/` file rewritten in place) is never deleted, whatever Q_B says.

**The report.** After Step D, or at a Step C stop that says so, close with a
report: each target written, each existing target kept, and each candidate
skipped as archived.

This phase is best-effort and must never undo the earlier phases: if a scan or
rewrite fails, report it and stop, leaving originals intact.

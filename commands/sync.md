---
description: Set up or resync harry here — wire the resident laws into your global instructions, add the .gitignore block, and offer to migrate legacy spec/plan docs. Re-run after updating the plugin or editing HARRY.md to resync. --remove strips this project's .gitignore block (laws stay).
argument-hint: '[--remove] [--force] [targetDir]'
allowed-tools: Bash(node:*), Bash(git log:*), Glob, Grep, Read, Write, Edit, AskUserQuestion
---

Raw slash-command arguments: `$ARGUMENTS`

## Phase 1 — Resident laws

Wire harry's resident laws (`HARRY.md`, which ships with the plugin) into your
global instructions file so they apply every session. **Skip this phase when
`$ARGUMENTS` contains `--remove`** — laws are global/per-machine, so a per-project
`/sync --remove` must NOT unwire them. (To unwire laws explicitly, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --remove` — that also removes the
optional Explore override below.)

Otherwise:

1. **Ask (AskUserQuestion) whether to also install the Explore override.** It's a
   user-level `~/.claude/agents/Explore.md` that shadows the built-in Explore so
   *auto-invoked* recon runs on a cheap model (haiku) instead of inheriting your
   main-session model — the same routing philosophy as the `scout` role, applied to
   the search path Claude Code triggers on its own. It is **opt-in** because it
   overrides a built-in agent globally (and a custom Explore loads your user memory,
   which the built-in skips). Recommend yes for anyone routing recon through harry.
2. **Run** — add `--explore` only if they opted in:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"            # laws only
# …or, if they opted into the Explore override:
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --explore  # laws + Explore override
```

It deploys a snapshot of the plugin's current `HARRY.md` to
`~/.claude/harry/HARRY.md` and inserts a marker-wrapped `@~/.claude/harry/HARRY.md`
import into `~/.claude/CLAUDE.md` (idempotent — re-running in another project is a
harmless no-op; it also warns about stale global entries harry supersedes). With
`--explore` it additionally writes `~/.claude/agents/Explore.md` (a marked file
`--remove` can safely strip). This is a **snapshot**, not a live reference to the
plugin checkout: after the plugin is updated (or `HARRY.md` is edited), re-run this
to re-deploy and resync — same resync model as the Codex build. Return its output
verbatim.

## Phase 2 — Gitignore

Run harry's gitignore initializer through the plugin runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $ARGUMENTS
```

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

Return the command output verbatim.

---

## Phase 3 — Legacy migration (agent-driven)

After the earlier phases, help adopt this repo into harry by migrating pre-existing
design/plan artifacts into harry's format. Phase 2 owns `.gitignore`; this phase
owns nothing deterministically — every move is gated on the user's answers.

**Skip conditions:**

- If `$ARGUMENTS` contains `--remove`, STOP here — do not scan or migrate.
  (Uninstalling harry must not migrate anything. `--remove` wins over `--force`.)

**Step A0 — Migrate harry's own pre-convergence layout, if present.** Before
the generic scan below, check for the old per-type `.local/` directories this
project may already have from before the item-store model:
`.local/specs/`, `.local/plans/` (+ `.local/plans/archived/`),
`.local/backlog/`, `.local/research/`, `.local/milestones/` (+
`.local/milestones/archived/`). If none exist, skip to Step A.

For each topic found, using the filename's `<topic>` slug to match across
directories:

1. **Spec + matching plan** (same topic) → merge into one
   `.local/items/<topic>.md`: `## Why / What` = the spec's §1-§5 content
   (reworked into the Task 1 subsection numbering), `## Plan` = the plan's
   content. `status: active` if the plan is in `.local/plans/` (not yet
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
`_(not present in source)_`. Present the full topic→target mapping as a
table (same shape as Step B below) and fold it into the same Step C
approval question — one combined migrate/keep/delete decision for both this
harry-native set and the generic candidates from Step A.

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

**Re-run safety:** a candidate that already has a conforming `.local` counterpart
(same topic, already in harry format) is "already migrated" — exclude it by
default. If `$ARGUMENTS` contains `--force`, do NOT exclude these; re-migrate and
overwrite their `.local` targets.

**If no candidates remain:** print one line (e.g. "No legacy spec/plan content to
migrate.") and stop. Do not prompt.

**Step B — Classify & propose.** For each candidate, decide item vs milestone
and propose a target path `.local/items/<topic>.md` (or `.local/archive/<topic>.md`
if already complete):

- Topic: kebab-case, derived from the filename/content.

Present the full candidate list as a table (source → proposed kind → target path).

**Step C — Ask two decisions** (AskUserQuestion):

- Q_A — Which candidates to migrate? (multiselect; offer "all" and "skip".)
- Q_B — After rewriting, keep the originals in place or delete them? (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

**Step D — Execute.** For each SELECTED candidate:

1. Rewrite its content into harry's item format, faithfully — never fabricate
   decisions or content. spec-class → the item's `## Why / What` (Context (SCQA)
   / Approaches Considered / Design / Scope & Non-Goals / Constraints
   subsections). plan-class → the item's `## Plan` in harry step format. Where
   the source lacks a section, write `_(not present in source)_` rather than
   invent.
2. Write the new file at its target path (create `.local/items` /
   `.local/archive` as needed). With `--force`, overwrite an existing target.
3. Per Q_B: keep the original untouched, or delete it ONLY after its new file is
   successfully written.

This phase is best-effort and must never undo the earlier phases: if a scan or
rewrite fails, report it and stop, leaving originals intact.

---
name: sync
description: Set up or resync harry for Codex CLI here — wire the resident laws into ~/.codex/AGENTS.md, add the .gitignore block, and offer to migrate legacy spec/plan docs. Use when the user asks to initialize, set up, or resync harry in a project under Codex CLI (e.g. after HARRY.md changes).
---

# Sync (Codex)

## Phase 1 — Resident laws

Wire harry's resident laws (`HARRY.md`, which ships with the plugin) into Codex's
global instructions file so they apply every session. **Skip this phase if the user
is uninstalling (`--remove`)** — laws are global/per-machine, so a per-project
uninstall must NOT unwire them. (To unwire laws explicitly, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.mjs" --remove`.)

Otherwise execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.mjs"
```

It inlines HARRY.md's content into a marker-wrapped block in `~/.codex/AGENTS.md`
(idempotent — re-running in another project is a harmless no-op; it also warns
about stale global entries harry supersedes).

**Snapshot semantics (shared with the Claude Code build):** this embeds
HARRY.md's content as of the moment `/sync` ran — a snapshot, not a live
reference. The Claude Code build now works the same way: it deploys a HARRY.md
snapshot and `@`-imports that copy, rather than the live plugin checkout. The only
difference is form — Codex inlines the content (no `@`-import syntax), Claude Code
`@`-imports a deployed copy — but both require a re-run to resync after HARRY.md
changes. If HARRY.md is updated later, re-run this to resync. Say this explicitly
to the user after running it, not just in this doc.

Return the command output verbatim.

## Phase 2 — Gitignore

Run harry's gitignore initializer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" [--remove] [--force] [targetDir]
```

What it does:

- Appends a marker-wrapped block to the target project's `.gitignore` listing the
  paths harry keeps out of version control: `.local/` (`items/`, `archive/`,
  `tmp/` scratch, `INDEX.md`/`HISTORY.md`),
  `*worktrees/` (worktree sandboxes, at any depth — covers both `.worktrees/`
  and `.claude/worktrees/`), and `CLAUDE.local.md` (the user's per-project
  specialization rules — same file harry uses for Claude Code, still
  gitignored the same way here).
- Idempotent — re-running replaces the block in place rather than duplicating it.
- `--remove` strips the block cleanly, leaving the rest of `.gitignore` untouched.

Return the command output verbatim. Do not edit `.gitignore` by hand — the script
owns that block.

## Phase 3 — Legacy migration

After the earlier phases, help adopt this repo into harry by migrating pre-existing
design/plan artifacts into harry's format. Phase 2 owns `.gitignore`; this phase
owns nothing deterministically — every move is gated on the user's answers.

**Skip if uninstalling** — do not scan or migrate.

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
questions below — the "which candidates to migrate" and "keep or delete
originals" decisions cover this harry-native set together with the generic
candidates from Step A.

**Step A — Scan for candidates.** In the target directory, look for legacy
design/plan artifacts. Default candidate set:

- spec-class: `docs/**/*design*.md`, `SPEC.md`, `DESIGN.md`, `ADR*/`, `RFC*/`,
  `decisions/`
- plan-class: `PLAN.md`, `TODO.md`, `ROADMAP.md`, `tasks/`, `planning/`
- misnamed `.local/` files: present under `.local/items` or `.local/archive` but
  missing the `id:`/`status:` frontmatter the item schema requires
  (`references/doc-types.md`).

Exclude: already-conformant `.local/` files, `.references/`, `node_modules/`,
`.git/`, vendored dirs, and clearly non-design docs (`README.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, license/notice files).

**Re-run safety:** a candidate that already has a conforming `.local` counterpart
is "already migrated" — exclude it by default. With a forced re-run, do NOT
exclude these; re-migrate and overwrite their `.local` targets.

**If no candidates remain:** print one line (e.g. "No legacy spec/plan content to
migrate.") and stop. Do not prompt.

**Step B — Classify & propose.** For each candidate, decide item vs milestone and
propose a target path `.local/items/<topic>.md` (or `.local/archive/<topic>.md`
if already complete). Topic: kebab-case, derived from the filename/content.
Present the full candidate list as a table (source → proposed kind → target
path).

**Step C — Ask two decisions:**

- Which candidates to migrate? (offer "all" and "skip")
- After rewriting, keep the originals in place or delete them? (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

If an interactive multiple-choice question tool is available, use it; otherwise ask
in plain text and wait for the user's reply before proceeding.

**Step D — Execute.** For each selected candidate:

1. Rewrite its content into harry's item format, faithfully — never fabricate
   decisions or content. spec-class → the item's `## Why / What` (Context (SCQA)
   / Approaches Considered / Design / Scope & Non-Goals / Constraints
   subsections). plan-class → the item's `## Plan` in harry step format. Where
   the source lacks a section, write `_(not present in source)_` rather than
   invent.
2. Write the new file at its target path (create `.local/items` / `.local/archive`
   as needed). With a forced re-run, overwrite an existing target.
3. Per the keep/delete decision: keep the original untouched, or delete it ONLY
   after its new file is successfully written.

This phase is best-effort and must never undo the earlier phases: if a scan or
rewrite fails, report it and stop, leaving originals intact.

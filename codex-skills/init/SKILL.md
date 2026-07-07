---
name: init
description: Set harry up for Codex CLI here — wire the resident laws into ~/.codex/AGENTS.md, add the .gitignore block, and offer to migrate legacy spec/plan docs. Use when the user asks to initialize or set up harry in a project under Codex CLI.
---

# Init (Codex)

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

**Known limitation vs. the Claude Code build:** this is a snapshot, not a live
reference — unlike Claude Code's `@`-import (which always reads the current
`HARRY.md`), this embeds HARRY.md's content as of the moment `/init` ran. If
HARRY.md is updated later, re-run this to resync. Say this explicitly to the user
after running it, not just in this doc.

Return the command output verbatim.

## Phase 2 — Gitignore

Run harry's gitignore initializer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" [--remove] [--force] [targetDir]
```

What it does:

- Appends a marker-wrapped block to the target project's `.gitignore` listing the
  paths harry keeps out of version control: `.local/` (specs, plans, backlog,
  milestones, research, ledger scratch, `STATUS.md`/`HISTORY.md`/`INDEX.md`),
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

**Step A — Scan for candidates.** In the target directory, look for legacy
design/plan artifacts. Default candidate set:

- spec-class: `docs/**/*design*.md`, `SPEC.md`, `DESIGN.md`, `ADR*/`, `RFC*/`,
  `decisions/`
- plan-class: `PLAN.md`, `TODO.md`, `ROADMAP.md`, `tasks/`, `planning/`
- misnamed `.local/` files: present under `.local/specs` or `.local/plans` but NOT
  matching `YYYY-MM-DD-<topic>-<design|plan>.md`.

Exclude: already-conformant `.local/` files, `.references/`, `node_modules/`,
`.git/`, vendored dirs, and clearly non-design docs (`README.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, license/notice files).

**Re-run safety:** a candidate that already has a conforming `.local` counterpart
is "already migrated" — exclude it by default. With a forced re-run, do NOT
exclude these; re-migrate and overwrite their `.local` targets.

**If no candidates remain:** print one line (e.g. "No legacy spec/plan content to
migrate.") and stop. Do not prompt.

**Step B — Classify & propose.** For each candidate, decide spec vs plan and
propose a target path `.local/specs/` or `.local/plans/` named
`YYYY-MM-DD-<topic>-<design|plan>.md`. Date: first git commit touching the file,
else the file mtime, else today. Topic: kebab-case, derived from the
filename/content. Present the full candidate list as a table (source → proposed
kind → target path).

**Step C — Ask two decisions:**

- Which candidates to migrate? (offer "all" and "skip")
- After rewriting, keep the originals in place or delete them? (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

If an interactive multiple-choice question tool is available, use it; otherwise ask
in plain text and wait for the user's reply before proceeding.

**Step D — Execute.** For each selected candidate:

1. Rewrite its content into harry format, faithfully — never fabricate decisions or
   content. spec → Context (SCQA) / Approaches Considered / Design / Scope &
   Non-Goals / Constraints. plan → harry step format. Where the source lacks a
   section, write `_(not present in source)_` rather than invent.
2. Write the new file at its target path (create `.local/specs` / `.local/plans`
   as needed). With a forced re-run, overwrite an existing target.
3. Per the keep/delete decision: keep the original untouched, or delete it ONLY
   after its new file is successfully written.

This phase is best-effort and must never undo the earlier phases: if a scan or
rewrite fails, report it and stop, leaving originals intact.

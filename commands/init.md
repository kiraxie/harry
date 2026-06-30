---
description: Add harry's required ignore entries (.local/, .worktrees/, CLAUDE.local.md) to this project's .gitignore. Idempotent and marker-wrapped; pass --remove to strip them.
argument-hint: '[--remove] [--force] [targetDir]'
allowed-tools: Bash(node:*), Bash(git log:*), Glob, Grep, Read, Write, Edit, AskUserQuestion
---

## Phase 1 — Gitignore

Run harry's gitignore initializer through the plugin runtime.

Raw slash-command arguments: `$ARGUMENTS`

Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $ARGUMENTS
```

What it does:

- Appends a marker-wrapped block (`# >>> harry >>>` … `# <<< harry <<<`) to the target project's `.gitignore` listing the paths harry keeps out of version control: `.local/` (specs, plans, ledger scratch), `.worktrees/` (worktree sandboxes), and `CLAUDE.local.md` (the user's per-project memos / task list / status).
- Idempotent — re-running replaces the block in place rather than duplicating it.
- `--remove` strips the block cleanly, leaving the rest of `.gitignore` untouched.

Return the command output verbatim. Do not edit `.gitignore` by hand — the script owns that block.

---

## Phase 2 — Legacy migration (agent-driven)

After Phase 1, help adopt this repo into harry by migrating pre-existing
design/plan artifacts into harry's format. Phase 1 owns `.gitignore`; Phase 2
owns nothing deterministically — every move is gated on the user's answers.

**Skip conditions:**

- If `$ARGUMENTS` contains `--remove`, STOP here — do not scan or migrate.
  (Uninstalling harry must not migrate anything. `--remove` wins over `--force`.)

**Step A — Scan for candidates.** In the target directory, look for legacy
design/plan artifacts. Default candidate set:

- spec-class: `docs/**/*design*.md`, `SPEC.md`, `DESIGN.md`, `ADR*/`, `RFC*/`, `decisions/`
- plan-class: `PLAN.md`, `TODO.md`, `ROADMAP.md`, `tasks/`, `planning/`
- misnamed `.local/` files: present under `.local/specs` or `.local/plans` but
  NOT matching `YYYY-MM-DD-<topic>-<design|plan>.md`.

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

**Step B — Classify & propose.** For each candidate, decide spec vs plan and
propose a target path `.local/specs/` or `.local/plans/` named
`YYYY-MM-DD-<topic>-<design|plan>.md`:

- Date: first git commit touching the file
  (`git log --diff-filter=A --follow --format=%ad --date=short -1 -- <file>`),
  else the file mtime, else today.
- Topic: kebab-case, derived from the filename/content.

Present the full candidate list as a table (source → proposed kind → target path).

**Step C — Ask two decisions** (AskUserQuestion):

- Q_A — Which candidates to migrate? (multiselect; offer "all" and "skip".)
- Q_B — After rewriting, keep the originals in place or delete them? (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

**Step D — Execute.** For each SELECTED candidate:

1. Rewrite its content into harry format, faithfully — never fabricate decisions
   or content. spec → Context (SCQA) / Approaches Considered / Design / Scope &
   Non-Goals / Constraints. plan → harry step format. Where the source lacks a
   section, write `_(not present in source)_` rather than invent.
2. Write the new file at its target path (create `.local/specs` / `.local/plans`
   as needed). With `--force`, overwrite an existing target.
3. Per Q_B: keep the original untouched, or delete it ONLY after its new file is
   successfully written.

Phase 2 is best-effort and must never undo Phase 1: if a scan or rewrite fails,
report it and stop, leaving originals intact.

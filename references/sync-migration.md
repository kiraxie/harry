# `/sync` — gitignore + legacy migration (shared)

The shared, drift-prone body of harry's `/sync` — Phase 2's description of what the
gitignore initializer does, plus the whole of Phase 3's legacy migration — used by
**both** builds: `commands/sync.md` (Claude Code) and `codex-skills/sync/SKILL.md`
(Codex CLI). Each of those files keeps only its own build-specific shell: its
frontmatter, its invocation surface, and **Phase 1 — Resident laws**, which is
genuinely per-build (`install.mjs` + the `@`-import + the optional Explore override
vs `install-codex.mjs` + the inlined block). Where the two builds genuinely differ
below, both variants are captured under explicit **Claude Code build:** /
**Codex build:** labels — never collapse them to one. Where only the **vocabulary** differs — a tool's name or casing, a flag that exists on one build — the text stays build-neutral and names the Claude Code term inline; a near-identical pair for that is duplication, not a divergence.

---

## Phase 2 — Gitignore

Your door runs harry's gitignore initializer,
`${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs` — see the door for this build's argument
form.

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

## Phase 3 — Legacy migration (agent-driven)

After the earlier phases, help adopt this repo into harry by migrating pre-existing
design/plan artifacts into harry's format. Phase 2 owns `.gitignore`; this phase
owns nothing deterministically — every move is gated on the user's answers.

**Skip conditions:**

- **Claude Code build:** If `$ARGUMENTS` contains `--remove`, STOP here — do not scan
  or migrate. (Uninstalling harry must not migrate anything. `--remove` wins over
  `--force`.)
- **Codex build:** Skip if uninstalling — do not scan or migrate.

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
   that section), `## Plan` = the plan's content. `status: active` if the plan is in `.local/plans/` (not yet
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
default.

- **Claude Code build:** If `$ARGUMENTS` contains `--force`, do NOT exclude these;
  re-migrate and overwrite their `.local` targets.
- **Codex build:** With a forced re-run, do NOT exclude these; re-migrate and
  overwrite their `.local` targets.

**If no candidates remain:** print one line (e.g. "No legacy spec/plan content to
migrate.") and stop. Do not prompt.

**Step B — Classify & propose.** For each candidate, decide item vs milestone and
propose a target path `.local/items/<topic>.md` (or `.local/archive/<topic>.md`
if already complete). Topic: kebab-case, derived from the filename/content.
Present the full candidate list as a table (source → proposed kind → target
path).

**Step C — Ask two decisions:**

- Q_A — Which candidates to migrate? (multiselect; offer "all" and "skip".)
- Q_B — After rewriting, keep the originals in place or delete them? (Deleting is
  destructive — this answer IS the confirmation. Default to keep.)

How to ask:

- **Claude Code build:** ask both with `AskUserQuestion`.
- **Codex build:** If an interactive multiple-choice question tool is available, use
  it; otherwise ask in plain text and wait for the user's reply before proceeding.

**Step D — Execute.** For each SELECTED candidate:

1. Rewrite its content into harry's item format, faithfully — never fabricate
   decisions or content. spec-class → the item's `## Why / What` (Context (SCQA)
   / Approaches Considered / Design / Scope & Non-Goals / Constraints
   subsections). plan-class → the item's `## Plan` in harry step format. Where
   the source lacks a section, write `_(not present in source)_` rather than
   invent.
2. Write the new file at its target path (create `.local/items` /
   `.local/archive` as needed). **Claude Code build:** with `--force`, overwrite an
   existing target. **Codex build:** with a forced re-run, overwrite an existing
   target.
3. Per Q_B: keep the original untouched, or delete it ONLY after its new file is
   successfully written.

This phase is best-effort and must never undo the earlier phases: if a scan or
rewrite fails, report it and stop, leaving originals intact.

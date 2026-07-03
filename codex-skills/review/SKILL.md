---
name: review
description: Run a code review against local git state via harry's companion runtime. Read-only by default; read-write only when the user explicitly asks to apply fixes. Angles are standard (gpt-5.3-codex defects), design-challenge, or cleanup; --full runs design+cleanup together. Use when the user asks for a code review, or to review and fix.
---

# Review

Run a code review through the harry runtime.

## Known limitation vs. the Claude Code build

This skill's RO/RW boundary is **convention, not tool-enforced**: unlike the Claude
Code version (which locks Edit/Write/git-commit out of its tool allowlist in
read-only mode), Codex has no discovered per-skill tool permission gate. Follow the
RO/RW rule below as a hard instruction anyway — do not use any file-write or
`git commit` action unless the user explicitly asked for fixes to be applied.

## RO vs RW — decide this first

- **No apply request → READ-ONLY (RO).** Produce findings and stop. Do not edit
  files or run `git add`/`git commit`.
- **User asks to apply/fix → READ-WRITE (RW).** Review → judge → apply.

## Review angle (what produces findings)

Mutually exclusive:
- default → standard defect review, `gpt-5.3-codex`.
- adversarial (design-challenge review, `gpt-5.5`) — questions the approach.
- simplify (cleanup review, `gpt-5.3-codex`) — behavior-preserving reuse /
  simplification / efficiency, NOT bugs.
- full → orchestrate two non-overlapping lanes — adversarial (design) and simplify
  (cleanup) — in parallel, then consolidate into one deduped table (see **Full
  mode**). Unlike the Claude Code build, this does NOT include a third
  self-review lane — Codex has no equivalent to invoke.

**Shared overrides:** a base ref (`--base <ref>`) sets a base-branch review. A
scope override (`--scope <auto|working-tree|branch>`) forces working-tree-only or
branch-diff-only when auto-detection would guess wrong. Extra context text
(`--context <text|@file|@->`) injects reviewer intent. A model/reasoning override
applies to a single review (ignored under full, where each lane is
model-specialized). Anything else is focus text, forwarded verbatim.

## The structured-review envelope (one definition)

`node … review --fix` (node's `--fix` = "emit structured JSON", regardless of RO/RW)
prints exactly one JSON line — the single source of truth for its shape:

```
{"status":"reviewed", kind, model, target, fileCount,
 findings:[{id,file,line,severity,title,rationale,suggestedFix}],
 reviewMarkdown}
```

`line` is optional (file-wide findings omit it). On **failure** (timeout/quota), the
process exits non-zero and stdout is markdown beginning `# Review Failed`, NOT this
envelope — never parse a leg's output as JSON without first checking it succeeded.

---

## Plain review (RO)

Read-only. The review session runs with writes/shell/URL denied on the Codex
runtime side. Do not fix anything or suggest you are about to. Return the review
session's output verbatim (HARRY.md §6). Do not use any write action on this path.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review [--adversarial|--simplify] [--base <ref>] [--scope <auto|working-tree|branch>] [--context <text|@file|@->] [focus...]
```

Return stdout verbatim (markdown). No paraphrase, summary, or commentary.

---

## Full mode (`--full`)

Two reviewers, both read-only, in parallel, then one deduped table.

### Stage 1 — Fan out two lanes in parallel
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --adversarial --fix <forwarded>
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --simplify --fix <forwarded>
```
(`<forwarded>` = the user's base/scope/context/focus args, minus `--full`/`--fix`/
`--model`/`--reasoning`.) Wait until both have produced output before Stage 2.

### Stage 2 — Consolidate into a table (your job)
- For each leg: check it succeeded first (zero exit, stdout is the envelope not
  `# Review Failed`). A failed leg contributes no findings — record it as a failed
  source and continue.
- Adversarial design-level notes live in `reviewMarkdown`'s `## Design Concerns`;
  simplify findings are cleanups, not bugs.
- **Re-key ids across sources** before merging: prefix each by source (`adv-`/
  `smp-`) so the table's `id` column is unique.
- **Dedup** by `file` + `line` + semantic-title. When `line` is absent (file-wide),
  only merge on a genuine semantic-title match on the same file.
- Judge against this codebase: read cited files where it matters and drop clear
  false positives (HARRY §6 — automated review is a suggestion, not an order).

Present ONE table, plus a `## Design Concerns` section (from adversarial) below it:

| id | file:line | severity | source(s) | title | verdict |

(source(s) = adversarial / simplify; verdict = Keep / Drop with a one-line reason
per Drop.) If both yield nothing material, say so and stop.

### Stage 3 — Output / hand off
- RO: the table + `## Design Concerns` is the final report. Stop.
- Apply requested: confirm the Keep set with the user, then follow **Stage 3 —
  Apply** under "Single review + fix" below (same apply steps, reused here).

---

## Single review + fix (RW)

You are the judge in the middle — the reviewer runs in an isolated session and may
flag intentional choices only you know about.

### Stage 1 — Structured review
Forward the angle (adversarial/simplify) and base/scope/context/focus args, append
node's `--fix` for structured output:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --fix <forwarded>
```
Parse the envelope. If `findings` is empty, tell the user and stop.

### Stage 2 — Judge each finding
Decide real defect vs false positive (a false positive is an intentional choice you
have context for). Read cited files. Present a table — id, file:line, title,
verdict (Keep / Drop + one-line reason per Drop). Confirm with the user before
applying; the user may override.

### Stage 3 — Apply
1. **Baseline snapshot** — if `git status --porcelain` is non-empty, the fix diff
   must be isolated from the user's pre-existing work. Confirm first: "snapshot
   your uncommitted work as a baseline commit before applying?"; on yes, `git add
   -A` and `git commit -m "chore: pre-fix snapshot (codex fix baseline)"`. If the
   commit fails on a dirty tree, STOP and tell the user to commit/stash manually.
2. **Apply** each approved finding directly: minimal, correct change per finding;
   no unrelated refactor. Skip any that is already fixed, no longer applies, or
   whose fix would change intended behavior — note why.
3. **Stage + report:** `git add -A`, then report applied / skipped (with reasons)
   and changed files, and tell the user the fixes are **staged but not committed**
   (`git diff --cached` to review).

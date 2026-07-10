---
name: review
description: Run a code review against local git state via harry's companion runtime. Read-only by default; read-write only when the user explicitly asks to apply fixes. Angles are standard (gpt-5.6-terra defects), design-challenge, or cleanup (gpt-5.6-terra cleanups run in parallel with a sub-agent over-engineering & readability lane, consolidated into one table); full runs design + the cleanup dual-lane together. Use when the user asks for a code review, or to review and fix.
---

# Review

Run a code review through the harry runtime.

## Known limitation vs. the Claude Code build

This skill's RO/RW boundary is **convention, not tool-enforced** — and so is the
Claude Code version's. CC's `allowed-tools` frontmatter is one static allowlist
that must include the write tools for its RW `--fix` path, so it cannot gate
read-only vs read-write per invocation either; both builds enforce the RO
discipline by instruction. (The only edge CC has here is that Codex exposes no
per-skill tool allowlist at all.) Follow the RO/RW rule below as a hard
instruction — do not edit repo-tracked files or run `git add`/`git commit` unless
the user explicitly asked for fixes to be applied.
Writing a scratch file **outside the repo** that a review lane needs as a handoff
(e.g. the simplify dual-lane's Lane B diff file, written to `/tmp/...`) is fine even
in RO mode — that boundary (repo-tracked vs. scratch) is the actual trust boundary,
not "no writes at all."

## RO vs RW — decide this first

- **No apply request → READ-ONLY (RO).** Produce findings and stop. Do not edit
  repo-tracked files or run `git add`/`git commit`. (A scratch/temp file outside
  the repo, like Lane B's diff handoff, is fine — see above.)
- **User asks to apply/fix → READ-WRITE (RW).** Review → judge → apply.

## Review angle (what produces findings)

Mutually exclusive:
- default → standard defect review, `gpt-5.6-terra`.
- adversarial (design-challenge review, `gpt-5.6-sol`) — questions the approach.
- simplify (cleanup review): `gpt-5.6-terra` behavior-preserving reuse /
  simplification / efficiency pass, run in parallel with a sub-agent
  over-engineering & readability lane (see **The simplify dual-lane** below) and
  consolidated into one table. NOT bugs.
- full → orchestrate three dispatches — adversarial (design) and the simplify
  dual-lane's two lanes (the Codex cleanup pass and the sub-agent
  over-engineering & readability pass) — in parallel, then consolidate into one deduped table
  (see **Full mode**). Unlike the Claude Code build, this does NOT include a
  fourth, self-review lane (its `/code-review max` equivalent) — Codex has no
  equivalent to invoke.

**Shared overrides:** a base ref (`--base <ref>`) sets a base-branch review. A
scope override (`--scope <auto|working-tree|branch>`) forces working-tree-only or
branch-diff-only when auto-detection would guess wrong. Extra context text
(`--context <text|@file|@->`) injects reviewer intent. A model/reasoning override
applies to a single review (ignored under full, where each lane is
model-specialized). Anything else is focus text, forwarded verbatim.

## The structured-review envelope (one definition)

See **The structured-review envelope** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

---

## The simplify dual-lane (one definition)

See **The simplify dual-lane** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

**Known asymmetry vs. the Claude Code build:** Lane B ports cleanly here because it
is ordinary sub-agent delegation — the same capability this skill's other sections
already assume Codex has, not something Claude-Code-specific. This is unlike the
Claude Code build's fourth lane (`/code-review max`), which has no Codex equivalent
at all — see **Known limitation** above.

---

## Plain review (RO)

**If the active angle is simplify:** skip the single-call path below entirely —
run **the simplify dual-lane** (defined above) and present its consolidated table
as the final output.

**Otherwise (standard or adversarial):** the review session runs with
writes/shell/URL denied on the Codex runtime side. Do not fix anything or suggest
you are about to. Return the review session's output verbatim (HARRY.md §6). Do
not use any write action on this path.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review [--adversarial|--simplify] [--base <ref>] [--scope <auto|working-tree|branch>] [--context <text|@file|@->] [focus...]
```

Return stdout verbatim (markdown). No paraphrase, summary, or commentary.

---

## Full mode (`--full`)

Three dispatches (two Codex, one sub-agent), all read-only, in parallel,
then one deduped table.

### Stage 1 — Fan out three dispatches in parallel
Forwarded args = the user's base/scope/context/focus args, minus `--full`,
`--adversarial`, `--simplify`, `--model`, `--reasoning` (each lane is
model-specialized); keep `--base`/`--scope`/`--context`/focus.

1. Background Codex adversarial review:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --adversarial --fix <forwarded>
```
2. **The simplify dual-lane** (defined above) — Lane A (Codex `--simplify --fix`)
   and Lane B (the over-engineering & readability sub-agent dispatch) both count
   as their own lanes here; do not consolidate them yet — Stage 2 below merges
   all three together in one pass. Lane A here uses *this Stage 1 preamble's* "Forwarded
   args" (computed just above, which already strips `--full` too) — not the
   dual-lane definition's own narrower `<forwarded>` rule, which would let a bare
   `--full` reach the node CLI here, which it rejects.

Wait until all three have produced output before Stage 2.

### Stage 2 — Consolidate into a table (your job)
- For each Codex leg (adversarial, simplify Lane A): check it succeeded first
  (zero exit, stdout is the envelope not `# Review Failed`). A failed leg
  contributes no findings — record it as a failed source and continue; never
  abort the whole consolidation for one bad leg. Adversarial design-level notes
  live in `reviewMarkdown`'s `## Design Concerns`; simplify findings are cleanups,
  not bugs.
- Simplify Lane B (the over-engineering & readability sub-agent) returns plain
  `tag: what. replacement.` lines — map each to a finding: `tag`→severity-ish
  label, the line itself→title.
- **Re-key ids across sources** before merging: prefix each by source (`adv-`/
  `smp-`/`lean-`) so the table's `id` column is unique and unambiguous.
- **Dedup** by `file` + `line` + semantic-title. When `line` is absent (file-wide),
  only merge on a genuine semantic-title match on the same file — do not collapse
  two different file-wide findings just because they share a file. Simplify Lane A
  and Lane B will sometimes name the same spot from different angles — merge, keep
  both sources listed.
- Judge against this codebase: read cited files where it matters and drop clear
  false positives (HARRY §6 — automated review is a suggestion, not an order).

Present ONE table, plus a `## Design Concerns` section (from adversarial) below it:

| id | file:line | severity | source(s) | title | verdict |

(source(s) = adversarial / simplify / lean; verdict = Keep / Drop with a one-line
reason per Drop.) If all three yield nothing material, say so and stop.

### Stage 3 — Output / hand off
- RO: the table + `## Design Concerns` is the final report. Stop.
- Apply requested: confirm the Keep set with the user, then follow **Stage 3 —
  Apply** under "Single review + fix" below (same apply steps, reused here).

---

## Single review + fix (RW)

You are the judge in the middle — the reviewer runs in an isolated session and may
flag intentional choices only you know about.

### Stage 1 — Structured review
**If the active angle is simplify:** run **the simplify dual-lane** (defined
above) instead of the single call below — Lane A already appends `--fix`; Lane B
has no `--fix` concept and always returns its plain tag-lines. Skip straight to
the dual-lane's own consolidation step, then continue to Stage 2 below with the
consolidated table instead of a raw envelope.

**Otherwise (standard or adversarial):** forward the angle and
base/scope/context/focus args, append node's `--fix` for structured output:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --fix <forwarded>
```
Parse the envelope. If `findings` is empty, tell the user and stop.

### Stage 2 — Judge each finding
Decide real defect vs false positive (a false positive is an intentional choice you
have context for). Read cited files. Present a table — id, file:line, title,
verdict (Keep / Drop + one-line reason per Drop) — for simplify this is just the
dual-lane's consolidated table carried forward, already deduped. Confirm with the
user before applying; the user may override.

### Stage 3 — Apply
1. **Baseline snapshot** — same contract as `src/commands/fix.ts` (runFix): if
   `git status --porcelain` is non-empty, the fix diff must be isolated from the
   user's pre-existing work. Run `git stash create` and **record the printed SHA**
   as the baseline — an ephemeral snapshot object; nothing (working tree, index,
   branch history, stash ref) is mutated, so no confirmation is needed. If it
   prints nothing (e.g. only untracked changes) or the tree is clean, use `git
   rev-parse HEAD` as the baseline instead. Reuse that literal SHA in step 3
   (don't rely on a shell variable surviving between commands). Known limit (same
   as runFix): `stash create` skips pre-existing untracked files, so the reported
   diff may attribute them to the fix.
2. **Apply** each approved finding directly: minimal, correct change per finding;
   no unrelated refactor. Skip any that is already fixed, no longer applies, or
   whose fix would change intended behavior — note why.
3. **Stage + report:** `git add -A`, then report applied / skipped (with reasons)
   and changed files, and tell the user the fixes are **staged but not committed**
   — review the fix-only diff with `git diff --cached <baseline-sha>` (the SHA
   recorded in step 1; it excludes their pre-existing *tracked* WIP —
   pre-existing *untracked* files may still appear, so warn the user before they
   commit the staged changes).

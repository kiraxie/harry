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
  (see **Full mode**). Same three lanes as the Claude Code build.

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

**Parity note vs. the Claude Code build:** Lane B ports cleanly here because it
is ordinary sub-agent delegation — the same capability this skill's other sections
already assume Codex has, not something Claude-Code-specific. Both builds run the
same dual-lane, so there is no asymmetry to work around here.

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
See **Full-mode Stage 2 — consolidate into one table** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

### Stage 3 — Output / hand off
- RO: the table + `## Design Concerns` is the final report. Stop.
- Apply requested: confirm the Keep set with the user, then follow **The apply steps
  — baseline snapshot, apply, report** in
  `${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md` (same steps the single
  review + fix path reaches, reused here).

---

## Single review + fix (RW)

See **Single review + fix** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

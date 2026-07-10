---
description: Run a code review against local git state. Read-only unless a fix backend is requested. Review angle is standard (gpt-5.6-terra defects), --adversarial (gpt-5.6-sol design), --simplify (gpt-5.6-terra cleanups + a parallel CC-native over-engineering & readability lane, consolidated into one table), or --full (adversarial + simplify + CC /code-review max, consolidated). Apply findings with --fix (Claude Code applies) or --harry-fix (isolated Codex fix session).
argument-hint: '[--adversarial|--simplify|--full] [--fix|--harry-fix] [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--context <text|@file|@->] [--model <id>] [--reasoning <effort>] [focus...]'
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SlashCommand, Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git ls-files:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), AskUserQuestion
---

Run a code review through the harry runtime.

Raw slash-command arguments:
`$ARGUMENTS`

## RO vs RW — decide this first

The single command serves two modes, gated solely by whether a **fix backend** flag
is present:

- **No `--fix` and no `--harry-fix` → READ-ONLY (RO).** Produce findings and stop.
  In this mode you MUST NOT use `Edit`, `git add`, or `git commit` — those tools
  break the read-only trust boundary the user invoked. `Write` is permitted ONLY for
  a scratch file **outside the repo** that a review lane needs as a handoff (e.g.
  the simplify dual-lane's Lane B diff file, written to `/tmp/...`) — never for a
  repo-tracked file; that boundary is the trust boundary, not the tool name. (Codex
  review sub-agents already run read-only — writes/shell/URL are denied.)
- **`--fix` or `--harry-fix` present → READ-WRITE (RW).** Review → judge → apply.
  `--fix` and `--harry-fix` are mutually exclusive; if both appear, tell the user to
  pick one and stop.

## Review angle (what produces findings)

Mutually exclusive:
- default → standard defect review, `gpt-5.6-terra`.
- `--adversarial` → design-challenge review, `gpt-5.6-sol` — questions the approach.
- `--simplify` → cleanup review: `gpt-5.6-terra` behavior-preserving reuse /
  simplification / efficiency pass, run in parallel with a Claude-Code-native
  over-engineering & readability lane (see **The simplify dual-lane** below) and
  consolidated into one table. NOT bugs.
- `--full` → orchestrate four non-overlapping lanes — `--adversarial` (design),
  the simplify dual-lane (`--simplify`'s Codex cleanup pass + a CC-native
  over-engineering & readability pass), and CC `/code-review max` (defects) — in
  parallel, then consolidate into one deduped table (see **Full mode**).

**Shared overrides:** `--base <ref>` sets a base-branch review. `--context
<text|@file|@->` injects extra reviewer intent. `--model` / `--reasoning` override
a single review's model/effort (ignored under `--full`, where each lane is
model-specialized). Anything not a known flag is focus text, forwarded verbatim.

## Routing

- `--full` present → **Full mode**.
- else a fix backend present → **Single review + fix** (RW).
- else → **Plain review** (RO).

## The structured-review envelope (one definition)

See **The structured-review envelope** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

---

## The simplify dual-lane (one definition)

See **The simplify dual-lane** in
`${CLAUDE_PLUGIN_ROOT}/references/review-orchestration.md`.

---

## Plain review (RO)

**If the active angle is `--simplify`:** skip the single-call path below entirely —
run **the simplify dual-lane** (defined above) and present its consolidated table as
the final output. The execution-mode ask (wait/background, below) still governs Lane
A's `node` call; Lane B (the CC `Agent` dispatch) always runs in the foreground
alongside it — it's cheap, no need to background it.

**Otherwise (standard or `--adversarial`):** the review session runs with
writes/shell/URL denied. Do not fix anything or suggest you are about to. Return the
review session's output verbatim (HARRY.md §6 — tool output as-is, no performative
claims). Do not use any write tool on this path.

**Execution mode:**
- `--wait` → run foreground, do not ask.
- `--background` → run in a Claude background task, do not ask.
- Otherwise estimate size, then ask once:
  - Working-tree: `git status --short --untracked-files=all`, plus `git diff
    --shortstat --cached` and `git diff --shortstat`. Base-branch: `git diff
    --shortstat <base>...HEAD`. Treat untracked files/dirs as reviewable.
  - Recommend `Wait` only when clearly tiny (~1–2 files); otherwise (incl. unclear)
    recommend `Run in background`. When in doubt, run rather than declare nothing.
  - `AskUserQuestion` once, recommended option first with `(Recommended)`:
    `Wait for results` / `Run in background`.

**Foreground:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review <args without --wait/--background>
```
`--wait`/`--background` are execution-mode flags for this command, not companion
flags — strip them before forwarding (the CLI rejects `--wait` as an unknown flag).
Return stdout verbatim (markdown). No paraphrase, summary, or commentary.

**Background:** launch with the harness's own background mode — do NOT pass
`--background` to node (run it foreground so the bash call completes only when the
review is done; the harness then notifies). Strip an explicit `--background`.
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review <args without --background>`,
  description: "Codex review",
  run_in_background: true
})
```
Tell the user it is running; when notified, return the captured stdout verbatim. If
the node process exited non-zero, surface its stderr instead of an empty result.

---

## Full mode (`--full`)

Orchestrated by you. Four reviewers (two Codex, two CC-native), all read-only, in
parallel, then one deduped table. `--full`/`--harry-fix` are rejected by the node
CLI — never forward them. Skip the execution-mode ask: full always fans out in the
background and joins across turns. A bare `--full` is RO; `--full --fix`/
`--full --harry-fix` is RW (apply step at the end).

Tell the user up-front: full consumes Codex token quota for the `gpt-5.6-terra`
simplify pass plus the adversarial `gpt-5.6-sol` request, plus your `/code-review max`
compute and the simplify Lane B `Agent` dispatch.

### Stage 1 — Fan out four lanes in parallel
Forwarded args = `$ARGUMENTS` minus `--full`, `--adversarial`, `--simplify`, `--fix`,
`--harry-fix`, `--wait`, `--background`, `--model`, `--reasoning` (each lane is
model-specialized); keep `--base`, `--scope`, `--context`, focus text. In one turn:

1. Background Codex adversarial review:
```typescript
Bash({ command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --adversarial --fix <forwarded>`,
       description: "review (adversarial/design)", run_in_background: true })
```
2. **The simplify dual-lane** (defined above) — Lane A (Codex `--simplify --fix`,
   background) and Lane B (CC `Agent` over-engineering & readability dispatch,
   foreground) both count as their own lanes here; do not consolidate them yet —
   Stage 2 below merges all four lanes together in one pass. Lane A here uses *this Stage 1 preamble's*
   "Forwarded args" (computed just above, which already strips `--full` too) — not
   the dual-lane definition's own narrower `<forwarded>` rule, which only strips
   `--fix`/`--harry-fix`/`--wait`/`--background` and would let a bare `--full` reach
   the node CLI here, which it rejects.
3. `/code-review max` via the `SlashCommand` tool, read-only (no `--fix`/`--comment`).
   It may return inline or dispatch a background Workflow whose findings arrive as a
   task notification — either way treat it as a fourth source to join.

Wait until ALL FOUR have produced output before Stage 2.

### Stage 2 — Consolidate into a table (your job)
- For each Codex leg (adversarial, simplify Lane A): check it succeeded first (zero
  exit, stdout is the envelope not `# Review Failed`). A failed leg contributes no
  findings — record it as a failed source and continue; never abort the whole
  consolidation for one bad leg. Adversarial design-level notes live in
  `reviewMarkdown`'s `## Design Concerns`; simplify findings are cleanups, not bugs.
- Simplify Lane B (CC over-engineering & readability) returns plain `tag: what. replacement.`
  lines — map each to a finding: `tag`→severity-ish label, the line itself→title.
- `/code-review max` returns `[{file,line,summary,failure_scenario}]` (≤15). Map
  lightly: `summary`→title, `failure_scenario`→rationale.
- **Re-key ids across sources** before merging: prefix each by source
  (`adv-`/`smp-`/`lean-`/`cr-`) so the table's `id` column is unique and unambiguous.
- **Dedup** by `file` + `line` + semantic-title. When `line` is absent (file-wide),
  only merge on a genuine semantic-title match on the same file — do not collapse two
  different file-wide findings just because they share a file. Simplify Lane A and
  Lane B will sometimes name the same spot from different angles — merge, keep both
  sources listed.
- Judge against this codebase: `Read` cited files where it matters and drop clear
  false positives (HARRY §6 — automated review is a suggestion, not an order).

Present ONE table, plus a `## Design Concerns` section (from adversarial) below it:

| id | file:line | severity | source(s) | title | verdict |

(source(s) = adversarial / simplify / lean / code-review; verdict = Keep / Drop with
a one-line reason per Drop.) If all four yield nothing material, say so and stop.

### Stage 3 — Output / hand off
- RO (no fix backend): the table + `## Design Concerns` is the final report. Stop.
- `--fix`: confirm the Keep set (`AskUserQuestion`), then **Apply: --fix** on it.
- `--harry-fix`: confirm the Keep set, then **Apply: --harry-fix** on it.

---

## Single review + fix (RW; `--fix` or `--harry-fix`, not `--full`)

You are the judge in the middle — the reviewer runs in an isolated session and may
flag intentional choices only you know about.

### Stage 1 — Structured review
**If the active angle is `--simplify`:** run **the simplify dual-lane** (defined
above) instead of the single call below — Lane A already appends `--fix`; Lane B has
no `--fix` concept and always returns its plain tag-lines. Skip straight to the
dual-lane's own consolidation step, then continue to Stage 2 below with the
consolidated table instead of a raw envelope.

**Otherwise (standard or `--adversarial`):** forward args verbatim EXCEPT strip the
slash-level fix flags (`--fix`, `--harry-fix`, `--wait`, `--background`); keep the
angle and `--base`/`--scope`/`--context`/focus. Append node's `--fix` for structured
output:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --fix <forwarded>
```
Parse the envelope (see its one definition above; handle the `# Review Failed`
failure case). If `findings` is empty, tell the user and stop.

### Stage 2 — Judge each finding
Decide real defect vs false positive (a false positive is an intentional choice you
have context for). `Read` cited files. Present a table — id, file:line, title,
verdict (Keep / Drop + one-line reason per Drop) — for `--simplify` this is just the
dual-lane's consolidated table carried forward, already deduped. `AskUserQuestion` to
confirm; the user may override. Do not apply until approved.

### Stage 3 — Apply
Follow **Apply: --fix** or **Apply: --harry-fix** on the approved (Keep) set.

---

## Apply: `--fix` (Claude Code applies)

You apply the approved findings yourself, with full conversation context.

1. **Baseline snapshot** — same contract as `src/commands/fix.ts` (runFix): if `git
   status --porcelain` is non-empty, the fix diff must be isolated from the user's
   pre-existing work. Run `git stash create` and **record the printed SHA** as the
   baseline — an ephemeral snapshot object; nothing (working tree, index, branch
   history, stash ref) is mutated, so no confirmation is needed. If it prints
   nothing (e.g. only untracked changes) or the tree is clean, use `git rev-parse
   HEAD` as the baseline instead. Reuse that literal SHA in step 3 — each `Bash`
   call is a fresh shell, so a `BASE=…` variable will not survive; substitute the
   actual value. Known limit (same as runFix): `stash create` skips pre-existing
   untracked files, so `git add -A` in step 3 stages them and they appear in the
   fix diff as if the fix created them.
2. **Apply** each approved finding with `Edit`/`Write`: minimal, correct change per
   finding; no unrelated refactor. Skip any that is already fixed, no longer applies,
   or whose fix would change intended behavior — note why.
3. **Stage + report:** `git add -A`, then report applied / skipped (with reasons) and
   changed files, and tell the user the fixes are **staged but not committed** —
   review the fix-only diff with `git diff --cached <baseline-sha>` (the SHA recorded
   in step 1; it excludes their pre-existing *tracked* WIP — pre-existing *untracked*
   files may still appear, so warn the user before they commit the staged changes).

## Apply: `--harry-fix` (isolated Codex fix session, gpt-5.6-sol/xhigh)

A fresh write-enabled Codex session applies the findings — it cannot see this
conversation, so carry context explicitly.

1. Write the approved findings (full objects) to a temp JSON via `Write`. For
   `--full`, `/code-review`-derived findings need only a light shape (`file`, `title`,
   optional `line`/`rationale`/`severity`/`id`); `suggestedFix` is optional.
2. Recommended for `--full`: write the consolidated report (failure scenarios, which
   reviewers agreed, design concerns) to a temp markdown and pass `--context @that`.
3. Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" fix \
  --findings /tmp/harry-fix-findings.json \
  --reasoning xhigh \
  [--context @/tmp/harry-fix-context.md]
```
`fix` snapshots pre-existing changes as a baseline, applies fixes (left staged), and
emits `{"status":"fixed", filesModified, applied, skipped, …}`. Report applied /
skipped and changed files; fixes are **staged but not committed**. If `status` is
`failed`, surface the message and stop.

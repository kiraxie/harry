---
description: Run a code review against local git state. Read-only unless a fix backend is requested. Review angle is standard (gpt-5.3-codex defects), --adversarial (gpt-5.5 design), --simplify (gpt-5.3-codex cleanups), or --full (adversarial + simplify + CC /code-review max, consolidated). Apply findings with --fix (Claude Code applies) or --harry-fix (isolated Copilot fix session, gpt-5.5/xhigh).
argument-hint: '[--adversarial|--simplify|--full] [--fix|--harry-fix] [--wait|--background] [--base <ref>] [focus...]'
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, SlashCommand, Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git ls-files:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), AskUserQuestion
---

Run a code review through the harry runtime.

Raw slash-command arguments:
`$ARGUMENTS`

## RO vs RW — decide this first

The single command serves two modes, gated solely by whether a **fix backend** flag
is present:

- **No `--fix` and no `--harry-fix` → READ-ONLY (RO).** Produce findings and stop.
  In this mode you MUST NOT use `Edit`, `Write`, `git add`, or `git commit` — those
  tools are in the allowlist only for RW mode, and using them here breaks the
  read-only trust boundary the user invoked. (Copilot sub-reviews already run with
  writes/shell/URL denied at the SDK level.)
- **`--fix` or `--harry-fix` present → READ-WRITE (RW).** Review → judge → apply.
  `--fix` and `--harry-fix` are mutually exclusive; if both appear, tell the user to
  pick one and stop.

## Review angle (what produces findings)

Mutually exclusive:
- default → standard defect review, `gpt-5.3-codex`.
- `--adversarial` → design-challenge review, `gpt-5.5` — questions the approach.
- `--simplify` → cleanup review, `gpt-5.3-codex` — behavior-preserving reuse /
  simplification / efficiency, NOT bugs.
- `--full` → orchestrate three non-overlapping lanes — `--adversarial` (design),
  `--simplify` (cleanup), and CC `/code-review max` (defects) — in parallel, then
  consolidate into one deduped table (see **Full mode**).

**Shared overrides:** `--base <ref>` sets a base-branch review. `--context
<text|@file|@->` injects extra reviewer intent. `--model` / `--reasoning` override
a single review's model/effort (ignored under `--full`, where each lane is
model-specialized). Anything not a known flag is focus text, forwarded verbatim.

## Routing

- `--full` present → **Full mode**.
- else a fix backend present → **Single review + fix** (RW).
- else → **Plain review** (RO).

## The structured-review envelope (one definition)

`node … review --fix` (node's `--fix` = "emit structured JSON", regardless of RO/RW)
prints exactly one JSON line. This is the single source of truth for its shape — do
not restate it elsewhere:

```
{"status":"reviewed", kind, model, target, fileCount,
 findings:[{id,file,line,severity,title,rationale,suggestedFix}],
 reviewMarkdown, premiumRequestCost, quotaRemaining}
```

`line` is optional (file-wide findings omit it). On **failure** (timeout/quota), the
process exits non-zero and stdout is markdown beginning `# Review Failed`, NOT this
envelope — so never `JSON.parse` a leg's output without first checking it succeeded.

---

## Plain review (RO)

Read-only. Copilot runs with writes/shell/URL denied. Do not fix anything or suggest
you are about to. Return Copilot's output verbatim (HARRY.md §6 — tool output as-is,
no performative claims). Do not use any write tool on this path.

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
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review $ARGUMENTS
```
Return stdout verbatim (markdown). No paraphrase, summary, or commentary.

**Background:** launch with the harness's own background mode — do NOT pass
`--background` to node (run it foreground so the bash call completes only when the
review is done; the harness then notifies). Strip an explicit `--background`.
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review <args without --background>`,
  description: "Copilot review",
  run_in_background: true
})
```
Tell the user it is running; when notified, return the captured stdout verbatim. If
the node process exited non-zero, surface its stderr instead of an empty result.

---

## Full mode (`--full`)

Orchestrated by you. Three reviewers, all read-only, in parallel, then one deduped
table. `--full`/`--harry-fix` are rejected by the node CLI — never forward them.
Skip the execution-mode ask: full always fans out in the background and joins across
turns. A bare `--full` is RO; `--full --fix`/`--full --harry-fix` is RW (apply step
at the end).

Tell the user up-front: full spends ~1 premium (`gpt-5.3-codex` simplify) + the
adversarial `gpt-5.5` request, plus your `/code-review max` compute.

### Stage 1 — Fan out three lanes in parallel
Forwarded args = `$ARGUMENTS` minus `--full`, `--adversarial`, `--simplify`, `--fix`,
`--harry-fix`, `--wait`, `--background`, `--model`, `--reasoning` (each lane is
model-specialized); keep `--base`, `--scope`, `--context`, focus text. In one turn:

1. Two background Copilot reviews (each appends `--fix` for the structured envelope):
```typescript
Bash({ command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --adversarial --fix <forwarded>`,
       description: "review (adversarial/design)", run_in_background: true })
Bash({ command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --simplify --fix <forwarded>`,
       description: "review (simplify/cleanup)", run_in_background: true })
```
2. `/code-review max` via the `SlashCommand` tool, read-only (no `--fix`/`--comment`).
   It may return inline or dispatch a background Workflow whose findings arrive as a
   task notification — either way treat it as a third source to join.

Wait until ALL THREE have produced output before Stage 2.

### Stage 2 — Consolidate into a table (your job)
- For each Copilot leg: check it succeeded first (zero exit, stdout is the envelope
  not `# Review Failed`). A failed leg contributes no findings — record it as a
  failed source and continue; never abort the whole consolidation for one bad leg.
  Parse the survivors. Adversarial design-level notes live in `reviewMarkdown`'s
  `## Design Concerns`; simplify findings are cleanups, not bugs.
- `/code-review max` returns `[{file,line,summary,failure_scenario}]` (≤15). Map
  lightly: `summary`→title, `failure_scenario`→rationale.
- **Re-key ids across sources** before merging: prefix each by source
  (`adv-`/`smp-`/`cr-`) so the table's `id` column is unique and unambiguous.
- **Dedup** by `file` + `line` + semantic-title. When `line` is absent (file-wide),
  only merge on a genuine semantic-title match on the same file — do not collapse two
  different file-wide findings just because they share a file.
- Judge against this codebase: `Read` cited files where it matters and drop clear
  false positives (HARRY §6 — automated review is a suggestion, not an order).

Present ONE table, plus a `## Design Concerns` section (from adversarial) below it:

| id | file:line | severity | source(s) | title | verdict |

(source(s) = adversarial / simplify / code-review; verdict = Keep / Drop with a
one-line reason per Drop.) If all three yield nothing material, say so and stop.

### Stage 3 — Output / hand off
- RO (no fix backend): the table + `## Design Concerns` is the final report. Stop.
- `--fix`: confirm the Keep set (`AskUserQuestion`), then **Apply: --fix** on it.
- `--harry-fix`: confirm the Keep set, then **Apply: --harry-fix** on it.

---

## Single review + fix (RW; `--fix` or `--harry-fix`, not `--full`)

You are the judge in the middle — the reviewer runs in an isolated session and may
flag intentional choices only you know about.

### Stage 1 — Structured review
Forward args verbatim EXCEPT strip the slash-level fix flags (`--fix`, `--harry-fix`,
`--wait`, `--background`); keep the angle (`--adversarial`/`--simplify`) and
`--base`/`--scope`/`--context`/focus. Append node's `--fix` for structured output:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --fix <forwarded>
```
Parse the envelope (see its one definition above; handle the `# Review Failed`
failure case). If `findings` is empty, tell the user and stop.

### Stage 2 — Judge each finding
Decide real defect vs false positive (a false positive is an intentional choice you
have context for). `Read` cited files. Present a table — id, file:line, title,
verdict (Keep / Drop + one-line reason per Drop). `AskUserQuestion` to confirm; the
user may override. Do not apply until approved.

### Stage 3 — Apply
Follow **Apply: --fix** or **Apply: --harry-fix** on the approved (Keep) set.

---

## Apply: `--fix` (Claude Code applies)

You apply the approved findings yourself, with full conversation context.

1. **Baseline snapshot** — same contract as `src/commands/fix.ts` (runFix): if `git
   status --porcelain` is non-empty, the fix diff must be isolated from the user's
   pre-existing work. Because this commits their uncommitted changes, **confirm first**
   with `AskUserQuestion` ("snapshot your uncommitted work as a baseline commit before
   applying?"); on yes, `git add -A` and `git commit -m "chore: pre-fix snapshot (cc
   fix baseline)"`. If the commit fails on a dirty tree, STOP and tell the user to
   commit/stash manually — never mix fix edits into their pre-existing changes.
2. **Apply** each approved finding with `Edit`/`Write`: minimal, correct change per
   finding; no unrelated refactor. Skip any that is already fixed, no longer applies,
   or whose fix would change intended behavior — note why.
3. **Stage + report:** `git add -A`, then report applied / skipped (with reasons) and
   changed files, and tell the user the fixes are **staged but not committed**
   (`git diff --cached` to review).

## Apply: `--harry-fix` (isolated Copilot fix session, gpt-5.5/xhigh)

A fresh write-enabled Copilot session applies the findings — it cannot see this
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
  --model gpt-5.5 --reasoning xhigh \
  [--context @/tmp/harry-fix-context.md]
```
`fix` snapshots pre-existing changes as a baseline, applies fixes (left staged), and
emits `{"status":"fixed", filesModified, applied, skipped, …}`. Report applied /
skipped and changed files; fixes are **staged but not committed**. If `status` is
`blocked` (quota) or `failed`, surface the message and stop.

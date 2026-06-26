---
description: Run a Copilot code review against local git state. Read-only by default; pass --fix to let Claude Code judge findings and hand the approved ones back to Copilot for repair. Pass --adversarial for a stricter design-challenge review.
argument-hint: '[--fix] [--adversarial] [--wait|--background] [--base <ref>] [focus...]'
disable-model-invocation: true
allowed-tools: Read, Write, Glob, Grep, Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git ls-files:*), Bash(git branch:*), AskUserQuestion
---

Run a Copilot review through the harry runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint (default / non-`--fix` mode):
- This command is review-only. Copilot is run with file writes, shell, and URL fetches all denied.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Copilot's output verbatim to the user (HARRY.md §6 — return tool output as-is, no performative claims).

**If the raw arguments include `--fix`, the core constraint above does NOT apply — follow the "Fix mode" section below instead of the foreground/background flows.**

Mode selection:
- Default mode is a focused defect review (`gpt-5.3-codex`, medium effort).
- `--adversarial` switches to a design-challenge review (`gpt-5.5`, high effort) that questions the approach, not just the implementation.
- `--model` and `--reasoning` override the defaults.
- `--context <text|@file|@->` injects extra intent into Copilot's system message — e.g. "the ignored lint rule is a team decision, don't flag it". Use a literal string, `@path` for a file, or `@-` for stdin; in `--fix` mode you can forward your Stage-2 judgment rationale this way (write it to a temp file and pass `@that-file`). (Copilot already loads the repo's CLAUDE.md/AGENTS.md, so don't repeat those.)

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a Claude background task.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - Also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Recommend waiting only when the review is clearly tiny (roughly 1–2 files total and no sign of a broader directory-sized change).
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring there is nothing to review.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly. Do not strip `--wait`, `--background`, or `--adversarial`.
- Anything that is not a known flag is treated as focus text and forwarded to the review prompt verbatim.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/copilot-companion.cjs" review $ARGUMENTS
```
- Return the command stdout verbatim, exactly as-is. It is markdown.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.

Background flow:
- Launch the review with `Bash` using the harness's own background mode. Do NOT pass `--background` to the node process — run it foreground so the bash call completes when (and only when) the review is actually done. The harness will then auto-notify this session.
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/dist/copilot-companion.cjs" review $ARGUMENTS`,
  description: "Copilot review",
  run_in_background: true
})
```
- Strip `--background` from `$ARGUMENTS` if the user passed it explicitly — harness background supersedes it.
- Do not wait for completion in this turn. Tell the user: "Copilot review running in the background. You'll be notified when it finishes; the output will be returned verbatim."
- When the harness notifies completion, read the captured stdout and return it verbatim, exactly as the foreground flow would.

## Fix mode (`--fix`)

Only when `$ARGUMENTS` contains `--fix`. This is a three-stage pipeline where **you (Claude Code) are the judge in the middle** — the reviewer model runs in an isolated session and cannot see this conversation, so it may flag things that are intentional and known only to you.

### Stage 1 — Structured review
Run the review in structured-findings mode (forward all other args verbatim, including `--adversarial` / `--base` / `--scope` / focus text):
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/copilot-companion.cjs" review $ARGUMENTS
```
Stdout is a single JSON line: `{"status":"reviewed", findings:[{id,file,line,severity,title,rationale,suggestedFix}], reviewMarkdown, ...}`. Parse it. If `findings` is empty, tell the user the review found nothing material and stop (do not call `fix`).

### Stage 2 — Judge each finding (your job)
For every finding, decide whether it is a **real defect** or a **false positive**. A finding is a false positive when the flagged behavior is an intentional choice you have context for from this conversation (a deliberate workaround, a known-safe pattern, a decision the user already made, code intentionally left as-is). Use the conversation history and read the cited files (`Read`) to judge — do not rubber-stamp the reviewer.

Then present a concise table to the user: each finding's id, file:line, title, and your verdict (**Keep** / **Drop**) with a one-line reason for every Drop. Use `AskUserQuestion` to confirm before proceeding — the user may override any verdict. **Do not call `fix` until the user approves.**

### Stage 3 — Apply approved fixes
Write the approved findings (the kept subset, full objects) to a temp file, then run `fix`:
```bash
# Write approved findings JSON to e.g. /tmp/copilot-fix-findings.json via the Write tool, then:
node "${CLAUDE_PLUGIN_ROOT}/dist/copilot-companion.cjs" fix --findings /tmp/copilot-fix-findings.json
```
- `fix` first commits any pre-existing uncommitted changes as a baseline snapshot, then applies the fixes to the working tree (leaving them staged) and emits `{"status":"fixed", filesModified, applied, skipped, ...}`.
- Report back: which findings were applied, which the model skipped (with reasons), and the files changed. Tell the user the fixes are **staged but not committed** so they can review with `git diff --cached` before committing.
- If `status` is `blocked` (quota) or `failed`, surface the message and stop.

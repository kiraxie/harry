---
description: Run a read-only code review through codex exec review — reviews the working tree, a branch against its default, or a diff against --base.
argument-hint: '[--base <ref>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->] [focus...]'
allowed-tools: Read, Bash(git status:*), Bash(git diff:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review:*)
---

Run a code review through the harry runtime.

Raw slash-command arguments:
`$ARGUMENTS`

## What this does

`node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review` spawns `codex exec review`
read-only (`sandbox_mode="read-only"`, `--ephemeral`) with a prompt built from the
target diff, the full `references/review-rubric.md`, a `## Background` section from
`--context`, and a `## Focus` section from the focus text. It never passes a
model — `~/.codex/config.toml` decides which one runs; `--reasoning` overrides
effort for that one call. Each run writes its findings to its own
`codex-review-<YYYYMMDD-HHMMSS>.md` (codex's session transcript goes to the
matching `.log`, never to the terminal), and stderr ends with
`Review written to <path>` and `Log: <path>`; this command's job is to run it,
wait, and hand back the findings verbatim.

This command has no fix backend and no dual-lane/full mode — it is read-only,
full stop. Nothing here edits the working tree, stages, or commits.

## Target

- `--base <ref>` → reviews `git diff <ref>...HEAD`.
- No `--base`, dirty working tree (including untracked files) → reviews the
  uncommitted changes.
- No `--base`, clean working tree → reviews the current branch against the
  repository's default branch.

## Execution mode

Estimate the target size first, then decide foreground vs. background — never
ask the user:

- With `--base <ref>`: `git diff --shortstat <ref>...HEAD`.
- Without `--base`: `git status --short --untracked-files=all` plus
  `git diff --shortstat HEAD`.

1–2 files → run in the foreground. Everything else, and anything the size
estimate leaves unclear, runs with the harness's background mode
(`run_in_background: true`) — do not ask the user first, just background it and
say so.

A run can take several minutes — a five-file branch has taken ~5.5 minutes, a
small one 35–90s. The foreground path is the only one bound by the Bash tool's
timeout (2-minute default, 10-minute ceiling), which is why anything beyond a
1–2 file target goes to the background, where that timeout does not apply.

**Foreground:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review <args>
```
Pass `timeout: 600000` on this call. Read the file named on the
`Review written to <path>` line (with `Read`) and return it verbatim (markdown).
No paraphrase, summary, or commentary (HARRY.md §6).

**Background:**
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review <args>`,
  description: "Codex review",
  run_in_background: true
})
```
Tell the user it is running. When notified, read the file named on the
`Review written to <path>` line of the captured output (with `Read`) and return
it verbatim.

**Nothing to review:** when the output has no `Review written to` line and prints
a `# Review Summary` saying there are no changes to review, the target is empty —
return that summary as-is. It is not a failure.

## Failure

Failure is explicit: a non-zero exit prints the last 40 lines of codex's log
(its closing `ERROR:` line carries the cause) and then `Log: <path>` — never
present a failure as an empty review. Surface that stderr tail verbatim and name
the cause; do not retry silently and do not fabricate a result.

## `--context` — facts, never verdicts

`--context <text|@file|@->` carries **facts** the reviewer doesn't already
have: constraints, decisions already taken, a prior round's ruling and its
reasoning. It never carries verdicts — never tell the reviewer what *not* to
flag ("this is deliberate, skip it"). Focus text says where to look; context
says what is true. Forward whatever `--context` the caller gives as-is — the
rule binds the caller, not this command; it is not this command's job to
rewrite or filter it before forwarding.

An `@file` that cannot be read, or an `@-` or `@file` with nothing in it, fails
the run before codex starts — the review never runs without the context it was
given.

## Findings are suggestions

Per HARRY.md §6, automated review findings are suggestions to verify against
this codebase, not orders — judge them, don't rubber-stamp them.

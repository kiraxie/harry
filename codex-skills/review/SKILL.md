---
name: review
description: Run a read-only code review through harry's companion runtime (the Codex CLI) — reviews the working tree, a branch against its default, or a diff against --base. Use when the user asks for a code review.
---

# Review

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/review/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

Run a code review through the harry runtime.

## What this does

`node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review` spawns `codex exec`
read-only (`-s read-only`, `--ephemeral`) with a prompt built from the
target diff, every file `references/review-rubric.md` declares as its standard, in full,
a `## Background` section from
`--context`, and a `## Focus` section from the focus text. Not `codex exec review`:
it answers in its own review-comment format and ignores the form the prompt asks for.
It never passes a
model — `~/.codex/config.toml` decides which one runs; `--reasoning` overrides
effort for that one call. Each run writes its findings to its own
`codex-review-<YYYYMMDD-HHMMSS>.md` (codex's session transcript goes to the
matching `.log`, never to the terminal), and stderr ends with
`Review written to <path>` and `Log: <path>`; your job is to run it, wait, and
hand back the findings verbatim.

This skill has no fix backend — it is read-only, full stop. Nothing here edits
the working tree, stages, or commits.

## Target

- `--base <ref>` → reviews `git diff <ref>...HEAD`.
- No `--base`, dirty working tree (including untracked files) → reviews the
  uncommitted changes.
- No `--base`, clean working tree → reviews the current branch against the
  repository's default branch.

## `--architecture`

`--architecture` changes two things. It swaps the embedded standard: the prompt
carries `references/architecture-review.md` in place of the per-diff standard.
And it scopes findings to the shapes the change adds or alters, rather than to
the diff's lines. Everything else stays the same — target resolution, the
read-only spawn, the output and failure handling. It is how the finishing
skill's architecture review (`skills/finishing/SKILL.md` **Architecture review**) runs out of session on this build. Finishing
passes the context file its **Reviewer.** paragraph lists for the Codex build
(`skills/finishing/SKILL.md` **Architecture review**) through `--context @<file>`.

## `--rereview`

`--rereview <text|@file|@->` runs the scoped re-review of executing's fix wave
(`skills/executing/SKILL.md` **One fix wave**). Its file holds the open findings
under their numbers, the fix check's verdicts and the last number in use. The
prompt carries the per-diff standard plus `references/fix-check.md` **Three levels**,
says it is a re-review, and puts the file under its own heading, so the reviewer
answers in the rubric's re-review form (`references/review-rubric.md`). It needs
`--base`: the head the review it follows reviewed. It excludes `--architecture` and
`--fix-check`.

## `--fix-check`

`--fix-check <text|@file|@->` runs the fix check of executing's fix wave on
this build (`skills/executing/SKILL.md` **One fix wave**), before a finding's fix
is built. Its file holds each finding with its proposed fix, and the paths of the
unit's earlier findings files. The prompt carries `references/fix-check.md` in full
and tells the reviewer to read the whole repo to trace each fix; it judges only the
handed fixes. It needs `--base`: the unit's branch point. It excludes `--architecture`
and `--rereview`.

`--rereview` and `--fix-check` both read their value as `--context` does, and as
strictly: an `@file` that cannot be read, or an `@-` or `@file` with nothing in it,
fails the run before codex starts. `--context` can go with either, but only one of
the two can read stdin (`@-`).

## Run it

Codex has no background-task tool — just run it and wait:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review [--base <ref>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->] [--architecture] [--rereview <text|@file|@->] [--fix-check <text|@file|@->] [focus...]
```

A run can take several minutes — a five-file branch has taken ~5.5 minutes, a
small one 35–90s. Read the file named on the `Review written to <path>` line and
return it verbatim (markdown). No paraphrase, summary, or commentary (HARRY.md **Talk**).

**Nothing to review:** when the output has no `Review written to` line and prints
a `# Review Summary` saying there are no changes to review, the target is empty —
return that summary as-is. It is not a failure. With `--rereview` or `--fix-check`, an
empty range fails instead: those modes judge committed changes.

## Failure

Failure is explicit: a non-zero exit, or a zero exit that writes no review,
prints only the error lines from the end of codex's log (lines starting
`ERROR:`, `Error:` or `error:`, each capped at 1000 bytes) — or, when there is
none, the line `No error line at the end of codex's log.` — then `Log: <path>`.
Never present a failure as an empty review. Surface those error lines verbatim
and name the cause; do not retry silently and do not fabricate a result. Do not
open or dump the whole log to diagnose it — it holds codex's session
transcript, including the output of commands codex ran and any files it read;
point the user at the `Log: <path>` path instead, or read a narrow slice only
if the user asks.

## `--context` — facts, never verdicts

`--context <text|@file|@->` carries **facts** the reviewer doesn't already
have: constraints, decisions already taken, a prior round's ruling and its
reasoning. It never carries verdicts — never tell the reviewer what *not* to
flag ("this is deliberate, skip it"). Focus text says where to look; context
says what is true. A re-review's open findings go in `--rereview`, not
`--context`: they are a prior reviewer's verdicts.

An `@file` that cannot be read, or an `@-` or `@file` with nothing in it, fails
the run before codex starts — the review never runs without the context it was
given.

## Findings are suggestions

Per `references/review-rubric.md` **Engineering judgment**, automated review findings are suggestions to verify against
this codebase, not orders — judge them, don't rubber-stamp them.

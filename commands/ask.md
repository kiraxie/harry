---
description: Ask a single frontier model one read-only prompt through codex exec and print the answer verbatim.
argument-hint: '"<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask:*)
---

Ask one frontier model a single prompt through Codex and return its answer.

Raw slash-command arguments:
`$ARGUMENTS`

## What this does

`node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask` spawns
`codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> [-c model_reasoning_effort="<v>"] -`
with the prompt on stdin. Read-only means the model may read files and run
read-only commands under Codex's own read-only sandbox; a fixed preamble on every
prompt tells it not to explore the working directory or run commands unless the
prompt asks about files in it. It never passes a model —
`~/.codex/config.toml` decides which one runs; `--reasoning` overrides effort
for that one call.

Execute:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]
```

## Success

The answer is printed verbatim to stdout; stderr ends with `Log: <path>`.
Return the stdout content verbatim — no paraphrase, summary, or commentary
before or after it (HARRY.md §6) — but only once you've confirmed the run
succeeded (see Failure below).

## Failure

An argument error (unknown flag, `--context` with no value, a bad `--reasoning`)
fails before any run: empty stdout, a `Fatal error: <message>` line on stderr,
non-zero exit.

Failure is explicit: stdout's first line is `# Ask Failed`, followed by a
reason line naming the cause — codex's last `ERROR:` line when codex exited
non-zero and the log's end has one (capped at 1000 bytes); otherwise, including
an exit-0 run that wrote no answer, the companion's own failure message. The
exit code is non-zero. When codex ran, stderr carries only the error lines from
the end of codex's log — lines starting `ERROR:`, `Error:` or `error:`, each
capped at 1000 bytes (or, when there is none, `No error line at the end of
codex's log.`) — and then `Log: <path>` (a missing CLI, an unreadable or empty
`--context`, or an empty prompt fails before codex starts, with no log).
Surface the reason line and those error lines — never present a failed run's
stdout as the model's answer, and do not retry silently. Do not open or dump
the whole log to diagnose it — it holds codex's session transcript, including
files it read; point the user at the `Log: <path>` path instead, or read a
narrow slice only if the user asks.

## `--context` — facts, never verdicts

`--context <text|@file|@->` carries **facts** the model doesn't already
have — same rule as `/harry:review`: it never carries verdicts, never tells
the model what *not* to say. An unreadable `@file`, or an `@-` or `@file`
with nothing in it, fails the run before codex starts.

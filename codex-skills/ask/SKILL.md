---
name: ask
description: Ask a single frontier model one read-only prompt via harry's companion runtime (spawns codex exec), and print the answer verbatim. Use when the user wants a one-shot answer from Codex under a read-only sandbox — the model cannot write.
---

# Ask

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/ask/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

Ask one frontier model a single prompt through Codex and return its answer.
Read-only — the model may read files and run read-only commands under Codex's
own read-only sandbox, but it cannot write (the command itself writes only its
answer file and log, under the plugin state dir). A fixed preamble on every
prompt tells the model not to explore the working directory or run commands
unless the prompt asks about files in it.

Parse the user's request into: the prompt text, an optional
`--reasoning <low|medium|high|xhigh>`, and an optional
`--context <text|@file|@->` (facts, never verdicts — same rule as `review`).

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]
```

This spawns
`codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> [-c model_reasoning_effort="<v>"] -`
with the prompt on stdin. It never passes a model — `~/.codex/config.toml`
decides which one runs.

- On success, the answer is printed verbatim to stdout and stderr ends with
  `Log: <path>`. Return the stdout content verbatim, exactly as-is — no
  paraphrase, summary, or commentary before or after it (HARRY.md §6) — but
  only once you've confirmed the run succeeded (next bullet).
- Failure signals: a non-zero exit, a `Fatal error: <message>` line on stderr
  (argument errors, before any run), or a `# Ask Failed` first line of stdout
  (followed by a reason line naming the cause — codex's last `ERROR:` line
  when codex exited non-zero and the log's end has one (capped at 1000 bytes);
  otherwise, including an exit-0 run that wrote no answer, the companion's own
  failure message) — when codex ran, stderr also carries only the error
  lines from the end of codex's log — lines starting `ERROR:`, `Error:` or
  `error:`, each capped at 1000 bytes (or, when there is none, `No error line
  at the end of codex's log.`) — and then `Log: <path>`; a missing CLI, a bad
  `--context`, or an empty prompt fails before codex starts, with no log. If
  you see any of these, report the failure and stop; never present that stdout
  body as the model's answer.
  Do not open or dump the whole log to diagnose it — it holds codex's session
  transcript, including files it read; point the user at the `Log: <path>`
  path instead, or read a narrow slice only if the user asks.
  **Name the reason line, do not just say it failed:** the line under the
  marker carries the backend's own cause when there is one (an upstream
  model rejection, say), which is the difference between a fixable report
  and "it didn't work".
- An `--context @file` that cannot be read, or an `@-` or `@file` with nothing in it, fails the run before codex starts.

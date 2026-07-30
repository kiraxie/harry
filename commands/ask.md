---
description: Ask a single frontier model one prompt (read-only) and print the answer. This is the gpt-5.6-sol backend used by /debate.
argument-hint: '"<prompt>" [--model <id>] [--reasoning <low|medium|high>]'
allowed-tools: Bash(node:*)
---

Ask one frontier model a single prompt and return its answer. Read-only — the model touches no filesystem, shell, or URLs.

Raw slash-command arguments:
`$ARGUMENTS`

Execute:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask $ARGUMENTS
```

- The first quoted argument is the prompt. `--model <id>` (default is the runtime's frontier model, gpt-5.6-sol for debate use) and `--reasoning <low|medium|high>` override defaults; forward all of `$ARGUMENTS` verbatim.
- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize, or add commentary before or after it (HARRY.md §6) — that applies only once you've confirmed the run succeeded (next bullet). `ask` has no JSON mode or `status` field; its output is plain markdown either way.
- Failure signals: a non-zero exit, a `# Ask Failed` first line of stdout, or a `Fatal error: <message>` line on stderr. If you see any of these, report the failure and stop — never present that body as the model's answer. **Name the reason line, do not just say it failed:** the line under the marker carries the backend's own cause when there is one (an upstream model rejection, say), which is the difference between a fixable report and "it didn't work".

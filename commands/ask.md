---
description: Ask a single frontier model one prompt (read-only) and print the answer. This is the gpt-5.5 backend used by /debate.
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

- The first quoted argument is the prompt. `--model <id>` (default is the runtime's frontier model, gpt-5.5 for debate use) and `--reasoning <low|medium|high>` override defaults; forward all of `$ARGUMENTS` verbatim.
- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize, or add commentary before or after it (HARRY.md §6).
- If `status` is `failed`, surface the message and stop.

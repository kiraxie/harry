---
name: ask
description: Ask a single frontier model one prompt (read-only) via harry's companion runtime, and print the answer verbatim. Use when the user wants a one-shot answer from a specific model (e.g. gpt-5.6-sol) with no filesystem, shell, or URL access.
---

# Ask

Ask one frontier model a single prompt and return its answer. Read-only — the model
touches no filesystem, shell, or URLs.

Parse the user's request into: the prompt text, an optional `--model <id>` (default
is the runtime's frontier model, gpt-5.6-sol), and an optional
`--reasoning <low|medium|high>`.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "<prompt>" [--model <id>] [--reasoning <low|medium|high>]
```

- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize,
  or add commentary before or after it (HARRY.md §6).
- If `status` is `failed`, surface the message and stop.

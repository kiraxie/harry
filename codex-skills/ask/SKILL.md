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
  or add commentary before or after it (HARRY.md §6) — but only once you've
  confirmed the run succeeded (next bullet). `ask` has no JSON mode and no
  `status` field to check; its output is plain markdown either way.
- Failure signals: a non-zero exit, a `# Ask Failed` first line of stdout, or a
  `Fatal error: <message>` line on stderr. If you see any of these, report the
  failure and stop; never present that stdout body as the model's answer.

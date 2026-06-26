---
description: Retrieve the output of a completed background Copilot job. Defaults to the latest finished job; pass a job-id to fetch a specific one.
argument-hint: '[job-id]'
allowed-tools: Bash(node:*)
---

Get a background job's result. Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/copilot-companion.cjs" result $ARGUMENTS
```

The stdout is the stored JSON envelope from the background job. Parse it and give the user a short human summary — do NOT paste the raw JSON, it is noisy and the host already shows it collapsed.

- Successful job → branch name, files modified, lines added/removed, quota remaining, and the `summary`.
- Failed job → the `error` and the branch (if any) so partial work can be salvaged.

Do not invent fields the envelope does not contain (HARRY.md §6); report only what `result` actually returned.

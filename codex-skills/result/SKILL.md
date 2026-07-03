---
name: result
description: Retrieve the output of a completed background review/fix job from harry's companion runtime. Use when the user asks for the result of a background job, optionally by job-id.
---

# Result

Get a background job's result. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" result [job-id]
```

The stdout is the stored JSON envelope from the background job. Parse it and give
the user a short human summary — do NOT paste the raw JSON, it is noisy.

- Successful job → branch name, files modified, lines added/removed, and the
  `summary`.
- Failed job → the `error` and the branch (if any) so partial work can be salvaged.

Do not invent fields the envelope does not contain (HARRY.md §6); report only what
`result` actually returned.

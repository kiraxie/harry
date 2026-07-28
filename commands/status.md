---
description: Show harry's Codex rate-limit snapshot — quota usage and reset windows, as of the last ask/review/fix run.
allowed-tools: Bash(node:*)
---

Show harry's runtime snapshot: the Codex quota state.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" status
```

The quota shown is a cached snapshot — refreshed after every ask/review/fix run — with its age labelled in the header.

Return the stdout **verbatim** in your text response so the user does not have to expand the collapsed tool-output block (HARRY.md §6). Do not paraphrase or summarize it.

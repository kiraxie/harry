---
name: status
description: Show harry's Codex rate-limit snapshot — quota usage and reset windows — via the companion runtime. Use when the user asks about harry's quota or how much Codex budget is left.
---

# Status

Show harry's runtime snapshot: the Codex quota state.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" status
```

The quota shown is a cached snapshot — refreshed after every ask/review/fix run —
with its age labelled in the header.

Return the stdout **verbatim** in the response. Do not paraphrase or summarize it.

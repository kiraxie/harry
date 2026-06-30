---
description: Show harry's quota snapshot + background-job status. Optionally pass a job-id for details, or --all for jobs from every session.
argument-hint: '[job-id] [--all]'
allowed-tools: Bash(node:*)
---

Show harry's runtime snapshot: quota and background jobs.

Raw slash-command arguments:
`$ARGUMENTS`

Run the runtime subcommand and return its stdout **verbatim** in your text response so the user does not have to expand the collapsed tool-output block (HARRY.md §6). A `job-id` shows that job's detail; `--all` shows jobs from every session.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" status $ARGUMENTS
```

The quota shown is a cached snapshot — refreshed at each session start (the SessionStart hook) and after every ask/review/fix run — with its age labelled in the header.

Return the output verbatim. Then, only if something is worth flagging, append at most one short line:
- If premium quota is near exhaustion — harry's fallback threshold is **< 5% remaining** (a percentage of entitlement, not an absolute count) — note that delegation will fall back off Copilot.
- If there is a failed background job the user may not have noticed, flag it in one line.

Do not paraphrase or summarize the runtime output itself; only the appended note is yours.

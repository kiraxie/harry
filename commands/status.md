---
description: Check Copilot auth + available models + quota snapshot + background-job status. Merges setup and status into one. Optionally pass a job-id for details, or --all for jobs from every session.
argument-hint: '[job-id] [--all]'
allowed-tools: Bash(node:*)
---

Show the full harry/Copilot health snapshot: authentication, available models, quota, and background jobs. This command merges what upstream split across `setup` and `status`.

Raw slash-command arguments:
`$ARGUMENTS`

Run both runtime subcommands and return their stdout **verbatim** in your text response so the user does not have to expand the collapsed tool-output blocks (HARRY.md §6).

Step 1 — auth + available models + quota (the `setup` check):
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" setup
```

Step 2 — quota plus background-job status (forward `$ARGUMENTS`; a `job-id` shows that job's detail, `--all` shows jobs from every session):
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" status $ARGUMENTS
```

Return both outputs verbatim, labeled. Then, only if something is worth flagging, append at most one short line:
- If authentication is missing, tell the user to run `gh auth login` and confirm an active GitHub Copilot subscription.
- If premium quota is near exhaustion — harry's fallback threshold is **< 5% remaining** (a percentage of entitlement, not an absolute count) — note that delegation will fall back off Copilot.
- If there is a failed background job the user may not have noticed, flag it in one line.

Do not paraphrase or summarize the runtime output itself; only the appended note is yours.

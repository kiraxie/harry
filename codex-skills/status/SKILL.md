---
name: status
description: Show harry's quota snapshot and background-job status via the companion runtime. Use when the user asks about harry's quota, background review/fix jobs, or job status.
---

# Status

Show harry's runtime snapshot: quota and background jobs.

Run the runtime subcommand and return its stdout **verbatim** in the response.
An optional `job-id` shows that job's detail; an optional `--all` shows jobs from
every session.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" status [job-id] [--all]
```

The quota shown is a cached snapshot — refreshed at each session start (the
SessionStart hook) and after every ask/review/fix run — with its age labelled in
the header.

Return the output verbatim. Then, only if something is worth flagging, append at
most one short line: if there is a failed background job the user may not have
noticed, flag it in one line. Do not paraphrase or summarize the runtime output
itself; only the appended note is yours.

---
description: Add harry's required ignore entries (.local/, .worktrees/, CLAUDE.local.md) to this project's .gitignore. Idempotent and marker-wrapped; pass --remove to strip them.
argument-hint: '[--remove] [targetDir]'
allowed-tools: Bash(node:*)
---

Run harry's gitignore initializer through the plugin runtime.

Raw slash-command arguments: `$ARGUMENTS`

Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $ARGUMENTS
```

What it does:

- Appends a marker-wrapped block (`# >>> harry >>>` … `# <<< harry <<<`) to the target project's `.gitignore` listing the paths harry keeps out of version control: `.local/` (specs, plans, ledger scratch), `.worktrees/` (worktree sandboxes), and `CLAUDE.local.md` (the user's per-project memos / task list / status).
- Idempotent — re-running replaces the block in place rather than duplicating it.
- `--remove` strips the block cleanly, leaving the rest of `.gitignore` untouched.

Return the command output verbatim. Do not edit `.gitignore` by hand — the script owns that block.

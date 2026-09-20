---
description: Re-judge deferred decisions and open backlog items (DEBT: markers, item deferrals, backlog entries) into one triaged ledger with a freshness verdict per row.
argument-hint: '[path...]'
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git grep:*)
---

Optional `$ARGUMENTS` scopes the scan to the given path(s); default is the whole repo.

## The procedure lives in a shared file

The full debt-ledger procedure is shared with the Codex build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/debt-audit.md`**. It covers what this command is
and is not, how the deferral sources reconcile into one view, how each row's
freshness is judged, and what the triaged ledger looks like.

**Read that file now and follow it.** It carries the build divergences under explicit
**Claude Code build:** / **Codex build:** labels; wherever it names the Claude Code
build, that is you. The invocation surface for this build is `$ARGUMENTS` above, and
this command's `allowed-tools` frontmatter is the tool universe you operate within.

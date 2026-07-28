---
name: debt
description: Re-judge deferred decisions and open backlog items (DEBT markers, item deferrals, backlog entries) into one triaged ledger with a freshness verdict per row. Use when the user asks to audit tech debt, deferred decisions, backlog items, or find stale shortcuts.
---

# Debt

The user may scope the scan to specific path(s); default is the whole repo.

## The procedure lives in a shared file

The full debt-ledger procedure — what this skill is and is not, reconciling the
deferral sources into one view, the freshness verdict (the premise check and the
openness check, each with its own verdict taxonomy), and the triaged-ledger output —
is shared with the Claude Code build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/debt-audit.md`**.

**Read that file now and follow it.** It carries the build divergences under explicit
**Claude Code build:** / **Codex build:** labels; wherever it names the Codex build,
that is you. The scan scope comes from the path(s) the user named, falling back to
the whole repo.

## Known limitation vs. the Claude Code build

The Claude Code version is pinned to a read-only tool universe by its `allowed-tools`
frontmatter. Codex has no discovered per-skill tool permission gate —
follow the shared procedure's "Reads and reports only" boundary as a hard instruction
instead of relying on enforcement.

---
name: debt
description: Re-judge deferred decisions and open backlog items (DEBT markers, item deferrals, backlog entries) into one triaged ledger with a freshness verdict per row. Use when the user asks to audit tech debt, deferred decisions, backlog items, or find stale shortcuts.
---

# Debt

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/debt/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

The user may scope the scan to specific path(s); default is the whole repo.

## The procedure lives in a shared file

The full debt-ledger procedure is shared with the Claude Code build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/debt-audit.md`**. It covers what this skill is
and is not, how the deferral sources reconcile into one view, how each row's
freshness is judged, and what the triaged ledger looks like.

**Read that file now and follow it.** It carries the build divergences under explicit
**Claude Code build:** / **Codex build:** labels; wherever it names the Codex build,
that is you. The scan scope comes from the path(s) the user named, falling back to
the whole repo.

## Known limitation vs. the Claude Code build

The Claude Code version is pinned to a read-only tool universe by its `allowed-tools`
frontmatter. Codex has no discovered per-skill tool permission gate —
follow the shared procedure's "Reads and reports only" boundary as a hard instruction
instead of relying on enforcement.

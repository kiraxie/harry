---
name: sync
description: Set up or resync harry for Codex CLI here — wire the resident laws into ~/.codex/AGENTS.md, add the .gitignore block, and offer to migrate legacy spec/plan docs. Use when the user asks to initialize, set up, or resync harry in a project under Codex CLI (e.g. after HARRY.md changes).
---

# Sync (Codex)

## Phase 1 — Resident laws

Wire harry's resident laws (`HARRY.md`, which ships with the plugin) into Codex's
global instructions file so they apply every session. **Skip this phase if the user
is uninstalling (`--remove`)** — laws are global/per-machine, so a per-project
uninstall must NOT unwire them. (To unwire laws explicitly, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.mjs" --remove`.)

Otherwise execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.mjs"
```

It inlines HARRY.md's content into a marker-wrapped block in `~/.codex/AGENTS.md`
(idempotent — re-running in another project is a harmless no-op; it also warns
about stale global entries harry supersedes).

**Snapshot semantics (shared with the Claude Code build):** this embeds
HARRY.md's content as of the moment `/sync` ran — a snapshot, not a live
reference. The Claude Code build now works the same way: it deploys a HARRY.md
snapshot and `@`-imports that copy, rather than the live plugin checkout. The only
difference is form — Codex inlines the content (no `@`-import syntax), Claude Code
`@`-imports a deployed copy — but both require a re-run to resync after HARRY.md
changes. If HARRY.md is updated later, re-run this to resync. Say this explicitly
to the user after running it, not just in this doc.

Return the command output verbatim.

## Phase 2 — Gitignore

Run harry's gitignore initializer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" [--remove] [--force] [targetDir]
```

## Phases 2–3 — the shared workflow

What that command does, and the whole of **Phase 3 — Legacy migration**, are shared
with the Claude Code build and live in
**`${CLAUDE_PLUGIN_ROOT}/references/sync-migration.md`**.

**Read that file now and follow it.** It carries the build divergences under explicit
**Claude Code build:** / **Codex build:** labels; wherever it names the Codex build,
that is you. The invocation surface for this build is what the user said — whether
they are uninstalling, whether this is a forced re-run, and which directory to target
(falling back to the current working directory).

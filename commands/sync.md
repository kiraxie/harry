---
description: Set up or resync harry here — wire the resident laws into your global instructions, add the .gitignore block, and offer to migrate legacy spec/plan docs. Re-run after updating the plugin or editing HARRY.md to resync. --remove strips this project's .gitignore block (laws stay).
argument-hint: '[--remove] [--force] [targetDir]'
allowed-tools: Bash(node:*), Bash(git log:*), Glob, Grep, Read, Write, Edit, AskUserQuestion
---

Raw slash-command arguments: `$ARGUMENTS`

## Phase 1 — Resident laws

Wire harry's resident laws (`HARRY.md`, which ships with the plugin) into your
global instructions file so they apply every session. **Skip this phase when
`$ARGUMENTS` contains `--remove`** — laws are global/per-machine, so a per-project
`/sync --remove` must NOT unwire them. (To unwire laws explicitly, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --remove` — that also removes the
optional Explore override below.)

Otherwise:

1. **Ask (AskUserQuestion) whether to also install the Explore override.** It's a
   user-level `~/.claude/agents/Explore.md` that shadows the built-in Explore so
   *auto-invoked* recon runs on a cheap model (haiku) instead of inheriting your
   main-session model — the same routing philosophy as the `scout` role, applied to
   the search path Claude Code triggers on its own. It is **opt-in** because it
   overrides a built-in agent globally (and a custom Explore loads your user memory,
   which the built-in skips). Recommend yes for anyone routing recon through harry.
2. **Run** — add `--explore` only if they opted in:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"            # laws only
# …or, if they opted into the Explore override:
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" --explore  # laws + Explore override
```

It deploys a snapshot of the plugin's current `HARRY.md` to
`~/.claude/harry/HARRY.md` and inserts a marker-wrapped `@~/.claude/harry/HARRY.md`
import into `~/.claude/CLAUDE.md` (idempotent — re-running in another project is a
harmless no-op; it also warns about stale global entries harry supersedes). With
`--explore` it additionally writes `~/.claude/agents/Explore.md` (a marked file
`--remove` can safely strip). This is a **snapshot**, not a live reference to the
plugin checkout: after the plugin is updated (or `HARRY.md` is edited), re-run this
to re-deploy and resync — same resync model as the Codex build. Return its output
verbatim.

## Phase 2 — Gitignore

Run harry's gitignore initializer through the plugin runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $ARGUMENTS
```

## Phases 2–3 — the shared workflow

What that command does, and the whole of **Phase 3 — Legacy migration**, are shared
with the Codex build and live in
**`${CLAUDE_PLUGIN_ROOT}/references/sync-migration.md`**.

**Read that file now and follow it.** It carries the build divergences under explicit
**Claude Code build:** / **Codex build:** labels; wherever it names the Claude Code
build, that is you. The invocation surface for this build is `$ARGUMENTS` above
(`--remove`, `--force`, an optional target dir), and this command's `allowed-tools`
frontmatter is the tool universe you operate within.


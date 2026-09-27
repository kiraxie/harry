---
name: upgrade-deps
description: Upgrade every dependency of the current repo to its latest stable release — the package manager and CI setup actions included — verify, and land it through the merge-vs-PR ask. pnpm/Node, Go and Python (uv). Use when the user asks to upgrade or bump dependencies, clear Dependabot alerts, or refresh CI action versions.
---

# Upgrade dependencies

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/upgrade-deps/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

## The procedure lives in a shared file

The full upgrade procedure is shared with the Claude Code build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/upgrade-deps.md`**. It covers reading the
toolchain, bumping, handling majors, verifying, Dependabot alerts and landing.

**Read that file now and follow it** for the current repo.

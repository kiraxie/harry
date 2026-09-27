---
name: release
description: Cut a release — bump the version fields the repo declares, add a CHANGELOG entry, verify and commit before the merge, then tag and push after it. Works for tag-only repos too. Use when the user asks to release, cut or tag a version.
---

# Release

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/release/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `scripts/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

The user names the version (strict `x.y.z`, no leading `v`).

## The procedure lives in a shared file

The full release procedure is shared with the Claude Code build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/release.md`**. It covers what the repo declares,
how the state is classified, and the two phases on either side of the merge.

**Read that file now and follow it**, taking the version from the user's request.

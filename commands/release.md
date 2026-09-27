---
description: Cut a release — bump the version fields the repo declares, add a CHANGELOG entry, verify and commit before the merge, then tag and push after it. Works for tag-only repos too; resumable across the merge.
argument-hint: '<version>'
---

Raw slash-command arguments: `$ARGUMENTS` — a single required `<version>` (strict
`x.y.z`, no leading `v`).

## The procedure lives in a shared file

The full release procedure is shared with the Codex build and lives in
**`${CLAUDE_PLUGIN_ROOT}/references/release.md`**. It covers what the repo declares,
how the state is classified, and the two phases on either side of the merge.

**Read that file now and follow it**, taking the version from `$ARGUMENTS`.

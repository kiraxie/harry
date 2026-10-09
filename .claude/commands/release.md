---
description: Cut a harry release — bump the version fields CLAUDE.md declares, add a CHANGELOG entry, verify and commit before the merge, then tag and push after it. Repo-local; resumable across the merge.
argument-hint: '<version>'
---

# `/release` — cut a harry release

Raw slash-command arguments: `$ARGUMENTS` — a single required `<version>` (strict
`x.y.z`, no leading `v`).

A release has two phases because the tag must land on the commit that is on the
default branch, and with squash merges (`skills/finishing/SKILL.md`) that commit exists only after
the merge. **Phase A** bumps and commits on a branch; **Phase B** tags the merged
result. A repo with nothing to bump skips Phase A and only tags.

The version is strict `x.y.z` with no leading `v`; tags are `v<version>`. Missing or
malformed → ask for it before doing anything else.

**Sync first**, before anything below reads a tag, a commit or a field. Every later
step reads this state, and a tag fetched after the classification could turn the new
version into a downgrade.

1. **Note where you start**: the branch (`git branch --show-current`, empty on a
   detached HEAD) and the commit (`git rev-parse HEAD`). The state section uses both.
2. **Clean tree.** `git status --porcelain` must be empty. Otherwise stop and ask:
   uncommitted changes would follow you onto the release branch and into its checks.
3. **Sync.** Switch to the default branch. When a remote exists, `git pull` and
   `git fetch --tags origin`. If either fails, stop and report it.

## What the repo declares

Read the `## Cutting a release` section of the repo's root `CLAUDE.md`, fresh every
run. It names up to four things:

- **Version fields** — each file that holds the version, and where inside it when that
  is not obvious (a nested JSON key).
- **Build** — a command to run after the bump, and the generated files it changes
  that belong in the release commit.
- **CHANGELOG** — its path.
- **Verify** — the commands that must pass before the release commit and before the
  tag.

Each entry the section leaves out takes its own default: **Version fields** → none;
**Build** → none; **CHANGELOG** → the root `CHANGELOG.md` if one exists, otherwise
none; **Verify** → the fallback in **The checks** below. No section at all means
every entry is left out. A repo with no fields, no build and no
CHANGELOG is **tag-only**.

**The checks** that Phase A and Phase B run come from the first of these that exists:
the **Verify** entry; the test, typecheck and lint commands the repo's `CLAUDE.md`
names; otherwise ask the user which commands to run, and do not guess.

## Classify the state

Run, from the repo root, with one `--field` per declared field file and the commit
you started on:

```
node .claude/scripts/release-state.mts <version> [--field <path>]... --start <starting-commit>
```

It reads the repo's real state (tags, the bump commit on the default branch and in
the starting commit's history, the declared fields) — never guess which phase you are
in. A non-zero exit is an environment or git problem, not a version problem: report
its stderr and stop. On exit 0 it prints one state:

- `already-tagged` — this version is already released. Report it and stop.
- `invalid-version` — the version is not `x.y.z`. Ask for a corrected one.
- `invalid-target` — the version is at or behind the latest tag and has no tag of its
  own, even when an old bump commit for it exists. A later version is already
  tagged, so tagging this one would release it out of order. Ask for a corrected one;
  never proceed as if it were new.
- `waiting-for-merge` — the bump commit is in the starting commit's history but not
  on the default branch: the release was cut and is waiting for its merge. Switch
  back to where you started, say so, and stop; do not start it again. After the
  merge, a re-run reads `bumped-not-tagged`. A declared field that already holds
  this version outranks it: that reads `version-mismatch-untracked`.
- `version-mismatch-untracked` — a declared field already holds this version but no
  bump commit is reachable: someone changed it outside this flow, or a release
  branch was merged under a subject other than the bump subject. The check
  matches the version as a whole token, so a dependency pinned at exactly the same
  version also trips it. **Stop and ask the user how to proceed.**
- `not-bumped` → **Phase A**; for a tag-only repo, straight to **Phase B**.
- `bumped-not-tagged` → **Phase B**.

**Check for an undeclared field** before entering Phase A or Phase B; every other
state has stopped by now. Take the latest tag's version from the state script,
`node .claude/scripts/release-state.mts latest-tag` (it prints `none` when there is
no tag yet), and list the tracked files that contain it as a whole version:
`git grep -lE '(^|[^0-9.])<latest>($|[^0-9.])'`. In this pattern and in every
other version pattern below, write each dot of the version as `\.`. The boundary is
the state script's own: no digit or dot on either side, so `v0.22.0` counts and
`10.22.0` does not. Show the user every listed file the section
does not declare, leaving out the CHANGELOG, and ask them to confirm none of those
holds the repo's version. If one does, stop: it goes into the section first, or it
would be released with the old version in it. No tag yet → skip this check.

## Phase A — bump, verify, commit (before the merge)

**Branch first.** Never commit the release on the default branch (HARRY.md **Ask first**): cut a
fresh branch from it (already synced above), holding nothing but the release
commit. The squash in step 6 lands everything on the branch under the release
subject, so other work on it would be released under that name.

The one exception: the user asks to commit the release on the default branch itself.
Then ask for consent before doing so. Phase B needs the default branch; say so if it
comes up.

1. **CHANGELOG**, when there is one. List what is landing with
   `git log v<latest>..HEAD --oneline` (the whole history when there is no tag yet).
   Draft a `## [<version>] - <YYYY-MM-DD>` entry in the file's existing style, show it,
   and **wait for approval or edits before writing it**.
2. **Fields.** The current version is the latest tag's version (`latest-tag`; with
   no tag yet, the version the field holds now). For each declared field, count the
   lines holding it as a whole version first:
   `grep -cE '(^|[^0-9.])<current>($|[^0-9.])' <file>`. Replace it only when the count
   is **exactly 1**; any other count means a plain replace would also touch something
   else (a dependency range, a history note), so stop and resolve that file by hand.
3. **Build**, when one is declared.
4. **Verify** with the checks (see **The checks** above). Any failure → stop, do not
   commit, report it.
5. **Commit** exactly the CHANGELOG, the field files and the build's generated files,
   as `chore(release): bump version to <version>`.
6. **Hand off** to the finishing skill for merge-vs-PR (HARRY.md **Ask first** — always ask).
   The state script finds Phase B by step 5's subject on the default branch, and a
   squash rewrites the subject, so a release overrides finishing's usual wording:
   - **Local merge:** the squash commit's subject is exactly that subject.
   - **PR:** the PR title and `gh pr merge --squash --subject` are exactly that
     subject. A squash merged from GitHub's web page appends ` (#<n>)`, which the
     state script also accepts.

   After the merge, run the release again to reach Phase B.

## Phase B — verify, tag, push (after the merge)

**Guard:** on the default branch, up to date with the remote. Otherwise stop and say
so — the tag must point at a commit the default branch holds.

1. **Re-verify** with the checks (see **The checks** above) on the current head; never
   trust the run from before the merge. A failure means no tag.
2. **Tag:** `git tag -a v<version> -m "v<version>: <one-line summary>"`. The summary
   comes from the CHANGELOG entry, or from the commits since the last tag when there
   is no CHANGELOG.
3. **Ask before pushing** — it is outward-facing. On approval:
   `git push origin <default-branch> --follow-tags`, which sends the branch and the
   new annotated tag together, never a tag for a commit the remote lacks.
4. **Report:** `node .claude/scripts/release-state.mts latest-tag` now prints
   `<version>`. If CI runs on tags, watch that run to completion and report it.

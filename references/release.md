# Release — shared procedure

The `/release` procedure used by **both** builds: `commands/release.md` (Claude Code)
and `codex-skills/release/SKILL.md` (Codex CLI). Each of those files keeps only its
own shell — frontmatter, title, and where the version comes from — and points here
for everything below.

A release has two phases because the tag must land on the commit that is on the
default branch, and with squash merges (HARRY.md §5) that commit exists only after
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

**Check for an undeclared field.** Before classifying, take the latest tag's version
— the highest strict `v<x.y.z>` tag, the rule the state script uses:
`git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1` —
and list the tracked files that contain it as a whole version:
`git grep -lE '(^|[^0-9.])<latest>($|[^0-9.])'`. In this pattern and in every
other version pattern below, write each dot of the version as `\.`. The boundary is
the state script's own: no digit or dot on either side, so `v0.22.0` counts and
`10.22.0` does not. Show the user every listed file the section
does not declare, leaving out the CHANGELOG, and ask them to confirm none of those
holds the repo's version. If one does, stop: it goes into the section first, or it
would be released with the old version in it. No tag yet → skip this check.

## Classify the state

Run, from the repo root, with one `--field` per declared field file:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/release-state.mjs" <version> [--field <path>]...
```

It reads the repo's real state (tags, the bump commit, the declared fields) — never
guess which phase you are in. A non-zero exit is an environment or git problem, not a
version problem: report its stderr and stop. On exit 0 it prints one state:

- `already-tagged` — this version is already released. Report it and stop.
- `invalid-version` — the version is not `x.y.z`. Ask for a corrected one.
- `invalid-target` — the version is at or behind the latest tag and has no tag of its
  own, even when an old bump commit for it exists. A later version is already
  tagged, so tagging this one would release it out of order. Ask for a corrected one;
  never proceed as if it were new.
- `version-mismatch-untracked` — a declared field already holds this version but no
  bump commit is reachable, so someone changed it outside this flow. The check
  matches the version as a whole token, so a dependency pinned at exactly the same
  version also trips it. **Stop and ask the user how to proceed.**
- `not-bumped` → first check whether this release is **waiting for its merge**: you
  did not start on the default branch, and the starting commit's history holds the
  bump subject:
  `git log <starting-commit> --format=%s | grep -E '^chore\(release\): bump version to <version>( \(#[0-9]+\))?$'`.
  - If so, switch back to where you started, say the release is waiting for its
    merge, and stop; do not start it again.
  - Otherwise → **Phase A**; for a tag-only repo, straight to **Phase B**.

  After the merge the bump is on the default branch, so a re-run from the kept
  branch reads `bumped-not-tagged` instead.
- `bumped-not-tagged` → **Phase B**.

## Phase A — bump, verify, commit (before the merge)

**Branch first.** Never commit the release on the default branch (HARRY.md §5): cut a
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
2. **Fields.** The current version is the latest tag's version (with no tag yet, the
   version the field holds now). For each declared field, count the lines holding it
   as a whole version first: `grep -cE '(^|[^0-9.])<current>($|[^0-9.])' <file>`.
   Replace it only when the count is
   **exactly 1**; any other count means a plain replace would also touch something
   else (a dependency range, a history note), so stop and resolve that file by hand.
3. **Build**, when one is declared.
4. **Verify** with the checks (see **The checks** above). Any failure → stop, do not
   commit, report it.
5. **Commit** exactly the CHANGELOG, the field files and the build's generated files,
   as `chore(release): bump version to <version>`.
6. **Hand off** to the finishing skill for merge-vs-PR (HARRY.md §5 — always ask).
   The state script finds Phase B by the subject
   `chore(release): bump version to <version>` on the default branch, and a squash
   rewrites the subject, so a release overrides finishing's usual wording:
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
4. **Report:** `git tag --sort=-v:refname | head -1` now reads `v<version>`. If CI
   runs on tags, watch that run to completion and report it.

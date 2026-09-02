---
description: Cut a harry release — bump the four version fields, add a CHANGELOG entry, rebuild dist, verify, commit, then (after the merge lands on main) tag and push. Repo-local; resumable across the merge boundary.
argument-hint: '<version>'
allowed-tools: Bash(node:*), Bash(git:*), Bash(pnpm:*), Bash(sed:*), Read, Edit, AskUserQuestion
---

# `/release` — cut a harry release

Raw slash-command arguments: `$ARGUMENTS` — a single required `<version>` (e.g. `0.21.0`,
strict `x.y.z`, no leading `v`). Missing or malformed → ask for it before doing anything else.

This command is **repo-local** (`.claude/commands/release.md`, not shipped in the plugin's
`commands/`) — it classifies against this repo's own four hand-maintained version fields,
which no consumer of the harry plugin has. It is **resumable**: this repo's tags land on
the *merge* commit, not the version-bump commit (verified against v0.17.0–v0.19.0's actual
history), so a full release normally spans two invocations — one before the merge, one after.

## Step 0 — Classify state

Run:

```
node .claude/scripts/release-state.mjs <version>
```

This reads real repo state (package.json version, `git tag`, `git log --grep` for the bump
commit) — never assume which phase you're in. Branch on its exact stdout line (see
`.claude/scripts/release-state.d.mts` for the full contract):

- **`already-tagged`** — this version is already released. Report it and stop.
- **`invalid-version`** — the CLI already printed why to stderr (exit 1). Report it, ask
  for a corrected `<version>`.
- **`invalid-target`** — `<version>` is behind or equal to the current `package.json`
  version, with no matching tag or bump commit. Report it, ask for a corrected `<version>`
  — never proceed as if it were a fresh bump.
- **`version-mismatch-untracked`** — `package.json` already reads `<version>`, but no
  `chore(release): bump version to <version>` commit is reachable from HEAD. Someone
  edited the version outside this flow. **Stop and ask the user how to proceed** — do not
  guess whether it's safe to keep going.
- **`not-bumped`** → go to **Phase A**.
- **`bumped-not-tagged`** → go to **Phase B**.

## Phase A — bump, verify, commit (pre-merge)

**Guard:** if the current branch is `main` or `master`, refuse and ask for explicit
consent before continuing (HARRY.md §5 — never touch the main checkout's main without
consent). This is the opposite of Phase B's requirement below; state that plainly if it
comes up, don't leave it implicit.

1. **Draft the CHANGELOG entry.** Run `git log <last-tag>..HEAD --oneline` (last tag =
   `git describe --tags --abbrev=0`) to see what's landing. Draft a `## [<version>] -
   <today>` entry in this repo's existing Keep-a-Changelog style (see the entries already
   in `CHANGELOG.md` for grouping conventions — `### Added` / `### Fixed` / etc.). **Present
   the draft and wait for approval or edits before writing it** — never insert an
   unreviewed entry.
2. **Bump the four fields.** The authoritative list is CLAUDE.md's "Cutting a release"
   paragraph — read it fresh rather than trusting a cached copy of the four paths, so a
   future fifth field is not silently missed here. For each file, `grep -c` the current
   version string in that file first and confirm it is **exactly 1** before replacing with
   `sed` — a count other than 1 means the naive string match would touch something it
   shouldn't (e.g. a dependency version range); stop and resolve by hand instead of forcing
   the replace.
3. **Rebuild:** `pnpm run build` (repo has no build step for consumers, but `dist/`
   is committed and inlines `package.json` — CI's drift gate fails without this).
4. **Verify:** `pnpm test && pnpm run typecheck && pnpm run lint`. Any non-zero exit →
   stop, do **not** commit, report the failure.
5. **Commit:** `git add` exactly the CHANGELOG + four version files + `dist/companion.cjs`,
   then commit `chore(release): bump version to <version>` (plus this session's standard
   attribution footer).
6. **Hand off — do not merge here.** Point at HARRY.md §5's merge-vs-PR law (always ask
   which) and the `finishing` skill; this command does not restate that menu or make the
   choice itself. After the merge lands on `main`, re-run `/release <version>` to reach
   Phase B.

## Phase B — verify, tag, push (post-merge)

**Guard:** requires the current branch to be `main` — this is a hard requirement, not a
default like Phase A's (tags must point at the commit that's actually on the base branch).
If not on `main`, stop and say so.

1. **Re-verify — never trust the merge-time run.** Run `pnpm test && pnpm run typecheck &&
   pnpm run lint` on the current `main` HEAD. If anything further landed on `main` since
   the bump merged, this catches it; a failure here means **do not tag** — report and stop.
2. **Tag:** `git tag -a v<version> -m "v<version>: <one-line summary from the CHANGELOG
   entry>"`.
3. **Ask before pushing** (outward-facing, needs explicit consent — same rule `finishing`
   applies to a local-only merge). On approval:

   ```
   git push origin main --follow-tags
   ```

   Not "push the tag alone" — `--follow-tags` pushes `main`'s new commits together with
   any annotated tags reachable from what's being pushed that are missing on `origin`
   (verified via `git help push`; confirmed against this repo that it picks up exactly the
   newly-created tag, not a sweep of every historical tag). Pushing the tag without the
   branch would point a remote ref at a commit the remote doesn't have yet.
4. Report the result: `git tag --sort=-v:refname | head -1` should now read `v<version>`.

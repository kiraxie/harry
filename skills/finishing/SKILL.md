---
name: finishing
description: "Use when implementation is complete and you need to integrate or wind down the work — deciding between merge, PR, keeping the branch, or discarding. Triggers at the end of any executing flow, before the branch/worktree is left behind."
---

# Finishing a Development Branch

Wind down completed work cleanly: verify it's green, ask how to integrate, then carry the chosen path all the way through. This is a procedure governed by the Harry laws (HARRY.md); when they conflict, the laws win.

## 1. Verify tests first — never finish on red

Run the project's suite before anything else. Read the output (exit code, failure count) — an unread "pass" is not evidence (HARRY.md §6).

If anything fails: STOP. Report the failures and do not proceed to the menu. There is no merge, no PR, no archive on red.

## 2. Ask: merge or PR? — ALWAYS ask

Never auto-decide (HARRY.md §5). Present exactly these options and wait:

```
Implementation complete and tests green. How should I integrate this?

1. Merge back to <base> locally
2. Push and open a Pull Request
3. Keep the branch as-is (I'll handle it later)
```

(Detached HEAD / externally-managed workspace: drop option 1 — merge isn't yours to make.)

Discard is **not offered** — it exists only as a response to the user's explicit request (see Discard below). Proactively offering to delete work nudges toward destruction; the user can always ask.

**Pre-decided integration path.** If the user already chose the path (e.g. "commit & merge", "just open the PR"), skip the menu — do NOT re-ask. But a pre-decided path is NOT a shortcut past finishing: still run the §1 verify gate first, then the FULL tail of the chosen option (for merge, every step a–h below). A bare `git merge` that stops at the merge skips the wind-down and is a §6 violation.

## 3. Execute the choice

### Option 1 — Merge (do all of this, in order; don't stop at the merge)

**Confirm `<base>` first.** The base is whatever the work forked from (the item, the conversation, or the branch's upstream/fork point) — if it isn't already known, ask before merging; merging into the wrong base is expensive to undo, and "the base is obviously main" is exactly how it happens.

The merge is the start of finishing, not the end. Completion evidence is CI green when the work was pushed, or the merged-result suite (step a) when the merge is local-only (HARRY.md §6).

a. **Verify the merged result — before anything else in the tail.** Run the full local suite on `<base>` now. Green → continue. Red → STOP: leave the branch AND worktree in place and investigate — nothing has been pushed, the merge is local and recoverable, and "the failure is probably flaky" is not a reason to destroy the debugging workspace.
b. **Memory** — append ONE line for this unit to `.local/HISTORY.md` (create if absent, newest first): `- YYYY-MM-DD · <topic> · <squash SHA> · PR #<n> (or "local merge, no PR") · <one-line outcome>` (rotate HISTORY yearly per `references/doc-types.md` — if this is the first entry of a new year, move the prior year's entries to `.local/history/<year>.md` first). Then remove the unit's line from `.local/INDEX.md` `## In flight` so the work list tracks only active work. Do NOT paste review/audit detail or commit lists — that lives in git/PR; `HISTORY.md` is a thin pointer (HARRY.md §5).
c. **Flush Follow-ups** — read the item's `## Follow-ups` section (before moving the file). For each line, create a new `.local/items/<new-slug>.md` with `status: backlog`, a title derived from the line, and a `## Notes` section quoting it; add one `.local/INDEX.md` line per new item. Then clear the source item's `## Follow-ups` section. Non-Goals do NOT get this treatment — only `## Follow-ups` is flushed (`references/doc-types.md`); if a Scope & Non-Goals bullet still needs to survive archiving, that's the author's job to have copied into `## Follow-ups` before now, not finishing's job to catch.
d. **Archive the item** — set the item's frontmatter `status: done` and move `.local/items/<slug>.md` → `.local/archive/<slug>.md` (content otherwise unchanged). Archive is **read-only** from here on — never edit it again; extending the idea later means opening a new `.local/items/` item that links back to this archive path (`references/doc-types.md`).
e. **Milestone membership** — if the item's frontmatter has `milestone: <slug>`, open that milestone item (`.local/items/<slug>.md`) and move this item's link from its `## Members` to its `## Delivered` section. If `## Members` is now empty (this was the last one), archive the milestone itself right here, same as step d: `status: done`, move it to `.local/archive/<slug>.md`.
f. **Cleanup** — record the worktree path BEFORE leaving it (`git rev-parse --show-toplevel`; the fallback below needs the value after you've left). Delete the feature branch and its worktree — prefer the harness's NATIVE worktree tooling; only as fallback: `cd` to the main repo root first, then `git worktree remove <recorded-path>` and `git worktree prune`. Provenance rule: only clean up worktrees YOU created — never remove harness-owned ones. Also delete this unit's `.local/tmp/<branch>/` (briefs/reports/diffs are transient; orphaned per-branch dirs otherwise accumulate in the main checkout forever) — never touch sibling branches' dirs.
g. **Back on `<base>`** — end on `<base>`, up to date (`git checkout <base>`, `git pull` when a remote exists).
h. **Completion evidence.** CI triggers on push, not on a local merge — so the evidence depends on where the merge landed:
   - **Pushed (or a PR merged):** watch the CI run to completion and report green or red. If red, handle it — do NOT claim done at the merge moment.
   - **Local-only merge:** CI will NOT run. Step a's merged-result suite IS the completion evidence (already run and read). Offer to push (outward-facing — needs the user's consent; don't push unasked).

### Option 2 — PR (HARRY.md §5 PR discipline)

- Draft the title + body, show it for approval BEFORE `gh pr create` (unless the user said "just open it"). Body must not leak internal planning language (no Sprint/Phase, `.local/` paths, "per the plan").
- Push the branch and open the PR. From a detached HEAD, publish with `git push origin HEAD:refs/heads/<new-branch>`.
- Before merging a PR — even when not asked — check its reviews, inline comments, and CodeRabbit status. Any unresolved actionable item → report and do NOT merge (unless the user says "force merge").
- Keep the worktree alive — the user needs it to iterate on feedback.
- **A PR-integrated unit is NOT finished at `gh pr create`.** Annotate the unit's `.local/INDEX.md` `## In flight` line with the PR number while it's open (e.g. `… · PR #12 open`) so the list stays truthful.
- **On merge** — whether in this session or a later one, and whether you merged it or a human clicked merge on GitHub — finishing resumes: run Option 1's full tail a–h, EXCEPT the merge itself (already done). Evidence step h uses the CI run the push/PR already triggered. If you notice a merged PR whose item is still `status: active`, that's the trigger to run the tail now.

### Option 3 — Keep

Report the branch name and worktree path. Touch nothing.

### Discard — explicit request only (destructive)

Never offered from the menu; run this only when the user asks to discard the work. Show what will be lost (branch, commit list, worktree path), then require a typed `discard` to confirm. On confirmation: `cd` to main root, clean up the worktree (provenance rule), delete `.local/tmp/<branch>/`, then `git branch -D <branch>`.

Then settle the item — never leave it `status: active`. Ask the user which:
- **Back to backlog** — set `status: backlog` and append a one-line `## Notes` entry (`implementation discarded <date>, <reason>`).
- **Delete outright** — remove `.local/items/<slug>.md` (destructive; needs the user's call per HARRY.md's confirmation rule).

Either way, remove the unit's `.local/INDEX.md` `## In flight` line, and update its `## Items` line to match the disposition (delete the entry with a deleted item; flip its status to backlog with a kept one).

## Quick reference

| Option | Tests gate | Merge | Push/PR | Branch | Worktree |
|--------|:--:|:--:|:--:|--------|----------|
| 1. Merge | green required ×2 (branch, then merged result) | yes | — | deleted after merged result is green | removed after merged result is green (native tooling, provenance) |
| 2. PR | green required | — | yes (draft approved first) | kept | **kept** (needed for iteration)¹ |
| 3. Keep | green required | — | — | kept | kept |
| Discard (explicit request only) | n/a | — | — | force-deleted (typed `discard`) | removed |

¹ Not finished at `gh pr create` — on merge (this session or later), run Option 1's tail a–h minus the merge itself.

## Red flags

- Finishing on red, or claiming done at the merge moment instead of after the completion evidence lands (CI green when pushed; the merged-result suite when the merge is local-only).
- Cleaning up — branch or worktree — before the merged-result suite has run green; a red merged result leaves everything in place.
- Merging into an unconfirmed base ("the base is obviously main").
- Offering to discard: discard is response-only, never menu.
- Auto-picking merge vs PR instead of asking.
- `gh pr create` before the body draft is approved; merging a PR with unresolved review/CodeRabbit items.
- Removing a harness-owned worktree, or running `git worktree remove` from inside the worktree.
- Discarding without the typed `discard` confirmation.
- Leaving a merged PR's item at `status: active` or its `.local/INDEX.md` In-flight line stale instead of running the wind-down tail.
- Editing a `.local/archive/` item after it lands there, or reopening it in place instead of linking to it from a new `.local/items/` item (`references/doc-types.md`).

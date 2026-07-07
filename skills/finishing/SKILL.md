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
4. Discard this work
```

(Detached HEAD / externally-managed workspace: drop option 1 — merge isn't yours to make.)

**Pre-decided integration path.** If the user already chose the path (e.g. "commit & merge", "just open the PR"), skip the menu — do NOT re-ask. But a pre-decided path is NOT a shortcut past finishing: still run the §1 verify gate first, then the FULL tail of the chosen option (for merge, every step a–e below). A bare `git merge` that stops at the merge skips the wind-down and is a §6 violation.

## 3. Execute the choice

### Option 1 — Merge (do all of this, in order; don't stop at the merge)

The merge is the start of finishing, not the end. Completion evidence is CI green when the work was pushed, or the full local suite when the merge is local-only (HARRY.md §6).

a. **Memory** — append ONE line for this unit to `.local/HISTORY.md` (create if absent, newest first): `- YYYY-MM-DD · <topic> · <squash SHA> · PR #<n> (or "local merge, no PR") · <one-line outcome>` (rotate HISTORY yearly per `references/doc-types.md` — if this is the first entry of a new year, move the prior year's entries to `.local/history/<year>.md` first). Then remove the unit's line from `.local/INDEX.md` `## In flight` so the work list tracks only active work. Do NOT paste review/audit detail or commit lists — that lives in git/PR; `HISTORY.md` is a thin pointer (HARRY.md §5).
b. **Archive** — move the plan → `.local/plans/archived/`. Leave the spec in `.local/specs/`: it is a long-term, accumulating design record (incl. decisions) and is never archived (HARRY.md §5).
c. **Cleanup** — delete the feature branch and its worktree. Prefer the harness's NATIVE worktree tooling. Only as fallback: `cd` to the main repo root first, then `git worktree remove <path>` and `git worktree prune`. Provenance rule: only clean up worktrees YOU created — never remove harness-owned ones.
d. **Back to main** — `git checkout main && git pull`.
e. **Completion evidence.** CI triggers on push, not on a local merge — so the evidence depends on where the merge landed:
   - **Pushed (or a PR merged):** watch the CI run to completion and report green or red. If red, handle it — do NOT claim done at the merge moment.
   - **Local-only merge:** CI will NOT run. Run the full local suite as the completion evidence, read the output (exit code, failures), then claim. Offer to push (outward-facing — needs the user's consent; don't push unasked).

### Option 2 — PR (HARRY.md §5 PR discipline)

- Draft the title + body, show it for approval BEFORE `gh pr create` (unless the user said "just open it"). Body must not leak internal planning language (no Sprint/Phase, `.local/` paths, "per the plan").
- Push the branch and open the PR.
- Before merging a PR — even when not asked — check its reviews, inline comments, and CodeRabbit status. Any unresolved actionable item → report and do NOT merge (unless the user says "force merge").
- Keep the worktree alive — the user needs it to iterate on feedback.

### Option 3 — Keep

Report the branch name and worktree path. Touch nothing.

### Option 4 — Discard (destructive)

Show what will be lost (branch, commit list, worktree path), then require a typed `discard` to confirm. On confirmation: `cd` to main root, clean up the worktree (provenance rule), then `git branch -D <branch>`.

## Quick reference

| Option | Tests gate | Merge | Push/PR | Branch | Worktree |
|--------|:--:|:--:|:--:|--------|----------|
| 1. Merge | green required | yes | — | deleted after merge | removed (native tooling, provenance) |
| 2. PR | green required | — | yes (draft approved first) | kept | **kept** (needed for iteration) |
| 3. Keep | green required | — | — | kept | kept |
| 4. Discard | n/a | — | — | force-deleted (typed `discard`) | removed |

## Red flags

- Finishing on red, or claiming done at the merge moment instead of after the completion evidence lands (CI green when pushed; the full local suite when the merge is local-only).
- Auto-picking merge vs PR instead of asking.
- `gh pr create` before the body draft is approved; merging a PR with unresolved review/CodeRabbit items.
- Removing a harness-owned worktree, or running `git worktree remove` from inside the worktree.
- Discarding without the typed `discard` confirmation.

---
name: executing
description: Use when you have approved acceptance criteria (or a Trivial task) ready to build and need to turn them into committed, reviewed code.
---

# Executing

Turn approved acceptance criteria into committed, reviewed code. The item's `### Acceptance criteria` is the work list: each AC is an outcome plus its verification, and every review verdict and progress note cites AC IDs. **Executing never edits an AC** — see the pre-flight below. The session does all the writing at every tier (HARRY.md §5); the tier decides the tests and the review.

## Route

```
Trivial   → build, verify, done — no review
Standard  → build, verify, then review with one lane (analyst)
Major     → build test-first, verify, then review with two lanes (analyst + Codex)
```

State the route in one line before starting ("Trivial → no review" / "Standard → one review lane" / "Major → two review lanes"). When in doubt, go higher.

**Re-classify mid-flight.** If scope growth crosses a §3 tier trigger during execution (more files, a new subsystem, a red line surfacing), STOP, re-declare the tier out loud, and adopt the higher tier's remaining gates from that point. Work already done stands — its gates are not re-run retroactively — but the review/TDD gates not yet reached run at the new tier.

## Before you build

1. **Branch.** A fresh branch for the unit, never `main`/`master` without consent, worked in place — one writer needs no worktree. A worktree is for concurrent writers, exactly as HARRY.md §5 lists them; if another writer is already in the main checkout — the user included — isolate instead of branching in place.
2. **Paths.** Every `.local/…` path in this skill means the **MAIN checkout's** store (HARRY.md §5) — a bare relative one written from inside a worktree would create a second store there. Resolve it **inside the same command that uses it**: shell variables do not survive from one tool call to the next, and a subagent's shell never saw yours, so hand subagents the already-resolved absolute path, never the `$STORE` literal.

   ```bash
   STORE="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   ```

   `$STORE/.local/tmp/<branch>` is created by whichever step first writes into it, with its own `mkdir -p`: the first review report (step 3), or finishing step 2's architecture review for a Trivial unit.

   (If the project has no `.local/` at all, set it up or confirm it first — HARRY.md §5.)

3. **Pre-flight AC review** (Standard/Major). Read the item's `### Acceptance criteria` once and scan for AC that is wrong, impossible, ambiguous, a step rather than an outcome, missing its verification, or in conflict with another AC or the item's Constraints — a later AC that names the AC it supersedes is not a conflict (`references/doc-types.md`). **You may not fix any of it yourself** — approved AC text is the user's (`references/doc-types.md`). Present every finding as **one batched question**, each quoted beside the AC it concerns, and ask the user to rule. Clean scan → proceed silently.

   **Legacy items.** An in-flight item whose `## Why / What` has no `### Acceptance criteria` is executed from its `## Plan` steps as written — the plan is the work list, and this pre-flight scan has nothing to scan. Record progress the same way, in `## Progress` (or in the plan's own completion notes when that is what the item already uses). Never retrofit acceptance criteria onto it.
4. **Mark started + track progress in the item** (Standard/Major). Add (or update) this unit's line in `.local/INDEX.md` `## In flight` (`<topic> · <branch> · <started YYYY-MM-DD>`; HARRY.md §5). Progress goes in the item's **`## Progress` section** (create it if absent) — **append-only**, one line per event, each citing the AC IDs it covers and the commit range, so it survives compaction. Never edit approved AC text to record progress.

   **Resuming** — a new session, or the same one after compaction — reads `## Progress`, `git log`, and the files `## Progress` names: an AC with a complete line is done; build from the first AC without one; once every AC is complete, the last review line says where the review stands, and the findings file it names says what is open. A findings file `## Progress` names that is missing → run step 3's review again over the whole branch (`<base>...HEAD`). Trust them over recollection.

## Steps

1. **Build.** Work the AC list in order. Tests by tier (HARRY.md §6): Trivial none, Standard one runnable check, Major red-green with watch-it-fail. Commit each AC (or a group that must land together) and append `AC-<n>[, AC-<m>]: complete (commits <base7>..<head7>)`. An AC that turns out wrong, impossible or ambiguous is BLOCKED: take it to the user with the AC quoted; never rewrite it. Do not check in with the user between AC — stop only for BLOCKED or a consequential, hard-to-reverse choice the AC did not settle.
2. **Verify** — run the full suite, read the output (exit code, failures), then claim (HARRY.md §6). **Trivial:** done → **finishing** skill.
3. **Review.** Dispatch the tier's lanes at once, in one turn, over the branch (`<base>...HEAD`, `<base>` being the branch point):
   - **analyst lane** (Standard and Major): dispatch `harry:analyst` with the range, the item's `### Acceptance criteria` verbatim (and its Constraints, when it has them), and `references/review-rubric.md` itself, not a citation of it — its rules bind only a reviewer that has read it. Save its report to `<store>/.local/tmp/<branch>/review-<k>.md` (`mkdir -p` first). For every file this skill numbers, `<k>` is one more than the files of that kind already there.
   - **Codex lane** (Major): a fresh, ephemeral `codex exec review` process, so the reviewer is not the session. From the unit's checkout:

     1. Write a facts file at `<store>/.local/tmp/<branch>/review-context.md` holding an `## Acceptance criteria` section with the item's AC **verbatim**, then the unit's binding constraints and any rulings recorded so far, each with its reasoning — **facts only**, never verdicts and never "don't flag X" (the `/harry:review` `--context` contract, `commands/review.md`). Resolve `<store>` in the same command that writes the file, and have it print the absolute path.
     2. Invoke the slash command (via the `SlashCommand`/`Skill` tool, not `Bash`) with that printed path:

     ```
     /harry:review --base <base-branch> --context @<absolute path printed in step 1>
     ```

     It writes findings to the file named on its `Review written to <path>` line — **read that file**. No `Review written to` line plus a no-changes `# Review Summary` means nothing to review; record that. **The lane fails** (auth, quota, model, any error) → append its verbatim error and `review: one lane ran` to `## Progress` and go on with the analyst lane alone — no substitute lane, and no question to the user.

   Do not pre-judge findings or tell a reviewer what not to flag. **Accept a report only with BOTH verdicts** — spec AND quality; the spec verdict is per AC, with evidence (`references/review-rubric.md`); a missing verdict is not a valid review, so send it back. Merge the lanes into **one** findings list, deduped, noting which lane raised each; write the merged list to `<store>/.local/tmp/<branch>/findings-<k>.md` and append `review at <sha7>: <n> findings (<lanes>) — <findings file>` to `## Progress`.
4. **One fix wave.** The session fixes every Critical and Important finding itself. A small fix (HARRY.md §3) gets the full suite and no re-review, and one `## Progress` line, `AC-<n>: small fix: <what> (commit <sha7>)`. When a wave has both kinds, its small fixes are re-reviewed with the rest. Any other fix is re-reviewed: **exactly one scoped re-review**, by the lanes that ran in step 3, of the fix range (the head step 3 reviewed → HEAD) plus the open-findings list, per-finding verdict **ADDRESSED / NOT ADDRESSED** — attempted is not addressed. New Critical/Important inside the fix range joins the open list; anything outside it → the item's `## Follow-ups`. Write the open list to the next findings file and append `fix wave: <X> addressed, <Y> open (commits <base7>..<head7>) — <findings file>`.

   **There is no second wave.** Adjudicate each finding still open with a recorded ruling — a silent discard is a §6 violation: contestable or reviewer-wrong → the ruling appended to `## Progress`; real but nothing builds on it → `## Follow-ups`; real and load-bearing → BLOCKED to the user with the finding, the AC text and the fix history. The re-review raising new findings in the same area (same file or same rule) as the review → stop and ask the user whether the scope still serves the unit's goal; name the goal (HARRY.md §6).

   Minor findings → `## Follow-ups` for triage before finishing. A finding that conflicts with an AC → the user decides; present it beside the AC text. Then append `review clean`, `review clean after small fixes`, or `review adjudicated` → **finishing** skill.

**Codex build.** There is no `analyst` to dispatch: the analyst lane is that build's review skill (`codex-skills/review`), which names its report on its `Review written to` line, and the Codex lane collapses into it — the orchestrator reviewing itself is not a second opinion. Record `review: one lane ran`. Pick the session's model and effort from the `/sync`-wired role map in `~/.codex/AGENTS.md`.

## Follow-ups discovered during execution

A follow-on task that surfaces mid-execution (out of scope for this item, but
worth doing later) is appended as one line under the item's `## Follow-ups`
section (create the section if it doesn't exist yet) — not a new file, and
not a code `DEBT:` marker (those stay code-side per HARRY.md §4; a
`## Follow-ups` line is for process/scope-level follow-on work, a `DEBT:`
marker is for an in-code shortcut with a ceiling). `finishing` turns these
into new backlog items on completion — do not create backlog items directly
during execution.

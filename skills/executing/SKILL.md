---
name: executing
description: Use when you have approved acceptance criteria (or a Trivial task) ready to build and need to turn them into committed, reviewed code.
---

# Executing

Turn approved acceptance criteria into committed, reviewed code. The item's `### Acceptance criteria` is the work list: each AC is an outcome plus its verification, and every brief, report, review verdict and progress note cites AC IDs. **Executing never edits an AC** — see the pre-flight below. **Route by tier** (HARRY.md §3) — there is no "subagent or inline" prompt; the tier decides.

## Route

```
Trivial   → session mode  (CC does the steps inline, verify, done — no review)
Standard  → session mode  (CC does the steps inline, then ONE mandatory independent review)
Major     → subagent mode (fresh subagent per task + per-task review + final review)
```

State the route in one line before starting ("Trivial → session mode" / "Standard → session mode + review" / "Major → subagent mode"). When in doubt, go higher.

**Re-classify mid-flight.** If scope growth crosses a §3 tier trigger during execution (more files, a new subsystem, a red line surfacing), STOP, re-declare the tier out loud, and adopt the higher tier's remaining gates from that point. Work already done stands — its gates are not re-run retroactively — but the review/TDD gates not yet reached run at the new tier.

## Before either mode

1. **Branch.** A fresh branch for the unit, never `main`/`master` without consent. Session mode works on it in place, at any tier — one writer needs no worktree. A worktree is for concurrent writers, exactly as HARRY.md §5 lists them (subagent mode's parallel units are one case); if any of them is writing in the main checkout already — the user included — isolate instead of branching in place.
2. **Paths.** Every `.local/…` path in this skill means the **MAIN checkout's** store (HARRY.md §5) — a bare relative one written from inside a worktree would create a second store there. Resolve it **inside the same command that uses it**: shell variables do not survive from one tool call to the next, and a subagent's shell never saw yours, so hand subagents the already-resolved absolute path, never the `$STORE` literal.

   ```bash
   STORE="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   ```

   `$STORE/.local/tmp/<branch>` itself is created by whichever step first writes into it — Standard's review-diff write (session mode step 4) or subagent mode's first brief write (step 1) each run their own `mkdir -p` before writing; Trivial writes nothing here during executing. Finishing step 2's architecture review also writes here (its own `mkdir -p`) and is the first creator for a Trivial unit, since Trivial never runs the writes above.

   (If the project has no `.local/` at all, set it up or confirm it first — HARRY.md §5.)

3. **Pre-flight AC review** (Standard/Major). Read the item's `### Acceptance criteria` once and scan for AC that is wrong, impossible, ambiguous, a step rather than an outcome, missing its verification, or in conflict with another AC or the item's Constraints — a later AC that names the AC it supersedes is not a conflict (`references/doc-types.md`). **You may not fix any of it yourself** — approved AC text is the user's (`references/doc-types.md`). Present every finding as **one batched question**, each quoted beside the AC it concerns, and ask the user to rule; this is the same STOP as the BLOCKED path below. Clean scan → proceed silently.

   **Legacy items.** An in-flight item whose `## Why / What` has no `### Acceptance criteria` is executed from its `## Plan` steps as written — the plan is the work list, and this pre-flight scan has nothing to scan. Record progress the same way, in `## Progress` (or in the plan's own completion notes when that is what the item already uses). Never retrofit acceptance criteria onto it.
4. **Mark started + track progress in the item** (Standard/Major). Add (or update) this unit's line in `.local/INDEX.md` `## In flight` (`<topic> · <branch> · <started YYYY-MM-DD>`; HARRY.md §5). Progress goes in the item's **`## Progress` section** (create it if absent) — **append-only**, one line per event, each citing the AC IDs it covers and the commit range, so it survives compaction. Never edit approved AC text to record progress. An AC with a done line is DONE — do not re-dispatch it; a resumed session reads `## Progress` and resumes at the first AC without one. Trust `## Progress` and `git log` over recollection.

## Session mode (Trivial / Standard)

CC executes inline on the unit's branch (§5: one writer, no worktree). No implementer subagent.

1. Do the work — satisfy the AC list in order / make the obvious change.
2. Verify — run it, read the output (exit code, failures), then claim (HARRY.md §6). No "should/probably."
3. **Trivial:** no review — → **finishing** skill.
4. **Standard: mandatory independent review** (compensates for inline execution). Leave one runnable check (HARRY.md §6). Package the working diff (`merge-base..HEAD` or the uncommitted diff) to a file under the store's tmp dir (resolve `$STORE` per the Paths rule, `mkdir -p "$STORE/.local/tmp/<branch>"` before this first write), then dispatch **ONE** CC reviewer subagent (explicit `model: opus` — the §5 dispatch cap; never inherit the session model) with the diff + the item's `### Acceptance criteria` (and its Constraints, when it has them) + `references/review-rubric.md`. Do not pre-judge findings or tell it what not to flag. **Accept its report only with BOTH verdicts** — spec AND quality; the spec verdict is per AC, with evidence (`references/review-rubric.md`); one missing verdict is not a valid review, so send it back rather than read a partial report as a pass. Fix Critical/Important findings with the session as fixer; each re-review is **scoped** — the fix-range diff plus the open-findings list, per-finding verdict ADDRESSED / NOT ADDRESSED, new breakage inside the fix diff joins the list, anything outside it → the item's `## Follow-ups`, never the loop. **Cap: three fix rounds**, then adjudicate each still-open finding with a recorded ruling (contestable → ruling appended to `## Progress`; real-not-load-bearing → `## Follow-ups`; load-bearing → BLOCKED to the user; a silent discard is a §6 violation). Record each round in `## Progress` (`AC-<n>: fix round <R>/3: <X> addressed, <Y> open (commits <base7>..<head7>)`). Minor findings → `## Follow-ups`, triage before finishing. Then append the AC completion lines to `## Progress` and → **finishing** skill.

## Subagent mode (Major)

Implementer = **CC's own subagents** (not an external delegate). Each gets isolated, precisely-built context — never your session history — via **file handoffs**, plus an explicit output contract. A task is one AC, or a group of AC that must land together. Tasks with data/interface dependencies run sequentially; independent tasks default to parallel dispatch, each in its **own** worktree (HARRY.md §5), cut from the unit's branch — if the harness cuts isolation worktrees from the main checkout's HEAD instead, the brief's first step is `git reset --hard <unit branch>`, or the unit builds on a stale base. While any parallel task is in flight, every task runs in its own worktree — a sequential one too — so no writer shares the unit branch's checkout with step 5's fast-forward (HARRY.md §5); and a task still writing in the unit branch's checkout finishes before any parallel task is dispatched. For each such task, branch a per-task worktree off the unit branch; the task stays there through its review and fix rounds, and reaches the unit branch only through step 5's integration, never before. A task's worktree never outlives the task that made it; finishing does not look for any.

**Parallel dispatch reads `## Dispatch`.** When the item has that section, it governs: one row per unit gives the AC covered, the write set (dispatch only disjoint write sets), what the unit reads from other units, and whether it lands first or last — a cross-unit contract test lands last. A unit that builds against an interface another unit has not written yet is not parallel with it: dispatch it after that unit lands. When the item has no `## Dispatch` and you are about to dispatch 2+ units in parallel, write one now, before dispatching; it is the only record of who owns which files.

**Model by role.** Predictable-nature work routes to a durable role — dispatch it by `subagent_type` and pass **no** `model`/`effort` (the role owns them; an inline arg overrides and defeats the binding): recon → `scout`, mechanical fully-specified edits → `mech`, prose/docs → `writer`, security-sensitive → `security` (HARRY.md §5). Judgment-heavy implementation and fixing have **no** role: dispatch ad-hoc at the **dispatch cap — `opus`** (a HARD cap, HARRY.md §5: session models above it are thinking-class, reserved for the session's own reasoning, never dispatch targets; the cap moves only on the user's explicit instruction — do not vague it to "figure it out at dispatch time"; that made silent session-model fallback too easy), and *there* you MUST set `model` and `effort` explicitly (an omitted model silently inherits the session's — above the cap, a violation; a weaker model flails and burns more turns than it saves — turn count beats token price). The task's *nature* decides role-vs-cap, never tier/file-count — a mechanical Major task (the same field across 8 CRUD files) → `mech`; a subtle 2-file concurrency fix → ad-hoc `opus`. Several small, independent edits of the same kind across files (the same one-line fix, constant change, or field addition) go to **ONE** `mech` dispatch whose brief lists every file and its change, reviewed as one diff — not one dispatch per file. That batched dispatch counts as **one task**: it keeps this tier's test discipline and goes through steps 3–5 (review, fix loop, mark complete) like any other task. A dispatch of its own is for a change that needs its own judgment, its own tests, or its own review surface. Reviewers are routed separately (step 3). **Codex build:** there is no per-subagent dispatch — apply the role's advisory model/effort from the `/sync`-wired role map in `~/.codex/AGENTS.md` (via a session profile, or `-m` plus reasoning-effort config); judgment-heavy work uses that map's most-capable row. **Reviewers on that build:** there are no CC subagents, so the reviewer in step 3 and the CC lane in step 6 are both that build's own review skill (`codex-skills/review`), and step 6's Codex lane collapses into it — the orchestrator reviewing itself is not a second opinion. Record that only one lane ran.

Per task:

1. **Brief.** Extract the task's AC verbatim — IDs, outcome text and each one's verification — to a brief file under the store (`<store>/.local/tmp/<branch>/task-N-brief.md` — transient, deletable; resolve `<store>` per the Paths rule, `mkdir -p "<store>/.local/tmp/<branch>"` before this first write, and write the absolute path into the dispatch prompt). The dispatch prompt carries: where the task fits (one line), the brief path ("read first — your requirements, exact values verbatim"), interfaces/decisions from earlier tasks the brief can't know, your resolution of any ambiguity, the report-file path + report contract (the report cites AC IDs and says which are satisfied, with the evidence each AC's verification produced), and a **no-subagent contract**: the implementer does the whole task itself and never dispatches subagents — not helpers, and above all never its own reviewer (review comes from the controller after the report, see step 3) — because a worker-spawned reviewer duplicates the controller's review seat at full cost and its verdict counts for nothing. (Role agents mech/writer/security are already tool-enforced leaves; this contract covers the ad-hoc dispatch-cap route.) Exact values live only in the brief.
2. **Dispatch implementer** (model per the routing above). Fresh subagent. It implements, follows TDD (red-green + watch-it-fail), tests, commits, self-reviews, writes its full report to the report file (`<store>/.local/tmp/<branch>/task-N-report.md`, absolute in its prompt), and returns only: status, commits, one-line test summary, concerns.
   - Status handling: **DONE** → review. **DONE_WITH_CONCERNS** → read concerns; address correctness/scope before review. **NEEDS_CONTEXT** → provide it, re-dispatch. **BLOCKED** → stop and ask, don't guess (more context / stronger model / split task / escalate). Never silently retry the same model unchanged. An AC that turns out wrong, impossible or ambiguous — yours or the implementer's finding — is BLOCKED too: take it to the user with the AC quoted. Neither you nor a subagent rewrites an approved AC.
3. **Per-task review.** AC compliance + code quality, scoped to this task's diff (write the diff to a file under `<store>/.local/tmp/<branch>/`; hand the reviewer the brief, the report, the diff, and the item's Constraints verbatim when it has them). Dispatch **ONE** CC reviewer subagent (explicit `model: opus` — the §5 dispatch cap). Hand it `references/review-rubric.md` itself, not just a citation of it — its reviewer rules only bind a reviewer that has read it. Per-task review is single-lane on purpose: the Codex lane, where the build has one, runs once per unit at the final review (step 6), so a Major spends Codex quota once instead of per task. Do not pre-judge findings or tell the reviewer what not to flag. **Accept a report only with BOTH verdicts** — spec AND quality (`references/review-rubric.md`); the spec verdict is per AC, with evidence, and one missing verdict is not a valid review, so send it back rather than read a partial report as a pass. **Codex build:** no CC subagent to dispatch here — see the Model-by-role carve-out above.
4. **Fix loop — capped at four rounds.** The cap operationalizes §6's three-failed-fixes law: three failures of the same fixer mean the fourth round changes the *fixer*, not the hypothesis; still open after that is structural, so adjudicate instead of looping. **The session is never the fixer here** — fixing a finding yourself skips the loop's re-review; every fix goes through the loop's fixer below (the resumed implementer in rounds 1–3, the fresh one in round 4). When the task has its own worktree, its fixer — resumed or fresh — works in it, which is still there: it is removed only at step 5's integration. Give a fresh fixer that worktree's absolute path; never dispatch it with a new isolation worktree, which would be cut from elsewhere and hold none of the task's commits. A failure from step 5's integration is a finding like any other, continuing the task's round count, with two limits: the fixer stays inside the task's `## Dispatch` write set — a fix that needs another unit's files is BLOCKED — and a red suite still open at the cap — or arriving after the loop already reached it — is BLOCKED to the user, never adjudicated.
   - **Rounds 1–3: resume the original implementer** with the open findings verbatim — its context (task, code, its own choices) makes the fix better and cheaper than a fresh dispatch (turn count beats token price). It fixes, re-runs covering tests, appends a fix report to the same report file, returns the same status contract. No live agent to resume (restart/compaction)? Fresh dispatch with brief + report file + findings — the report file is the persistent memory either way.
   - **Round 4 — escalation: one fresh implementer.** Role-routed work escalates to the ad-hoc dispatch-cap route (the Model-by-role routing above); work already at the cap gets fresh eyes only. A loop that survives three resumes usually means the implementer cannot see its own problem.
   - **Every re-review is scoped:** diff range = the head the previous review saw → HEAD (after a step-5 integration, its merge commit → HEAD, so other tasks' merged code stays out; when the integration merged nothing, the head the previous review saw), handed with the open-findings list. Per-finding verdict **ADDRESSED / NOT ADDRESSED** — attempted is not addressed. New Critical/Important *inside the fix diff* joins the open list; anything outside it → the item's `## Follow-ups`, never the loop.
   - **Still open after round 4 → stop the loop and adjudicate.** Adjudicate each open finding with a recorded ruling — a silent discard is a §6 violation: contestable / reviewer-wrong → park it with a ruling appended to `## Progress`; real but nothing builds on it → `## Follow-ups`; real and load-bearing → STOP, BLOCKED to the human with finding + AC text + fix history. Adjudicate only at the cap — earlier is pre-judging.
   - Record each round in `## Progress` (`AC-<n>: fix round <R>/4: <X> addressed, <Y> open (commits <base7>..<head7>)`) — a unit whose last `## Progress` line is a fix round resumes mid-loop.
   - Minor findings → `## Follow-ups` for final triage (finishing turns these into new backlog items, as `references/doc-types.md` sets out). A finding that conflicts with an AC → human decides; present the finding beside the AC text, and do not edit the AC to settle it.
5. **Integrate, then mark complete.** A task in its own worktree integrates first; a task that ran on the unit branch itself — only when no other task is in flight — goes straight to the `## Progress` line.
   1. Merge the unit branch into the task's branch in its worktree (`git -C <path> merge <unit branch>`) and resolve any conflicts there. Resolved conflicts come after the per-task review, so append `AC-<n>[, AC-<m>]: integration: conflicts resolved in <merge7>` to `## Progress`; step 6 reviews them by name (`git show --remerge-diff <merge7>`).
   2. Run the suite in the worktree. Red → the task is not complete: hand the failure to step 4 as a finding, then come back to 1.
   3. Green → fast-forward the unit branch to the task's branch (`git -C <unit checkout> merge --ff-only <its branch>` — the unit's worktree, or the main checkout for a branch in place), so integration only ever moves the unit branch to a tree whose suite passed. Refused because another task landed meanwhile → back to 1; refused for any other reason (a dirty unit checkout) → stop and ask.
   4. Remove the task's worktree and delete its branch — the fast-forward just proved it landed: `git -C <path> status --porcelain -uall` must be empty first (if not, stop and ask), then `git worktree remove <path>` and `git branch -D <its branch>`.

   Then append one line to the item's `## Progress`: `AC-<n>[, AC-<m>]: complete (commits <base7>..<head7>, review clean)` — or `review adjudicated` plus the rulings recorded when the loop exited at the cap. `## Progress` is append-only, so this record survives into the archive. Do not check in with the human between tasks — work the whole AC list; stop only for BLOCKED or genuine ambiguity (a consequential, hard-to-reverse design choice the AC didn't settle).

After all tasks:

6. **Final review — two lanes, once per unit.**
   - **CC lane:** one broad whole-branch CC reviewer subagent, dispatched as in step 3 — hand it `references/review-rubric.md` itself, not just a citation of it, same as step 3. A whole-branch pass has no per-task brief, so its dispatch prompt carries the item's `### Acceptance criteria` **verbatim** — all of them, IDs and verifications — in the brief's place, plus the item's Constraints when it has them, and every integration conflict resolution recorded in `## Progress` (its merge commit), named for review: no per-task review saw them. Package the full branch diff (`merge-base..HEAD`) to a file. **Codex build:** no CC subagent to dispatch here — on that build both lanes are the review skill, see the Model-by-role carve-out above; record that only one lane ran.
   - **Codex lane** (a reviewer that is not the orchestrator — a fresh, ephemeral `codex exec review` process, not the CC session reviewing itself). Two steps, both from the unit's branch checkout (its worktree, or the main checkout for a branch in place):

     1. Write a facts file at `<store>/.local/tmp/<branch>/review-context.md` holding an `## Acceptance criteria` section with the item's AC **verbatim** (this lane judges spec against the same list as the CC lane), then this unit's binding constraints, the rulings recorded so far, each with its reasoning, and the merge commits where integration resolved conflicts — **facts only**, never verdicts and never "don't flag X" (the `/harry:review` `--context` contract, `commands/review.md`). Resolve `<store>` in the same command that writes the file, per the Paths rule, and have that command also print the resulting absolute path — it does not survive to the next call, so paste the printed value literally into step 2.

     2. Invoke the slash command (via the `SlashCommand`/`Skill` tool, not `Bash` — it is not a shell command) with that printed absolute path:

     ```
     /harry:review --base <base-branch> --context @<absolute path printed in step 1>
     ```

     `/harry:review` runs `codex exec review` read-only and writes findings to a
     fresh `<store>/.local/tmp/<branch>/codex-review-<YYYYMMDD-HHMMSS>.md` per
     run, reporting that path on `Review written to <path>` — **read that file**:
     the lane's findings only exist there. It picks the reviewing model from
     `~/.codex/config.toml`, not from this skill.

     No `Review written to` line plus a no-changes `# Review Summary` means the
     branch has nothing to review — record that in `## Progress`; it is not a
     lane failure.

     If the lane fails (auth, model, quota, or any other error), record the
     verbatim error in `## Progress` and take it to the user — never silently
     skip it, never claim it ran.

   Merge whatever lanes ran into **one** findings list before acting, deduped, noting which lane raised each — that record is what later tells you whether the cross-model lane earns its quota. Findings → **one** fix subagent with the complete list (not one fixer per finding). Point it at the item's `## Follow-ups` to triage what must be fixed before merge. After that fix wave lands, run exactly **one scoped re-review** of the fix range (step 4's re-review rules) — the last code on the branch is never left unreviewed. **There is no second fix wave:** residuals are adjudicated the same way as subagent mode step 4's round-4 cap (park with a recorded ruling / `## Follow-ups`; load-bearing → BLOCKED, surface at finishing).
7. → **finishing** skill.

## Follow-ups discovered during execution

A follow-on task that surfaces mid-execution (out of scope for this item, but
worth doing later) is appended as one line under the item's `## Follow-ups`
section (create the section if it doesn't exist yet) — not a new file, and
not a code `DEBT:` marker (those stay code-side per HARRY.md §4; a
`## Follow-ups` line is for process/scope-level follow-on work, a `DEBT:`
marker is for an in-code shortcut with a ceiling). `finishing` turns these
into new backlog items on completion — do not create backlog items directly
during execution.

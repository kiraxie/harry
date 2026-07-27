---
name: executing
description: Use when you have an approved plan (or a Trivial task) ready to build and need to turn it into committed, reviewed code.
---

# Executing

Turn a plan into committed, reviewed code. **Route by tier** (HARRY.md §3) — there is no "subagent or inline" prompt; the tier decides.

## Route

```
Trivial   → session mode  (CC does the steps inline, verify, done — no review)
Standard  → session mode  (CC does the steps inline, then ONE mandatory independent review)
Major     → subagent mode (fresh subagent per task + per-task review + final review)
```

State the route in one line before starting ("Trivial → session mode" / "Standard → session mode + review" / "Major → subagent mode"). When in doubt, go higher.

**Re-classify mid-flight.** If scope growth crosses a §3 tier trigger during execution (more files, a new subsystem, a red line surfacing), STOP, re-declare the tier out loud, and adopt the higher tier's remaining gates from that point. Work already done stands — its gates are not re-run retroactively — but the review/TDD gates not yet reached run at the new tier.

## Before either mode

1. **Worktree.** No work on the main checkout without explicit consent — Standard/Major default to an isolated worktree on a new branch; a single Trivial edit may go on a fresh branch in place, no worktree needed (HARRY.md §5). Never start on `main`/`master` without consent.
2. **Pre-flight plan review** (Standard/Major). Scan the item's `## Plan` section once for conflicts: tasks that contradict each other or the Global Constraints; anything the plan mandates that the review rubric treats as a defect (a test that asserts nothing, a verbatim-duplicated logic block). Present all findings as **one batched question** — each beside the plan text that mandates it, ask which governs. Clean scan → proceed silently.
3. **Mark started + track progress in the item.** Add (or update) this unit's line in `.local/INDEX.md` `## In flight` (`<topic> · <branch> · <started YYYY-MM-DD>`; HARRY.md §5). Progress is tracked in the item's **`## Plan` section itself** — check off / append a completion note per task there, so it survives compaction. Tasks marked complete are DONE — do not re-dispatch them; resume at the first unmarked task. Trust the plan's marks and `git log` over recollection.

## Session mode (Trivial / Standard)

CC executes inline in the isolated worktree (worktree rule, §5). No implementer subagent.

1. Do the steps. Follow the plan / the obvious change.
2. Verify — run it, read the output (exit code, failures), then claim (HARRY.md §6). No "should/probably."
3. **Trivial:** no review — → **finishing** skill.
4. **Standard: mandatory independent review** (compensates for inline execution). Leave one runnable check (HARRY.md §6). Package the working diff (`merge-base..HEAD` or the uncommitted diff) to a file, then dispatch **ONE** free CC reviewer subagent (cheaper default model) with the diff + the item's `## Plan` section + `references/review-rubric.md`. Do not pre-judge findings or tell it what not to flag. Fix Critical/Important findings with the session as fixer; each re-review is **scoped** — the fix-range diff plus the open-findings list, per-finding verdict ADDRESSED / NOT ADDRESSED, new breakage inside the fix diff joins the list, anything outside it → the item's `## Follow-ups`, never the loop. **Cap: three fix rounds**, then the breaker — adjudicate each still-open finding with a recorded ruling (contestable → ruling in the item; real-not-load-bearing → `## Follow-ups`; load-bearing → BLOCKED to the user; a silent discard is a §6 violation). Minor findings → `## Follow-ups`, triage before finishing. Then mark the plan's tasks complete and → **finishing** skill.

## Subagent mode (Major)

Implementer = **CC's own subagents** (not an external delegate). Each gets isolated, precisely-built context — never your session history — via **file handoffs**, plus an explicit output contract. Tasks with data/interface dependencies run sequentially; independent tasks default to parallel dispatch, each in its **own** worktree (HARRY.md §5). For each parallel task, branch a per-task worktree off the unit branch; merge each back into the unit branch as it completes, resolve conflicts, then run the suite on the unit branch.

**Model by role.** Predictable-nature work routes to a durable role — dispatch it by `subagent_type` and pass **no** `model`/`effort` (the role owns them; an inline arg overrides and defeats the binding): recon → `scout`, mechanical fully-specified edits → `mech`, prose/docs → `writer`, security-sensitive → `security` (HARRY.md §5). Judgment-heavy implementation and fixing have **no** role: dispatch ad-hoc on the **most capable available model — currently `opus`** (update this literal the day a stronger model ships; do not vague it to "figure it out at dispatch time" — that made silent session-model fallback too easy), and *there* you MUST set `model` and `effort` explicitly (an omitted model silently inherits the session's; a weaker model flails and burns more turns than it saves — turn count beats token price). The task's *nature* decides role-vs-capable, never tier/file-count — a mechanical Major task (the same field across 8 CRUD files) → `mech`; a subtle 2-file concurrency fix → ad-hoc `opus`. Reviewers are routed separately (step 3). **Codex build:** there is no per-subagent dispatch — apply the role's advisory model/effort from the `/sync`-wired role map in `~/.codex/AGENTS.md` (via a session profile, or `-m` plus reasoning-effort config); judgment-heavy work uses that map's most-capable row.

Per task:

1. **Brief.** Extract the task's full text to a brief file (`.local/tmp/<branch>/task-N-brief.md` — transient, deletable). The dispatch prompt carries: where the task fits (one line), the brief path ("read first — your requirements, exact values verbatim"), interfaces/decisions from earlier tasks the brief can't know, your resolution of any ambiguity, and the report-file path + report contract. Exact values live only in the brief.
2. **Dispatch implementer** (model per the routing above). Fresh subagent. It implements, follows TDD (red-green + watch-it-fail), tests, commits, self-reviews, writes its full report to the report file (`.local/tmp/<branch>/task-N-report.md`), and returns only: status, commits, one-line test summary, concerns.
   - Status handling: **DONE** → review. **DONE_WITH_CONCERNS** → read concerns; address correctness/scope before review. **NEEDS_CONTEXT** → provide it, re-dispatch. **BLOCKED** → stop and ask, don't guess (more context / stronger model / split task / escalate). Never silently retry the same model unchanged.
3. **Per-task review.** Item compliance + code quality, scoped to this task's diff (write the diff to a file under `.local/tmp/<branch>/`; hand the reviewer the brief, the report, the diff, and the binding Global Constraints verbatim). Route to harry's `/review` (frontier); if that lane is unavailable (quota, account, outage), fall back to a CC reviewer subagent and **declare the substitution** in the task record — never silently skip review, never claim frontier ran when it didn't. Do not pre-judge findings or tell the reviewer what not to flag.
4. **Fix loop — capped at four rounds.** The cap operationalizes §6's three-failed-fixes law: three failures of the same fixer mean the fourth round changes the *fixer*, not the hypothesis; still open after that is structural, so adjudicate instead of looping.
   - **Rounds 1–3: resume the original implementer** with the open findings verbatim — its context (task, code, its own choices) makes the fix better and cheaper than a fresh dispatch (turn count beats token price). It fixes, re-runs covering tests, appends a fix report to the same report file, returns the same status contract. No live agent to resume (restart/compaction)? Fresh dispatch with brief + report file + findings — the report file is the persistent memory either way.
   - **Round 4 — escalation: one fresh implementer.** Role-routed work escalates to the ad-hoc most-capable route (the Model-by-role routing above); work already on that route gets fresh eyes only. A loop that survives three resumes usually means the implementer cannot see its own problem.
   - **Every re-review is scoped:** diff range = the head the previous review saw → HEAD, handed with the open-findings list. Per-finding verdict **ADDRESSED / NOT ADDRESSED** — attempted is not addressed. New Critical/Important *inside the fix diff* joins the open list; anything outside it → the item's `## Follow-ups`, never the loop.
   - **Still open after round 4 → the breaker trips.** Adjudicate each open finding with a recorded ruling — a silent discard is a §6 violation: contestable / reviewer-wrong → park it with a ruling in the task's completion note; real but nothing builds on it → `## Follow-ups`; real and load-bearing → STOP, BLOCKED to the human with finding + plan text + fix history. Adjudicate only at the cap — earlier is pre-judging.
   - Record each round in the task's `## Plan` completion note (`fix round <R>/4: <X> addressed, <Y> open`) — a task whose last line is a fix round resumes mid-loop.
   - Minor findings → `## Follow-ups` for final triage (finishing's flush covers them). A finding that conflicts with the plan → human decides (present finding + plan text).
5. **Mark complete.** Mark the task complete in the item's `## Plan` section: append `Task N: complete (commits <base7>..<head7>, review clean)` — or `review adjudicated` plus the breaker's rulings when the loop exited at the cap — (or check its box) — the item's archival then preserves this record. Do not check in with the human between tasks — execute the whole plan; stop only for BLOCKED or genuine ambiguity (a consequential, hard-to-reverse design choice the plan didn't settle).

After all tasks:

6. **Final review** — one broad whole-branch review (frontier `/review`; same declared fallback as step 3 if the lane is unavailable). Package the full branch diff (`merge-base..HEAD`) to a file. Findings → **one** fix subagent with the complete list (not one fixer per finding). Point it at the item's `## Follow-ups` to triage what must be fixed before merge. After that fix wave lands, run exactly **one scoped re-review** of the fix range (step 4's re-review rules) — the last code on the branch is never left unreviewed. **There is no second fix wave:** residuals are adjudicated per the breaker's exit (park with a recorded ruling / `## Follow-ups`; load-bearing → BLOCKED, surface at finishing).
7. → **finishing** skill.

## Follow-ups discovered during execution

A follow-on task that surfaces mid-execution (out of scope for this item, but
worth doing later) is appended as one line under the item's `## Follow-ups`
section (create the section if it doesn't exist yet) — not a new file, and
not a code `DEBT:` marker (those stay code-side per HARRY.md §4; a
`## Follow-ups` line is for process/scope-level follow-on work, a `DEBT:`
marker is for an in-code shortcut with a ceiling). `finishing` flushes these
into new backlog items on completion — do not create backlog items directly
during execution.

## Never

- Guess past a BLOCKED — stop and ask.
- Work on main/master without consent.
- Paste session history or whole-plan files into a dispatch — hand briefs/reports/diffs as files.
- Skip per-task review, or accept a report missing either verdict (spec AND quality).
- Fix findings yourself in the session while in subagent mode — that skips the loop's re-review; every fix goes through the loop's fixer (Standard: the session *is* the fixer; Major: the resumed or escalated implementer).
- Re-dispatch a task the plan already marks complete.
- Claim done without fresh verification evidence (HARRY.md §6).

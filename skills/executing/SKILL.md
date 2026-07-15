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

## Before either mode

1. **Worktree.** No work on the main checkout without explicit consent — default to an isolated worktree on a new branch (HARRY.md §5). Never start on `main`/`master` without consent.
2. **Pre-flight plan review** (Standard/Major). Scan the item's `## Plan` section once for conflicts: tasks that contradict each other or the Global Constraints; anything the plan mandates that the review rubric treats as a defect (a test that asserts nothing, a verbatim-duplicated logic block). Present all findings as **one batched question** — each beside the plan text that mandates it, ask which governs. Clean scan → proceed silently.
3. **Mark started + track progress in the item.** Add (or update) this unit's line in `.local/INDEX.md` `## In flight` (`<topic> · <branch> · <started YYYY-MM-DD>`; HARRY.md §5). Progress is tracked in the item's **`## Plan` section itself** — check off / append a completion note per task there, so it survives compaction. Tasks marked complete are DONE — do not re-dispatch them; resume at the first unmarked task. Trust the plan's marks and `git log` over recollection.

## Session mode (Trivial / Standard)

CC executes inline in the isolated worktree (worktree rule, §5). No implementer subagent.

1. Do the steps. Follow the plan / the obvious change.
2. Verify — run it, read the output (exit code, failures), then claim (HARRY.md §6). No "should/probably."
3. **Trivial:** no review — → **finishing** skill.
4. **Standard: mandatory independent review** (compensates for inline execution). Leave one runnable check (HARRY.md §6). Package the working diff (`merge-base..HEAD` or the uncommitted diff) to a file, then dispatch **ONE** free CC reviewer subagent (cheaper default model) with the diff + the item's `## Plan` section + `references/review-rubric.md`. Do not pre-judge findings or tell it what not to flag. Fix Critical/Important findings, re-review until clean (Minor → the item's `## Follow-ups`, triage before finishing). Then mark the plan's tasks complete and → **finishing** skill.

## Subagent mode (Major)

Implementer = **CC's own subagents** (not an external delegate). Each gets isolated, precisely-built context — never your session history — via **file handoffs**, plus an explicit output contract. Run tasks sequentially; only parallelize independent tasks across worktrees (HARRY.md §5).

**Model by role.** Predictable-nature work routes to a durable role — dispatch it by `subagent_type` and pass **no** `model`/`effort` (the role owns them; an inline arg overrides and defeats the binding): recon → `scout`, mechanical fully-specified edits → `mech`, prose/docs → `writer`, security-sensitive → `security` (HARRY.md §5). Judgment-heavy implementation and fixing have **no** role: dispatch ad-hoc on the **most capable available model — currently `opus`** (update this literal the day a stronger model ships; do not vague it to "figure it out at dispatch time" — that made silent session-model fallback too easy), and *there* you MUST set `model` and `effort` explicitly (an omitted model silently inherits the session's; a weaker model flails and burns more turns than it saves — turn count beats token price). The task's *nature* decides role-vs-capable, never tier/file-count — a mechanical Major task (the same field across 8 CRUD files) → `mech`; a subtle 2-file concurrency fix → ad-hoc `opus`. Reviewers are routed separately (step 3). **Codex build:** dispatch the equivalent Codex agent (same role names; path per the Codex distribution); effort maps, model is inherited.

Per task:

1. **Brief.** Extract the task's full text to a brief file (`.local/tmp/<branch>/task-N-brief.md` — transient, deletable). The dispatch prompt carries: where the task fits (one line), the brief path ("read first — your requirements, exact values verbatim"), interfaces/decisions from earlier tasks the brief can't know, your resolution of any ambiguity, and the report-file path + report contract. Exact values live only in the brief.
2. **Dispatch implementer** (model per the routing above). Fresh subagent. It implements, follows TDD (red-green + watch-it-fail), tests, commits, self-reviews, writes its full report to the report file (`.local/tmp/<branch>/task-N-report.md`), and returns only: status, commits, one-line test summary, concerns.
   - Status handling: **DONE** → review. **DONE_WITH_CONCERNS** → read concerns; address correctness/scope before review. **NEEDS_CONTEXT** → provide it, re-dispatch. **BLOCKED** → stop and ask, don't guess (more context / stronger model / split task / escalate). Never silently retry the same model unchanged.
3. **Per-task review.** Item compliance + code quality, scoped to this task's diff (write the diff to a file under `.local/tmp/<branch>/`; hand the reviewer the brief, the report, the diff, and the binding Global Constraints verbatim). Route to harry's `/review` (frontier). Do not pre-judge findings or tell the reviewer what not to flag.
4. **Fix loop.** Critical/Important findings → dispatch a fix subagent (model per the routing above; carries the implementer contract: re-runs covering tests, reports command + output). Re-review. Repeat until spec ✅ and quality approved. Minor findings → append to the item's `## Follow-ups` for final triage (so finishing's flush covers them). A finding that conflicts with the plan → human decides (present finding + plan text).
5. **Mark complete.** Mark the task complete in the item's `## Plan` section: append `Task N: complete (commits <base7>..<head7>, review clean)` (or check its box) — the item's archival then preserves this record. Do not check in with the human between tasks — execute the whole plan; stop only for BLOCKED or genuine ambiguity.

After all tasks:

6. **Final review** — one broad whole-branch review (frontier `/review`). Package the full branch diff (`merge-base..HEAD`) to a file. Findings → **one** fix subagent with the complete list (not one fixer per finding). Point it at the item's `## Follow-ups` to triage what must be fixed before merge.
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
- Re-dispatch a task the plan already marks complete.
- Claim done without fresh verification evidence (HARRY.md §6).

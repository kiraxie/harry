---
name: executing
description: Use when you have an approved plan (or a Trivial task) ready to build and need to turn it into committed, reviewed code.
---

# Executing

Turn a plan into committed, reviewed code. **Route by tier** (HARRY.md §3) — there is no "subagent or inline" prompt; the tier decides.

## Route

```
Trivial            → session mode  (CC does the steps inline, verify, done)
Standard / Major   → subagent mode (fresh subagent per task + per-task review + final review)
```

State the route in one line before starting ("Trivial → session mode" / "Standard → subagent mode"). When in doubt, go higher.

## Before either mode

1. **Worktree.** No work on the main checkout without explicit consent — default to an isolated worktree on a new branch (HARRY.md §5). Never start on `main`/`master` without consent.
2. **Pre-flight plan review** (Standard/Major). Scan the plan once for conflicts: tasks that contradict each other or the Global Constraints; anything the plan mandates that the review rubric treats as a defect (a test that asserts nothing, a verbatim-duplicated logic block). Present all findings as **one batched question** — each beside the plan text that mandates it, ask which governs. Clean scan → proceed silently.
3. **Ledger.** Open/append a durable progress ledger at `$(git rev-parse --show-toplevel)/.local/ledger/<branch>.md` so progress survives compaction. Tasks marked complete there are DONE — do not re-dispatch them; resume at the first unmarked task. Trust the ledger and `git log` over recollection.

## Session mode (Trivial)

CC executes inline. No subagent, no per-task review.

1. Do the steps. Follow the plan / the obvious change.
2. Verify — run it, read the output (exit code, failures), then claim (HARRY.md §6). No "should/probably."
3. → **finishing** skill.

## Subagent mode (Standard / Major)

Implementer = **CC's own subagents** (not an external delegate). Each gets isolated, precisely-built context — never your session history — via **file handoffs**, plus an explicit output contract. Run tasks sequentially; only parallelize independent tasks across worktrees (HARRY.md §5).

**Model by role — always specify it; an omitted model silently inherits the session's.** Implementer and fixer default to the **most capable available model** (currently `opus`): the role does judgment/exploration, and a weaker model flails and burns more turns than it saves (turn count beats token price). Route to a cheaper model (`sonnet`) ONLY when the task's *nature* is mechanical/transcription — the plan already carries the complete code, or it's a single-file rote change with no design decision to make. Tier (Standard/Major) does NOT decide this — a Major task that's mechanical (e.g. the same field added across 8 CRUD files) still routes cheap; a Standard task that's subtle (e.g. a 2-file concurrency fix) still routes capable. Reviewers are routed separately (step 3), already tier-scaled.

Per task:

1. **Brief.** Extract the task's full text to a brief file (`.local/ledger/task-N-brief.md`). The dispatch prompt carries: where the task fits (one line), the brief path ("read first — your requirements, exact values verbatim"), interfaces/decisions from earlier tasks the brief can't know, your resolution of any ambiguity, and the report-file path + report contract. Exact values live only in the brief.
2. **Dispatch implementer** (model per the routing above). Fresh subagent. It implements, follows TDD per tier (Standard: one runnable check; Major: red-green + watch-it-fail), tests, commits, self-reviews, writes its full report to the report file, and returns only: status, commits, one-line test summary, concerns.
   - Status handling: **DONE** → review. **DONE_WITH_CONCERNS** → read concerns; address correctness/scope before review. **NEEDS_CONTEXT** → provide it, re-dispatch. **BLOCKED** → stop and ask, don't guess (more context / stronger model / split task / escalate). Never silently retry the same model unchanged.
3. **Per-task review.** Spec compliance + code quality, scoped to this task's diff (write the diff to a file; hand the reviewer the brief, the report, the diff, and the binding Global Constraints verbatim). Route:
   - **Major** → harry's `/review` (frontier).
   - **Standard** → a free CC reviewer subagent on the shared rubric (`references/review-rubric.md`).
   - Do not pre-judge findings or tell the reviewer what not to flag.
4. **Fix loop.** Critical/Important findings → dispatch a fix subagent (model per the routing above; carries the implementer contract: re-runs covering tests, reports command + output). Re-review. Repeat until spec ✅ and quality approved. Minor findings → record in the ledger for final triage. A finding that conflicts with the plan → human decides (present finding + plan text).
5. **Mark complete.** Append one line to the ledger: `Task N: complete (commits <base7>..<head7>, review clean)`. Do not check in with the human between tasks — execute the whole plan; stop only for BLOCKED or genuine ambiguity.

After all tasks:

6. **Final review** — one broad whole-branch review (frontier `/review` for Major). Package the full branch diff (`merge-base..HEAD`) to a file. Findings → **one** fix subagent with the complete list (not one fixer per finding). Point it at the ledger's Minor list to triage what must be fixed before merge.
7. → **finishing** skill.

## Never

- Guess past a BLOCKED — stop and ask.
- Work on main/master without consent.
- Paste session history or whole-plan files into a dispatch — hand briefs/reports/diffs as files.
- Skip per-task review, or accept a report missing either verdict (spec AND quality).
- Re-dispatch a task the ledger already marks complete.
- Claim done without fresh verification evidence (HARRY.md §6).

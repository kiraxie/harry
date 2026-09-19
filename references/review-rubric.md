# Review Rubric (shared)

The rubric a **CC reviewer subagent (dispatched at the §5 cap)** applies for per-task and whole-branch
reviews (`skills/executing/SKILL.md`, subagent mode steps 3 and 6), and for Standard's
single review (session mode step 4). This is also the rubric `/harry:review`
embeds verbatim into its `codex exec review` prompt for step 6's Codex lane, so
the two lanes judge by the same standard even though they run in isolated
sessions. Hand the reviewer the acceptance criteria it judges — the task's brief
for a per-task review, the item's `### Acceptance criteria` verbatim for a
whole-branch pass — plus the report, the diff (as a file), and the item's
Constraints verbatim when it has them. It reviews **read-only** — no
working-tree, index, or HEAD mutation.

## Four dimensions

1. **Spec compliance** (primary). Does the diff satisfy the acceptance criteria
   it was given — no more, no less? Judge **per AC**: pass / fail / partial, each
   with the evidence you read. Flag unmet criteria AND unrequested extras
   ("Extra: added `--json`, not in any AC"). Any AC not `pass` means the task is
   not done, however clean the code. This is the dimension frontier reviewers
   under-weight and the one worth keeping.
2. **Code quality.** Clear separation of concerns; error handling at trust
   boundaries; edge cases (empty / null / overflow / concurrency); type safety
   where the language offers it; integrates cleanly with surrounding code.
3. **YAGNI / altitude** (HARRY.md §1–§2). Speculative abstraction (interface with
   one impl, factory for one product, config for a constant), premature
   generality or optimization (a cache/index/clever rewrite with no measured
   bottleneck — §1), dead scaffolding → flag for deletion. **Counter-constraint:**
   grep-unused is necessary but NOT sufficient to cut — run the drift test first.
   A cross-boundary contract, trust-boundary validation, or correctness
   infrastructure stays even if currently uncalled (§2). Do not YAGNI away a
   red line.
4. **Test hygiene** (HARRY.md §6). Tests assert real behavior on real code, not
   mocks; one behavior per test with a clear name; a bug fix has a failing
   reproduction test (tier permitting); GREEN is the minimal code that passes.
   Flag tests that assert nothing.

## Severity

- **Critical** — bugs, security holes, data-loss risk, broken functionality, an
  acceptance criterion unmet.
- **Important** — architecture problems, poor error handling, test gaps,
  unrequested scope, a red line crossed.
- **Minor** — style, naming, local optimization, doc polish. Record in the
  item's `## Follow-ups` for final triage; do not block on these.

Categorize by *actual* severity — not everything is Critical, and a nitpick is
never Critical. Acknowledge what was done well before listing issues.

## Rules

- **Do not pre-judge.** Never tell the reviewer what not to flag, or pre-rate a
  finding's severity ("treat as Minor at most", "the AC chose this"). If you
  think a finding is a false positive, let it surface and adjudicate it in the
  review loop. The brief's example code is a starting point, not proof its
  weaknesses were chosen.
- **Be specific:** `file:line`, what's wrong, why it matters, how to fix.
- A finding that **conflicts with an AC** is the human's call — present the
  finding beside the AC text; do not silently fix against the AC, or dismiss
  the finding because the AC mandated it.
- Give a clear verdict. No "looks good" without evidence read.
- **Review it yourself.** Never dispatch a subagent to review part of the diff or
  for a second opinion; every review seat is already provided. A diff too large
  for one pass is reviewed in passes — say so in the report.
- **Unreadable evidence is a gap, not a failure.** If the report or its test
  evidence looks truncated, or you cannot locate results it claims, re-read the
  file at its stated path first; a run of your own does not fill the report's
  gap — report the gap either way. Where a report was handed (subagent mode),
  missing or genuinely illegible test evidence in it is at least Important and
  blocks `pass` for that AC (report it as evidence missing) until the
  implementer supplies it — even though it is not itself a finding against the
  code. An AC whose named verification path is missing or unreadable is the same
  blocker.
- **Batched briefs are checked file by file.** When the brief lists several
  files each with its own change, every listed file must have its hunk in the
  diff; a listed file the diff never touches is a missing-requirement (spec)
  finding, however clean the rest looks.

## Output

```
### Strengths
[specific, file:line]

### Issues
#### Critical (must fix)
#### Important (should fix)
#### Minor (nice to have — item's `## Follow-ups` for final triage)
[each: file:line · what's wrong · why it matters · how to fix]

### Assessment
Spec (one line per AC): AC-1 pass / fail / partial · evidence read
                        AC-2 …
Quality: Approved / Changes requested
Verdict: Ready to merge — Yes / No / With fixes  ·  1-2 sentence reasoning
```

Both verdicts (**spec** AND **quality**) are required — a report missing either
is not a valid review. This binds every review run against this rubric; executing
states the acceptance rule at both of its review steps — session mode step 4
(Standard) and subagent mode step 3 (Major).

**When no acceptance criteria were handed** — a bare `/harry:review` on an
arbitrary diff, or a legacy item that has none — the spec line says exactly that
(`Spec: no acceptance criteria handed`) and the review judges the other three
dimensions. That is a complete report, not a missing verdict. Never invent
criteria to judge against.

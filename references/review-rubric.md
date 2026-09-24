# Review Rubric (shared)

The rubric the `analyst` reviewer applies at executing's review (`skills/executing/SKILL.md`,
step 3, and its scoped re-review in step 4). This is also the rubric `dist/companion.cjs review`
embeds verbatim into its `codex exec review` prompt (`src/lib/review-prompts.ts`), so
the analyst and Codex lanes judge by the same standard even though they run in isolated
sessions. On the Codex build there is no `analyst` at all, so this
embedded prompt is what binds that build's single review lane. Hand the
reviewer the item's `### Acceptance criteria` verbatim, the diff range, and the
item's Constraints verbatim when it has them. It reviews **read-only** — no
working-tree, index, or HEAD mutation; its report is its final message.

## Four dimensions

1. **Spec compliance** (primary). Does the diff satisfy the acceptance criteria
   it was given — no more, no less? Judge **per AC**: pass / fail / partial, each
   with the evidence you read. An AC that a later AC supersedes is judged by
   its successor, not on its own (`references/doc-types.md`): its line reads
   `superseded by AC-<m>`, never `fail`, and only the successor's verdict
   counts. Flag unmet criteria AND unrequested extras
   ("Extra: added `--json`, not in any AC"). Any AC not `pass` means the task is
   not done, however clean the code. This is the dimension frontier reviewers
   under-weight and the one worth keeping.
2. **Code quality.** Clear separation of concerns; error handling at trust
   boundaries; edge cases (empty / null / overflow / concurrency); type safety
   where the language offers it; integrates cleanly with surrounding code. Flag a
   comment that restates the code, justifies a workaround, or resists a change —
   code carries no comment by default (HARRY.md §4).
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
  think a finding is a false positive, let it surface and adjudicate it after the
  fix wave.
- **Be specific:** `file:line`, what's wrong, why it matters, and the long-term
  structural fix — never a workaround (HARRY.md §6).
- A finding that **conflicts with an AC** is the human's call — present the
  finding beside the AC text; do not silently fix against the AC, or dismiss
  the finding because the AC mandated it.
- Give a clear verdict. No "looks good" without evidence read.
- **Review it yourself.** Never dispatch a subagent to review part of the diff or
  for a second opinion; every review seat is already provided. A diff too large
  for one pass is reviewed in passes — say so in the report.
- **Unreadable evidence is a gap, not a failure.** An AC whose named verification path is
  missing or unreadable is at least Important and blocks `pass` for that AC
  (report it as evidence missing).
## Output

```
### Strengths
[specific, file:line]

### Issues
#### Critical (must fix)
#### Important (should fix)
#### Minor (nice to have — item's `## Follow-ups` for final triage)
[each: file:line · what's wrong · why it matters · structural fix · short-term fix, only when the structural one is not simple]

### Assessment
Spec (one line per AC): AC-1 pass / fail / partial / superseded by AC-<m> · evidence read
                        AC-2 …
Quality: Approved / Changes requested
Verdict: Ready to merge — Yes / No / With fixes  ·  1-2 sentence reasoning
```

Both verdicts (**spec** AND **quality**) are required — a report missing either
is not a valid review. This binds every review run against this rubric; executing
states the acceptance rule at its review step (step 3).

**When no acceptance criteria were handed** — a bare `/harry:review` on an
arbitrary diff, or a legacy item that has none — the spec line says exactly that
(`Spec: no acceptance criteria handed`) and the review judges the other three
dimensions. That is a complete report, not a missing verdict. Never invent
criteria to judge against.

# Rounds 3–6: Validate, Structure, Fact-check, Report

These four rounds turn raw Round 2 findings into a trustworthy report. The two quality gates (Round 3 and Round 5) do **different jobs** and must not be collapsed:

- **Round 3 (adversarial)** — *is this a real problem worth fixing?* Judgment.
- **Round 5 (independent fact-check)** — *are the cited facts correct?* Facts only.

Collapsing them is the single easiest way to waste effort here, because without a security exploit to construct, "disprove it" and "re-verify it" both tempt an agent into re-litigating taste. Keep the questions distinct.

---

## Round 3: Adversarial validation

**Consolidate duplicates first.** Round 2 overlaps agent scopes on purpose, and the same root cause surfaces from multiple agents wearing different dimension hats (a "raw SQL in route" is reported as both pattern-fit and layering). Merge findings that share a root cause **before** validating — otherwise you validate and report the same problem twice. This overlap is heavier than in a security audit, because quality dimensions aren't cleanly separable; be aggressive about merging.

Then, for each surviving finding, launch a **separate `research` validation agent** whose job is to **disprove** it. Round 2 agents are biased to find; these are biased to kill false positives. Batch findings from the same area into one agent; run independent areas in parallel.

Give each validation agent the finding plus `intended-architecture.md`, and these tests — aimed squarely at this domain's false-positive modes:

```
Your job is to DISPROVE this finding. Read the actual source at every cited location.

1. COST TEST: Is the claimed concrete_cost real? Construct the future change or reproduce the
   reasoning. If the "cost" is just "it's not how I'd write it" with no change made harder and
   no bug caused -> REJECT.

2. DRIFT TEST (reuse/duplication/hoist findings): Would divergence actually be a bug, or is this
   independent evolution that's FINE to diverge? If fine-to-diverge -> REJECT (incidental
   duplication is not a DRY violation).

3. SPECULATIVE-ABSTRACTION TEST: Does the remediation add an abstraction (Strategy/Factory/
   Repository/interface/config) that isn't earned by the demonstrated cost — e.g. indirection
   for a single call site, or generality for a future that may never come? If the fix is
   over-engineering -> REJECT or downgrade to "leave as-is".

4. IDIOM TEST: Is the flagged code actually a framework/language idiom, or the codebase's own
   established dominant pattern? Check the DO-NOT-FLAG list. If it's an idiom -> REJECT.

5. SUBSTRATE TEST: Do the cited facts hold? Is the "dead" export actually reachable via dynamic
   import / DI / reflection / public API? Is the "cycle" real in the current graph? If the
   underlying fact is wrong -> REJECT.

6. SEVERITY TEST: Is blast_radius × change_likelihood consistent with the claim? A real problem
   in cold, never-touched code is LOW, not HIGH.

Return one of:
- "CONFIRMED: [why it's real, with code evidence and the surviving concrete_cost]"
- "REJECTED: [which test it failed, with code evidence]"
- "DOWNGRADED: [confirmed but severity/remediation corrected to X because ...]"
```

Kill false positives aggressively; do not kill real findings. A short report with 3 real HIGHs beats a long one with 30 taste notes. An honest "the structure is largely sound" is a valid outcome — but push before concluding it.

---

## Round 4: Structured output

For every finding that survived Round 3, write a structured object to `<output-dir>/findings.json` conforming to `report-schema.json` (in this skill's directory).

**Before writing:**

1. Read `report-schema.json`. `additionalProperties: false` is enforced — extra fields fail validation.
2. The schema has two verdicts via `oneOf`: `confirmed` (full finding) and `rejected` (investigated and dropped — keep these so a later run doesn't re-derive them). Populate every required field. If you can't fill `evidence` with real `file:line` verified against source, the finding isn't ready — verify or reject it.
3. Run `node <skill-dir>/validate-findings.cjs <output-dir>/findings.json`. It checks required fields, enums, `additionalProperties`, and the semantic rules (a confirmed finding needs a non-empty `concrete_cost` and evidence; a hoist finding needs ≥2 evidence sites). This is a **structural** check only — it confirms the JSON is well-formed, not that findings are correct (that's Round 5). Fix failures before proceeding.

---

## Round 5: Independent fact-check

Round 4's structure forces self-consistency, but the agent that wrote the finding also wrote its JSON — it won't catch its own blind spots. This round uses **fresh agents, none of which wrote the findings they check**, verifying only **facts** — never re-judging whether the problem "matters" (that was Round 3).

One agent per finding is not required and is often wasteful — batching several findings (5-8) into one fact-checking agent works fine and is cheaper, as long as each finding in the batch is self-contained for the agent to verify independently. When batching, identify each finding to the agent **by its title** (or another self-describing label), never by its bare array index — index-based references are exactly the kind of off-by-one detail a batch-processing agent gets wrong (skips one, double-checks another), and a wrong-target fact-check is worse than a skipped one because it looks done. If you do assign by index for bookkeeping, restate the title alongside it in the prompt.

Give each agent its finding(s) (JSON) and:

```
You are an independent fact-checker. You did NOT write this finding, and you are NOT judging
whether it's worth fixing — only whether its factual claims are TRUE. Read the actual source.

1. Every evidence location: does the file exist at that path? Does the line match the described
   code? Is the scope (function/module) name correct? Does the description match what the code does?
2. Every count/measurement: are there really N duplication sites? Is the cycle really A->B->C->A
   in the current code? Is the churn rank cited correctly against substrate/churn.txt?
3. For hoist findings: do the cited implementations actually exist and actually differ as the
   drift delta claims?
4. Does the remediation reference real destinations (the shared package/path actually exists or
   is the stated intended location)?

Return one of:
- "VERIFIED" — every factual claim checks out against source.
- "CORRECTED: [field]: [wrong] -> [right]" — a specific factual error.
- "REJECTED: [reason]" — a claim is fundamentally false (cited code doesn't exist / doesn't
   do what's described). This kills the finding on FACTS, not taste.
```

Apply results:
- **VERIFIED** → no change.
- **CORRECTED** → fix the field in `findings.json`, re-run `validate-findings.cjs`.
- **REJECTED** → flip `verdict` to `rejected` with the reason, or remove it.

---

## Round 6: Human report

Write the human-readable deliverables **last**, so verification (Round 5) never forces a rewrite. Reconcile: `REPORT.md` and `findings.json` must not disagree — every confirmed finding in the JSON appears in the report and vice versa.

**`REPORT.md`:**
- **One-paragraph health assessment** — honest overall posture, calibrated (say what's solid).
- **What this codebase is** and the intent baseline it was measured against.
- **Findings table** — severity (HIGH/MODERATE/LOW), dimension, title, one-line cost, bucket.
- **Each finding** — the concrete cost, evidence (`file:line`), remediation, severity rationale (blast × churn), and its **bucket**:
  - **fix-now** — cheap and in the blast radius of active work; do it in the next PR touching that area (the "clean legacy in the scope you touch" case).
  - **tracked-debt** — real cost, needs its own effort; belongs in a ticket/debt ledger with the concrete_cost as justification.
  - **accepted** — noted, but the cost is low enough to live with; recorded so it isn't re-litigated next run.
- **What the codebase does well** — solid patterns, clean boundaries. This calibrates trust in the findings.
- **Coverage & next run** — what this run focused on, what it deliberately or accidentally left (cite the substrate README's known gaps, e.g. drifted-beyond-recognition hoist candidates), and a recommendation to re-run weighted toward the gaps.

**`FINDINGS-DETAIL.md`** — for each MODERATE+ finding: the full evidence set with every `file:line`, the drift delta (hoist findings), the traced future-change that demonstrates the cost, and the concrete remediation. Keep it proportional — if the detail is longer than the code deserves, you're padding.

If the target uses a debt ledger convention (e.g. `DEBT:` markers, a debt command), emit the **tracked-debt** findings in that format too, so they flow into the team's existing process instead of dying in a report.

# Claim → Evidence — the claim/evidence map for HARRY.md §6 (Honesty & evidence)

**Core principle: evidence before claims, always.** No completion claim without fresh
verification evidence — run the command, read the output (exit code, failure count), *then*
claim. If you haven't run the verification in this message, you cannot claim it passes.

## The map

| Claim | Required evidence | Not sufficient |
|-------|-------------------|----------------|
| Tests pass | Test command output: 0 failures, in this message | A previous run; "should pass" |
| Linter clean | Linter output: 0 errors | A partial check; extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing; "logs look good" |
| Bug fixed | Test the original symptom: it passes | Code changed, assumed fixed |
| Regression test works | Full red-green cycle verified (write → fail → fix → pass) | Test passes once |
| Agent / subagent done | Check the **VCS diff** — the actual changes | The agent's word ("success") |
| Requirements met | Line-by-line checklist against the spec | Tests passing |

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Should work now" | Run the verification. |
| "I'm confident" | Confidence ≠ evidence. |
| "Just this once" | No exceptions. |
| "Linter passed" | Linter ≠ compiler. |
| "Agent said success" | Verify independently — read the diff. |
| "Partial check is enough" | Partial proves nothing. |
| "I'll commit now and verify after" | The commit / push / PR *is* the claim — verify before it lands, not after. |

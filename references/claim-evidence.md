# Claim → Evidence — full detail for HARRY.md §6 (Honesty & evidence)

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

## Red flags — STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit / push / open a PR without running verification
- Trusting an agent's success report instead of reading the diff
- Relying on a partial check
- Thinking "just this once" or "I'm tired, close enough"
- **Any wording that implies success without having run the verification**

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Should work now" | Run the verification. |
| "I'm confident" | Confidence ≠ evidence. |
| "Just this once" | No exceptions. |
| "Linter passed" | Linter ≠ compiler. |
| "Agent said success" | Verify independently — read the diff. |
| "Partial check is enough" | Partial proves nothing. |

## Why

An agent's "success" is not evidence: agents report completion they did not achieve, ship
undefined functions, and miss requirements. The diff is the truth. Read it. Run the command.
Then claim — never before.

# Tier Gates — full detail for HARRY.md §3

Classify every non-trivial task into exactly one tier, then run that tier's gates.
**Take the highest tier whose trigger is hit. When in doubt, go higher.**

## The three tiers

### Trivial

| Gate | Setting |
|------|---------|
| Trigger | 1 file, mechanical, no branching logic, revert is one glance |
| Brainstorm | skip |
| Spec | none |
| Plan | none |
| TDD | none — trivial one-liners need no test |
| Review | none |
| Execution | session, one-shot (no subagent needed) |
| Todos | none |

### Standard

| Gate | Setting |
|------|---------|
| Trigger | 2–5 files, real logic, single subsystem |
| Brainstorm | compressed — confirm intent + approach in a few lines, no full exploration |
| Spec | `*-design.md` in `.local/specs/` if a decision needs recording; otherwise inline |
| Plan | bullet plan (`*-plan.md` in `.local/plans/`) |
| TDD | one runnable check left behind (smallest thing that fails if the logic breaks); watch-it-fail encouraged, not mandatory |
| Review | free subagent review, or skip |
| Execution | subagent |
| Todos | track the few units if the plan has more than one step |

### Major

| Gate | Setting |
|------|---------|
| Trigger | 6+ files, cross-subsystem, **or any red line (see below)** |
| Brainstorm | full — explore intent, requirements, design before any code |
| Spec | full `*-design.md` in `.local/specs/` with decision records (Discussion → Decision → considered-but-rejected) |
| Plan | full `*-plan.md` in `.local/plans/`, step-by-step |
| TDD | full red-green-refactor, **watch-it-fail mandatory** (`references/red-green.md`) |
| Review | `/review` |
| Execution | subagent (parallelize independent units in isolated worktrees) |
| Todos | one todo per plan unit, kept current |

## Promotion rules

Tiers are not chosen by file count alone. Apply these in order:

1. **Red lines → auto-Major, unconditionally, regardless of file count.** If the task touches any of:
   - **security / auth** — authentication, authorization, secrets, permissions
   - **money** — billing, payments, balances, pricing
   - **delete / destructive** — data deletion, `DROP`, irreversible mutation
   - **migration** — schema or data migration
   - **external contract** — a public API, wire format, or anything another system depends on
   - **cross-boundary contract** — shared knowledge that two sides must agree on (the DRY drift test: silent divergence = a bug)

   …then it is **Major**, even if it is a one-line change in a single file.

2. **Branching logic upgrades Trivial → Standard.** The moment the change introduces a branch, loop, parser, or any real decision, it is no longer Trivial. "No branching" is the line between Trivial and Standard.

3. **Take the highest tier whose trigger is hit.** Count files, check subsystems, scan for red lines and branching — whichever lands highest wins. Ties and uncertainty resolve upward.

## Red flags (you're rationalizing — stop)

"It seems simple" is not a tier. "Just a quick fix" does not skip the gates. Classify first, then follow the matching flow.

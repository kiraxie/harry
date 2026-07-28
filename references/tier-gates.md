# Tier Gates — full detail for HARRY.md §3

Classify every non-trivial task into exactly one tier, then run that tier's gates.
**Take the highest tier whose trigger is hit. When in doubt, go higher.**

## The three tiers

### Trivial

| Gate | Setting |
|------|---------|
| Trigger | 1 file, mechanical, no branching logic, revert is one glance |
| Brainstorm | skip |
| Item | none |
| TDD | none — trivial one-liners need no test |
| Review | none |
| Execution | session, one-shot (no subagent needed) |

### Standard

| Gate | Setting |
|------|---------|
| Trigger | 2–5 files, real logic, single subsystem |
| Brainstorm | compressed — confirm intent + approach in a few lines, no full exploration |
| Item | one `.local/items/<slug>.md`, `status: active` — `## Why / What` filled ONLY when a real design decision was weighed (alternatives existed); otherwise skip straight to `## Plan` and record the decision inline at its top. `## Plan` is always a bullet plan. |
| TDD | one runnable check left behind (smallest thing that fails if the logic breaks); watch-it-fail encouraged, not mandatory |
| Review | free subagent review — required (compensates for inline execution) |
| Execution | session (inline), in an isolated worktree per §5 |

### Major

| Gate | Setting |
|------|---------|
| Trigger | 6+ files, cross-subsystem, **or any red line (see below)** |
| Brainstorm | full — explore intent, requirements, design before any code |
| Item | one `.local/items/<slug>.md`, `status: active` — `## Why / What` is a full decision record (Discussion → Decision → considered-but-rejected), `## Plan` is full step-by-step. If the work spans several items, add a `type: milestone` item linking them. |
| TDD | full red-green-refactor, **watch-it-fail mandatory** (`references/red-green.md`) |
| Review | `/review` |
| Execution | subagent (parallelize independent units in isolated worktrees) |

**Gate scaling on a red-line promotion.** When a red line — not file count — is what forces Major, the promotion exists to guarantee the **verification** gates: a failing-reproduction / red-green test with watch-it-fail, frontier `/review`, and full evidence discipline (§6), because the domain risk is exactly what those gates guard. The **design** gates scale with the change's actual design complexity — a mechanically-trivial red-line change (one-glance diff, no alternatives to weigh) takes a compressed brainstorm and a one-line `## Why / What`, not the full decision record. Scaling never reaches verification: a trivial-looking change in a red-line domain still ships red-green + review.

## Promotion rules

Tiers are not chosen by file count alone. Apply these in order:

1. **Red lines → auto-Major, unconditionally, regardless of file count.** These are §2's promotion-triggering red-line domains, restated here for the tier decision — **§2 is authoritative: if this list and §2 diverge, §2 wins.** If the task touches any of:
   - **security / auth** — authentication, authorization, secrets, permissions
   - **money** — billing, payments, balances, pricing
   - **delete / destructive** — data deletion, `DROP`, irreversible or destructive mutation
   - **migration** — schema or data migration
   - **external contract** — a public API, wire format, or anything another system depends on
   - **cross-boundary contract** — shared knowledge that two sides must agree on (the DRY drift test: silent divergence = a bug)
   - **input validation** — untrusted input at a trust boundary
   - **data-loss error handling** — error paths whose absence risks losing data
   - **accessibility** — keyboard, screen-reader, and semantic-markup paths

   …then it is **Major**, even if it is a one-line change in a single file. (§2 carries one further never-simplify entry — *anything the user explicitly requested* — that is never-simplify-**only** and does **not** promote: a requested change's tier is whatever these nine triggers plus the file/subsystem count make it.)

2. **Branching logic upgrades Trivial → Standard.** The moment the change introduces a branch, loop, parser, or any real decision, it is no longer Trivial. "No branching" is the line between Trivial and Standard.

3. **Take the highest tier whose trigger is hit.** Count files, check subsystems, scan for red lines and branching — whichever lands highest wins. Ties and uncertainty resolve upward.

## Incident lane

**User-declared only.** When the user calls it an incident ("incident", "ship it now"), invert the order — fix and verify first, then back-fill the rest. Verification is not skipped: the covering / reproduction test still runs and nothing merges red; only the *sequencing* moves. Review and the process artifacts (the `.local/` item, INDEX/HISTORY lines, `DEBT:` markers) are back-filled immediately after shipping, the same day. A model may never self-declare an incident — deciding on your own that something is urgent enough to bypass the flow is a §7 rationalization.

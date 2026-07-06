# Scan Dimensions

The facets a code audit hunts along. In Round 2, fan out by **workspace × dimension** — assign each agent a scope (a subsystem/package) and one or two dimensions, so each stays deep instead of shallow-everywhere.

Not every dimension applies to every codebase. Pick the ones the target's `intended-architecture.md` and substrate make relevant. Each dimension below states **what it is**, **the deterministic seed** (what Round 1 substrate feeds it), and **the falsifiability bar** (what a real finding must show — the SKILL.md Principle 1 anchor, specialized).

Every finding, in every dimension, must clear the same bar: name the concrete future change made expensive/dangerous, or the bug already caused.

---

## 1. Design-pattern fit

**What:** Places where the code fights a pattern the rest of the codebase (or its stated intent) uses — a wall of `if/else` on a type where a lookup/dispatch is the established idiom; business logic welded directly to the framework (raw SQL in a route handler when a Repository layer exists); polling where an existing event/queue mechanism is the norm.

**Seed:** semgrep rules for "framework primitive used directly in the wrong layer"; complexity hotspots (long branchy functions); `intended-architecture.md`'s stated patterns and doc-vs-reality gaps.

**Bar:** Show the cost of the mismatch, not its existence. "This `switch` handles 8 cases and every new type touches 3 such switches scattered across the module → adding a type means finding all 3, and the last two PRs that added a type each missed one." Do **not** flag a 2-case `if/else` and call it a missing Strategy — that's Principle 2 (speculative abstraction) in disguise.

## 2. Reusability & hoist candidates (same-intent code that drifted apart)

**What:** Logic that exists in more than one place with the same purpose but a divergent implementation — the classic outcome of merging two codebases, or of two teams solving the same problem independently. Token-level clone detectors miss these *because* they drifted. This dimension has its own two-stage funnel: Stage A (deterministic candidate generation) runs in Round 1 — see RECON.md "Step 1b"; Stage B (LLM adjudication) runs in Round 2 — see DEEP-DIVE.md "Hoist-candidate funnel."

**Seed:** cross-boundary symbol/filename fuzzy matches; shared-external-dependency fingerprints; git provenance (files merged in from another repo; prior hoist PRs).

**Bar:** The two implementations must (a) share intent and (b) **fail the drift test** — divergence between them would be a bug, not healthy independent evolution. Then: name the drift delta (how they already differ), the canonical version, and the designated shared destination. Incidental similarity that's fine to diverge is **not** a finding.

## 3. Copy-paste duplication (token-level)

**What:** Literal or near-literal duplicated blocks — the easy case, where the drift test almost always says "bug if they diverge" because they're still identical.

**Seed:** `jscpd` / `dupl` output directly.

**Bar:** More than incidental (past the rule of three, or cross-boundary on first occurrence), and divergence would be a bug. A duplicated 3-line guard that's genuinely independent is not a finding.

## 4. Coupling & dependency structure

**What:** Circular dependencies; a module that imports half the codebase (or is imported by half); layering violations (a lower layer reaching up, a product module importing infrastructure it shouldn't, an inner module depending on an outer one).

**Seed:** `madge --circular` / `go mod graph` / `import-linter` cycles; fan-in/fan-out from the dependency graph; `intended-architecture.md`'s stated dependency boundaries.

**Bar:** Name what the coupling blocks. "This cycle means `A` can't be built/tested/moved without `B`, and the team split PR #X had to be reverted because of it." A cycle with no demonstrated cost, in cold code, is LOW at most.

## 5. Layout & module boundaries

**What:** Directory structure that fights the real domain boundaries — logic for one concern scattered across "technical" folders; "fake modules" (a folder whose responsibility overlaps another's); inconsistent import styles (relative vs alias) that signal unclear boundaries.

**Seed:** the layout map from Agent 2b; churn co-occurrence (files that always change together but live far apart signal a boundary in the wrong place).

**Bar:** Show the navigation/change cost: "a single feature change routinely edits files in 4 unrelated-looking directories." Not "I'd have organized this differently."

## 6. Dead code & unused surface

**What:** Unreachable code, unused exports, orphaned files, feature flags for shipped/abandoned features.

**Seed:** `knip` / `ts-prune` / `deadcode` / `vulture` directly.

**Bar:** Mostly self-proving from the tool, but **verify** before reporting — dynamic imports, reflection, DI registration, and public-API/library exports produce false positives in every dead-code tool. A finding is: confirmed-unreachable **and** it carries maintenance weight (it's read, updated, or tested as if live). Cite the tool line and the confirmation.

## 7. Error-handling consistency

**What:** Divergent strategies across modules — some throw, some return error tuples, some swallow; empty catch blocks; errors caught and logged then re-thrown (double handling); inconsistent error envelopes across an API boundary.

**Seed:** semgrep/grep for empty catches, `catch` without log/rethrow, mixed `throw` vs return-error in the same layer.

**Bar:** Tie it to a failure: "these swallowed errors mean a failed DB write returns 200 and the caller proceeds on stale data." Inconsistency alone, with no failure path, is LOW.

## 8. Observability gaps

**What:** Critical paths (auth, payment, data-mutation, external calls, queue consumption) with no log/trace/metric — when it breaks in production, nobody can tell where.

**Seed:** the critical-path list from `intended-architecture.md`; grep for logging/tracing calls and find the hot paths that have none.

**Bar:** Identify a concrete incident-response failure: "if this payment-capture call fails, there is no log line and no metric — the first signal is a customer complaint." Not "more logging would be nice."

## 9. Structural test-coverage holes

**What:** Not a coverage *percentage* — a *type* of logic branch that is entirely untested (all error paths in a subsystem, a whole state-machine transition class, the concurrency guards). Also: tests that don't actually exercise the real code (mock-only tests that reimplement the logic they claim to test).

**Seed:** test-file-to-source mapping; branch/error paths from complexity output cross-referenced with what tests touch.

**Bar:** Name the class of bug that ships undetected: "no test drives the `PENDING→FAILED` transition, so a regression there passes CI." A single missing edge-case test is not a structural hole.

---

### Choosing dimensions and shaping agents

- Weight toward dimensions the substrate lit up (many cycles → dimension 4; a recent repo merge → dimension 2) and toward high-churn areas.
- One agent may own one dimension across a subsystem, or two related dimensions (4+5, 7+8) in one scope — but don't hand an agent everything, or it goes shallow.
- Every agent's scope is a *focus, not a fence*: if a coupling agent trips over a swallowed error, it reports it. Attackers-of-badness don't respect category lines.

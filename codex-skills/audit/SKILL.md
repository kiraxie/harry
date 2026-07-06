---
name: audit
description: Whole-codebase structure & architecture-fitness audit — a six-round, iterative, multi-language (TypeScript/JavaScript, Go, Python) workflow that finds design-pattern mismatches, missed reuse / hoist candidates (same-intent code that drifted apart), layering violations, dead code, coupling/circular dependencies, error-handling & observability gaps, and structural test-coverage holes. Use when the user asks to audit a codebase's design/architecture/maintainability, review structure across many files, find technical debt, find duplicated-but-drifted logic that should be shared, check whether the code matches its own stated architecture, or do a "codebase health check" — even if they don't say the word "audit". This is the macro/structural counterpart to a code review — reach for it for the whole repo or a whole subsystem, not a single change.
---

# Audit

You are a codebase auditor. Your job is to find **structural and architectural problems that carry a concrete, demonstrable cost** — not style opinions, not deviations from a textbook.

A security audit has a clean anchor: "can you build an exploit?" This domain does not. "This should use the Strategy pattern" is a taste claim, and if you let taste drive findings the whole audit degrades into two agents arguing aesthetics. So this skill is built around a substitute anchor — the **falsifiability anchor** below — and everything downstream (the adversarial round, the verification round) exists to enforce it.

## Where this sits among related tools

| Tool | Direction | Scope | Cadence |
|---|---|---|---|
| a diff-level code review | correctness | a change | per PR |
| an over-engineering / "lean" pass | **subtract** (delete, simplify) | diff or project | one-shot |
| a debt-ledger pass | re-judge existing debt markers | existing markers | one-shot |
| **this audit** | **restructure / consolidate** (incl. hoist) | **whole repo / subsystem** | **iterative, accumulative** |

The one place this audit and a "lean" pass could seem to contradict — one says *extract a shared abstraction*, the other says *delete abstraction* — is reconciled by the **drift test**: this audit only proposes a hoist when divergence would be a bug (cross-boundary shared truth), which is exactly the case where even KISS/YAGNI says extract. Outside that case, it leaves duplication alone. So the two never fight over the same code.

Multi-language support: Round 1's substrate collection is the only language-dependent layer, via a per-language tool matrix (TS/JS: knip, madge, jscpd; Go: deadcode, dupl, gocyclo; Python: vulture, import-linter, radon; cross-language: jscpd, scc, semgrep, git churn — see `${CLAUDE_PLUGIN_ROOT}/references/audit/RECON.md`). Tools are pulled on-demand (npx / go run / uvx) so the audit adds nothing to the target's manifests. Everything from Round 2 on is language-neutral.

## Known limitation vs. the Claude Code build

The Claude Code version gates Round 2's `general`/`research` sub-agent split through its own Task/Agent tooling and a read-only trust boundary for RO rounds enforced by tool allowlists. Codex has no discovered per-skill tool permission gate — follow the same role/parallelism/independence boundaries below as hard instructions instead of relying on enforcement.

## Platform terminology

- **`research` agent** means a delegated agent optimized for focused codebase exploration and factual verification.
- **`general` agent** means a delegated agent that can investigate broadly and spawn focused research agents.

Use Codex's equivalent sub-agent/delegation mechanism while preserving the specified roles, parallelism, prompts, and independence boundaries.

If an agent is killed mid-task (quota/session limit, transient API error), **resume it** rather than relaunching fresh — a resumed agent keeps its context (files already read, partial conclusions) and only needs a short nudge to finish and deliver its final answer. A fresh relaunch re-reads everything from zero at full cost. Only relaunch fresh if the platform gives no resume mechanism.

## Setup

Establish two paths before starting:

- **Target**: the codebase to audit (from what the user said, or the current working directory). Confirm the scope — whole repo, or a named subsystem / set of workspaces.
- **Output directory**: where all audit artifacts go. If the user named one, use it. Otherwise, if the repo has a gitignored `.local/` directory, default to `.local/audit/run-<N>/`; else default to `.code-audit/run-<N>/`. `<N>` is the next unused integer (check with `ls`). Ask the user if they want somewhere else. Create it if missing. Separate run directories are what make the audit **iterative** (see below).

All files written during the audit go in the output directory:

- `substrate/` — Round 1 raw tool output (dead-code lists, cycle graphs, duplication reports, churn) — the factual bedrock every later round cites
- `intended-architecture.md` — Round 1 output: the codebase's own stated intent, fed into every later round
- `findings.json` — machine-readable structured output (Round 4)
- `REPORT.md` — human-readable report (Round 6)
- `FINDINGS-DETAIL.md` — detailed evidence for MODERATE+ findings (Round 6)

Subagents in Round 1 (Steps 1b and 2), Round 2, Round 3, and Round 5 do NOT write files — they return results to you. You write all files. Rounds 4 and 6 have no subagents at all — structured-output assembly and report writing are yours directly, not delegated.

## Iterative by design — no single run is complete

Like a security audit, one run does not find everything: which agents dig where determines what surfaces. This skill is meant to be **run repeatedly**, each run a full pass that accumulates.

**If prior runs exist** for this repo (check sibling `run-*` directories), read their `findings.json` before Round 2 and use them to:

1. **Skip known findings** — don't re-derive the same god-object. Mention it, but spend agents on new ground.
2. **Target gaps** — if prior runs leaned on dead-code and coupling, weight this run toward hoist-candidates, pattern-fit, and observability.
3. **Track progress** — was a prior finding fixed? A finding that disappeared is a win worth recording; one still present after N runs is hardening the case that it's real.

**Also mine the repo's own audit trail**, whether or not a prior `run-*` exists — most real codebases already have one, and it's often richer than anything this skill produced before: existing tech-debt ledgers, `DEBT:`-marker sweeps, prior manual reuse/hoist audits, architecture-review docs, or a debt-tracking convention (check any project-specific instruction files for where these live). Treat their open items as leads and their explicitly-rejected items as a skip-list — re-report a rejected item only with genuinely new evidence. This is frequently the single highest-value input to Round 1, because it's targeted where the team already knows the pain is.

**If no prior runs exist and no such repo-native ledger exists**, say so in the report and recommend re-running to improve coverage.

## Core Principles

### 1. The falsifiability anchor — every finding names a concrete cost

A finding is only real if it answers: **which specific future change does this structure make expensive or dangerous, or what bug has it already caused?** Name that change or that bug. If you can't, the finding is taste — drop it.

- ❌ "High coupling here, violates SRP." — unfalsifiable. Cut it.
- ✅ "`computeFee` is duplicated byte-for-byte in `billing/` and `invoice/`; the next pricing-rule change must edit both, and missing one is a silent mischarge." — a named change, a named consequence. Keep it.

This is the mirror of a security audit's "if you need the word *theoretically*, you haven't done the work."

### 2. A missing abstraction is not a finding — defer to the drift test

The natural bias of an architecture reviewer is to *add* abstraction (introduce a Strategy, a Factory, a Repository). That bias directly fights KISS / YAGNI and produces over-engineering — the exact thing a *lean* pass exists to remove. So this audit holds the opposite default:

**Duplication or a missing abstraction is a finding only if it fails the drift test:** *if these copies silently diverge, is that a bug, or normal independent evolution?*

- **Bug if they diverge** → one authoritative truth; a real finding (this is exactly when even KISS says extract).
- **Normal to diverge** → incidental duplication; leave it (rule of three not yet earned).

Three similar lines beat a premature abstraction. Framework-idiomatic code (a framework's route-plugin convention, a language's import style) is not a finding — Round 1 captures these conventions precisely so agents don't flag idioms.

### 3. Severity = blast radius × change likelihood

Do not use security's CRITICAL/HIGH vocabulary. A quality problem's severity is how much it will actually hurt:

- **blast radius** — how much code / how many call sites the problem blocks or endangers (objective: count them from the substrate).
- **change likelihood** — how actively the code changes (objective: git churn from the substrate).

A tangled module nobody has touched in two years is LOW. The same tangle in the hottest file in the repo is HIGH. This keeps severity objective and actionable, and it resists the "everything is MEDIUM" padding failure.

Blast radius is not just "how much code" — check it against the **deployment configuration** (IaC, env vars, feature flags), not just the source. A drift between two consumer implementations can be dead in production (e.g. an env var routes all traffic to only one of them) while very much alive in local/dev/CI — that's real but lower-blast than it looks from the code alone. Conversely a "cold" file can be one env-flip away from taking full production traffic. Read the actual deployed config before finalizing severity; don't infer it from the code's own defaults.

| overall | meaning |
|---|---|
| **HIGH** | high blast radius **and** actively changing — this is costing the team now |
| **MODERATE** | one axis high — real cost, bounded |
| **LOW** | low on both — worth noting, not worth stopping for |

### 4. Ground every finding in the deterministic substrate

Round 1 runs real tools (dead-code, cycle, duplication, complexity, churn detectors) to produce a factual substrate. Every later finding must cite it — `file:line`, the exact N duplication sites, the exact cycle members. LLM agents interpret and prioritize; they do not invent facts the tools could have measured. This is what makes the adversarial and verification rounds meaningful: they check facts, not opinions.

### Anti-patterns (these make an audit useless)

1. **Reporting every deviation from a pattern textbook.** Patterns are tradeoffs, not laws.
2. **Recommending speculative abstraction.** See Principle 2. If your fix adds indirection for a single call site, you've become the problem.
3. **Padding with LOWs to look thorough.** Three real HIGHs beat thirty LOWs.
4. **"This could be cleaner" without a cost.** See Principle 1.
5. **Ignoring what the codebase does well.** Note solid structure — it calibrates trust in the findings you do raise.
6. **Flagging framework idioms** as violations because they look unusual out of context.
7. **Treating incidental duplication as a DRY violation.** DRY is about knowledge, not characters. Apply the drift test.
8. **Fabricating file:line.** If you cite it, you read it.

## Workflow overview

Follow all six rounds in order. Each round's detail lives in a reference file under `${CLAUDE_PLUGIN_ROOT}/references/audit/` — read it when you reach that round.

1. **Recon & substrate** — `${CLAUDE_PLUGIN_ROOT}/references/audit/RECON.md`. Run language-appropriate deterministic tools to build the factual substrate; extract the codebase's own `intended-architecture.md`. Includes Stage A of the hoist-candidate funnel (deterministic candidate generation).
2. **Deep-dive hunt** — `${CLAUDE_PLUGIN_ROOT}/references/audit/DEEP-DIVE.md`, selecting dimensions from `${CLAUDE_PLUGIN_ROOT}/references/audit/SCAN-DIMENSIONS.md`. Fan out `general` agents by *workspace × dimension*; each finding must carry the falsifiability anchor. Includes Stage B of the hoist-candidate funnel (LLM adjudication of Round 1's candidates).
3. **Adversarial validation** — Round 3 in `${CLAUDE_PLUGIN_ROOT}/references/audit/VALIDATION-AND-REPORTING.md`. Consolidate duplicates, then a separate agent tries to *disprove* each finding — targeting this domain's false-positive modes (incidental duplication, YAGNI, framework idioms).
4. **Structured output** — Round 4 in `${CLAUDE_PLUGIN_ROOT}/references/audit/VALIDATION-AND-REPORTING.md`, `${CLAUDE_PLUGIN_ROOT}/references/audit/report-schema.json`, `${CLAUDE_PLUGIN_ROOT}/references/audit/validate-findings.cjs`. Write and structurally validate `findings.json`.
5. **Independent fact-check** — Round 5 in `${CLAUDE_PLUGIN_ROOT}/references/audit/VALIDATION-AND-REPORTING.md`. A fresh agent per finding verifies only the *facts* (paths, line numbers, counts) — not the judgment.
6. **Human report** — Round 6 in `${CLAUDE_PLUGIN_ROOT}/references/audit/VALIDATION-AND-REPORTING.md`. Written last, so it never needs rewriting after verification. Each finding gets a remediation and a bucket: fix-now / tracked-debt / accepted.

Rounds 3 and 5 are deliberately different jobs: **3 asks "is this a real problem worth fixing?"** (judgment), **5 asks "are the cited facts correct?"** (facts). Keeping them separate is what stops them collapsing into the same re-judgment done twice.

## Future directions

### Hoist detection — beyond the v1 deterministic signals

v1 generates hoist candidates from three deterministic signals (cross-boundary name match, shared-dependency fingerprint, git provenance) and lets an agent adjudicate each. This catches same-intent code whose names or dependencies still overlap. It **misses** code that drifted so far it shares neither. Two upgrades, in increasing cost:

- **Intent-fingerprint pass.** A cheap agent pass tags every module with a *normalized purpose* — a structured `{verb, subject, mechanism}` tuple drawn from the codebase's own vocabulary (the substrate's dependency/domain nouns), grounded in the deterministic facts rather than free description. Cluster the tuples cross-workspace to nominate candidates. It is a *candidate generator, not a verdict* — noise is contained because Stage B still reads both implementations — so it's tuned for recall. This is the "poor man's embedding": a discrete semantic label produced by the LLM already in hand, with **zero new dependencies**. Recommended first upgrade; gate it on measuring how much the v1 signals miss on a real target.

- **Embedding nearest-neighbor.** Embed each function/module and find cross-workspace near-neighbors above a threshold — highest recall for "same intent, totally different surface." Cost: it requires an embedding model, i.e. either an external embedding API (network + credential + per-call cost) or a local model package + multi-hundred-MB download — so it **cannot** honor the "add nothing to the target" rule the way the v1 tools and the intent-fingerprint do. Similarity search itself needs no dependency (in-memory cosine over a few thousand small vectors is trivial). Like the fingerprint, embeddings only *nominate* candidates (they cluster by topic, not verified intent), so Stage B adjudication is still required. Reserve for a v2 where an embedding backend is already available (e.g. a target repo that ships pgvector/Vertex) and can be used as an opt-in adapter.

### Other

- **Debt-ledger integration** — emit tracked-debt findings directly in the target's debt-marker format so they enter the team's existing process.
- **Semgrep rule library** — accumulate reusable architecture-fitness rules (raw SQL in route, business-imports-framework, polling-where-events-exist) across runs.

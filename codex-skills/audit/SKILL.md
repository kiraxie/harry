---
name: audit
description: Whole-codebase structure & architecture-fitness audit — a six-round, iterative, multi-language (TypeScript/JavaScript, Go, Python) workflow that finds design-pattern mismatches, missed reuse / hoist candidates (same-intent code that drifted apart), layering violations, dead code, coupling/circular dependencies, error-handling & observability gaps, and structural test-coverage holes. Use when the user asks to audit a codebase's design/architecture/maintainability, review structure across many files, find technical debt, find duplicated-but-drifted logic that should be shared, check whether the code matches its own stated architecture, or do a "codebase health check" — even if they don't say the word "audit". This is the macro/structural counterpart to a code review — reach for it for the whole repo or a whole subsystem, not a single change.
---

# Audit

Trigger this skill when the user asks to audit a codebase's design / architecture /
maintainability, review structure across many files, find technical debt or
duplicated-but-drifted logic that should be shared, check whether the code matches
its own stated architecture, or do a "codebase health check" — the target is a whole
repo or subsystem, not a single change.

## Orchestration lives in a shared file

The full six-round audit orchestration — the auditor's role, the falsifiability
discipline and core principles, the setup / output-directory rules, the
iteration / `run-<N>` semantics, and the six-round flow (with its pointers into
`RECON.md`, `DEEP-DIVE.md`, `SCAN-DIMENSIONS.md`, `VALIDATION-AND-REPORTING.md`,
`report-schema.json`, and `validate-findings.cjs`) — is shared with the Claude Code
build and lives in **`${CLAUDE_PLUGIN_ROOT}/references/audit/ORCHESTRATION.md`**.

**Read that file now and follow it.** It carries the build divergences under
explicit **Claude Code build:** / **Codex build:** labels; wherever it names the
Codex build, that is you. The target and output directory come from what the user
said (falling back to the current working directory), and dispatch happens through
Codex's equivalent sub-agent / delegation mechanism.

## Known limitation vs. the Claude Code build

The Claude Code version gates Round 2's `general`/`research` sub-agent split through its own Task/Agent tooling and a read-only trust boundary for RO rounds enforced by tool allowlists. Codex has no discovered per-skill tool permission gate — follow the same role/parallelism/independence boundaries in the shared orchestration file as hard instructions instead of relying on enforcement.

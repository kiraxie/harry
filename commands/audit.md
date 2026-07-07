---
description: Whole-codebase structure & architecture-fitness audit — a multi-round, multi-language (TypeScript/JavaScript, Go, Python) workflow that finds design-pattern mismatches, missed reuse / hoist candidates (same-intent code that drifted apart), layering violations, dead code, coupling/circular dependencies, error-handling & observability gaps, and structural test-coverage holes. This is the macro/structural counterpart to a diff-level code review — reach for it for the whole repo or a whole subsystem, not a single change.
argument-hint: '[path...] [--output <dir>]'
allowed-tools: Read, Write, Glob, Grep, Agent, AskUserQuestion, Bash(npx:*), Bash(uvx:*), Bash(go:*), Bash(semgrep:*), Bash(git log:*), Bash(git grep:*), Bash(git ls-files:*), Bash(node:*), Bash(ls:*)
---

# Code Audit

Raw slash-command arguments (optional target path(s) and `--output <dir>`):
`$ARGUMENTS`

## Orchestration lives in a shared file

The full six-round audit orchestration — the auditor's role, the falsifiability
discipline and core principles, the setup / output-directory rules, the
iteration / `run-<N>` semantics, and the six-round flow (with its pointers into
`RECON.md`, `DEEP-DIVE.md`, `SCAN-DIMENSIONS.md`, `VALIDATION-AND-REPORTING.md`,
`report-schema.json`, and `validate-findings.cjs`) — is shared with the Codex
build and lives in **`${CLAUDE_PLUGIN_ROOT}/references/audit/ORCHESTRATION.md`**.

**Read that file now and follow it.** It carries the build divergences under
explicit **Claude Code build:** / **Codex build:** labels; wherever it names the
Claude Code build, that is you. The invocation surface for this build is
`$ARGUMENTS` above (target path(s) and an optional `--output <dir>`), and this
command's `allowed-tools` frontmatter is the tool universe you operate within.

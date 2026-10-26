---
description: Whole-codebase structure & architecture-fitness audit — a multi-round, multi-language (TypeScript/JavaScript, Go, Python) workflow that finds design-pattern mismatches, missed reuse / hoist candidates (same-intent code that drifted apart), layering violations, dead code, coupling/circular dependencies, error-handling & observability gaps, structural test-coverage holes, and low-value tests. This is the macro/structural counterpart to a diff-level code review — reach for it for the whole repo or a whole subsystem, not a single change.
argument-hint: '[path...] [--output <dir>]'
allowed-tools: Read, Write, Glob, Grep, Agent, AskUserQuestion, Bash(npx:*), Bash(uvx:*), Bash(go:*), Bash(semgrep:*), Bash(git log:*), Bash(git grep:*), Bash(git ls-files:*), Bash(node:*), Bash(ls:*)
---

# Code Audit

Raw slash-command arguments (optional target path(s) and `--output <dir>`):
`$ARGUMENTS`

## Orchestration lives in a reference file

The full six-round audit orchestration — the auditor's role, the falsifiability
discipline and core principles, the setup / output-directory rules, the
iteration / `run-<N>` semantics, and the six-round flow with its pointers into
the rest of `references/audit/` — lives in
**`${CLAUDE_PLUGIN_ROOT}/references/audit/ORCHESTRATION.md`**.

**Read that file now and follow it.** The invocation surface is
`$ARGUMENTS` above (target path(s) and an optional `--output <dir>`), and this
command's `allowed-tools` frontmatter is the tool universe you operate within.

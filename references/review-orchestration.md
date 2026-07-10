# Review orchestration — shared definitions

The shared, drift-prone `/review` orchestration definitions used by **both** builds:
`commands/review.md` (Claude Code) and `codex-skills/review/SKILL.md` (Codex CLI).
Each of those files keeps its own build-specific sections (frontmatter, RO/RW gating,
review angle, routing, plain review, full mode, single review + fix, apply backends,
and the Codex-only limitation/asymmetry notes) and points here for the two definitions
below. Where the two builds genuinely differ, both variants are captured under explicit
**Claude Code build:** / **Codex build:** labels — never collapse them to one.

## The structured-review envelope (one definition)

`node … review --fix` (node's `--fix` = "emit structured JSON", regardless of RO/RW)
prints exactly one JSON line. This is the single source of truth for its shape — do
not restate it elsewhere:

```
{"status":"reviewed", kind, model, target, fileCount,
 findings:[{id,file,line,severity,title,rationale,suggestedFix}],
 reviewMarkdown}
```

`line` is optional (file-wide findings omit it). On **failure** (timeout/quota), the
process exits non-zero and stdout is markdown beginning `# Review Failed`, NOT this
envelope — never parse a leg's output as JSON without first checking it succeeded.

---

## The simplify dual-lane (one definition)

The triggering condition (when the active angle runs as two lanes) is worded per build:

- **Claude Code build:** Whenever the active angle is `--simplify` — standalone, under a fix backend, or as two of `--full`'s four lanes — it runs as **two lanes**, not one.
- **Codex build:** Whenever the active angle is simplify — standalone, under an apply request, or as two of full's three dispatches — it runs as **two lanes**, not one.

This is the single definition; every call site below just says "run the simplify dual-lane."

`<forwarded>` (used by Lane A below):

- **Claude Code build:** by default means: the invoking args minus the slash-level fix/execution flags (`--fix`, `--harry-fix`, `--wait`, `--background`), keeping `--base`/`--scope`/`--context`/focus. Never let a raw `--harry-fix` reach the node CLI: it throws ("--harry-fix is a /review fix-backend selector, not a CLI flag", `src/companion.ts`). **Exception:** Full mode's Stage 1 already computes its own wider "Forwarded args" (it also strips `--full`/`--adversarial`/`--simplify`/`--model`/`--reasoning`, since `--full` alone would crash the node CLI the same way) — when the dual-lane runs as part of `--full`, use that value instead, not this one.
- **Codex build:** means: the base/scope/context/focus args the user gave, keeping `--base`/`--scope`/`--context`/focus and dropping the angle keyword itself (`--simplify`) plus any model/reasoning override — Lane A's own node call already supplies `--simplify --fix` explicitly, so forwarding those again would be redundant, and this build has no separate apply-request flag to strip (RW is decided by whether the user asked to apply, not a CLI flag). **Exception:** Full mode's Stage 1 already computes its own wider "Forwarded args" (it also strips `--full`/`--adversarial`, since the node CLI has no `--full` concept and would error on it) — when the dual-lane runs as part of full, use that value instead, not this one.

**Lane A — Codex cleanup review** (`gpt-5.3-codex`, behavior-preserving reuse /
simplification / efficiency — NOT bugs):
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --simplify --fix <forwarded>
```
Parse the structured envelope (see above).

**Lane B — over-engineering & readability lane.** The lane title and dispatch mechanism differ by build:

- **Claude Code build:** **Lane B — CC-native over-engineering & readability lane** (`Agent` tool, `model: sonnet` — a heuristic hunt, not a design judgment call, so it does not need the session's most capable model; no Codex backend, no extra Codex quota — same cost class as `--full`'s `/code-review max` lane)
- **Codex build:** **Lane B — over-engineering & readability lane** (a lightweight sub-agent — this is a heuristic hunt, not a design judgment call, so it doesn't need your most capable model; no Codex backend involved, no extra Codex quota consumed)

Before dispatching, write the target diff to a file so Lane B can read it, matching
this repo's own reviewer-handoff convention (`references/review-rubric.md`: "hand the
reviewer ... the diff (as a file)") rather than inlining a full diff into the prompt:
- Working-tree mode: `git diff --cached` (staged) + `git diff` (unstaged), plus —
  for untracked files, `git status --porcelain --untracked-files=all` lists paths
  only, not content, so also append each untracked file's full body (skip
  binaries), under its own `--- Untracked: <path> ---` heading, mirroring how
  `src/lib/git.ts`'s `collectWorkingTreeContext`/`formatUntrackedFile` handle this
  same gap — a bare filename list gives Lane B nothing to actually review, and new
  files are exactly where dead scaffolding and speculative code show up. Concatenate
  staged diff + unstaged diff + untracked file bodies into one file.
- Branch mode (`--base <ref>` given): `git diff <base>...HEAD` (new files already
  appear in this diff normally — no untracked-file gap here).
Write the result to a temp file (e.g. `/tmp/harry-review-simplify-laneb-diff.txt`).
Then dispatch the reviewer with this brief (the dispatch verb, and whether the context
arg is named `--context`, differ by build):

- **Claude Code build:** Then dispatch an agent — it has no memory of this conversation, so hand it the file path explicitly — with this brief, substituting the actual file path and any `--context`/focus text into the `Scope:` line:
- **Codex build:** Then dispatch a sub-agent — it has no memory of this conversation, so hand it the file path explicitly — with this brief, substituting the actual file path and any context/focus text into the `Scope:` line:

```
You are a lazy senior engineer reviewing for TWO things: over-engineering and
poor readability. The best outcome is code that is shorter where it can be cut,
and clearer where it can't. Do not duplicate correctness/security/performance
findings — those are out of scope here.

Scope: Read the diff at <substitute the actual temp file path here>. <If context/
focus text was given, append it here.> Cite real file paths and line numbers from
within that diff.

Hunt (cut): reinvented stdlib, deps the platform already ships, single-implementation
interfaces, factories with one product, wrappers that only delegate, config for
a value that never changes, dead flags, speculative "for later" scaffolding,
files exporting one thing.

Hunt (clarify — same behavior, clearer expression, not deletion): nested ternary
operators that should be an if/else chain or switch, deeply nested conditionals
that should early-return, a name that hides what a variable/function actually
holds or does, tangled boolean logic that should be a named intermediate.

The over-simplification brake — do not suggest a rewrite that trades clarity for
fewer lines: don't collapse multiple concerns into one function/component, don't
propose a denser one-liner over explicit code, don't remove an abstraction that
is actually carrying its weight. If a "clarify" fix would make the diff harder to
read than it already is, don't suggest it.

The red-line carve-out — DO NOT flag these as over-engineering. Before
suggesting a deletion, apply the drift test: "if these two copies silently
diverge, is that a bug or normal evolution?" Bug -> it is one authoritative
truth, keep it. Never flag for deletion: cross-boundary contracts and shared
knowledge, input validation at trust boundaries, error handling that prevents
data loss, security measures and access checks, a single smoke test or
assert-based self-check. When unsure whether something is dead flexibility or
a real contract, leave it and say nothing.

Return one finding per line: <file>:L<line>: <tag> <what>. <replacement>.
Tags: delete: (dead code/speculative feature), stdlib: (hand-rolled thing the
standard library ships -- name the function), native: (dependency or code the
platform already does -- name the feature), yagni: (abstraction with one
implementation, config for a constant, layer with one caller), readab: (same
behavior, clearer expression -- nested ternary, deep nesting, unclear naming,
tangled conditional).
If there is nothing to cut or clarify, say so plainly and return no findings.
```

**Consolidate (always runs once both lanes return):**
- Re-key ids by source: `smp-` for Lane A, `lean-` for Lane B.
- Dedup by `file` + `line` + semantic-title. Lane A's `suggestedFix`-shaped findings
  vs Lane B's `tag:`-shaped lines will occasionally name the same spot — merge them,
  keep both sources listed.
- Judge against this codebase: read cited files where it matters, drop clear false
  positives (HARRY §6).
- Present ONE table: `id | file:line | tag/severity | source(s) | title | verdict`.
  (`source(s)` = `simplify` / `lean` / both; `verdict` = Keep / Drop with a one-line
  reason per Drop.) If both lanes return nothing, say so and stop.

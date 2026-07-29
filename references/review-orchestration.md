# Review orchestration — shared definitions

The shared, drift-prone `/review` orchestration definitions used by **both** builds:
`commands/review.md` (Claude Code) and `codex-skills/review/SKILL.md` (Codex CLI).
Each of those files keeps its own build-specific sections (frontmatter, RO/RW gating,
review angle, routing, plain review, full mode apart from its Stage 2 consolidation,
apply backends apart from the apply steps themselves, and the Codex-only
limitation/asymmetry notes) and points here for the five definitions below.
Where the two builds genuinely differ, both variants are captured under explicit
**Claude Code build:** / **Codex build:** labels — never collapse them to one.
Where only the **vocabulary** differs — a tool's name or casing, a flag that
exists on one build — the text stays build-neutral and names the Claude Code term
inline; a near-identical pair for that is duplication, not a divergence.

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

Whenever the active angle is simplify (`--simplify` on Claude Code) — standalone, under
a fix/apply request, or as two of full mode's three lanes — it runs as **two lanes**, not
one.

This is the single definition; every call site below just says "run the simplify dual-lane."

`<forwarded>` (used by Lane A below):

- **Claude Code build:** by default means: the invoking args minus the slash-level fix/execution flags (`--fix`, `--harry-fix`, `--wait`, `--background`), keeping `--base`/`--scope`/`--context`/focus. Never let a raw `--harry-fix` reach the node CLI: it throws ("--harry-fix is a /review fix-backend selector, not a CLI flag", `src/companion.ts`). **Exception:** Full mode's Stage 1 already computes its own wider "Forwarded args" (it also strips `--full`/`--adversarial`/`--simplify`/`--model`/`--reasoning`, since `--full` alone would crash the node CLI the same way) — when the dual-lane runs as part of `--full`, use that value instead, not this one.
- **Codex build:** means: the base/scope/context/focus args the user gave, keeping `--base`/`--scope`/`--context`/focus and dropping the angle keyword itself (`--simplify`) plus any model/reasoning override — Lane A's own node call already supplies `--simplify --fix` explicitly, so forwarding those again would be redundant, and this build has no separate apply-request flag to strip (RW is decided by whether the user asked to apply, not a CLI flag). **Exception:** Full mode's Stage 1 already computes its own wider "Forwarded args" (it also strips `--full`/`--adversarial`, since the node CLI has no `--full` concept and would error on it) — when the dual-lane runs as part of full, use that value instead, not this one.

**Lane A — Codex cleanup review** (`gpt-5.6-terra`, behavior-preserving reuse /
simplification / efficiency — NOT bugs):
```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --simplify --fix <forwarded>
```
Parse the structured envelope (see above).

**Lane B — over-engineering & readability lane.** The lane title and dispatch mechanism differ by build:

- **Claude Code build:** **Lane B — CC-native over-engineering & readability lane** (`Agent` tool, `model: sonnet` — a heuristic hunt, not a design judgment call, so it does not need the session's most capable model; no Codex backend, no extra Codex quota)
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
Then dispatch a sub-agent (the `Agent` tool on Claude Code) — it has no memory of this
conversation, so hand it the file path explicitly — with this brief, substituting the
actual file path and any context/focus text (`--context` on Claude Code) into the
`Scope:` line:

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

---

## Full-mode Stage 2 — consolidate into one table (one definition)

Full mode's Stage 1 (fanning the three read-only lanes out) and Stage 3 (output /
hand off) stay per build in the doors; this is the consolidation step all three lanes
feed into.

- For each Codex leg (adversarial, simplify Lane A): check it succeeded first (zero
  exit, stdout is the envelope not `# Review Failed`). A failed leg contributes no
  findings — record it as a failed source and continue; never abort the whole
  consolidation for one bad leg. Adversarial design-level notes live in
  `reviewMarkdown`'s `## Design Concerns`; simplify findings are cleanups, not bugs.
- Simplify Lane B (the over-engineering & readability lane) returns plain `tag: what.
  replacement.` lines — map each to a finding: `tag`→severity-ish label, the line
  itself→title.
- **Re-key ids across sources** before merging: prefix each by source
  (`adv-`/`smp-`/`lean-`) so the table's `id` column is unique and unambiguous.
- **Dedup** by `file` + `line` + semantic-title. When `line` is absent (file-wide),
  only merge on a genuine semantic-title match on the same file — do not collapse two
  different file-wide findings just because they share a file. Simplify Lane A and
  Lane B will sometimes name the same spot from different angles — merge, keep both
  sources listed.
- Judge against this codebase: read cited files where it matters and drop clear false
  positives (HARRY §6 — automated review is a suggestion, not an order).

Present ONE table, plus a `## Design Concerns` section (from adversarial) below it:

| id | file:line | severity | source(s) | title | verdict |

(source(s) = adversarial / simplify / lean; verdict = Keep / Drop with a one-line
reason per Drop.) If all three yield nothing material, say so and stop.

---

## Single review + fix (one definition)

The judge role and the three stages. Which apply backends exist, what is stripped
when forwarding, and how the user confirms differ by build and are labelled below;
everything else is shared.

You are the judge in the middle — the reviewer runs in an isolated session and may
flag intentional choices only you know about.

### Stage 1 — Structured review

**If the active angle is simplify:** run **the simplify dual-lane** (defined above)
instead of the single call below — Lane A already appends `--fix`; Lane B has no
`--fix` concept and always returns its plain tag-lines. Skip straight to the
dual-lane's own consolidation step, then continue to Stage 2 with the consolidated
table instead of a raw envelope.

**Otherwise (standard or adversarial):** append node's `--fix` for structured output.
What to forward differs:

- **Claude Code build:** forward args verbatim EXCEPT the slash-level fix flags
  (`--fix`, `--harry-fix`, `--wait`, `--background`); keep the angle and
  `--base`/`--scope`/`--context`/focus.
- **Codex build:** forward the angle and base/scope/context/focus args.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review --fix <forwarded>
```

Parse the envelope (see its one definition above) — including its failure shape: a
non-zero exit with stdout beginning `# Review Failed` is NOT an envelope, so report
the failure rather than parsing it. If `findings` is empty, tell the user and stop.

### Stage 2 — Judge each finding

Decide real defect vs false positive (a false positive is an intentional choice you
have context for). Read cited files. Present a table — id, file:line, title, verdict
(Keep / Drop + one-line reason per Drop) — for simplify this is just the dual-lane's
consolidated table carried forward, already deduped. The user may override; do not
apply anything until approved. How you ask differs:

- **Claude Code build:** confirm with `AskUserQuestion`.
- **Codex build:** confirm in plain text.

### Stage 3 — Apply

Apply the approved (Keep) set. Which path performs it differs by build:

- **Claude Code build:** follow **Apply: `--fix`** or **Apply: `--harry-fix`** in the
  door — two backends, and the choice is the user's flag.
- **Codex build:** follow **The apply steps** below; this build has only that path.

---

## The apply steps — baseline snapshot, apply, report (one definition)

The steps that apply an approved (Keep) set to the working tree yourself. Which path
invokes them differs by build:

- **Claude Code build:** these are the steps of **Apply: `--fix`** (Claude Code applies). The other backend, `--harry-fix` (an isolated Codex fix session), does not use them — it keeps its own section in the door.
- **Codex build:** these are the steps of **Stage 3 — Apply**, this build's only apply path (it has no `--harry-fix`).

1. **Baseline snapshot** — same contract as `src/commands/fix.ts` (runFix). Its
   first act *within this step* is to **refuse a repository with no commits**:
   it resolves HEAD and, finding none, exits 1 with `fix requires at least one
   commit to diff against` *without running a model turn*, because a fix diffed
   against an unborn HEAD would silently report nothing changed. Do the same —
   stop here rather than discovering it half-way through an apply. (Earlier
   refusals exist and are not this step's business: runFix validates its
   findings file and the repo before this, and the session layer refuses on
   failed auth or an unhonorable capability set — `run-agent-session.ts`'s
   capability gate deliberately fires *before* this snapshot.) Then: if `git
   status --porcelain` is non-empty, the fix diff must be isolated from the user's
   pre-existing work. Run `git stash create` and **record the printed SHA** as the
   baseline — an ephemeral snapshot object; nothing (working tree, index, branch
   history, stash ref) is mutated, so no confirmation is needed. If it prints
   nothing (e.g. only untracked changes) or the tree is clean, use `git rev-parse
   HEAD` as the baseline instead. **A `git` command that outright fails counts as
   the quiet branch, not as a reason to stop**: runFix treats a failed `git status`
   as clean and a failed `git stash create` as "printed nothing", so both fall
   through to HEAD. Reuse that literal SHA in step 3 — each command runs in a fresh
   shell (every `Bash` call, on Claude Code), so a `BASE=…` variable will not survive;
   substitute the actual value. Known limit (same as
   runFix): `stash create` skips pre-existing untracked files, so `git add -A` in step 3
   stages them and they appear in the fix diff as if the fix created them.
2. **Apply** each approved finding to the working tree (`Edit`/`Write` on Claude Code):
   minimal, correct change per finding; no unrelated refactor. Skip any that is already
   fixed, no longer applies, or whose fix would change intended behavior — note why.
3. **Stage + report:** `git add -A`, then report applied / skipped (with reasons) and
   changed files. **If any of those git commands fails, report the counts as
   *unavailable*, never as zero** — this too is runFix's contract, and the one
   place it is easiest to break by accident: `computeStagedDiff` returns `null`
   rather than zeros when git fails, and the envelope carries `null` with the
   operator line `diff stats unavailable (git failed — see the job log)`, because
   the fix may well have edited files and only the *measurement* failed. Reporting
   "no files changed" there tells the user the opposite of what happened. Then tell
   the user the fixes are **staged but not committed** —
   review the fix-only diff with `git diff --cached <baseline-sha>` (the SHA recorded
   in step 1; it excludes their pre-existing *tracked* WIP — pre-existing *untracked*
   files may still appear, so warn the user before they commit the staged changes).

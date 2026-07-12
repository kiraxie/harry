# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-07-12

### Added

- **New law: "Optimize on evidence, never on imagination" (HARRY.md §1)** —
  the performance-axis counterpart to YAGNI that the law set was missing. No
  cache/index/memoization/micro-optimization/clever rewrite without a
  profile or benchmark naming *this* path on a *real* workload; "should be
  faster" is a §6 banned claim. The simple version is the default, carrying a
  §4 `DEBT:` ceiling when one is worth naming. Three explicit carve-outs keep
  it from forbidding legitimate perf work: design-time scale decisions (data
  model, asymptotic class, round-trip/query shape against a *known* workload),
  an explicit perf budget or SLO (a §2 requested behavior), and declining
  gratuitous pessimization (take the equally-clear-but-faster idiom).
  `references/review-rubric.md` #3 extended to flag premature optimization
  alongside premature generality.

## [0.11.0] - 2026-07-10

### Changed

- **Codex model defaults bumped to the GPT-5.6 family**, replacing
  `gpt-5.3-codex` (now deprecated by OpenAI for ChatGPT-signed-in Codex
  sessions) and `gpt-5.5` (superseded). `/review`'s standard and `--simplify`
  lanes now default to `gpt-5.6-terra` (balanced tier); `--adversarial`,
  `ask`, and `fix` now default to `gpt-5.6-sol` (flagship tier, matching
  HARRY.md §5's "capable-by-default" judgment-task principle). Updated every
  doc that names the defaults (README, `commands/*.md`,
  `codex-skills/*/SKILL.md`, `references/review-orchestration.md`).

### Fixed

- Removed `CodexProvider`'s stale `xhigh`→`high` reasoning-effort clamp
  (`src/lib/providers/codex.ts`). It existed because codex's app-server
  previously had no `xhigh` tier; verified against the installed codex CLI
  binary that `xhigh` is now a supported effort value, so every codex lane
  defaulting to `xhigh` (`/review`'s three lanes) was being silently
  downgraded to `high`. `opts.reasoning` now passes through unmodified.

## [0.10.0] - 2026-07-10

### Changed

- **Renamed `/harry:init` to `/harry:sync`** (breaking: update any muscle
  memory / scripts invoking the old name). The command is re-run far more
  often than it's run once — every time HARRY.md or the plugin updates,
  across every repo the laws are wired into — so "init" undersold its actual
  job; "sync" matches the resync semantics already documented for its Phase 1
  (laws snapshot re-deploy). Renamed `commands/init.md` -> `commands/sync.md`
  and `codex-skills/init/` -> `codex-skills/sync/`; updated all prose
  cross-references. `scripts/init.mjs` (the Phase 2 gitignore-block script,
  and its `init-ignore` pnpm alias) is unchanged — that one genuinely is a
  per-project one-time setup action, distinct from the laws resync.

## [0.9.1] - 2026-07-10

### Fixed

- Reworded Codex cost notes in `commands/debate.md`, `commands/review.md`,
  and `README.md` from Copilot-era "premium-request quota" language to
  token-quota consumption, now that the Copilot backend is gone.

### Changed

- `/review --simplify`'s Lane B (over-engineering hunt) gained a second
  dimension: readability (nested ternaries, deep nesting, unclear naming)
  plus an over-simplification brake, and a new `readab:` finding tag.
  Renamed the lane to "over-engineering & readability lane" consistently
  across `references/review-orchestration.md`, `commands/review.md`, and
  `codex-skills/review/SKILL.md`.

## [0.9.0] - 2026-07-09

### Changed

- **Converged the `.local/` doc model**: harry's five parallel doc types
  (spec/plan/backlog/milestone/research, each its own directory) collapse into
  one status-driven item store. Each work unit is a single `.local/items/<slug>.md`
  file moving through `status: backlog → active → done` in place — `active`
  holds both the former spec (`## Why / What`) and plan (`## Plan`) content.
  Milestones are `type: milestone` items linking to members/deliverables
  instead of a separate folder; completed items move to `.local/archive/`
  (read-only). `references/doc-types.md` is the rewritten canonical taxonomy;
  `HARRY.md`, `references/tier-gates.md`, the four pipeline skills,
  `commands/debt.md` + its codex mirror, and `commands/init.md` + its codex
  mirror (which now also migrates a repo's pre-existing docs into the new
  layout) all updated to match.
- Re-pinned the Major-tier implementer's default model to a literal `opus` in
  `skills/executing/SKILL.md` — a prior revision had softened this into "pick
  the current top tier at dispatch time," which in practice stopped reliably
  resolving to `opus`.

### Fixed

- `/harry:debt`'s freshness checks referenced comparing items "by date in the
  filename" — a structure the item model no longer has (no date prefix;
  `status` is the temporal signal). Switched to git last-touched date /
  `.local/HISTORY.md`.
- A milestone item never closed itself out once every member was delivered;
  it would sit `active` forever. Finishing now archives a milestone the same
  way as any other item once its `## Members` list empties out.
- A stale `.local/STATUS.md` reference in `CLAUDE.local.md` (superseded by
  `.local/INDEX.md`).

## [0.8.0] - 2026-07-07

### Added

- A prose reference-path linter test (`tests/prose-refs.test.ts`): every repo-relative
  path and `${CLAUDE_PLUGIN_ROOT}` reference across HARRY.md, skills, commands, and
  references must resolve — renames/deletes can no longer leave dangling instructions.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, test, and a **dist-drift
  gate** (`pnpm run build` + `git diff --exit-code dist/`) so the committed
  `dist/companion.cjs` can never silently diverge from `src/`.
- Tests for the previously-uncovered first-party core: `findings` (the
  review→fix JSON parsing), `zombie` (reaper logic), install-script atomicity,
  and a manifest/`package.json` version-sync guard.

### Changed

- **Laws release boundary**: `install-laws` / `/harry:init` now deploys HARRY.md as a
  **snapshot** to `~/.claude/harry/HARRY.md` and `@`-imports that copy, instead of
  live-importing the plugin checkout — "release" = re-run init, converging with the
  Codex build's resync model. Old direct-repo imports migrate automatically on re-run.
- **Standard tier executes inline** (session mode, isolated worktree) with a now
  **mandatory** independent reviewer subagent; subagent-per-task execution is Major-only.
  The Standard spec rule is canonicalized across all copies: a spec only when real
  alternatives were weighed, otherwise the decision lives at the top of the plan.
- **Tracking files simplified**: `.local/STATUS.md` merged into `.local/INDEX.md` as an
  `## In flight` section (now wired into the executing/finishing skills so start/finish
  marks actually happen); `HISTORY.md` rotates yearly to `.local/history/<year>.md`; the
  separate `.local/ledger/` is gone — progress marks live in the plan file itself, and
  Major-mode handoff files move to `.local/tmp/<branch>/`.
- **Audit orchestration hoisted**: the ~77%-identical `commands/audit.md` and
  `codex-skills/audit/SKILL.md` now share `references/audit/ORCHESTRATION.md`
  (same treatment as `review-orchestration.md`); the wrappers keep only their
  build-specific surface.
- The finishing skill now states completion evidence honestly: CI green when pushed,
  the full local suite when a merge stays local (CI does not run on local merges).
- Removed the unexplained `Intensity: full` orphan line from HARRY.md §1 and the
  contradictory "Every project, regardless of perceived simplicity" wording from the
  brainstorming HARD-GATE (the gate now defers tier claims to §3).
- **`fix`** isolates the pre-fix baseline with `git stash create` (an ephemeral
  snapshot) instead of committing the user's uncommitted work onto their branch —
  no branch-history mutation. It also now exits non-zero when the fix session
  fails or times out (was exit 0).
- **`state`** writes job state atomically (temp + rename) and with `0600`/`0700`
  permissions, and prunes per-job files/logs it drops past `MAX_JOBS` — closing a
  torn-read data-loss window and unbounded state-dir growth. Pruning never drops
  a running/queued job, and the zombie reaper's pid-reuse window scales with the
  job's own `--timeout` — a long-running job is never reaped or deleted mid-run.
- The CLI rejects unknown/typo'd flags per command and prints usage for
  `<command> --help` instead of launching a run.
- The shared `/review` orchestration (structured-review envelope, simplify
  dual-lane) moved to `references/review-orchestration.md`; the CC command and
  Codex skill both reference it instead of carrying diverging copies. Its `--fix`
  apply path now uses the same `git stash create` baseline as `fix` (no commit).
- Doc corrections: README documents the `/harry:` command namespace consistently;
  the `ask`/`fix` model-default claim and the RO/RW "instruction-only on both
  builds" wording in CLAUDE.md now match the code.
- Slimmed HARRY.md §5: the `.local/` doc-type taxonomy and lifecycle moved to
  `references/doc-types.md` (loaded on demand), keeping the resident law compact.
- Install scripts write the user's global files atomically with a one-time
  `.bak`, and no longer strip trailing bytes outside harry's marker block.

### Fixed

- `getCodexAvailability` never accepted an `env` override, so it always probed
  the real inherited `PATH` even when a caller (namely the test suite's fake
  Codex fixture) asked it to look elsewhere. Masked on a machine with a real
  `codex` CLI installed (the probe happened to succeed against the real
  binary); surfaced by this release's own new CI, which has no `codex` on
  `PATH` — `env` is now threaded through to `binaryAvailable` so the
  availability probe and the real RPC connection agree on which binary to use.

### Removed

- The no-op `SessionStart` hook (both `hooks.json` files) and its dead
  `setup --check` branch — it spawned `node` every session without refreshing
  anything. Docs that claimed a session-start quota refresh were corrected.
- ~170 lines of dead worktree-lifecycle code (`src/lib/worktree.ts`); the one
  live helper moved to the existing `src/lib/git.ts`.

## [0.7.0] - 2026-07-06

### Added

- **`/audit`**: a new whole-codebase structure & architecture-fitness audit —
  a six-round, iterative, multi-language (TypeScript/JavaScript, Go, Python)
  workflow that finds design-pattern mismatches, missed reuse/hoist candidates,
  layering violations, dead code, coupling, error-handling and observability
  gaps, and structural test-coverage holes. Ships as a Claude Code command
  (`commands/audit.md`) and a Codex skill (`codex-skills/audit/`), sharing one
  reference bundle under `references/audit/` via `${CLAUDE_PLUGIN_ROOT}`.
- `/audit` dimension 10 (over-engineering / unearned abstraction): the deep,
  evidence-verified, severity-ranked counterpart to `/review --simplify`'s new
  quick pass (below), governed by the same falsifiability anchor and drift-test
  discipline as `/audit`'s other nine dimensions.
- `/review --simplify` now runs as a "dual lane": the existing `gpt-5.3-codex`
  cleanup pass, plus a new CC-native (Codex build: sub-agent) over-engineering
  lane running in parallel, consolidated into one table. Costs no extra Codex
  quota — the new lane runs on the calling session's own compute.

### Removed

- **`/lean`** (command + Codex skill) is retired. Its quick per-diff scan is
  now `/review --simplify`'s new lane (above); its drift-test philosophy is now
  `/audit`'s dimension 10 (above). Existing `/lean` users should switch to
  `/review --simplify` for a quick per-diff check, or `/audit` for a deep,
  whole-repo, iterative pass.

## [0.6.1] - 2026-07-03

### Fixed

- `/init`'s `.gitignore` wiring (and the Codex `init` skill) referenced a stale
  `.worktrees/` entry instead of the `*worktrees/` glob this repo's own
  `.gitignore` was already fixed to use — the mismatch meant `scripts/
  init.mjs`'s dedupe couldn't recognize `*worktrees/` as already covering
  `.worktrees/`, so it kept re-adding a redundant marker block.

## [0.6.0] - 2026-07-03

### Added

- **Codex CLI compatibility**: harry now also ships as a Codex CLI plugin, a
  deliberate partial-parity companion to the Claude Code build. `.codex-plugin/
  plugin.json` + `.agents/plugins/marketplace.json` register the plugin — both
  schemas were live-verified against an authenticated Codex CLI install, not
  guessed from web docs. `codex-skills/` converts the mechanical/read-only
  slash commands (`ask`, `status`, `result`, `debt`, `lean`, `review`, `init`)
  into Codex Skills, since Codex's plugin manifest has no `commands`/`prompts`
  field. `scripts/install-codex.mjs` wires `HARRY.md` into `~/.codex/AGENTS.md`.
  The four pipeline skills and the `dist/companion.cjs` runtime are shared
  as-is between both builds.
- Known, documented degradations on the Codex build: `debate` has no Codex
  skill; `review --full` drops the Claude-only self-review lane and
  `--harry-fix`; `review`'s read-only/read-write boundary is instruction-only
  rather than tool-enforced; `init`'s law-wiring inlines `HARRY.md` as a
  snapshot rather than a live `@`-import.
- `pnpm run install-laws-codex` — mirrors `install-laws` for the Codex build.

## [0.5.0] - 2026-07-03

### Removed

- Copilot backend removed entirely. harry's agent commands (`ask`, `review`, `fix`) now
  run exclusively through Codex. The `Provider` dual-backend abstraction, the
  `@github/copilot-sdk` dependency, the `--provider` CLI flag, the `Backend provider`
  plugin setting, and Copilot's premium-request quota tracking (`status`'s `## Quota`
  block) are all gone. `/harry:debate`'s `gpt` voice now calls Codex directly instead of
  Copilot's `gpt-5.5`.

## [0.4.0] - 2026-07-02

### Added

- Restored the brainstorming **Visual Companion** — a zero-dependency local
  browser companion for genuinely visual design questions (mockups, wireframes,
  side-by-side layout comparisons), offered just-in-time.
- **Shared review rubric** (`references/review-rubric.md`): the in-house reviewer
  subagent now reviews against explicit dimensions (spec compliance, code
  quality, YAGNI/altitude, test hygiene) instead of an unnamed "shared rubric".

### Changed

- `executing`: a dispatched implementer/fixer now picks its model by **role and
  task nature** — capable by default (the role does judgment/exploration),
  cheaper only for mechanical/transcription work — and always sets it explicitly
  instead of silently inheriting the session model.
- `HARRY.md` §5: AI-assisted commits keep the `Co-Authored-By: Claude` trailer
  (previously stripped); the worktree law is rescoped from "any mutation" to
  work that can collide — a lone trivial edit needn't isolate.

### Fixed

- `.gitignore` now covers the native harness worktree path (`.claude/worktrees/`),
  so a lint run no longer breaks when a worktree is present.

## [0.3.1] - 2026-06-30

### Changed

- Active in-flight work now lives in a lazy `.local/STATUS.md` work list instead
  of `CLAUDE.local.md`, so in-flight state and history no longer ride in context
  every session. `CLAUDE.local.md` reverts to per-project specialization rules;
  the discipline is to mark a unit started in `STATUS.md` when work begins
  (HARRY.md §5).
- Renamed the completed-work archive `history.md` → `HISTORY.md`.

### Fixed

- `/init` no longer duplicates `.gitignore` entries the user already has outside
  harry's marked block; when every entry is already covered, no block is written.

## [0.3.0] - 2026-06-30

### Added

- `/init` wires the resident laws into global instructions and migrates legacy
  spec/plan artifacts into harry's format.
- Codex as a provider alongside Copilot.

### Fixed

- Restored the dropped `SessionStart` hook so `setup --check` refreshes the quota
  at session start.

### Changed

- Specs accumulate in `.local/specs/` and are never archived; only plans archive.
- Simplified the README install and providers prose.

## [0.2.0] - 2026-06-29

### Added

- Initial harry plugin: resident engineering laws (`HARRY.md`) loaded every
  session; brainstorming / writing-plans / executing / finishing skills;
  multi-model `/review` and `/debate`.
- `/review` `--full` multi-reviewer mode, a `--simplify` lane, and CC/Copilot fix
  backends.
- `/lean` whole-project scope with `--diff` for diff-only hunts.

### Changed

- `writing-plans` reframes asks as verifiable test goals before writing tasks.
- `finishing` runs the full wind-down tail even on a pre-decided merge.
- Tooling: Biome linter/formatter, TypeScript 7, dependency bumps.

[0.5.0]: https://github.com/kiraxie/harry/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kiraxie/harry/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kiraxie/harry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kiraxie/harry/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiraxie/harry/releases/tag/v0.2.0

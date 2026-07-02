# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[0.4.0]: https://github.com/kiraxie/harry/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kiraxie/harry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kiraxie/harry/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiraxie/harry/releases/tag/v0.2.0

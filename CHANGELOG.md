# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.1]: https://github.com/kiraxie/harry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kiraxie/harry/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiraxie/harry/releases/tag/v0.2.0

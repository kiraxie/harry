# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`harry` is a Claude Code **plugin** with two halves:

1. **Plugin content** (`HARRY.md`, `skills/`, `commands/`, `references/`) — the resident laws
   and `brainstorm → plan → execute → finish` pipeline that ship to consumers. This is prose/markdown,
   not code.
2. **The `companion` runtime** (`src/` → bundled to `dist/companion.cjs`) — a TypeScript CLI that
   backs the `review`, `ask`, and `fix` slash commands, talking to a Codex backend.

`dist/companion.cjs` is **committed** — the plugin is self-contained for end users, no build step
required to install it. Only rebuild `dist/` when changing `src/`.

## Commands

```
pnpm install                    # install deps
pnpm run build                  # bundle src/companion.ts -> dist/companion.cjs (esbuild)
pnpm test                       # node --test — runs tests/*.test.ts directly (Node >=26 native TS)
node --test tests/codex-auth.test.ts   # run a single test file
pnpm run typecheck              # tsc --noEmit
pnpm run lint                   # biome check .
pnpm run format                 # biome format --write .
pnpm run install-laws           # scripts/install.mjs — wire HARRY.md into a global CLAUDE.md via @-import
pnpm run install-laws-codex     # scripts/install-codex.mjs — inline HARRY.md into ~/.codex/AGENTS.md (Codex build)
pnpm run init-ignore            # scripts/init.mjs — add harry's .gitignore block to a project
```

Node **>= 26** is required, deliberately — it is the floor for running `.test.ts` files directly
under `node --test` via native TypeScript stripping, with no ts-node/transpile step. This is a
conscious trade (newer-than-LTS floor, narrower contributor base) bought for a zero-build test/run
path; don't "fix" it by lowering the floor without restoring a transpile step for tests.

**Lint scope** (`biome.json` `files.includes`): `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.mjs`,
`build.mjs`, `*.json`. The vendored Apache-2.0 Codex code is deliberately excluded from lint
(`!src/lib/codex/**`, `!tests/fake-codex.*`) — it tracks upstream, so we don't churn it for style.
`pnpm run lint` currently emits one benign warning (`useBiomeIgnoreFolder` on the exclude glob;
biome's suggested folder form doesn't actually exclude under `includes`, so the `**` form stays);
it exits 0. `pnpm run typecheck` covers the whole TS source including the vendored dir.

## Runtime architecture (`src/`)

Single CLI entry point `src/companion.ts` parses `argv` and routes to `src/commands/*.ts`
(`review`, `ask`, `fix`, `status`, `result`, `background`, `setup`). Bundled by `build.mjs`
(esbuild, CJS, Node built-ins kept external) into the one committed file `dist/companion.cjs`.

**Codex session driver** (`src/lib/provider.ts`, `src/lib/run-agent-session.ts`,
`src/lib/providers/codex.ts`): `review`, `ask`, and `fix` all run through a single Codex-only
`CodexSession`. No provider selection — the `codex` CLI on `PATH`, logged in via `codex login`,
is the only backend.

`src/lib/codex/` (protocol, process, app-server, turn, auth) and `tests/fake-codex.mjs` /
`tests/fake-codex.d.mts` are derived from `codex-plugin-cc` and are **Apache-2.0**, not MIT — see
`NOTICE`. Everything else in the repo is MIT.

`upstream.json` pins the three upstream sources (`superpowers`, `ponytail`, `codex-plugin-cc`) by
commit; `references/upstream-sync.md` documents how to diff an upstream's newer philosophy against
harry's customized version when pulling in changes.

## Plugin content (`HARRY.md`, `skills/`, `commands/`, `references/`)

`HARRY.md` is the resident law file, `@`-imported into a consumer's global `~/.claude/CLAUDE.md` by
`scripts/install.mjs` (`pnpm run install-laws` / the plugin's own `/init` command) so it applies
every session without needing a keyword. Editing `HARRY.md` changes behavior for every project that
has already run `/init` — there is no versioning/opt-in per edit, the `@`-import is live.

The four pipeline skills (`skills/brainstorming`, `skills/writing-plans`, `skills/executing`,
`skills/finishing`) auto-trigger (no slash command) and read `HARRY.md`'s tier table (§3) to decide
how much process a task gets. `references/` holds on-demand tables/techniques the skills link to
(e.g. `tier-gates.md`, `red-green.md`, `review-rubric.md`) rather than inlining them, to keep the
skill files themselves short.

`/audit` (`commands/audit.md`) is a whole-codebase structure/architecture audit — a six-round,
iterative workflow distinct from the four pipeline skills above (it's user-invoked via slash
command, not tier-triggered). Its round-by-round methodology, JSON schema, and validator script
are too large to inline in one command file, so they live in `references/audit/` (`RECON.md`,
`DEEP-DIVE.md`, `SCAN-DIMENSIONS.md`, `VALIDATION-AND-REPORTING.md`, `report-schema.json`,
`validate-findings.cjs`) — a subdirectory of the shared `references/`, read by path from
`commands/audit.md`, not auto-discovered as anything on its own.

`CLAUDE.local.md` (gitignored, present in this repo) is harry's own convention for
project-specific rules that refine `HARRY.md` for a single repo — not a task list. Active in-flight
work lives in the also-gitignored `.local/STATUS.md` instead.

## Codex CLI compatibility (`.codex-plugin/`, `codex-skills/`)

Alongside the Claude Code plugin, harry ships a parallel `.codex-plugin/plugin.json`
+ `.agents/plugins/marketplace.json` for Codex CLI, which has its own Skills/Hooks
system (`SKILL.md` format is shared with Claude Code; `${CLAUDE_PLUGIN_ROOT}` /
`${CLAUDE_PLUGIN_DATA}` are aliased by Codex, so `dist/companion.cjs` needs no
Codex-specific code path). `skills/` (the four pipeline skills) is auto-discovered
by Codex's default component discovery and `dist/companion.cjs` is shared as-is
between both builds; `plugin.json`'s `skills` field only needs to name the
supplemental `./codex-skills` path (it's a single string, not an array — Codex's
own `plugin-creator` system skill's schema reference confirms this).
`.agents/plugins/marketplace.json`'s shape (`name` / `interface.displayName` /
`plugins[]` with `source.source`/`source.path`/`policy.installation`/
`policy.authentication`/`category` per entry) is Codex-specific and does NOT
mirror `.claude-plugin/marketplace.json`'s shape — verified live against an
authenticated Codex CLI install (0.128.0) via `codex debug prompt-input`, not
guessed from web docs.

`codex-skills/` holds Codex-only conversions of the mechanical/read-only
`commands/*.md` slash commands (`ask`, `status`, `result`, `debt`, `review`,
`init`, `audit`) — Codex's plugin manifest has no `commands`/`prompts`
field, so these become semantically-triggered Skills instead of explicit slash
commands. This is a **deliberate partial-parity build**, not full feature parity:

- `debate` has no Codex skill (its "self" voice is Claude/opus by design).
- Codex `review --full` drops the CC self-review leg (no `SlashCommand` tool on
  Codex) and drops `--harry-fix` (redundant when the orchestrator already is
  Codex) — only `--fix` remains.
- `review`'s RO/RW boundary is instruction-only on **both** builds. Claude
  Code's `allowed-tools` frontmatter is a single static allowlist that must
  include the write tools (`Edit`/`git add`/`git commit`) for the RW `--fix`
  path, so it cannot conditionally gate read-only vs read-write — the RO
  discipline is enforced by instruction, same as Codex. (CC's allowlist still
  bounds the overall tool universe; it just doesn't enforce the RO/RW split.)
- Codex `audit`'s RO round-boundaries are likewise instruction-only, not
  tool-enforced (see its skill's own "Known limitation" note); it shares the same
  `references/audit/` reference bundle and `report-schema.json`/
  `validate-findings.cjs` as the Claude Code `/audit` command via
  `${CLAUDE_PLUGIN_ROOT}`.
- `init`'s law-wiring (`scripts/install-codex.mjs`) inlines HARRY.md's content into
  `~/.codex/AGENTS.md` as a snapshot (Codex has no `@`-import syntax) — re-run
  after HARRY.md changes to resync, unlike Claude Code's always-live import.

See `.local/specs/2026-07-03-codex-compat-design.md` for the full design record
(gitignored, not committed — this section is the durable summary).

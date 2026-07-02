# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`harry` is a Claude Code **plugin** with two halves:

1. **Plugin content** (`HARRY.md`, `skills/`, `commands/`, `references/`) — the resident laws
   and `brainstorm → plan → execute → finish` pipeline that ship to consumers. This is prose/markdown,
   not code.
2. **The `companion` runtime** (`src/` → bundled to `dist/companion.cjs`) — a TypeScript CLI that
   backs the `review`, `ask`, and `fix` slash commands, talking to a Copilot or Codex backend.

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
pnpm run init-ignore            # scripts/init.mjs — add harry's .gitignore block to a project
```

Node **>= 26** is required — tests are `.test.ts` files executed directly by `node --test` via
native TypeScript stripping; there is no separate ts-node/transpile step for tests.

**Lint scope is narrow by design** (`biome.json` `files.includes`): only `scripts/**/*.mjs`,
`build.mjs`, and `*.json`. `src/**/*.ts` and `tests/**/*.ts` are **not** covered by `pnpm run lint`
— rely on `pnpm run typecheck` for the TS source.

## Runtime architecture (`src/`)

Single CLI entry point `src/companion.ts` parses `argv` and routes to `src/commands/*.ts`
(`review`, `ask`, `fix`, `status`, `result`, `background`, `setup`). Bundled by `build.mjs`
(esbuild, CJS, Node built-ins kept external) into the one committed file `dist/companion.cjs`.

**Provider abstraction** (`src/lib/provider.ts`, `src/lib/providers/{codex,copilot}.ts`): `review`,
`ask`, and `fix` run through one of two interchangeable backends. Resolution order:
1. an explicit `--provider codex|copilot` flag
2. the plugin's `provider` user setting (exposed as `CLAUDE_PLUGIN_OPTION_PROVIDER`)
3. auto — prefer Codex (if its CLI is installed and logged in), else Copilot

`src/lib/codex/` (protocol, process, app-server, turn, auth) and `tests/fake-codex.mjs` /
`tests/fake-codex.d.mts` are derived from `codex-plugin-cc` and are **Apache-2.0**, not MIT — see
`NOTICE`. Everything else in the repo is MIT.

`upstream.json` pins the four upstream sources (`superpowers`, `ponytail`, `copilot-plugin-cc`,
`codex-plugin-cc`) by commit; `references/upstream-sync.md` documents how to diff an upstream's
newer philosophy against harry's customized version when pulling in changes.

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

`CLAUDE.local.md` (gitignored, present in this repo) is harry's own convention for
project-specific rules that refine `HARRY.md` for a single repo — not a task list. Active in-flight
work lives in the also-gitignored `.local/STATUS.md` instead.

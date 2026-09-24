# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`harry` is a Claude Code **plugin** with two halves:

1. **Plugin content** (`HARRY.md`, `skills/`, `commands/`, `references/`) — the resident laws
   and `brainstorm → execute → finish` pipeline that ship to consumers. This is prose/markdown,
   not code.
2. **The `companion` runtime** (`src/` → bundled to `dist/companion.cjs`) — a TypeScript CLI that
   backs the `review` and `ask` slash commands by spawning the `codex` CLI.

`dist/companion.cjs` is **committed** — the plugin is self-contained for end users, no build step
required to install it. Rebuild `dist/` when changing `src/` **or `package.json`** —
the bundle inlines `package.json`, so every version bump needs a rebuild (CI's dist
drift gate fails otherwise).

## Commands

```
pnpm install                    # install deps
pnpm run build                  # bundle src/companion.ts -> dist/companion.cjs (esbuild)
pnpm test                       # node --test — runs tests/*.test.ts directly (Node >=26 native TS)
node --test tests/review-cli.test.ts   # run a single test file
pnpm run typecheck              # tsc --noEmit
pnpm run lint                   # biome check .
pnpm run format                 # biome format --write .
pnpm run install-laws           # scripts/install.mjs — wire HARRY.md into a global CLAUDE.md via @-import
pnpm run install-laws-codex     # scripts/install-codex.mjs — inline HARRY.md into ~/.codex/AGENTS.md (Codex build)
pnpm run init-ignore            # scripts/init.mjs — add harry's .gitignore block to a project
pnpm run evals <validate|run|score> [options]   # scripts/run-evals.mjs — behavioral evals
```

Node **>= 26** is required, deliberately — it is the floor for running `.test.ts` files directly
under `node --test` via native TypeScript stripping, with no ts-node/transpile step. This is a
conscious trade (newer-than-LTS floor, narrower contributor base) bought for a zero-build test/run
path; don't "fix" it by lowering the floor without restoring a transpile step for tests.

Use pnpm 12 natively (corepack, or a pnpm 12 install) — a pre-12 global pnpm hands off to 12 and
rewrites `pnpm-lock.yaml`'s package-manager document in the process, dirtying the lockfile.

**Lint scope** (`biome.json` `files.includes`): `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.mjs`,
`build.mjs`, `*.json` — no excludes; `pnpm run lint` exits 0. `pnpm run typecheck` covers the whole
TS source.

**Behavioral evals** (`evals/`, `scripts/run-evals.mjs`) measure whether the resident laws actually
change a model's first-response behavior — each case runs the same prompt twice, once with an empty
global `CLAUDE.md` (baseline) and once with `HARRY.md` inlined (candidate), and the delta is the
laws' effect. Run them after any material `HARRY.md` change. `validate` (schema-check the cases) and
`score` (grade a results file) are free; `run` is **real API spend** and requires a pinned `--model`.
The opt-in agentic jail (`EVALS_SANDBOX=1`) is for trusted, repo-authored cases only; untrusted cases
belong on an ephemeral machine (see `evals/README.md`).
Conditions, isolation, auth, trials, and the scoring model → `evals/README.md`.

**Cutting a release:** bump the four hand-maintained version fields in lockstep —
`package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and the **nested**
`plugins[harry].version` in `.claude-plugin/marketplace.json` — `tests/version-sync.test.ts`
fails if any one of them disagrees. Add the `CHANGELOG.md` entry, then rebuild `dist/`
(`build.mjs` inlines `package.json`, so a version bump with no rebuild fails CI's drift
gate). Finally `git tag vX.Y.Z` and push the tag: without it there is no way to diff what a
release shipped. Some older releases have a `CHANGELOG.md` entry and no tag; do not backfill
them — a tag reconstructed from CHANGELOG commits cannot be verified, and a wrong tag is worse
than a missing one. Audit gaps with `git tag --sort=v:refname`: plain `git tag` sorts
lexically, filing `v0.10.0` ahead of `v0.2.0`, so a `tail` of it hides the newest tags.
`/release <version>` (repo-local, `.claude/commands/release.md`) automates the
bump/build/verify/commit steps above; re-run it after the merge to tag.

## Runtime architecture (`src/`)

Single CLI entry point `src/companion.ts` parses `argv` and routes to `src/commands/*.ts`
(`review`, `ask`, `setup`). Bundled by `build.mjs`
(esbuild, CJS, Node built-ins kept external) into the one committed file `dist/companion.cjs`.

Both `ask` and `review` spawn the `codex` CLI as a separate, ephemeral, read-only
subprocess and read its output back. `ask` runs
`codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> [-c model_reasoning_effort="<v>"] -`
with the prompt on stdin. `review` spawns `codex exec review` (`sandbox_mode="read-only"`),
with the review rubric and context built into its prompt, and writes findings to a file
rather than streaming a session turn. Neither passes a model — `~/.codex/config.toml`
decides which one runs. There is no fix backend or apply path in-runtime; both commands are
read-only, full stop.

Everything in the repo is MIT except `references/skill-authoring.md`, which distills
parts of an Apache-2.0 source (`anthropics/skills`) — see `NOTICE`.

`upstream.json` pins three upstream sources (`ponytail`, `mattpocock-skills`,
`anthropics-skills`) by commit; `superpowers` (origin of the pipeline skills) and
`codex-plugin-cc` (origin of the retired vendored runtime) are retired to
`historical_sources` (attribution only, not synced);
`references/upstream-sync.md` documents how to diff an upstream's newer philosophy against
harry's customized version when pulling in changes.

## Plugin content (`HARRY.md`, `skills/`, `commands/`, `references/`)

`HARRY.md` is the resident law file. `scripts/install.mjs` (`pnpm run install-laws` / the plugin's
own `/sync` command) **deploys a snapshot** of it to `~/.claude/harry/HARRY.md` and `@`-imports that
deployed copy into a consumer's global `~/.claude/CLAUDE.md`, so it applies every session without
needing a keyword. The import points at the deployed snapshot, NOT the live plugin checkout: editing
`HARRY.md` (even uncommitted) does not change installed behavior until you re-run install-laws /
`/sync`, which re-deploys the snapshot and rewrites the import block (migrating any older
direct-repo-path import). "Release" = re-run sync — the same resync model as the Codex build
(`scripts/install-codex.mjs`), so both builds converge on one mental model.

The three pipeline skills (`skills/brainstorming`, `skills/executing`, `skills/finishing`)
auto-trigger (no slash command) and read `HARRY.md`'s tier table (§3) to decide
how much process a task gets. There is no plan stage: brainstorming closes on numbered
acceptance criteria inside the item's `## Why / What`, and executing builds against them. `references/` holds on-demand tables/techniques the skills link to
(e.g. `tier-gates.md`, `red-green.md`, `review-rubric.md`) rather than inlining them, to keep the
skill files themselves short.

`agents/` holds two **role agents**: `scout` (recon, haiku/low, read-only tools) and
`analyst` (independent judgment — review, architecture review, the debate's opus voice,
audit analysis — opus/high, no edit or spawn tools). The session writes everything
itself; it dispatches only these two (HARRY.md §5). The Agent tool takes a model but no
effort, so a fixed effort needs an agent file. CC namespaces plugin agents, so they
dispatch as `harry:scout` and `harry:analyst`. `tests/agents.test.ts` enforces the
invariants (alias models only, no edit or spawn tools; `analyst` keeps Bash and is read-only by instruction).

**Dispatch mechanism is Claude Code only — verified against live Codex 0.144.4.** Codex has
no per-subagent model/effort mechanism: `codex --help` exposes no subagent dispatch, its
plugin `agents/` are frontmatter-less persona/interface cards (no `model`/`effort`), and
`codex debug prompt-input` shows harry contributing skills + AGENTS.md laws but **no
agents**. Web docs describing `codex-agents/*.toml` with `model_reasoning_effort` do not
match the live CLI; do not add them. The role→model *bindings* exist for Codex, though —
`references/codex-role-mapping.md` is an advisory table that `install-codex.mjs` inlines
into `~/.codex/AGENTS.md` alongside HARRY.md, applied via session profile / `-m` plus
reasoning-effort config rather than dispatch, since there is still no subagent to route to.

The *auto-invoked* Explore path (vs. explicit `scout` dispatch) is captured on CC by an
opt-in user-level `~/.claude/agents/Explore.md` override that `/harry:sync --explore` installs
(marker-guarded so `--remove` never deletes a user's own). Note plugin agent changes need
`/reload-plugins` or a restart (not live like SKILL.md), and are discovered from a **real
install** (or `claude plugin update`), not a hand-edited plugin cache.

`/audit` (`commands/audit.md`) is a whole-codebase structure/architecture audit — a six-round,
iterative workflow distinct from the three pipeline skills above (it's user-invoked via slash
command, not tier-triggered). Its round-by-round methodology, JSON schema, and validator script
are too large to inline in one command file, so they live in `references/audit/`
(`references/audit/ORCHESTRATION.md` — the shared six-round orchestration both builds' thin
wrappers point at — plus `references/audit/RECON.md`, `references/audit/DEEP-DIVE.md`,
`references/audit/SCAN-DIMENSIONS.md`, `references/audit/VALIDATION-AND-REPORTING.md`,
`references/audit/report-schema.json`, `references/audit/validate-findings.cjs`) — a
subdirectory of the shared `references/`, read by path from `commands/audit.md` and
`codex-skills/audit/SKILL.md`, not auto-discovered as anything on its own. Written as full
paths, not bare filenames: this is now the only hand-maintained copy of that list, and
`tests/prose-refs.test.ts` can only verify a path, so a bare filename here would go stale
silently on a rename.

`CLAUDE.local.md` is harry's own convention for project-specific rules that refine
`HARRY.md` for a single repo — not a task list. It is gitignored and **untracked**, so it
exists only in your working copy: it was listed in `.gitignore` from the start but stayed
tracked until 2026-08-08 (git does not apply an ignore to an already-tracked path), which
made the ignore a no-op and shipped one repo's personal rules to everyone who cloned.
Active in-flight work lives in the also-gitignored `.local/INDEX.md` `## In flight` section
instead.

## Codex CLI compatibility (`.codex-plugin/`, `codex-skills/`)

Alongside the Claude Code plugin, harry ships a parallel `.codex-plugin/plugin.json`
+ `.agents/plugins/marketplace.json` for Codex CLI, which has its own Skills/Hooks
system (`SKILL.md` format is shared with Claude Code). Codex does **not** set
`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` in the shell a skill's commands run
in (verified on codex-cli 0.155.1), so every `codex-skills/*/SKILL.md` that uses the
root variable opens with a **Plugin root** rule — derive it from the skill's own path —
pinned by `tests/codex-plugin-root.test.ts`; `dist/companion.cjs` falls back to a
tmpdir state root when `CLAUDE_PLUGIN_DATA` is unset, so it needs no Codex-specific
code path. `skills/` (the three pipeline skills) is auto-discovered
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

`codex-skills/` holds Codex-only conversions of the portable
`commands/*.md` slash commands (`ask`, `debt`, `review`,
`sync`, `audit`, `distill`, `wait-what`, and the conversational `grill`) — Codex's plugin manifest has no `commands`/`prompts`
field, so these become semantically-triggered Skills instead of explicit slash
commands. This is a **deliberate partial-parity build**, not full feature parity:

- `debate` has no Codex skill (its "self" voice is Claude/opus by design).
- `grill` is listed to keep this parity list complete, not as a difference: both builds
  ask one question per round, in both phases, per `references/grilling.md`. A single
  question needs no harness-specific question UI, so only the door differs
  (`commands/grill.md` vs `codex-skills/grill/SKILL.md`).
- `review` is read-only on both builds — it has no fix backend and no in-runtime
  path to apply what it finds. On both
  builds the review itself is held read-only by the spawned `codex exec review`
  process's own `sandbox_mode="read-only"` override. On Claude Code,
  `commands/review.md`'s `allowed-tools` only **pre-approves** the review
  invocation (`node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review`), read-only
  `git status`/`git diff`, and `Read` — it does not block other tools, so the
  orchestrator side stays read-only by instruction. Every command line in that
  doc starts with that exact invocation so it matches the pattern (an unmatched
  one only costs a permission prompt). The frontmatter does not set
  `disable-model-invocation`, so both the `SlashCommand` and `Skill` tools — and
  `skills/executing/SKILL.md`'s review step (step 3) — can invoke it directly.
- Codex `audit`'s RO round-boundaries are likewise instruction-only, not
  tool-enforced (see its skill's own "Known limitation" note); it shares the same
  `references/audit/` reference bundle and `report-schema.json`/
  `validate-findings.cjs` as the Claude Code `/audit` command via
  `${CLAUDE_PLUGIN_ROOT}`.
- `sync` (`scripts/install-codex.mjs`) inlines HARRY.md's content into
  `~/.codex/AGENTS.md` as a snapshot (Codex has no `@`-import syntax), appending the
  advisory Codex role-map table (`references/codex-role-mapping.md`) to the same block —
  re-run after HARRY.md or the role map changes to resync, unlike Claude Code's always-live import.

See `.local/specs/2026-07-03-codex-compat-design.md` for the full design record
(gitignored, not committed — this section is the durable summary).

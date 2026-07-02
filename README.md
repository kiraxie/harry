# harry

A personal Claude Code plugin: the **Superpowers** workflow philosophy and **ponytail** laziness discipline, distilled into one resident ruleset around a single stance — **correctness and leaving no legacy outrank saving cost** — with a multi-model review/debate runtime.

Two halves:

- **Resident laws** (`HARRY.md`) — loaded into your global instructions via an `@`-import, so they apply every session: a cost model, a three-tier complexity threshold, red lines, and the correctness disciplines (TDD, root-cause, honesty/evidence).
- **A `brainstorm → plan → execute → finish` pipeline** — four skills, plus slash commands for review, debate, and over-engineering/debt audits.

## The three-tier threshold

Every non-trivial task is classified; the tier decides how much process applies (full detail in `references/tier-gates.md`).

| Tier | Trigger | What runs |
|------|---------|-----------|
| **Trivial** | 1 file, mechanical, no branching | just do it + verify |
| **Standard** | 2–5 files, real logic, one subsystem | compressed brainstorm, bullet plan, one test, subagent execution |
| **Major** | 6+ files, cross-subsystem, or a red line | full brainstorm → spec → plan → subagent execution with per-task review → finish |

Any red line (security/auth/money/delete/migration/external contract/cross-boundary contract) forces **Major** regardless of size.

## Prerequisites

- Node.js **>= 26**
- [Claude Code](https://claude.com/claude-code)
- For the agent commands (`review`, `ask`, `debate`): the `codex` CLI on `PATH`, logged in (`codex login`).
- For `debate`'s Gemini voice: the `agy` (Antigravity) CLI on `PATH`.

## Install

**Claude Code only.** No clone, no build — `dist/` is committed and self-contained.

```
/plugin marketplace add kiraxie/harry   # GitHub owner/repo
/plugin install harry@kiraxie           # <plugin>@<marketplace> — "harry, published by kiraxie"
/init                                    # wire the resident laws + set up this project
```

`/init` does three things: wires harry's resident laws (`HARRY.md`, which ships
with the plugin) into your global `~/.claude/CLAUDE.md` so they apply every
session; adds harry's `.gitignore` block to this project; and offers to migrate
any legacy spec/plan docs into harry's format. Run it once per project — the laws
step is idempotent, so re-runs elsewhere are no-ops. (`/init --remove` strips this
project's `.gitignore` block; the global laws stay.)

Contributors rebuilding the runtime under `src/`: `pnpm install && pnpm run build`.

## Commands

`review`, `ask`, and `debate` run through Codex, on your Codex/ChatGPT subscription — no
per-call premium quota. The rest are Claude-native or local scripts.

| Command | What it does |
|---------|--------------|
| `/review [--adversarial] [--fix]` | Multi-model code review (gpt-5.3-codex defect; `--adversarial` gpt-5.5 design challenge; `--fix` Claude-judged repair) |
| `/ask "<prompt>"` | One read-only prompt to Codex |
| `/debate "<topic>"` | 3 models (opus / gpt via Codex / gemini-3.1-pro) deliberate over 2 rounds; Claude synthesizes |
| `/status` | Codex rate-limit snapshot + background jobs |
| `/result [job-id]` | Fetch a completed background job's output |
| `/lean [--repo]` | Over-engineering audit — what to delete/simplify (diff, or whole tree with `--repo`) |
| `/debt` | Re-judge deferred decisions (`DEBT:` markers + spec Non-Goals + plan deferrals) into a triaged ledger |
| `/init [--remove] [--force]` | Set harry up here — wire the resident laws, add the `.gitignore` block, migrate legacy spec/plan docs |

Cheap-first smoke test: `/status` → `/lean` → `/ask` → `/review`/`/debate`.

## Codex

The agent commands (`ask`, `review`, `review --fix`) all run through the OpenAI **Codex**
CLI (spawned as a subprocess, JSON-RPC over stdio). No SDK dependency — only the `codex`
binary on `PATH`.

Codex injects no default model for `ask`/`fix` — leave `--model` unset to let
`~/.codex/config.toml` decide. `review`'s three lanes (standard/adversarial/simplify) each
pin their own default model to keep their perspectives distinct; pass `--model` to
override any of them. One-time setup: install the `codex` CLI, then `codex login`.

## Skills

These auto-trigger (no slash command); they are the pipeline:

- **brainstorming** — turn an idea into an approved SCQA spec (HARD-GATE: no code before approval). A Major/contested decision can escalate to `/debate`.
- **writing-plans** — turn a spec into a tier-appropriate execution plan.
- **executing** — run the plan; the tier auto-routes between session (inline) and subagent (fresh subagent per task + per-task review) mode.
- **finishing** — verify green, ask merge-vs-PR, then archive spec/plan, clean up the worktree, return to main, and watch CI.

## Layout

```
HARRY.md            resident laws (loaded via @)
skills/             brainstorming · writing-plans · executing · finishing
commands/           review · ask · status · result · debate · lean · debt · init
references/         on-demand tables + techniques (tier gates, claim→evidence, red-green, ...)
src/ + dist/        agent runtime — Codex provider (bundled via build.mjs)
scripts/            install.mjs · init.mjs · lib/markers.mjs
upstream.json       tracks the four upstreams by commit (see references/upstream-sync.md)
```

## Upstream

harry is distilled from `superpowers`, `ponytail`, `copilot-plugin-cc`, and `codex-plugin-cc`. `upstream.json` pins each by commit; `references/upstream-sync.md` is how to diff an upstream's newer philosophy against harry's customized version. Note: `review`'s design upstream is **codex-plugin-cc** (Copilot's review was ported from it).

## License

MIT, except the Codex provider. The files under `src/lib/codex/` and the test
fixture `tests/fake-codex.mjs` are derived from
[`codex-plugin-cc`](https://github.com/openai/codex) (Copyright 2026 OpenAI) and
are licensed under Apache-2.0; see [`NOTICE`](NOTICE). All other code is MIT.

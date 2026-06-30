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
- For the agent commands (`review`, `ask`, `debate`): a backend **provider** — GitHub Copilot (`gh auth login`) or OpenAI Codex (`codex` CLI + `codex login`). See [Providers](#providers).
- For `debate`'s Gemini voice: the `agy` (Antigravity) CLI on `PATH`.

## Install

Two layers — install whichever your agent supports.

### 1. Plugin (commands + skills + hooks) — Claude Code only

No clone, no build — `dist/` is committed and self-contained (just needs Node **>= 26** for the agent commands):

```bash
claude plugin marketplace add kiraxie/harry
claude plugin install harry@kiraxie
```

Or inside Claude Code: `/plugin marketplace add kiraxie/harry` then `/plugin install harry@kiraxie`.

Per project, add harry's `.gitignore` block with `/init`.

### 2. Resident laws (`HARRY.md`) — Claude Code, Codex, or Antigravity

`@`-imports need a local copy, so clone first. `scripts/install.mjs` wires a
marker-wrapped `@<path>/HARRY.md` into a global instructions file (idempotent;
`--remove` strips it):

```bash
git clone https://github.com/kiraxie/harry && cd harry
node scripts/install.mjs                                    # Claude Code → ~/.claude/CLAUDE.md (default)
HARRY_GLOBAL=~/.codex/AGENTS.md  node scripts/install.mjs   # Codex
HARRY_GLOBAL=~/.gemini/GEMINI.md node scripts/install.mjs   # Antigravity (agy)
```

If a host doesn't resolve `@`-imports, paste `HARRY.md`'s contents in instead.
Contributors rebuilding the runtime under `src/`: `pnpm install && pnpm run build`.

## Commands

`review`, `ask`, and `debate` run through a backend [provider](#providers). On **Copilot** they **consume premium quota** (costs below); on **Codex** they run on your Codex subscription at **no Copilot premium**. The rest are Claude-native or local scripts and cost **no premium**.

| Command | What it does | Premium cost |
|---------|--------------|--------------|
| `/review [--adversarial] [--fix]` | Multi-model code review (gpt-5.3-codex defect; `--adversarial` gpt-5.5 design challenge; `--fix` Claude-judged repair) | **yes** — scales with diff size |
| `/ask "<prompt>"` | One read-only prompt to a frontier model (gpt-5.5) | **yes** — ~7.5 cost/call |
| `/debate "<topic>"` | 3 models (opus / gpt-5.5 / gemini-3.1-pro) deliberate over 2 rounds; Claude synthesizes | **yes** — gpt across 2 rounds (opus on your Claude sub, gemini on your Google sub) |
| `/status` | Quota / Codex rate-limit snapshot + background jobs | no |
| `/result [job-id]` | Fetch a completed background job's output | no |
| `/lean [--repo]` | Over-engineering audit — what to delete/simplify (diff, or whole tree with `--repo`) | no |
| `/debt` | Re-judge deferred decisions (`DEBT:` markers + spec Non-Goals + plan deferrals) into a triaged ledger | no |
| `/init [--remove]` | Add/remove harry's `.gitignore` block in a project | no |

Cheap-first smoke test: `/status` → `/lean` → `/ask` → `/review`/`/debate`.

## Providers

The agent commands (`ask`, `review`, `review --fix`) run through one of two
interchangeable backends:

- **Copilot** — the GitHub Copilot CLI. Consumes Copilot **premium quota**.
- **Codex** — OpenAI's `codex` CLI. Runs on your Codex/ChatGPT subscription at
  **no Copilot premium**; `status` shows its rate-limit snapshot instead.

**Which one runs**, in order:

1. An explicit `--provider codex|copilot` flag.
2. The `provider` plugin setting (`/plugin` → harry → **Backend provider**).
3. Otherwise **auto**: Codex when its CLI is installed and logged in, else Copilot.

Codex injects no default model — leave `--model` unset to let
`~/.codex/config.toml` decide. One-time setup: install the `codex` CLI, then `codex login`.

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
src/ + dist/        agent runtime — Copilot + Codex providers (bundled via build.mjs)
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

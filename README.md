# harry

A personal Claude Code plugin. It distills the **Superpowers** workflow philosophy and the **ponytail** laziness discipline into one resident ruleset, recalibrated around a single stance — **correctness and leaving no legacy outrank saving cost** — and fuses in a copilot-centric multi-model review/debate runtime.

Two halves:

- **Resident laws** (`HARRY.md`) — loaded into your global instructions via an `@` import, so they apply every session without a keyword: a cost model, a three-tier complexity threshold, red lines, deferral discipline, and the correctness disciplines (TDD, root-cause, honesty/evidence) folded in from Superpowers' iron laws.
- **A `brainstorm → plan → execute → finish` pipeline** as four skills, plus slash commands for review, debate, and over-engineering/debt audits.

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
- For the runtime commands (`review`, `ask`, `debate`): a GitHub Copilot subscription, authenticated via `gh auth login`. `npm install` pulls the `@github/copilot` CLI.
- For `debate`'s Gemini voice: the `agy` (Antigravity) CLI on `PATH`.

## Install

```bash
# 1. Build the Copilot runtime (the committed dist drifts as the Copilot CLI updates)
npm install
npm run build

# 2. Wire the resident laws into your global ~/.claude/CLAUDE.md (idempotent)
node scripts/install.mjs          # adds `@<path>/HARRY.md` in a marked block
                                  # warns about stale entries it supersedes
# uninstall: node scripts/install.mjs --remove

# 3. Install as a plugin so commands + skills are discovered
#    (inside Claude Code)
/plugin marketplace add /path/to/harry
/plugin install harry@harry-dev
```

Per project, add harry's ignore entries to that project's `.gitignore`:

```bash
/init                             # or: node scripts/init.mjs [dir]
```

## Commands

`review`, `ask`, and `debate` run through the Copilot runtime and **consume Copilot premium quota**. The rest are Claude-native or local scripts and cost **no premium**.

| Command | What it does | Premium cost |
|---------|--------------|--------------|
| `/review [--adversarial] [--fix]` | Multi-model code review (gpt-5.3-codex defect; `--adversarial` gpt-5.5 design challenge; `--fix` Claude-judged repair) | **yes** — scales with diff size |
| `/ask "<prompt>"` | One read-only prompt to a frontier model (gpt-5.5) | **yes** — ~7.5 cost/call |
| `/debate "<topic>"` | 3 models (opus / gpt-5.5 / gemini-3.1-pro) deliberate over 2 rounds; Claude synthesizes | **yes** — gpt across 2 rounds (opus on your Claude sub, gemini on your Google sub) |
| `/status` | Auth + available models + quota snapshot + background jobs | no |
| `/result [job-id]` | Fetch a completed background job's output | no |
| `/lean [--repo]` | Over-engineering audit — what to delete/simplify (diff, or whole tree with `--repo`) | no |
| `/debt` | Re-judge deferred decisions (`DEBT:` markers + spec Non-Goals + plan deferrals) into a triaged ledger | no |
| `/init [--remove]` | Add/remove harry's `.gitignore` block in a project | no |

Cheap-first smoke test: `/status` → `/lean` → `/ask` → `/review`/`/debate`.

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
src/ + dist/        copilot runtime (bundled via build.mjs)
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

# harry

A personal Claude Code plugin: the **Superpowers** workflow philosophy and **ponytail** laziness discipline, distilled into one resident ruleset around a single stance — **correctness and leaving no legacy outrank saving cost** — with a multi-model review/debate runtime.

Two halves:

- **Resident laws** (`HARRY.md`) — deployed as a snapshot into your global instructions via an `@`-import, so they apply every session: a cost model, a three-tier complexity threshold, red lines, and the correctness disciplines (TDD, root-cause, honesty/evidence).
- **A `brainstorm → plan → execute → finish` pipeline** — four skills, plus slash commands for review, debate, and over-engineering/debt audits.

## The three-tier threshold

Every non-trivial task is classified; the tier decides how much process applies (full detail in `references/tier-gates.md`).

| Tier | Trigger | What runs |
|------|---------|-----------|
| **Trivial** | 1 file, mechanical, no branching | just do it + verify |
| **Standard** | 2–5 files, real logic, one subsystem | compressed brainstorm, bullet plan, one test, inline execution + required independent review |
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
/harry:sync                             # wire the resident laws + set up this project
```

harry's commands share the `/harry:` namespace. The ones whose bare name collides
with a Claude Code built-in — `/harry:review`, `/harry:status` —
**must** be typed with the prefix, or the built-in runs instead; the rest
(`/harry:sync`, `/harry:ask`, `/harry:debate`, `/harry:debt`, `/harry:audit`, `/harry:result`)
accept the bare name when unambiguous.

`/harry:sync` does three things: deploys harry's resident laws (`HARRY.md`, which
ships with the plugin) as a snapshot to `~/.claude/harry/HARRY.md` and wires an
`@`-import to it into your global `~/.claude/CLAUDE.md` so they apply every
session; adds harry's `.gitignore` block to this project; and offers to migrate
any legacy spec/plan docs into harry's format. Run it once per project to set up,
and again any time the plugin updates or `HARRY.md` changes — the laws step is
idempotent, so re-runs elsewhere are no-ops. (`/harry:sync --remove` strips this
project's `.gitignore` block; the global laws stay.)

The laws are a **snapshot**, not a live reference to the plugin checkout: after
updating the plugin (or editing `HARRY.md`), re-run `/harry:sync` (or
`pnpm run install-laws`) to re-deploy and resync — same model as the Codex build
below. "Release" = re-run sync.

Contributors rebuilding the runtime under `src/`: `pnpm install && pnpm run build`.

## Install (Codex CLI)

harry also ships as a **Codex CLI** plugin — a deliberate partial-parity build, not
full feature parity (see `CLAUDE.md`'s "Codex CLI compatibility" section for exactly
what's degraded or missing). Requires the `codex` CLI on `PATH`, logged in
(`codex login`).

```
codex plugin marketplace add kiraxie/harry   # GitHub owner/repo
```

Then, inside an interactive `codex` session, run `/plugins` and install `harry`
from the `kiraxie` marketplace — this CLI build has no non-interactive plugin
install command yet, only the `/plugins` picker.

`codex-skills/` holds the Codex-only conversions (`ask`, `status`, `result`,
`debt`, `review`, `sync`, `audit`); the four pipeline skills and the runtime are
shared as-is with the Claude Code build. `debate` has no Codex skill.

## Commands

`review`, `ask`, and `debate` run through Codex, on your Codex/ChatGPT subscription —
token-quota consumption, not a per-call premium-request count. The rest are
Claude-native or local scripts.

| Command | What it does |
|---------|--------------|
| `/harry:review [--adversarial] [--fix]` | Multi-model code review (gpt-5.6-terra defect; `--adversarial` gpt-5.6-sol design challenge; `--fix` Claude-judged repair) |
| `/harry:ask "<prompt>"` | One read-only prompt to Codex |
| `/harry:debate "<topic>"` | 3 models (opus / gpt via Codex / gemini-3.1-pro) deliberate over 2 rounds; Claude synthesizes |
| `/harry:status` | Codex rate-limit snapshot + background jobs |
| `/harry:result [job-id]` | Fetch a completed background job's output |
| `/harry:debt` | Re-judge deferred decisions and open backlog items (`DEBT:` markers + spec Non-Goals + plan deferrals + backlog entries) into a triaged ledger |
| `/harry:audit` | Whole-repo structural/architecture health-check — 6 rounds, iterative, incl. over-engineering hunting |
| `/harry:sync [--remove] [--force]` | Set up or resync harry here — wire the resident laws, add the `.gitignore` block, migrate legacy spec/plan docs |

Cheap-first smoke test: `/harry:status` → `/harry:ask` → `/harry:review`/`/harry:debate`.

## Codex

The agent commands (`ask`, `review`, `review --fix`) all run through the OpenAI **Codex**
CLI (spawned as a subprocess, JSON-RPC over stdio). No SDK dependency — only the `codex`
binary on `PATH`.

`ask` and `fix` default to a capable model (`gpt-5.6-sol`) rather than inheriting
whatever `~/.codex/config.toml` happens to set — applying vetted findings and
answering a one-shot prompt are judgment tasks (HARRY.md §5); pass `--model` to
override. `review`'s three lanes (standard/adversarial/simplify) each pin their own
default model to keep their perspectives distinct; pass `--model` to override any of
them. One-time setup: install the `codex` CLI, then `codex login`.

## Skills

These auto-trigger (no slash command); they are the pipeline:

- **brainstorming** — turn an idea into an approved SCQA spec (HARD-GATE: no code before approval). A Major/contested decision can escalate to `/debate`.
- **writing-plans** — turn a spec into a tier-appropriate execution plan.
- **executing** — run the plan; the tier auto-routes between session (inline) and subagent (fresh subagent per task + per-task review) mode.
- **finishing** — verify green, ask merge-vs-PR, then archive the plan, clean up the worktree, return to main, and verify completion (CI when pushed, the full local suite when the merge stays local).

## Layout

```
HARRY.md            resident laws (loaded via @)
skills/             brainstorming · writing-plans · executing · finishing (shared, both builds)
commands/           review · ask · status · result · debate · debt · sync · audit (Claude Code)
codex-skills/       ask · status · result · debt · review · sync · audit (Codex CLI)
references/         on-demand tables + techniques (tier gates, claim→evidence, red-green, ...)
src/ + dist/        agent runtime — Codex provider (bundled via build.mjs, shared, both builds)
scripts/            install.mjs · init.mjs · install-codex.mjs · lib/markers.mjs · lib/stale-entries.mjs
.claude-plugin/     Claude Code plugin manifest
.codex-plugin/ + .agents/plugins/   Codex CLI plugin manifest
upstream.json       tracks the three upstreams by commit (see references/upstream-sync.md)
```

## Upstream

harry is distilled from `superpowers`, `ponytail`, and `codex-plugin-cc` — all three pinned by commit in `upstream.json`; `references/upstream-sync.md` is how to diff an upstream's newer philosophy against harry's customized version. A fourth, `copilot-plugin-cc`, was a historical design influence (`debate`'s three-model structure, `ask`/`status`/`result`'s original shape) but is no longer pinned now that the Copilot backend is gone. Note: `review`'s design upstream is **codex-plugin-cc** (it was originally ported for the Copilot backend).

## License

MIT, except the Codex provider. The files under `src/lib/codex/` and the test
fixture `tests/fake-codex.mjs` are derived from
[`codex-plugin-cc`](https://github.com/openai/codex) (Copyright 2026 OpenAI) and
are licensed under Apache-2.0; see [`NOTICE`](NOTICE). All other code is MIT.

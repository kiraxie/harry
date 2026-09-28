# harry

A personal Claude Code plugin: the **Superpowers** workflow philosophy and **ponytail** laziness discipline, distilled into one resident ruleset around a single stance — **correctness and leaving no legacy outrank saving cost** — with a multi-model review/debate runtime.

Two halves:

- **Resident laws** (`HARRY.md`) — deployed as a snapshot into your global instructions via an `@`-import, so they apply every session: a cost model, a three-tier complexity threshold, red lines, and the correctness disciplines (TDD, root-cause, honesty/evidence, and plain language for anything you have to read).
- **A `brainstorm → execute → finish` pipeline** — three skills, plus slash commands for review, debate, adversarial grilling interviews, and over-engineering/debt audits.

## The three-tier threshold

Every non-trivial task is classified; the tier decides how much process applies (full detail in `references/tier-gates.md`).

| Tier | Trigger | What runs |
|------|---------|-----------|
| **Trivial** | 1 file, mechanical, no branching | just do it + verify |
| **Standard** | 2–5 files, real logic, one subsystem | compressed brainstorm, acceptance criteria, one test, the session builds + one independent review |
| **Major** | 6+ files, cross-subsystem, or a red line | full brainstorm → item `## Why / What` + numbered acceptance criteria → the session builds test-first → two review lanes (analyst + Codex) → finish |

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

harry's commands share the `/harry:` namespace. The one whose bare name collides
with a Claude Code built-in — `/harry:review` —
**must** be typed with the prefix, or the built-in runs instead; the rest
(`/harry:sync`, `/harry:ask`, `/harry:debate`, `/harry:debt`, `/harry:audit`, `/harry:grill`, `/harry:distill`, `/harry:wait-what`)
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

`codex-skills/` holds the Codex-only conversions (`ask`, `debt`,
`review`, `sync`, `audit`, `grill`, `distill`, `wait-what`); the three pipeline skills and the runtime are
shared as-is with the Claude Code build. `debate` has no Codex skill.

## Commands

`review`, `ask`, and `debate` run through Codex, on your Codex/ChatGPT subscription —
token-quota consumption, not a per-call premium-request count. The rest are
Claude-native or local scripts.

| Command | What it does |
|---------|--------------|
| `/harry:review [--base <ref>] [--reasoning <effort>] [--context <text\|@file\|@->]` | Read-only code review via `codex exec review` — working tree, a branch against its default, or a diff against `--base` |
| `/harry:ask "<prompt>" [--reasoning <effort>] [--context <text\|@file\|@->]` | One read-only prompt to Codex via `codex exec` |
| `/harry:debate "<topic>"` | 3 models (opus / gpt via Codex / gemini-3.1-pro) deliberate over 2 rounds; Claude synthesizes |
| `/harry:debt` | Re-judge deferred decisions and open backlog items (`DEBT:` markers + item deferrals + backlog entries) into a triaged ledger |
| `/harry:audit` | Whole-repo structural/architecture health-check — 6 rounds, iterative, incl. over-engineering hunting |
| `/harry:grill <topic>` | Adversarial interview that stress-tests a plan, decision, or idea — every decision settled, deferred, or surfaced; closes on a residue manifest |
| `/harry:distill <repo>` | Evaluate an external repo as a distillation candidate — survey it against harry's laws and deviation record, rule pull/adapt/skip per candidate, record the outcome in upstream tracking |
| `/harry:sync [--remove] [--force]` | Set up or resync harry here — wire the resident laws, add the `.gitignore` block, migrate legacy spec/plan docs |
| `/harry:wait-what` | Re-explain harry's previous message once, in plainer words — one-shot, not a mode |

Cheap-first smoke test: `/harry:ask` → `/harry:review`/`/harry:debate`.

## Codex

`ask` and `review` both spawn the `codex` CLI directly as a separate, ephemeral,
read-only subprocess — no SDK dependency, no in-process session, only the
`codex` binary on `PATH`. `ask` runs
`codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> [-c model_reasoning_effort="<v>"] -`
with the prompt on stdin; `review` spawns `codex exec review`. Read-only means
the model may read files and run read-only commands under Codex's own
read-only sandbox, but cannot write; the command itself writes only its output
file and a transcript log beside it.

Neither passes a model — `~/.codex/config.toml` decides which one runs;
`--reasoning` overrides effort for that one call. One-time setup: install the
`codex` CLI, then `codex login`.

## Skills

These auto-trigger (no slash command); they are the pipeline:

- **brainstorming** — turn an idea into an approved item `## Why / What` (SCQA) via the grilling interview (`references/grilling.md`), closing on a residue manifest and the numbered acceptance criteria approved with it (gate: no code before approval). A Major/contested decision can escalate to `/debate`.
- **executing** — build against the acceptance criteria, recording progress per AC ID. The session writes the code; the tier sets the tests and the review (one `analyst` lane for Standard, plus a Codex lane for Major).
- **finishing** — verify green, run an architecture review when the change altered an API, DB schema, public interface or module/service boundary, ask merge-vs-PR, then verify the merged result before any cleanup, archive the item, clean up the branch and any worktrees, and end on the confirmed base (CI as evidence when pushed; the merged-result suite when the merge stays local).

## Layout

```
HARRY.md            resident laws (loaded via @)
skills/             brainstorming · executing · finishing (shared, both builds)
commands/           review · ask · debate · debt · sync · audit · grill · distill · wait-what (Claude Code)
codex-skills/       ask · debt · review · sync · audit · grill · distill · wait-what (Codex CLI)
references/         on-demand tables + techniques (tier gates, claim→evidence, red-green, ...)
src/ + dist/        companion CLI — spawns the codex CLI for ask/review (bundled via build.mjs, shared, both builds)
scripts/            install.mjs · init.mjs · install-codex.mjs · lib/markers.mjs · lib/stale-entries.mjs
.claude-plugin/     Claude Code plugin manifest
.codex-plugin/ + .agents/plugins/   Codex CLI plugin manifest
upstream.json       tracks the three upstreams by commit (see references/upstream-sync.md)
```

## Upstream

harry is distilled from `ponytail`, `mattpocock-skills` (the `grill` family), and `anthropics-skills` (skill-authoring principles) — all three pinned by commit in `upstream.json`; `references/upstream-sync.md` is how to diff an upstream's newer philosophy against harry's customized version. Four more sources are historical influences, not pinned: `superpowers` (origin of the pipeline skills and the TDD/debugging/verification laws; retired as a pinned upstream in 2026-09 once harry's versions had diverged), `codex-plugin-cc` (origin of `review`'s design and of the vendored in-process Codex runtime; retired 2026-09 once that runtime was deleted in favor of spawning the `codex` CLI directly), `copilot-plugin-cc` (`debate`'s three-model structure, `ask`/`status`'s original shape; dropped with the Copilot backend) and `ayghri/i-have-adhd` (a one-time law comparison behind HARRY.md's talk-like-an-engineer and lawful-exit rules).

## License

MIT. Parts of `references/skill-authoring.md` are distilled from an
Apache-2.0 source (`anthropics/skills`); see [`NOTICE`](NOTICE).

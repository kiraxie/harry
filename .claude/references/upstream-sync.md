# Upstream Sync

> Onboarding a NEW candidate repo (clone, survey, rule, record) is `/distill`'s job —
> see `.claude/commands/distill.md`. This file covers re-syncing sources already pinned
> below.

Harry is distilled from the upstreams `upstream.json` pins by commit. Other sources are historical influences that are NOT pinned/synced: `superpowers` (the origin of harry's pipeline, which then had a plan stage and the TDD/debugging/verification laws, retired as a pinned upstream on 2026-09-15 after harry's versions diverged; recorded under `historical_sources` in `upstream.json`, last harvested at v6.3.0 — nothing to sync), `codex-plugin-cc` (origin of `review`'s design and of the vendored in-process Codex runtime; retired as a pinned upstream on 2026-09-17 once that runtime was deleted in favor of spawning the `codex` CLI directly — nothing left to sync), `copilot-plugin-cc` (design influence for `debate`/`ask`/`status`/`result`; dropped when the Copilot backend went away) and `anthropics-skills` (origin of `skill-authoring.md`'s 2026-07 additions; retired as a pinned upstream on 2026-10-20 because the installed official skill-creator covers its tooling and nothing was left to pull; recorded under `historical_sources`), and `ayghri/i-have-adhd` (a one-time 2026-07-24 philosophy comparison that produced HARRY.md law edits now in HARRY.md **Priority**, HARRY.md **Talk** and HARRY.md **Tiers** — no derived files exist to diff, so there is nothing to sync; re-compare on demand if its philosophy evolves). This is how to check whether an upstream's newer philosophy is worth pulling into harry.

Clones live in `.references/` (gitignored). Each `derived` entry in `upstream.json` records which source + path a harry file came from, plus a `note` on *why* it was customized — read the note before pulling, so you don't re-add something deliberately removed.

## Check one source for changes worth pulling

```bash
# 1. The commit harry last synced from
SHA=$(jq -r '.sources.ponytail.synced_commit' upstream.json)

# 2. Fetch the latest upstream
git -C .references/ponytail fetch -q

# 3. What changed in the relevant path since the last sync?
git -C .references/ponytail diff "$SHA"..origin/main -- skills/
```

Then compare that upstream diff against harry's customized version and decide — pull, adapt, or skip (per the `note`). After incorporating, bump the source's `synced_commit` (and `synced_version` / `synced_date`) in `upstream.json`.

## Provenance notes

- **`review`'s design upstream was `codex-plugin-cc`** — originally ported for the (now-removed)
  Copilot backend. `codex-plugin-cc` is retired to `historical_sources` (2026-09-17): the vendored
  in-process runtime it fed (`src/lib/codex/`) is deleted, and `review` now spawns
  the Codex CLI directly, running no code ported from it. Attribution only — do not sync.
- `debate` / `ask` / `status` / historically `result` (retired for lack of a shipped producer, 2026-07;
  `status` itself retired 2026-09-17 alongside the vendored runtime it read quota off of) were
  originally designed against `copilot-plugin-cc` (see `upstream.json`'s `derived[].from` for that
  historical attribution), but no longer track it for sync — the Copilot backend was removed, and
  `upstream.json` no longer pins that source.
- The resident laws (`HARRY.md`) track `ponytail`, still recalibrated (correctness > cost) — most upstream "be lazier" changes do NOT apply; read the `note`. Their other origin, `superpowers`, is retired — re-compare on demand only.
- **Every `mattpocock-skills` skill has a recorded verdict** in `.claude/references/mattpocock-decisions.md` (pulled, kept harry's, or skipped with the condition to re-judge). Read it before pulling from that source, so a settled skip is not re-opened.
- **`grill`'s upstream is `mattpocock-skills`** (its grilling primitive and grill-me door). Harry's cadence is a **deliberate deviation**: upstream (v1.3.x) asks the whole frontier per round and folded its former batch-grill-me into that default; harry keeps one question per round, because the user returns to threads cold across several sessions, where one question is answerable and a round is not. Upstream's round layout is borrowed only for a batch the user explicitly asks for — don't "restore" the batched default. The harry-authored parts, with NO upstream counterpart, are the residue-manifest exit gate, the assumption dispositions (confirmed fact / returned as an open question / pinned by an AC), and the ledger (decided/open/deferred/assumptions) it reads out from. The same upstream also feeds `root-cause-tracing.md`, `red-green.md`, `skill-authoring.md`, brainstorming, `references/architecture-review.md` **Abstraction timing** (the deletion test and when a seam is real; `/audit` dimension **Over-engineering / unearned abstraction** only points there), and `pr-body.md` (see `derived[]`); in `red-green.md`, the two direct-store exceptions to read-back persistence are harry's — upstream bans the direct query outright.
- HARRY.md **Priority**, HARRY.md **Talk** and the skip-out-loud rule in HARRY.md **Tiers** came from the `i-have-adhd` comparison (see the intro) — attribution only, nothing to sync.
- **`red-green.md`'s test-ownership rules track `openclaw`** (its `.agents/skills/test-audit/SKILL.md` authoring gate, 2026-09-29). Harry's TDD stays tiered where openclaw gates every test — don't "restore" a gate on Trivial work. Its pruning method is ported as `/audit` dimension **Low-value tests**, not a standalone command, with the evidence rule enforced by the findings validator; `/audit` stays read-only, so don't "restore" running the deletion mutation inside it. Its campaign mode and Vitest/crabbox/PR-script plumbing were skipped on purpose.
- **`skill-authoring.md`'s 2026-07 additions came from `anthropics-skills`** (the official skill-creator's methodology), now retired to `historical_sources` — attribution only, do not sync. Deviations kept: WHEN-only descriptions (upstream wants what+when) and the prohibition forms for discipline skills (`.claude/references/skill-authoring.md` **Bulletproofing discipline skills** and `.claude/references/skill-authoring.md` **Match the form to the failure**) — don't "restore" either when diffing. Licensing is per-skill: port only from Apache-2.0 paths (`skills/skill-creator`); the document skills are proprietary.

## Sources

| Source | Tracks |
|--------|--------|
| ponytail | HARRY.md philosophy, `debt`, review finding numbering, historically `lean` (absorbed into `/audit` dimension **Over-engineering / unearned abstraction** + `/review`'s simplify lane, 2026-07; the simplify lane was itself retired 2026-09 when `/review` collapsed onto the Codex CLI's review run) |
| mattpocock-skills | `grill` (+ distills into `root-cause-tracing.md`, `skill-authoring.md`, `red-green.md`, brainstorming, `/audit` dimension **Over-engineering / unearned abstraction**, `pr-body.md` + plain-language's Show the structure) |
| openclaw | `red-green.md` (test-audit authoring gate: one owner per contract, test-only seams, junk patterns); `/audit` dimension **Low-value tests** (its pruning method) |

Pins (commit, version, date) live only in `upstream.json` — read them with `jq`, per the procedure above. A duplicated Pin column here drifted from `upstream.json`, so it was removed rather than maintained twice.

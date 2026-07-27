# Upstream Sync

> Onboarding a NEW candidate repo (clone, survey, rule, record) is `/distill`'s job —
> see `references/distilling.md`. This file covers re-syncing sources already pinned
> below.

Harry is distilled from four upstreams (tracked in `upstream.json`, pinned by commit). Three more sources are recorded here but NOT pinned/synced: `copilot-plugin-cc` (design influence for `debate`/`ask`/`status`/`result`; dropped when the Copilot backend went away), `ayghri/i-have-adhd` (a one-time 2026-07-24 philosophy comparison that produced the HARRY.md §0/§6/§7 law edits — no derived files exist to diff, so there is nothing to sync; re-compare on demand if its philosophy evolves), and `anthropics/skills` (surveyed 2026-07-27 at `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` for skill-authoring principles: 1 pull + 4 adapt proposals pending against `references/skill-authoring.md`; pinned only when the first proposal is actually ported. Licensing caution: no root LICENSE — per-skill licensing, `skill-creator` is Apache-2.0 but the document skills are proprietary source-available; port text only from Apache-2.0 paths, with NOTICE attribution). This is how to check whether an upstream's newer philosophy is worth pulling into harry.

Clones live in `.references/` (gitignored). Each `derived` entry in `upstream.json` records which source + path a harry file came from, plus a `note` on *why* it was customized — read the note before pulling, so you don't re-add something deliberately removed.

## Check one source for changes worth pulling

```bash
# 1. The commit harry last synced from
SHA=$(jq -r '.sources.superpowers.synced_commit' upstream.json)

# 2. Fetch the latest upstream
git -C .references/superpowers fetch -q

# 3. What changed in the relevant path since the last sync?
git -C .references/superpowers diff "$SHA"..origin/main -- skills/brainstorming/
```

Then compare that upstream diff against harry's customized version and decide — pull, adapt, or skip (per the `note`). After incorporating, bump the source's `synced_commit` (and `synced_version` / `synced_date`) in `upstream.json`.

## Provenance notes

- **`review`'s upstream is `codex-plugin-cc`** — its design was originally ported for the (now-removed)
  Copilot backend; when codex changes, sync `review` against `codex-plugin-cc`.
- `debate` / `ask` / `status` / `result` were originally designed against `copilot-plugin-cc`
  (see `upstream.json`'s `derived[].from` for that historical attribution), but no longer track
  it for sync — the Copilot backend was removed, and `upstream.json` no longer pins that source.
- The resident laws (`HARRY.md`) track `superpowers` + `ponytail` but were heavily recalibrated (correctness > cost) — most upstream "be lazier" changes do NOT apply; read the `note`.
- **`grill`'s upstream is `mattpocock-skills`** (the grill family: grilling primitive, grill-me, batch-grill-me). Harry's residue-manifest exit gate has NO upstream counterpart (harry-authored), and the phase-hybrid delivery deliberately replaces upstream's one-question-at-a-time canon — when diffing, don't "restore" either. The same survey also fed smaller distills into `root-cause-tracing.md`, `skill-authoring.md`, `red-green.md`, and brainstorming (see `derived[]`).
- `HARRY.md` §0/§6/§7 came from the `i-have-adhd` comparison (see the intro) — attribution only, nothing to sync.

## Sources

| Source | Tracks |
|--------|--------|
| superpowers | HARRY.md laws, the 4 skills |
| ponytail | HARRY.md philosophy, `debt`, historically `lean` (absorbed into `/audit` dimension 10 + `/review --simplify`, 2026-07) |
| codex-plugin-cc | `review` |
| mattpocock-skills | `grill` (+ survey distills into `root-cause-tracing.md`, `skill-authoring.md`, `red-green.md`, brainstorming) |

Pins (commit, version, date) live only in `upstream.json` — read them with `jq`, per the procedure above. A duplicated Pin column here drifted from `upstream.json`, so it was removed rather than maintained twice.

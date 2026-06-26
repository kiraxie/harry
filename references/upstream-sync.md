# Upstream Sync

Harry is distilled from four upstreams (tracked in `upstream.json`, pinned by commit). This is how to check whether an upstream's newer philosophy is worth pulling into harry.

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

- **`review`'s upstream is `codex-plugin-cc`**, not copilot-plugin-cc. Copilot's review was ported from codex; when codex changes, sync `review` against `codex-plugin-cc`.
- `debate` / `ask` / `status` / `result` track `copilot-plugin-cc`.
- The resident laws (`HARRY.md`) track `superpowers` + `ponytail` but were heavily recalibrated (correctness > cost) — most upstream "be lazier" changes do NOT apply; read the `note`.

## Sources

| Source | Tracks | Pin |
|--------|--------|-----|
| superpowers | HARRY.md laws, the 4 skills | `896224c` (v6.0.3) |
| ponytail | HARRY.md philosophy, `lean`, `debt` | `c4d1925` (v4.8.3) |
| copilot-plugin-cc | `debate`, `ask`, `status`, `result` | `c3e8a8a` (v0.4.2) |
| codex-plugin-cc | `review` | `80c31f9` (v1.0.5) |

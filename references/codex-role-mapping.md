# Codex Role Map — model + effort bindings for HARRY.md §5

HARRY.md §5 dispatches two roles: `scout` reads, `analyst` judges. This table is
Codex's binding of them to a model + reasoning effort. Codex has no per-subagent
dispatch, so the map is **advisory**: pick the row's model/effort for the work at
hand via a session profile or `-m` / reasoning-effort config.

| role | nature | model | effort |
|---|---|---|---|
| scout | recon / lookup, read-only | `gpt-5.6-luna` | low |
| analyst | independent judgment: review, debate, audit analysis | `gpt-5.6-luna` | high |

Writing is the session's own work; run it on the analyst row's model.

**Why not `gpt-5.6-sol`:** it is not supported on a ChatGPT login — the run fails
with a 400 (*"The 'gpt-5.6-sol' model is not supported when using Codex with a
ChatGPT account."*, probed 2026-08-08, codex-cli 0.144.4), so the analyst row
names `gpt-5.6-luna`, which answers there. This table is advisory, not
read by any harry command. `ask` and `/debate`'s gpt voice take their model from
`~/.codex/config.toml`, not from this table; they no longer expose a `--model`
override.

# Codex Role Map — model + effort bindings for HARRY.md §5

HARRY.md §5 routes predictable work by *nature* to a durable role. This table is
Codex's binding of those roles to a model + reasoning effort. Codex has no
per-subagent dispatch, so the map is **advisory**: pick the row's model/effort for
the work at hand via a session profile or `-m` / reasoning-effort config — there is
no cheap-tier subagent to route to.

| role | nature | model | effort |
|---|---|---|---|
| scout | recon / lookup, read-only | `gpt-5.6-luna` | low |
| mech | mechanical, fully-specified edits | `gpt-5.6-luna` | medium |
| writer | prose / docs / comments | `gpt-5.6-terra` | medium |
| security | security-sensitive | `gpt-5.6-luna` | high |

Judgment-heavy implementation has **no** role — use `gpt-5.6-luna` with high
reasoning.

mech's effort is deliberately one notch above CC's binding (medium vs low, user-tuned
2026-07-24): a Codex session has no orchestrator bounding it, so mechanical work carries its own
verification.

**Why not `gpt-5.6-sol`:** it is not supported on a ChatGPT login — the run fails
with a 400 (*"The 'gpt-5.6-sol' model is not supported when using Codex with a
ChatGPT account."*, probed 2026-08-08, codex-cli 0.144.4), so the security and
judgment rows name `gpt-5.6-luna`, which answers there. This table is advisory, not
read by any harry command. `ask` and `/debate`'s gpt voice take their model from
`~/.codex/config.toml`, not from this table; they no longer expose a `--model`
override.

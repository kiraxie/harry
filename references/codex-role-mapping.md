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
| security | security-sensitive | `gpt-5.6-sol` | high |

Judgment-heavy implementation has **no** role — use the most capable model
(`gpt-5.6-sol`) with high reasoning.

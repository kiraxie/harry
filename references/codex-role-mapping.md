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

mech's effort is deliberately one notch above CC's binding (medium vs low, user-tuned
2026-07-24): a Codex session has no orchestrator bounding it, so mechanical work carries its own
verification.

**If your login cannot reach `gpt-5.6-sol`** it fails loudly, not silently — the run
prints the upstream reason verbatim: *"The 'gpt-5.6-sol' model is not supported when
using Codex with a ChatGPT account."* Probed 2026-08-08 (codex-cli 0.144.4) on a
ChatGPT login with **no OpenAI subscription**: `terra` and `luna` answer, `sol` 400s
regardless of quota. No subscribed account has been probed, so `sol`'s status there
is unverified; the rows stay pinned to it because downgrading on one account's
evidence would degrade every other account on none.
On an account that rejects it, substitute `gpt-5.6-luna` for those rows, and set it
once for the runtime rather than per command:
`export HARRY_MODEL_JUDGMENT=gpt-5.6-luna` (likewise `HARRY_MODEL_ADVERSARIAL`,
`HARRY_MODEL_STANDARD`). `--model` still wins per invocation.

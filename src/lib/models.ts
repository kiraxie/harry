/**
 * Codex model policy — the single place that decides which model harry sends, and
 * the only place a probed availability fact is written down.
 *
 * Hoisted 2026-08-08 from per-command `DEFAULT_MODEL` constants — a pointer between
 * copies is the signal that the knowledge, not the value, is what is duplicated
 * (HARRY.md §2). `tests/model-pinning-drift.test.ts` holds the prose side to this
 * module. Only `ask` sends a model now: `review` runs `codex exec review`, which
 * passes none and lets `~/.codex/config.toml` decide.
 *
 * AVAILABILITY is per ACCOUNT, and the defaults below are deliberately set for the
 * capable case rather than the weakest one.
 *
 * Probed live 2026-08-08, codex-cli 0.144.4, on a ChatGPT login with **no OpenAI
 * subscription**:
 *
 *   gpt-5.6-terra   answers
 *   gpt-5.6-luna    answers
 *   gpt-5.6-sol     hard 400 invalid_request_error, quota-independent:
 *                   "The 'gpt-5.6-sol' model is not supported when using Codex
 *                   with a ChatGPT account."
 *
 * That is ONE account, and an unsubscribed one. **No subscribed account has been
 * probed**, so whether sol is reachable there is unverified either way — the reason
 * the defaults stay on sol is not evidence that it works elsewhere, it is that
 * downgrading a shipped default to satisfy the weakest observed account would
 * degrade every account that is not that one, on no evidence at all.
 *
 * ON AN ACCOUNT THAT REJECTS IT the failure is now self-describing — ff6475c
 * surfaces the upstream 400 verbatim, naming the model and the reason — and the fix
 * is per-invocation: pass `--model` (see {@link MODEL_WITHOUT_SOL}), or set
 * `model` in `~/.codex/config.toml` and pass `--model` to defeat these pins.
 *
 * Deliberately NOT detect-and-degrade. An automatic fallback would paper over a
 * one-line, one-time account fact with a retry ladder, and would make the two
 * environments silently diverge instead of visibly (§1).
 */

export type ModelRole = "judgment";

/**
 * The shipped defaults.
 *
 * - `judgment` — a one-shot `ask` (also `/debate`'s gpt voice).
 */
const DEFAULTS: Readonly<Record<ModelRole, string>> = {
  judgment: "gpt-5.6-sol",
};

/**
 * Per-role environment override. This is the durable escape hatch for a login that
 * cannot reach a default — set it once instead of remembering `--model` on every
 * invocation.
 *
 * It is NOT the automatic degrade this module argues against: nothing here inspects
 * a failure or substitutes a model behind your back. The operator names the model,
 * so the two environments differ because someone said so, not because a retry
 * ladder quietly resolved them differently.
 *
 * Note this deliberately does NOT read `~/.codex/config.toml`'s `model`. Yielding
 * to that would resurrect exactly what the pins prevent — a judgment task silently
 * inheriting whatever the operator last set for an unrelated session (HARRY.md §5).
 * An override for harry has to be addressed to harry.
 */
const ENV_VAR: Readonly<Record<ModelRole, string>> = {
  judgment: "HARRY_MODEL_JUDGMENT",
};

/**
 * The model to send for `role`: the `HARRY_MODEL_*` override when set to something
 * non-blank, else the shipped default. Read at CALL time, not import time, so a
 * test can set the variable without fighting the ESM module cache.
 */
export function resolveModel(role: ModelRole, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_VAR[role]]?.trim();
  return override || DEFAULTS[role];
}

/** The environment variable that overrides `role`, for use in help text and errors. */
export function modelEnvVar(role: ModelRole): string {
  return ENV_VAR[role];
}

/**
 * The documented substitute for a login that rejects `sol` — verified answering on
 * the unsubscribed account above. Not a fallback: nothing selects it automatically;
 * it is what the docs tell you to put in `HARRY_MODEL_JUDGMENT` / `--model`.
 */
export const MODEL_WITHOUT_SOL = "gpt-5.6-luna";

/**
 * The shipped defaults, independent of any override — this is what the docs
 * describe, so it is what the prose guard checks against.
 */
export const PINNED_MODELS: readonly string[] = Object.values(DEFAULTS);

/**
 * Probed answering on the unsubscribed account above, and bound to the `writer` row
 * of the advisory `references/codex-role-mapping.md`. harry itself never sends it.
 */
export const ROLE_MAP_ONLY_MODEL = "gpt-5.6-terra";

/**
 * Every model id harry may legitimately NAME in shipped prose — the defaults, the
 * documented override, and the advisory role map's extra row.
 * `tests/model-pinning-drift.test.ts` holds prose to this set, so a door cannot name
 * an id the code knows nothing about.
 */
export const KNOWN_MODELS: readonly string[] = [
  ...PINNED_MODELS,
  MODEL_WITHOUT_SOL,
  ROLE_MAP_ONLY_MODEL,
];

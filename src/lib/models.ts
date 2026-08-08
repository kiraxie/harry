/**
 * Codex model policy — the single place that decides which model each command
 * drives, and the only place a probed availability fact is written down.
 *
 * Hoisted 2026-08-08. It was three `DEFAULT_MODEL` constants in ask.ts, fix.ts and
 * review.ts, two of which carried a comment pointing at the third for the reasoning
 * — a pointer between copies is the signal that the knowledge, not the value, is
 * what is duplicated (HARRY.md §2). Changing the policy previously meant finding
 * three files and eleven prose sites; `tests/model-pinning-drift.test.ts` now holds
 * the prose side to this module.
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
 * That is ONE account, and an unsubscribed one — not evidence that every ChatGPT
 * login rejects sol. A subscribed (or company/Enterprise) account is expected to
 * reach it, and downgrading the shipped defaults to satisfy the weakest account
 * would silently degrade every stronger one. So sol stays the default for the
 * judgment and adversarial paths.
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

/** Balanced tier: defect-hunting review and the behavior-preserving cleanup lane. */
export const MODEL_STANDARD = "gpt-5.6-terra";

/**
 * Deepest scrutiny, and a DIFFERENT model from {@link MODEL_STANDARD} on purpose:
 * the adversarial lane exists to supply a second perspective, and two lanes on one
 * model is one perspective billed twice.
 */
export const MODEL_ADVERSARIAL = "gpt-5.6-sol";

/**
 * Judgment work — a one-shot `ask` (also `/debate`'s gpt voice) and applying vetted
 * findings in `fix`. Pinned rather than inherited from `~/.codex/config.toml`, so a
 * judgment task cannot silently run on whatever the operator last set (HARRY.md §5).
 */
export const MODEL_JUDGMENT = "gpt-5.6-sol";

/**
 * The documented `--model` value for an account whose login rejects
 * {@link MODEL_JUDGMENT} — verified answering on the unsubscribed account above.
 * Not a default and not a fallback: nothing selects it automatically.
 */
export const MODEL_WITHOUT_SOL = "gpt-5.6-luna";

/** The three defaults commands send when `--model` is absent. */
export const PINNED_MODELS: readonly string[] = [MODEL_STANDARD, MODEL_ADVERSARIAL, MODEL_JUDGMENT];

/**
 * Every model id harry may legitimately NAME in shipped prose — the defaults plus
 * the documented override. `tests/model-pinning-drift.test.ts` holds prose to this
 * set, so a door cannot name an id the code knows nothing about.
 */
export const KNOWN_MODELS: readonly string[] = [...PINNED_MODELS, MODEL_WITHOUT_SOL];

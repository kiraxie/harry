/**
 * Unit guards on `withCause` — the rule for how ask/review/fix present a
 * backend cause.
 *
 * Shared rather than inlined three times, so the rule needs one home and one set
 * of tests; three copies would let the commands drift into reporting the same
 * failure differently, which is the triplication `turn-runtime.ts` exists to end.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withCause } from "../src/lib/turn-runtime.ts";

const GENERIC = "Ask did not complete successfully.";

test("withCause appends the backend cause to the command's own sentence", () => {
  // Both halves are required. The cause alone does not say WHICH command failed;
  // the generic alone is what this whole field exists to stop being the only
  // thing a user sees.
  assert.equal(
    withCause(GENERIC, "The 'gpt-5.6-sol' model is not supported"),
    "Ask did not complete successfully: The 'gpt-5.6-sol' model is not supported",
  );
});

test("withCause returns the generic sentence untouched when there is no cause", () => {
  // A timeout has no backend cause — it is observed by the caller's own clock —
  // and so does any failure the provider reports without a message. The sentence
  // must come back exactly as passed, INCLUDING its period: these strings are
  // what the doors tell consumers to surface.
  for (const cause of [undefined, "", "   ", "\n\t "]) {
    assert.equal(
      withCause(GENERIC, cause),
      GENERIC,
      `a ${JSON.stringify(cause)} cause must not produce a dangling colon`,
    );
  }
});

test("withCause drops the generic sentence's period before joining", () => {
  // Otherwise the joined string reads "…successfully.: cause". Only a TRAILING
  // period goes: a sentence with internal punctuation keeps it.
  assert.equal(withCause("Fix failed.", "boom"), "Fix failed: boom");
  assert.equal(withCause("Fix failed", "boom"), "Fix failed: boom");
  assert.equal(
    withCause("Fix failed (stage 3.1).", "boom"),
    "Fix failed (stage 3.1): boom",
    "only the trailing period is stripped, not internal punctuation",
  );
});

test("withCause preserves a multi-line cause", () => {
  // turn.ts's failure() folds the codex child's stderr in after the message, so a
  // real cause is often multi-line. Collapsing it would bury the upstream message
  // that is the whole point of carrying a cause at all.
  const cause = "400 invalid_request_error\nsome stderr line";
  assert.equal(withCause(GENERIC, cause), `Ask did not complete successfully: ${cause}`);
});

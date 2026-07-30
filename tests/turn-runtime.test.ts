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
  // Reached when the provider reports a failure with no message at all. (A
  // timeout is NOT this case — turn.ts does set a cause there; the commands just
  // prefer their own wording. See RunResult.error's doc.) The sentence
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

// The cause is BOUNDED, because turn.ts's failure() folds in the codex child's
// whole stderr buffer and app-server.ts accumulates that without limit. On the
// default hang path (the turn's 15-minute ceiling fires before any command's
// 30-minute one) that is tens of kilobytes, and it would otherwise land inside
// ask's `# Ask Failed` block — which the doors return verbatim and /debate feeds
// to another model.
test("withCause bounds a huge cause and says it did", () => {
  const upstream = "400 invalid_request_error: model not supported";
  const huge = `${upstream}\n${"x".repeat(60_000)}`;
  const out = withCause(GENERIC, huge);

  assert.ok(
    Buffer.byteLength(out, "utf8") < 6_000,
    `expected a bounded string, got ${Buffer.byteLength(out, "utf8")} bytes`,
  );
  // The cut is taken off the TAIL, so the upstream message — which failure()
  // always puts first — must survive whole. This is the assertion that would
  // have caught the earlier reasoning that a cap "would cut it off".
  assert.ok(out.includes(upstream), `the leading upstream message must survive:\n${out}`);
  // A silently clipped diagnostic is worse than a short one: the reader cannot
  // otherwise tell whether the cause ended there.
  assert.match(out, /cause truncated; full text in the job log/);
});

test("withCause leaves a cause that fits entirely alone", () => {
  // The other pole: the cap must not touch, or annotate, anything under it.
  const cause = "400 invalid_request_error: model not supported";
  const out = withCause(GENERIC, cause);
  assert.equal(out, `Ask did not complete successfully: ${cause}`);
  assert.ok(!out.includes("truncated"), "an in-budget cause must not be annotated");
});

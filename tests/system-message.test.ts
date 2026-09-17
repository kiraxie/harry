import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemMessage } from "../src/lib/system-message.ts";

// `ask` is the only surviving kind: `implement` and `fix` were deleted, and
// `review` now runs `codex exec review`, which takes no system message.
test("buildSystemMessage produces the ask framing", () => {
  assert.match(buildSystemMessage("ask"), /independent voice/);
});

test("buildSystemMessage appends orchestrator context when supplied", () => {
  const out = buildSystemMessage("ask", { extraContext: "do the thing" });
  assert.match(out, /Additional context from the orchestrator/);
  assert.match(out, /do the thing/);
});

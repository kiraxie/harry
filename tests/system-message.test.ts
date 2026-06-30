import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSystemMessage,
  type SessionKind,
} from "../src/lib/system-message.ts";

// smp-6: the 'implement' SessionKind is dead (implement.ts was deleted); only
// review/ask/fix remain. Building each surviving kind must still work.
test("buildSystemMessage produces framing for every surviving kind", () => {
  for (const kind of ["review", "ask", "fix"] as const satisfies readonly SessionKind[]) {
    const out = buildSystemMessage(kind);
    assert.ok(out.length > 0, `${kind} framing should be non-empty`);
  }
});

test("buildSystemMessage review framing is read-only", () => {
  const out = buildSystemMessage("review");
  assert.match(out, /read-only/);
});

test("buildSystemMessage appends orchestrator context when supplied", () => {
  const out = buildSystemMessage("fix", { extraContext: "do the thing" });
  assert.match(out, /Additional context from the orchestrator/);
  assert.match(out, /do the thing/);
});

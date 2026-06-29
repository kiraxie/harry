/**
 * Characterization of event-stream.ts's neutral `ProviderEvent` mapping.
 *
 * Exercises ONLY the pure SDK-event → ProviderEvent translation via a fake
 * session object: no Copilot auth, no network, no SDK runtime. The fake just
 * captures the handler `attachStream` registers and lets us feed synthetic SDK
 * events at it. Synthetic events are cast `as any` because they intentionally
 * carry only the fields the handler reads, not the full SDK union.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { attachStream } from "../src/lib/event-stream.ts";
import type { ProviderEvent } from "../src/lib/provider.ts";

interface FakeSession {
  h?: (event: unknown) => void;
  on(handler: (event: unknown) => void): () => void;
}

function makeFake(): FakeSession {
  return {
    on(handler) {
      this.h = handler;
      return () => {};
    },
  };
}

function setup(): { fire: (event: unknown) => void; events: ProviderEvent[]; dispose: () => void } {
  const fake = makeFake();
  const events: ProviderEvent[] = [];
  const stream = attachStream({
    // The fake only implements `on`; cast through unknown for the SDK type.
    session: fake as unknown as Parameters<typeof attachStream>[0]["session"],
    stateDir: "/tmp",
    appendLog: () => {},
    progress: () => {},
    emit: (ev) => events.push(ev),
  });
  // session.error rejects the completion promise; swallow it so the synthetic
  // rejection does not surface as an unhandledRejection in the test runner.
  stream.completion.catch(() => {});
  return {
    fire: (event) => fake.h?.(event),
    events,
    dispose: stream.dispose,
  };
}

test("maps assistant.message to assistant_message", () => {
  const { fire, events } = setup();
  fire({ type: "assistant.message", data: { content: "hi" } });
  assert.deepEqual(events, [{ type: "assistant_message", content: "hi" }]);
});

test("maps assistant.usage cost to a usage event", () => {
  const { fire, events } = setup();
  fire({ type: "assistant.usage", data: { model: "gpt-5.5", cost: 1.5 } });
  assert.deepEqual(events, [{ type: "usage", copilot: { cost: 1.5 } }]);
});

test("maps session.task_complete to task_complete", () => {
  const { fire, events } = setup();
  fire({ type: "session.task_complete", data: { summary: "done", success: true } });
  assert.deepEqual(events, [{ type: "task_complete", summary: "done", success: true }]);
});

test("maps session.idle to idle", () => {
  const { fire, events } = setup();
  fire({ type: "session.idle", data: {} });
  assert.deepEqual(events, [{ type: "idle" }]);
});

test("maps session.error to error", () => {
  const { fire, events } = setup();
  fire({ type: "session.error", data: { message: "boom" } });
  assert.deepEqual(events, [{ type: "error", message: "boom" }]);
});

test("maps session.shutdown to shutdown with code changes", () => {
  const { fire, events } = setup();
  fire({
    type: "session.shutdown",
    data: {
      shutdownType: "routine",
      modelMetrics: {},
      codeChanges: { linesAdded: 3, linesRemoved: 1, filesModified: ["a.ts"] },
    },
  });
  assert.deepEqual(events, [
    { type: "shutdown", codeChanges: { linesAdded: 3, linesRemoved: 1, filesModified: ["a.ts"] } },
  ]);
});

test("maps tool.execution_start to tool_start", () => {
  const { fire, events } = setup();
  fire({ type: "tool.execution_start", data: { toolName: "bash" } });
  assert.deepEqual(events, [{ type: "tool_start", name: "bash" }]);
});

test("maps permission.requested to permission_request", () => {
  const { fire, events } = setup();
  fire({
    type: "permission.requested",
    data: { permissionRequest: { kind: "shell", fullCommandText: "ls" } },
  });
  assert.deepEqual(events, [{ type: "permission_request", kind: "shell", detail: "ls" }]);
});

test("does not require emit (existing callers unaffected)", () => {
  const fake = makeFake();
  const stream = attachStream({
    session: fake as unknown as Parameters<typeof attachStream>[0]["session"],
    stateDir: "/tmp",
    appendLog: () => {},
    progress: () => {},
  });
  // No emit provided — firing an event must not throw.
  assert.doesNotThrow(() => fake.h?.({ type: "assistant.message", data: { content: "hi" } }));
  stream.dispose();
});

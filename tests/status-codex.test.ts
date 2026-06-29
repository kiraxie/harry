import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatCodexRateLimits,
  readCodexRateLimits,
  renderCodexBlock,
  writeCodexRateLimits,
} from "../src/lib/state.ts";
import type { CodexRateLimits } from "../src/lib/provider.ts";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-status-codex-test-"));
}

// status.ts / setup.ts are `.js`-chain modules (not loadable under `node --test`
// type-stripping), so we exercise the extracted pure reader + renderer here and
// trust the (thin) wiring in those commands via typecheck + build.

test("readCodexRateLimits returns null when no snapshot exists", () => {
  const dir = makeTempDir();
  assert.equal(readCodexRateLimits(dir), null);
});

test("readCodexRateLimits parses a written fixture snapshot", () => {
  const dir = makeTempDir();
  const fixture: CodexRateLimits = {
    primaryUsedPercent: 42,
    secondaryUsedPercent: 10,
    planType: "pro",
    resetsAt: "2026-07-01T00:00:00Z",
  };
  // Write a fixture file directly (no subscription / live codex needed).
  fs.writeFileSync(
    path.join(dir, "codex-rate-limits.json"),
    JSON.stringify(fixture, null, 2),
    "utf-8",
  );

  const snap = readCodexRateLimits(dir);
  assert.ok(snap, "expected a snapshot");
  assert.equal(snap.primaryUsedPercent, 42);
  assert.equal(snap.resetsAt, "2026-07-01T00:00:00Z");
});

test("writeCodexRateLimits round-trips through readCodexRateLimits with capturedAt", () => {
  const dir = makeTempDir();
  writeCodexRateLimits(dir, { primaryUsedPercent: 7, planType: "team" });
  const snap = readCodexRateLimits(dir);
  assert.ok(snap);
  assert.equal(snap.primaryUsedPercent, 7);
  assert.equal(snap.planType, "team");
  assert.match(snap.capturedAt ?? "", /\d{4}-\d{2}-\d{2}T/);
});

test("writeCodexRateLimits never throws on an unwritable target", () => {
  // Point at a path whose parent is a file → mkdir/write fails; must swallow.
  const dir = makeTempDir();
  const filePath = path.join(dir, "not-a-dir");
  fs.writeFileSync(filePath, "x", "utf-8");
  assert.doesNotThrow(() => writeCodexRateLimits(path.join(filePath, "nested"), { primaryUsedPercent: 1 }));
});

test("formatCodexRateLimits omits absent fields", () => {
  assert.equal(formatCodexRateLimits({ primaryUsedPercent: 5 }), "primary 5% used");
  assert.equal(
    formatCodexRateLimits({ primaryUsedPercent: 5, secondaryUsedPercent: 2, planType: "pro" }),
    "primary 5% / secondary 2% used · plan pro",
  );
  assert.equal(formatCodexRateLimits({}), "");
});

test("renderCodexBlock renders a `## Codex` block with percent and reset", () => {
  const block = renderCodexBlock({
    primaryUsedPercent: 42,
    secondaryUsedPercent: 10,
    planType: "pro",
    resetsAt: "2026-07-01T00:00:00Z",
  });
  assert.match(block, /^## Codex/);
  assert.match(block, /primary 42%/);
  assert.match(block, /secondary 10%/);
  assert.match(block, /plan pro/);
  assert.match(block, /resets 2026-07-01T00:00:00Z/);
});

test("renderCodexBlock labels the snapshot age when capturedAt is given (C3)", () => {
  // codex rate-limits are a cache refreshed only by an actual turn, so a stale
  // reading must be marked — the same guard the quota block already has.
  const block = renderCodexBlock({ primaryUsedPercent: 10 }, new Date().toISOString());
  assert.match(block, /^## Codex \(snapshot /);
});

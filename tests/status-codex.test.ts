import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CodexRateLimits } from "../src/lib/provider.ts";
import {
  formatCodexRateLimits,
  readCodexRateLimits,
  renderCodexBlock,
  writeCodexRateLimits,
} from "../src/lib/state.ts";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-status-codex-test-"));
}

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
  assert.doesNotThrow(() =>
    writeCodexRateLimits(path.join(filePath, "nested"), { primaryUsedPercent: 1 }),
  );
});

test("formatCodexRateLimits omits absent fields", () => {
  // No window reported (every legacy `token_count` snapshot): the wire slot name
  // is the only label left, so it surfaces rather than nothing.
  assert.equal(formatCodexRateLimits({ primaryUsedPercent: 5 }), "primary 5% used");
  assert.equal(
    formatCodexRateLimits({ primaryUsedPercent: 5, secondaryUsedPercent: 2, planType: "pro" }),
    "primary 5% / secondary 2% used · plan pro",
  );
  assert.equal(formatCodexRateLimits({}), "");
});

// "primary" and "secondary" are wire names for the two quota slots. They tell a
// reader nothing, and codex 0.144.4 reports the window duration that gives each
// slot its meaning — so whenever the duration is known the output states it.
test("formatCodexRateLimits labels a slot by its WINDOW, not its wire name", () => {
  assert.equal(
    formatCodexRateLimits({
      primaryUsedPercent: 5,
      primaryWindowMinutes: 43200,
      planType: "free",
    }),
    "30-day 5% used · plan free",
    "43200 minutes is the 30-day window this account actually has",
  );
  assert.equal(
    formatCodexRateLimits({
      primaryUsedPercent: 5,
      primaryWindowMinutes: 43200,
      secondaryUsedPercent: 2,
      secondaryWindowMinutes: 10080,
    }),
    "30-day 5% / 7-day 2% used",
  );
  // Sub-day and non-round windows still render as a duration rather than a slot.
  assert.equal(
    formatCodexRateLimits({ primaryUsedPercent: 9, primaryWindowMinutes: 300 }),
    "5-hour 9% used",
  );
  assert.equal(
    formatCodexRateLimits({ primaryUsedPercent: 9, primaryWindowMinutes: 90 }),
    "90-minute 9% used",
  );
  // A mixed snapshot — one slot with a window, one without — must not lose either.
  assert.equal(
    formatCodexRateLimits({
      primaryUsedPercent: 5,
      primaryWindowMinutes: 43200,
      secondaryUsedPercent: 2,
    }),
    "30-day 5% / secondary 2% used",
  );
  // Nonsense durations fall back instead of rendering "0-day" or "-1-day".
  for (const bad of [0, -60, Number.NaN]) {
    assert.equal(
      formatCodexRateLimits({ primaryUsedPercent: 5, primaryWindowMinutes: bad }),
      "primary 5% used",
      `window ${bad} must fall back to the slot name`,
    );
  }
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

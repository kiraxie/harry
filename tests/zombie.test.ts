import assert from "node:assert/strict";
import test from "node:test";

import type { JobRecord } from "../src/lib/state.ts";
import { isZombie } from "../src/lib/zombie.ts";

const NOW = 1_000_000_000_000; // fixed clock; tests pass `now` explicitly
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A pid that process.kill(pid, 0) will report as dead (ESRCH).
const DEAD_PID = 2_147_483_646;
// A pid guaranteed alive: this test process itself.
const ALIVE_PID = process.pid;
// No log file exists at this path, so isZombie falls back to startedAt.
const NO_LOG = "/nonexistent/harry-zombie-test.log";

function job(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: "job-1",
    kind: "review",
    title: "t",
    summary: "",
    status: "running",
    phase: "run",
    cwd: "/tmp",
    createdAt: new Date(NOW - 5 * MINUTE).toISOString(),
    startedAt: new Date(NOW - 5 * MINUTE).toISOString(),
    request: { command: "review", args: [], flags: {}, cwd: "/tmp" },
    ...overrides,
  };
}

test("a terminal job is never a zombie", () => {
  assert.equal(isZombie(job({ status: "completed" }), NO_LOG, NOW), false);
  assert.equal(isZombie(job({ status: "failed" }), NO_LOG, NOW), false);
});

test("a live pid with a recent heartbeat is not a zombie", () => {
  const j = job({ pid: ALIVE_PID, startedAt: new Date(NOW - 10_000).toISOString() });
  assert.equal(isZombie(j, NO_LOG, NOW), false);
});

test("a live pid silent past the pid-reuse window is reaped (L3)", () => {
  // pid alive but no sign of life for 7h > the 6h reuse window: the pid was
  // reused by an unrelated long-lived process; the job is wedged and must reap.
  const j = job({ pid: ALIVE_PID, startedAt: new Date(NOW - 7 * HOUR).toISOString() });
  assert.equal(isZombie(j, NO_LOG, NOW), true);
});

test("a live pid's reuse window widens to the job's own --timeout", () => {
  // --timeout is uncapped: a job that asked for 10h must not be reaped at the
  // 6h floor while its pid is alive — its window is its own timeout + grace.
  const tenHours = 10 * HOUR;
  const silent7h = job({
    pid: ALIVE_PID,
    startedAt: new Date(NOW - 7 * HOUR).toISOString(),
    request: { command: "review", args: [], flags: { timeout: String(tenHours) }, cwd: "/tmp" },
  });
  assert.equal(isZombie(silent7h, NO_LOG, NOW), false);
  const silent11h = job({
    pid: ALIVE_PID,
    startedAt: new Date(NOW - 11 * HOUR).toISOString(),
    request: { command: "review", args: [], flags: { timeout: String(tenHours) }, cwd: "/tmp" },
  });
  assert.equal(isZombie(silent11h, NO_LOG, NOW), true);
});

test("a small --timeout never narrows the 6h floor", () => {
  // A 30-min timeout job silent for 5h is still inside the floor: the window
  // is max(floor, own timeout), never less than the floor.
  const j = job({
    pid: ALIVE_PID,
    startedAt: new Date(NOW - 5 * HOUR).toISOString(),
    request: { command: "review", args: [], flags: { timeout: String(30 * MINUTE) }, cwd: "/tmp" },
  });
  assert.equal(isZombie(j, NO_LOG, NOW), false);
});

test("a dead pid with a stale heartbeat is a zombie", () => {
  const j = job({ pid: DEAD_PID, startedAt: new Date(NOW - 2 * MINUTE).toISOString() });
  assert.equal(isZombie(j, NO_LOG, NOW), true);
});

test("a dead pid within the grace window is not yet a zombie", () => {
  const j = job({ pid: DEAD_PID, startedAt: new Date(NOW - 30_000).toISOString() });
  assert.equal(isZombie(j, NO_LOG, NOW), false);
});

test("a queued job with no pid falls back to log/start staleness", () => {
  const stale = job({
    status: "queued",
    pid: null,
    startedAt: new Date(NOW - 2 * MINUTE).toISOString(),
  });
  assert.equal(isZombie(stale, NO_LOG, NOW), true);
  const fresh = job({
    status: "queued",
    pid: null,
    startedAt: new Date(NOW - 10_000).toISOString(),
  });
  assert.equal(isZombie(fresh, NO_LOG, NOW), false);
});

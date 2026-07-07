import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendLog, createJob, type JobRecord, jobLogPath, listJobs } from "../src/lib/state.ts";

// MAX_JOBS is private to state.ts; mirror its value here. If the cap changes,
// this test's arithmetic (not its invariant) needs the same bump.
const MAX_JOBS = 50;

function job(id: string, status: JobRecord["status"]): JobRecord {
  return {
    id,
    kind: "review",
    title: id,
    summary: "",
    status,
    phase: "run",
    cwd: "/tmp",
    createdAt: new Date().toISOString(),
    request: { command: "review", args: [], flags: {}, cwd: "/tmp" },
  };
}

test("pruning past MAX_JOBS never drops an in-flight job or deletes its files", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "harry-state-prune-"));
  try {
    // Oldest entry is a still-running job with a live log file...
    createJob(stateDir, job("job-running", "running"));
    appendLog(stateDir, "job-running", "still working");
    // ...then bury it under MAX_JOBS + 5 newer terminal jobs.
    for (let i = 0; i < MAX_JOBS + 5; i++) {
      createJob(stateDir, job(`job-done-${i}`, "completed"));
    }

    const jobs = listJobs(stateDir);
    const ids = jobs.map((j) => j.id);
    // The in-flight job kept its slot despite being past the cap by position.
    assert.ok(ids.includes("job-running"), "running job must survive pruning");
    assert.ok(existsSync(jobLogPath(stateDir, "job-running")), "running job's log must survive");
    // Terminal jobs still honor the cap: oldest completed ones were dropped.
    assert.equal(jobs.length, MAX_JOBS + 1);
    assert.ok(!ids.includes("job-done-0"), "oldest terminal job is pruned");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

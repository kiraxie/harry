import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createJob,
  readJobFile,
  resolveStateDir,
  type JobRecord,
} from "../src/lib/state.ts";

function makeJob(id: string): JobRecord {
  return {
    id,
    kind: "review",
    title: "t",
    summary: "s",
    status: "queued",
    phase: "queued",
    cwd: "/tmp/ws",
    createdAt: new Date().toISOString(),
    request: { command: "review", args: [], flags: {}, cwd: "/tmp/ws" },
  };
}

// cr-5: FALLBACK_STATE_ROOT was renamed copilot-companion -> harry. A job queued
// by a pre-rename build is written under the legacy tmp root; without a
// back-compat read it becomes permanently unretrievable after upgrade.
test("resolveStateDir falls back to the legacy tmp root for pre-rename queued jobs", () => {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harry-fallback-ws-"));

    // Nothing written yet -> resolves to the new (post-rename) location.
    const newDir = resolveStateDir(cwd);
    const dirName = path.basename(newDir);
    assert.equal(newDir, path.join(os.tmpdir(), "harry", dirName));
    assert.equal(fs.existsSync(newDir), false);

    // Simulate a job queued by a pre-rename build under the legacy tmp root.
    const legacyDir = path.join(os.tmpdir(), "copilot-companion", dirName);
    const job = makeJob("job-legacy-1");
    createJob(legacyDir, job);

    // The new location still has no state, so resolveStateDir must hand back the
    // legacy dir and the queued job must remain retrievable.
    const resolved = resolveStateDir(cwd);
    assert.equal(resolved, legacyDir);
    const found = readJobFile(resolved, job.id);
    assert.ok(found, "legacy-queued job should still be found after the rename");
    assert.equal(found?.id, job.id);

    fs.rmSync(legacyDir, { recursive: true, force: true });
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_DATA = prev;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});

test("resolveStateDir prefers the current root once it has state", () => {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harry-fallback-ws-"));
    const newDir = resolveStateDir(cwd);
    const dirName = path.basename(newDir);

    // State exists in BOTH locations: the current root wins.
    createJob(newDir, makeJob("job-new-1"));
    const legacyDir = path.join(os.tmpdir(), "copilot-companion", dirName);
    createJob(legacyDir, makeJob("job-legacy-2"));

    assert.equal(resolveStateDir(cwd), newDir);

    fs.rmSync(newDir, { recursive: true, force: true });
    fs.rmSync(legacyDir, { recursive: true, force: true });
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_DATA = prev;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});

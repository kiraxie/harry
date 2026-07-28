// fix's diff-stat collection. The numbers it returns are published in the
// `status: "fixed"` success envelope, so a failed collection must never be
// reported as "the model changed nothing" — a consumer cannot tell the two
// apart, and the git diagnostic that would explain it was being discarded.
// Runs against a throwaway temp dir; no real repo is touched.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeStagedDiff } from "../src/commands/fix.ts";

test("computeStagedDiff: a failed git call reports unknown stats, not zeros", () => {
  // A temp dir outside any repository: every `git` call in computeStagedDiff
  // exits non-zero ("not a git repository"), the same shape as any other
  // failure of the stats collection.
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-fix-test-"));
  const logged: string[] = [];
  try {
    const stats = computeStagedDiff(dir, "HEAD", (m) => logged.push(m));
    assert.equal(stats, null, "unknown stats must not be reported as zero changes");
    assert.ok(
      logged.some((l) => /not a git repository/i.test(l)),
      `git's own diagnostic must be logged, not swallowed; got: ${JSON.stringify(logged)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

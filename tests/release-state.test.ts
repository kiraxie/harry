import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, detectState, parseVersion } from "../.claude/scripts/release-state.mjs";

// `.claude/scripts/release-state.mjs` is a repo-local tool (not shipped in the
// plugin), so it sits outside tsconfig/biome's include globs — this test file is
// its only enforcement, per the release-skill item's Task 1 (HARRY.md §6 Standard
// tier "leave one runnable check").

test("parseVersion accepts strict x.y.z and rejects everything else", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion("0.20.0"), { major: 0, minor: 20, patch: 0 });
  for (const bad of ["v1.2.3", "1.2", "1.2.3-rc1", "1.2.3.4", "", "abc"]) {
    assert.throws(() => parseVersion(bad), `expected "${bad}" to be rejected`);
  }
});

test("compareVersions orders numerically, not lexicographically", () => {
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});

test("detectState: invalid-version wins when the target itself is malformed", () => {
  assert.equal(
    detectState({
      currentVersion: "0.19.0",
      targetVersion: "not-a-version",
      tagExists: false,
      bumpCommitExists: false,
    }),
    "invalid-version",
  );
});

test("detectState: already-tagged is terminal, wins over everything else", () => {
  assert.equal(
    detectState({
      currentVersion: "0.19.0",
      targetVersion: "0.20.0",
      tagExists: true,
      bumpCommitExists: false,
    }),
    "already-tagged",
  );
});

test("detectState: bumped-not-tagged when version matches and the bump commit exists", () => {
  assert.equal(
    detectState({
      currentVersion: "0.20.0",
      targetVersion: "0.20.0",
      tagExists: false,
      bumpCommitExists: true,
    }),
    "bumped-not-tagged",
  );
});

test("detectState: version-mismatch-untracked when version matches but no bump commit", () => {
  assert.equal(
    detectState({
      currentVersion: "0.20.0",
      targetVersion: "0.20.0",
      tagExists: false,
      bumpCommitExists: false,
    }),
    "version-mismatch-untracked",
  );
});

test("detectState: not-bumped when target is strictly ahead of current", () => {
  assert.equal(
    detectState({
      currentVersion: "0.19.0",
      targetVersion: "0.20.0",
      tagExists: false,
      bumpCommitExists: false,
    }),
    "not-bumped",
  );
});

test("detectState: invalid-target when target is behind or equal to current with no matching tag/commit", () => {
  assert.equal(
    detectState({
      currentVersion: "0.20.0",
      targetVersion: "0.19.0",
      tagExists: false,
      bumpCommitExists: false,
    }),
    "invalid-target",
  );
});

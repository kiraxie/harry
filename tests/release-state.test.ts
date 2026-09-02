import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  detectState,
  gitBumpCommitExists,
  gitTagExists,
  parseVersion,
} from "../.claude/scripts/release-state.mjs";

// `.claude/scripts/release-state.mjs` is a repo-local tool (not shipped in the
// plugin), so it sits outside tsconfig/biome's include globs — this test file is
// its only enforcement, per the release-skill item's Task 1 (HARRY.md §6 Standard
// tier "leave one runnable check").

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

// --- I/O-layer tests against THIS repo's real git history — the layer the pure
// tests above cannot reach, and where a `git log --grep` pattern-mode bug lived
// silently until it was caught by review, not by these tests (there were none).

test("gitBumpCommitExists: true for a real bump commit reachable from HEAD", () => {
  assert.equal(gitBumpCommitExists(repoRoot, "0.19.0"), true);
});

test("gitBumpCommitExists: false for a version with no matching commit", () => {
  assert.equal(gitBumpCommitExists(repoRoot, "9.9.9"), false);
});

test("gitTagExists: true for a real tag, false for one that doesn't exist", () => {
  assert.equal(gitTagExists(repoRoot, "0.19.0"), true);
  assert.equal(gitTagExists(repoRoot, "9.9.9"), false);
});

// --- Drift guard: the six state names are hand-written in three places
// (release-state.mjs's return values, release-state.d.mts's ReleaseState union,
// release.md's Step 0 bullet list) with nothing else pinning them together
// (HARRY.md §2 drift test — divergence here is a bug, not evolution).

const CANONICAL_STATES = [
  "invalid-version",
  "invalid-target",
  "not-bumped",
  "bumped-not-tagged",
  "already-tagged",
  "version-mismatch-untracked",
];

test("release-state.d.mts's ReleaseState union names exactly the six canonical states", () => {
  const dts = readFileSync(path.join(repoRoot, ".claude/scripts/release-state.d.mts"), "utf8");
  const unionMatch = dts.match(/export type ReleaseState =([\s\S]*?);/);
  assert.ok(unionMatch, "release-state.d.mts: no 'export type ReleaseState =' union found");
  const names = [...unionMatch[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    new Set(names),
    new Set(CANONICAL_STATES),
    `release-state.d.mts ReleaseState union drifted from the canonical state set: found ${names.join(", ")}`,
  );
});

test("release.md Step 0 names exactly the six canonical states", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  const start = md.indexOf("## Step 0");
  const end = md.indexOf("## Phase A");
  assert.ok(start >= 0 && end > start, "release.md: could not locate the Step 0 section");
  const section = md.slice(start, end);
  const names = [...section.matchAll(/`([a-z-]+)`/g)]
    .map((m) => m[1])
    .filter((n) => CANONICAL_STATES.includes(n));
  assert.deepEqual(
    new Set(names),
    new Set(CANONICAL_STATES),
    `release.md Step 0 drifted from the canonical state set: found ${names.join(", ")}`,
  );
});

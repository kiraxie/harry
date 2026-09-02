#!/usr/bin/env node
// harry release-state — classify where a target release version stands relative
// to this repo's real state (package.json version, git tags, git log), so
// `.claude/commands/release.md` can resume the bump/tag flow correctly regardless
// of which side of the merge boundary it's invoked from.
//
// Usage:
//   node .claude/scripts/release-state.mjs <version>
// Exit 0: prints exactly one of the six state names to stdout (parseVersion
// failure is itself a state — "invalid-version" — not a separate exit path, so
// every classification, valid or not, comes back the same way).
// Exit 1: an unexpected environment/git failure (not a git repo, git missing,
// package.json unreadable) — stderr explains; this is NOT a version-format
// problem, so it must not be read as one.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

// Strict x.y.z only — no leading "v", no pre-release/build suffix. Throws with a
// message meant to reach a human (invalid-version's stderr output).
export function parseVersion(v) {
  const m = typeof v === "string" ? v.match(SEMVER_RE) : null;
  if (!m) {
    throw new Error(`not a valid x.y.z version: ${JSON.stringify(v)}`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

// Numeric comparison (never lexicographic — "1.9.0" < "1.10.0"). Returns -1/0/1.
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return 0;
}

// Pure classifier — no I/O. Facts are gathered by the CLI below and passed in.
export function detectState({ currentVersion, targetVersion, tagExists, bumpCommitExists }) {
  try {
    parseVersion(targetVersion);
  } catch {
    return "invalid-version";
  }

  if (tagExists) return "already-tagged";

  if (currentVersion === targetVersion) {
    return bumpCommitExists ? "bumped-not-tagged" : "version-mismatch-untracked";
  }

  return compareVersions(targetVersion, currentVersion) > 0 ? "not-bumped" : "invalid-target";
}

function currentPackageVersion(repoRoot) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  if (typeof pkg.version !== "string") {
    throw new Error(`package.json at ${repoRoot} has no string "version" field`);
  }
  return pkg.version;
}

export function gitTagExists(repoRoot, version) {
  const out = execFileSync("git", ["tag", "-l", `v${version}`], { cwd: repoRoot }).toString();
  return out.trim().length > 0;
}

// --basic-regexp is explicit, not the default: `git log --grep`'s pattern syntax
// follows the caller's `grep.patternType` config, and under extended-regexp mode
// the literal "(release)" becomes a capture group — the pattern then requires the
// text "chorerelease" and silently never matches. Verified in this repo: `git log
// -E --grep '^chore(release): bump version to 0.19.0$'` finds nothing while the
// same pattern under basic-regexp finds 995c654. Pinning the mode makes this
// correct regardless of the caller's gitconfig.
export function gitBumpCommitExists(repoRoot, version) {
  const out = execFileSync(
    "git",
    [
      "log",
      "--basic-regexp",
      "--grep",
      `^chore(release): bump version to ${version}$`,
      "--format=%H",
      "-1",
    ],
    { cwd: repoRoot },
  ).toString();
  return out.trim().length > 0;
}

// Gathers real repo facts and returns the classified state name. `repoRoot`
// defaults to the git top-level of the current working directory.
export function run(targetVersion, repoRoot) {
  const root = repoRoot ?? execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
  return detectState({
    currentVersion: currentPackageVersion(root),
    targetVersion,
    tagExists: gitTagExists(root, targetVersion),
    bumpCommitExists: gitBumpCommitExists(root, targetVersion),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const target = process.argv[2];
  try {
    console.log(run(target));
  } catch (err) {
    process.stderr.write(`release-state: ${err.message}\n`);
    process.exit(1);
  }
}

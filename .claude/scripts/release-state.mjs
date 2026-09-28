#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = typeof v === "string" ? v.match(SEMVER_RE) : null;
  if (!m) {
    throw new Error(`not a valid x.y.z version: ${JSON.stringify(v)}`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return 0;
}

export function detectState({
  latestTag,
  targetVersion,
  tagExists,
  bumpCommitExists,
  fieldHoldsTarget,
}) {
  try {
    parseVersion(targetVersion);
  } catch {
    return "invalid-version";
  }
  if (tagExists) return "already-tagged";
  if (latestTag !== null && compareVersions(targetVersion, latestTag) <= 0) return "invalid-target";
  if (bumpCommitExists) return "bumped-not-tagged";
  if (fieldHoldsTarget) return "version-mismatch-untracked";
  return "not-bumped";
}

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function latestTag(repoRoot) {
  const versions = git(repoRoot, ["tag", "-l", "v*"])
    .split("\n")
    .map((t) => t.trim().slice(1))
    .filter((v) => SEMVER_RE.test(v));
  if (versions.length === 0) return null;
  return versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

export function gitTagExists(repoRoot, version) {
  return git(repoRoot, ["tag", "-l", `v${version}`]).trim().length > 0;
}

// --basic-regexp is pinned: under grep.patternType=extended, "(release)" becomes a group and never matches.
export function gitBumpCommitExists(repoRoot, version) {
  const out = git(repoRoot, [
    "log",
    "--basic-regexp",
    "--grep",
    `^chore(release): bump version to ${version.replaceAll(".", "\\.")}\\( (#[0-9][0-9]*)\\)\\{0,1\\}$`,
    "--format=%H",
    "-1",
  ]);
  return out.trim().length > 0;
}

export function fieldHoldsTarget(repoRoot, fields, version) {
  const token = new RegExp(`(?<![\\d.])${version.replaceAll(".", "\\.")}(?![\\d.])`);
  return fields.some((field) => token.test(readFileSync(resolve(repoRoot, field), "utf8")));
}

export function run(targetVersion, fields = [], repoRoot) {
  if (typeof targetVersion !== "string" || !SEMVER_RE.test(targetVersion)) return "invalid-version";
  const root = repoRoot ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  return detectState({
    latestTag: latestTag(root),
    targetVersion,
    tagExists: gitTagExists(root, targetVersion),
    bumpCommitExists: gitBumpCommitExists(root, targetVersion),
    fieldHoldsTarget: fieldHoldsTarget(root, fields, targetVersion),
  });
}

function parseArgs(argv) {
  const [target, ...rest] = argv;
  const fields = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== "--field" || rest[i + 1] === undefined) {
      throw new Error(`unexpected argument: ${rest[i]} (usage: <version> [--field <path>]...)`);
    }
    fields.push(rest[++i]);
  }
  return { target, fields };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { target, fields } = parseArgs(process.argv.slice(2));
    console.log(run(target, fields));
  } catch (err) {
    process.stderr.write(`release-state: ${err.message}\n`);
    process.exit(1);
  }
}

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export const RELEASE_STATES = [
  "invalid-version",
  "invalid-target",
  "not-bumped",
  "bumped-not-tagged",
  "waiting-for-merge",
  "already-tagged",
  "version-mismatch-untracked",
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

export function parseVersion(v: string): { major: number; minor: number; patch: number } {
  const m = typeof v === "string" ? v.match(SEMVER_RE) : null;
  if (!m) {
    throw new Error(`not a valid x.y.z version: ${JSON.stringify(v)}`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return 0;
}

export function detectState({
  latestTag,
  targetVersion,
  tagExists,
  bumpCommitExists,
  startHasBumpCommit = false,
  fieldHoldsTarget,
}: {
  latestTag: string | null;
  targetVersion: string;
  tagExists: boolean;
  bumpCommitExists: boolean;
  startHasBumpCommit?: boolean;
  fieldHoldsTarget: boolean;
}): ReleaseState {
  try {
    parseVersion(targetVersion);
  } catch {
    return "invalid-version";
  }
  if (tagExists) return "already-tagged";
  if (latestTag !== null && compareVersions(targetVersion, latestTag) <= 0) return "invalid-target";
  if (bumpCommitExists) return "bumped-not-tagged";
  if (fieldHoldsTarget) return "version-mismatch-untracked";
  if (startHasBumpCommit) return "waiting-for-merge";
  return "not-bumped";
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function latestTag(repoRoot: string): string | null {
  const versions = git(repoRoot, ["tag", "-l", "v*"])
    .split("\n")
    .map((t) => t.trim().slice(1))
    .filter((v) => SEMVER_RE.test(v));
  if (versions.length === 0) return null;
  return versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

export function gitTagExists(repoRoot: string, version: string): boolean {
  return git(repoRoot, ["tag", "-l", `v${version}`]).trim().length > 0;
}

export function bumpSubject(version: string): string {
  return `chore(release): bump version to ${version}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function gitBumpCommitExists(repoRoot: string, version: string, ref = "HEAD"): boolean {
  const literal = bumpSubject(version);
  const subject = new RegExp(`^${escapeRegExp(literal)}( \\(#\\d+\\))?$`);
  return git(repoRoot, [
    "log",
    "-F",
    "--grep",
    literal,
    "--format=%s",
    "--end-of-options",
    ref,
    "--",
  ])
    .split("\n")
    .some((line) => subject.test(line));
}

export function fieldHoldsTarget(repoRoot: string, fields: string[], version: string): boolean {
  const token = new RegExp(`(?<![\\d.])${version.replaceAll(".", "\\.")}(?![\\d.])`);
  return fields.some((field) => token.test(readFileSync(resolve(repoRoot, field), "utf8")));
}

const repoRootOfCwd = () => git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();

export function run(
  targetVersion: string,
  fields: string[] = [],
  repoRoot?: string,
  start?: string,
): ReleaseState {
  if (typeof targetVersion !== "string" || !SEMVER_RE.test(targetVersion)) return "invalid-version";
  const root = repoRoot ?? repoRootOfCwd();
  return detectState({
    latestTag: latestTag(root),
    targetVersion,
    tagExists: gitTagExists(root, targetVersion),
    bumpCommitExists: gitBumpCommitExists(root, targetVersion),
    startHasBumpCommit: start !== undefined && gitBumpCommitExists(root, targetVersion, start),
    fieldHoldsTarget: fieldHoldsTarget(root, fields, targetVersion),
  });
}

function parseArgs(argv: string[]) {
  const [target, ...rest] = argv;
  const fields: string[] = [];
  let start: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--field" && value !== undefined) fields.push(value);
    else if (flag === "--start" && start !== undefined) throw new Error("--start given twice");
    else if (flag === "--start" && value !== undefined) start = value;
    else {
      throw new Error(
        `unexpected argument: ${flag} (usage: <version> [--field <path>]... [--start <ref>] | latest-tag)`,
      );
    }
    i++;
  }
  return { target, fields, start };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === "latest-tag") {
      if (argv.length > 1) throw new Error("latest-tag takes no arguments");
      console.log(latestTag(repoRootOfCwd()) ?? "none");
    } else {
      const { target, fields, start } = parseArgs(argv);
      console.log(run(target, fields, undefined, start));
    }
  } catch (err) {
    process.stderr.write(`release-state: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

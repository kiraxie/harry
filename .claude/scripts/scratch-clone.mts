#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";

const USAGE = "usage: create <name> [--ref <commit>] | run <name> -- <command>...";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function locate(cwd: string, name: string): string {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid name ${JSON.stringify(name)}: use A-Z a-z 0-9 . _ - and start with a letter or digit`,
    );
  }
  const branch = git(cwd, ["branch", "--show-current"]);
  if (branch === "")
    throw new Error("the checkout is on a detached HEAD; a clone belongs to a unit branch");
  if (branch === "main" || branch === "master") {
    throw new Error(`the checkout is on ${branch}; a clone belongs to a unit branch`);
  }
  const store = path.join(
    path.dirname(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])),
    ".local",
  );
  if (!existsSync(store)) throw new Error(`no .local store at ${store}`);
  return path.join(store, "tmp", branch, "clones", name);
}

export function create(cwd: string, name: string, ref = "HEAD"): { clone: string } {
  const clone = locate(cwd, name);
  const source = git(cwd, ["rev-parse", "--show-toplevel"]);
  let sha: string;
  try {
    sha = git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  } catch {
    throw new Error(`unknown ref ${JSON.stringify(ref)}: not a commit in ${source}`);
  }
  try {
    git(cwd, ["cat-file", "-e", `${sha}:pnpm-workspace.yaml`]);
  } catch {
    // Without its own, pnpm in the clone may take the source checkout above it as the workspace.
    throw new Error(
      `${sha.slice(0, 7)} has no pnpm-workspace.yaml; pnpm in its clone could act on ${source}`,
    );
  }
  if (existsSync(clone)) throw new Error(`${clone} already exists`);

  mkdirSync(path.dirname(clone), { recursive: true });
  try {
    git(cwd, ["clone", "--quiet", source, clone]);
    git(clone, ["switch", "--quiet", "--detach", sha]);
    // Its own node_modules: one shared with the source is rewritten by any pnpm run in the clone.
    const pnpm = spawnSync("pnpm", ["install", "--frozen-lockfile", "--offline"], {
      cwd: clone,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (pnpm.error) throw pnpm.error;
    if (pnpm.status !== 0) {
      throw new Error(
        `\`pnpm install --frozen-lockfile --offline\` failed for ${sha.slice(0, 7)}; pnpm's output follows\n${pnpm.stdout}${pnpm.stderr}`.trimEnd(),
      );
    }
  } catch (err) {
    rmSync(clone, { recursive: true, force: true });
    throw err;
  }
  return { clone };
}

export function run(cwd: string, name: string, command: string[]): number {
  const clone = locate(cwd, name);
  if (!existsSync(clone)) throw new Error(`no clone named ${name} at ${clone}`);
  const [file, ...args] = command;
  if (file === undefined) throw new Error(USAGE);
  const res = spawnSync(file, args, { cwd: clone, stdio: "inherit" });
  if (res.error) throw res.error;
  return res.signal ? 128 + constants.signals[res.signal] : (res.status ?? 1);
}

if (import.meta.main) {
  try {
    const [verb, name, ...rest] = process.argv.slice(2);
    if (
      verb === "create" &&
      name !== undefined &&
      (rest.length === 0 || (rest.length === 2 && rest[0] === "--ref"))
    ) {
      const { clone } = create(process.cwd(), name, rest[1]);
      console.log(`clone: ${clone}\nuncommitted changes are not included`);
    } else if (verb === "run" && name !== undefined && rest[0] === "--") {
      process.exitCode = run(process.cwd(), name, rest.slice(1));
    } else {
      throw new Error(USAGE);
    }
  } catch (err) {
    process.stderr.write(`scratch-clone: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

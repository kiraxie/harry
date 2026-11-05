// harry parses these tools' output, so a pin moves only in a harry release:
// following upstream HEAD would run unreviewed third-party code in every unit.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOnPath } from "./path-search.mjs";

/** @typedef {{ name: string; url: string; commit: string }} PinnedTool */
/** @typedef {"cloned" | "moved" | "current" | "local changes" | "failed"} ToolOutcome */
/** @typedef {{ name: string; outcome: ToolOutcome; detail: string }} ToolResult */

/** @type {PinnedTool[]} */
export const PINNED_TOOLS = [
  {
    name: "crapper",
    url: "https://github.com/unclebob/crapper.git",
    commit: "6fd92c4c9bcc56efb64a2f8743d5a2993bcfd42d",
  },
  {
    name: "dryer",
    url: "https://github.com/unclebob/dryer.git",
    commit: "66ff6d21a42c04afcad89c78a80066176d1294b0",
  },
  {
    name: "mutator",
    url: "https://github.com/unclebob/mutator.git",
    commit: "a5a0cb803b66e0cdb8bf471b3b08af701d424a41",
  },
];

export function toolsDir() {
  return join(homedir(), ".claude", "harry", "tools");
}

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd) {
  const bin = resolveOnPath("git", process.env);
  if (bin === null) return { ok: false, out: "", err: "git is not on PATH" };
  const res = spawnSync(bin, args, { cwd, encoding: "utf8" });
  return { ok: res.status === 0, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

/** @param {string} clone @param {string} commit */
function checkout(clone, commit) {
  const res = git(["checkout", "--quiet", "--detach", commit], clone);
  return res.ok ? null : res.err;
}

/** @param {PinnedTool} tool @param {string} clone @returns {ToolResult} */
function update(tool, clone) {
  const { name, commit } = tool;
  const top = git(["rev-parse", "--show-toplevel"], clone);
  if (!top.ok || realpathSync(top.out) !== realpathSync(clone)) {
    return { name, outcome: "failed", detail: `not a git clone: ${clone}` };
  }
  const status = git(["status", "--porcelain"], clone);
  if (!status.ok) return { name, outcome: "failed", detail: `git status: ${status.err}` };
  if (status.out !== "") {
    return { name, outcome: "local changes", detail: `left as is at ${clone}` };
  }
  if (git(["rev-parse", "HEAD"], clone).out === commit) {
    return { name, outcome: "current", detail: commit };
  }
  if (!git(["cat-file", "-e", `${commit}^{commit}`], clone).ok) {
    const fetched = git(["fetch", "--quiet", "origin"], clone);
    if (!fetched.ok) return { name, outcome: "failed", detail: `fetch: ${fetched.err}` };
  }
  const err = checkout(clone, commit);
  return err
    ? { name, outcome: "failed", detail: err }
    : { name, outcome: "moved", detail: commit };
}

/** @param {PinnedTool} tool @param {string} dir @returns {ToolResult} */
function install(tool, dir) {
  const { name, url, commit } = tool;
  const clone = join(dir, name);
  const cloned = git(["clone", "--quiet", url, clone]);
  if (!cloned.ok) return { name, outcome: "failed", detail: `clone: ${cloned.err}` };
  const err = checkout(clone, commit);
  return err
    ? { name, outcome: "failed", detail: err }
    : { name, outcome: "cloned", detail: commit };
}

/**
 * Its first run builds the tool's own .venv; running it here keeps that out of
 * the first metrics run.
 * @param {string} clone @param {string} name
 */
function firstRun(clone, name) {
  const res = spawnSync(join(clone, name), ["--help"], { cwd: clone, encoding: "utf8" });
  return res.status === 0
    ? null
    : (res.stderr || res.error?.message || `exit ${res.status}`).trim();
}

/**
 * @param {{ tools?: PinnedTool[] }} [opts]
 * @returns {ToolResult[]}
 */
export function syncTools({ tools = PINNED_TOOLS } = {}) {
  const dir = toolsDir();
  mkdirSync(dir, { recursive: true });
  return tools.map((tool) => {
    const clone = join(dir, tool.name);
    const result = existsSync(clone) ? update(tool, clone) : install(tool, dir);
    if (result.outcome === "cloned" || result.outcome === "moved" || result.outcome === "current") {
      const err = firstRun(clone, tool.name);
      if (err) return { ...result, outcome: "failed", detail: `first run failed: ${err}` };
    }
    return result;
  });
}

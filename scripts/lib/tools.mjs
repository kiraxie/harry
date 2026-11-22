// harry parses these tools' output, so a pin moves only in a harry release:
// following upstream HEAD would run unreviewed third-party code in every unit.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isExecutableFile, resolveOnPath } from "./path-search.mjs";

/**
 * `dist` is the project name in the tool's pyproject.toml, read at `commit`: the
 * package the venv must hold, which need not equal the launcher's name.
 * @typedef {{ name: string; dist: string; url: string; commit: string }} PinnedTool
 */
/** @typedef {{ kind: "launcher" | "python" | "package"; path: string }} NotReady */
/** @typedef {"cloned" | "moved" | "current" | "local changes" | "failed"} ToolOutcome */
/** @typedef {{ name: string; outcome: ToolOutcome; detail: string }} ToolResult */

/** @type {PinnedTool[]} */
export const PINNED_TOOLS = [
  {
    name: "crapper",
    dist: "crapper",
    url: "https://github.com/unclebob/crapper.git",
    commit: "6fd92c4c9bcc56efb64a2f8743d5a2993bcfd42d",
  },
  {
    name: "dryer",
    dist: "dryer",
    url: "https://github.com/unclebob/dryer.git",
    commit: "66ff6d21a42c04afcad89c78a80066176d1294b0",
  },
  {
    name: "mutator",
    dist: "mutator",
    url: "https://github.com/unclebob/mutator.git",
    commit: "a5a0cb803b66e0cdb8bf471b3b08af701d424a41",
  },
];

export function toolsDir() {
  return join(homedir(), ".claude", "harry", "tools");
}

/** @param {string} name */
export function toolClone(name) {
  return join(toolsDir(), name);
}

/** @param {string} clone @param {string} name */
export function toolLauncher(clone, name) {
  return join(clone, name);
}

/** @param {string} clone */
export function venvDir(clone) {
  return join(clone, ".venv");
}

/** @param {string} clone */
export function venvPython(clone) {
  return join(venvDir(clone), "bin", "python");
}

/** @param {string} name */
function normalizeDist(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "_");
}

/**
 * Whether the clone's venv holds the `dist` package: pip writes a project's
 * dist-info last, so a half-built venv has none. A dist-info dir is named for
 * the normalized project name, so both sides are compared normalized. A
 * missing or unreadable directory counts as not installed.
 * @param {string} clone @param {string} dist
 */
function venvInstalled(clone, dist) {
  /** @param {string} dir */
  const dirs = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  const want = normalizeDist(dist);
  const lib = join(venvDir(clone), "lib");
  return dirs(lib)
    .filter((py) => py.startsWith("python"))
    .some((py) =>
      dirs(join(lib, py, "site-packages")).some(
        (d) => d.endsWith(".dist-info") && normalizeDist(d.split("-")[0]) === want,
      ),
    );
}

/**
 * The one test of "this tool can run", shared by sync and metrics so the two never
 * disagree: files only, since running the launcher would build a venv.
 * @param {string} clone @param {PinnedTool} tool @returns {NotReady | null}
 */
export function toolReadiness(clone, tool) {
  const launcher = toolLauncher(clone, tool.name);
  if (!isExecutableFile(launcher)) return { kind: "launcher", path: launcher };
  const python = venvPython(clone);
  if (!isExecutableFile(python)) return { kind: "python", path: python };
  if (!venvInstalled(clone, tool.dist)) return { kind: "package", path: venvDir(clone) };
  return null;
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

/** @param {PinnedTool} tool @param {string} clone @returns {ToolResult} */
function install(tool, clone) {
  const { name, url, commit } = tool;
  const cloned = git(["clone", "--quiet", url, clone]);
  if (!cloned.ok) return { name, outcome: "failed", detail: `clone: ${cloned.err}` };
  const err = checkout(clone, commit);
  return err
    ? { name, outcome: "failed", detail: err }
    : { name, outcome: "cloned", detail: commit };
}

/**
 * Its first run builds the tool's own .venv; metrics never builds one, so a
 * tool is usable only once this has run. A run counts only when it leaves the
 * tool ready by the check metrics applies.
 * @param {string} clone @param {PinnedTool} tool
 */
function firstRun(clone, tool) {
  const res = spawnSync(toolLauncher(clone, tool.name), ["--help"], {
    cwd: clone,
    encoding: "utf8",
  });
  if (res.status !== 0) return (res.stderr || res.error?.message || `exit ${res.status}`).trim();
  const notReady = toolReadiness(clone, tool);
  return notReady && `not ready: ${notReady.kind} at ${notReady.path}`;
}

/** @param {string} venv */
function removeVenv(venv) {
  try {
    rmSync(venv, { recursive: true, force: true });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * The launcher builds a venv only when .venv/bin/python is missing, so a
 * half-built one left behind would fail every later run.
 * @param {string} clone @param {PinnedTool} tool
 */
function buildVenv(clone, tool) {
  const venv = venvDir(clone);
  const first = firstRun(clone, tool);
  if (first === null) return null;
  if (!existsSync(venv)) return `first run failed: ${first}`;
  const stale = removeVenv(venv);
  if (stale) return `first run failed: ${first}; could not remove ${venv}: ${stale}`;
  const retry = firstRun(clone, tool);
  if (retry === null) return null;
  const left = removeVenv(venv);
  return left
    ? `first run failed twice: ${retry}; could not remove ${venv}: ${left}`
    : `first run failed twice: ${retry}; its .venv was removed`;
}

/**
 * @param {{ tools?: PinnedTool[] }} [opts]
 * @returns {ToolResult[]}
 */
export function syncTools({ tools = PINNED_TOOLS } = {}) {
  mkdirSync(toolsDir(), { recursive: true });
  return tools.map((tool) => {
    const clone = toolClone(tool.name);
    const result = existsSync(clone) ? update(tool, clone) : install(tool, clone);
    if (result.outcome === "cloned" || result.outcome === "moved" || result.outcome === "current") {
      const err = buildVenv(clone, tool);
      if (err) return { ...result, outcome: "failed", detail: err };
    }
    return result;
  });
}

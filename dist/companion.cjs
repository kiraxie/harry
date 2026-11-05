#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/companion.ts
var import_node_process = __toESM(require("node:process"), 1);

// src/commands/ask.ts
var import_node_fs6 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path5 = require("node:path");

// src/lib/context.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function resolveTextFlag(cwd, flag, raw) {
  if (!raw?.trim()) return void 0;
  if (!raw.startsWith("@")) return raw.trim();
  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text;
  try {
    text = (0, import_node_fs.readFileSync)(ref === "-" ? 0 : (0, import_node_path.resolve)(cwd, ref), "utf-8").trim();
  } catch (err) {
    throw new Error(`Could not read ${flag} ${source}: ${err.message}`);
  }
  if (!text) throw new Error(`${flag} ${source} is empty.`);
  return text;
}

// src/lib/run-codex.ts
var import_node_child_process = require("node:child_process");
var import_node_fs4 = require("node:fs");

// scripts/lib/path-search.mjs
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
function isExecutableFile(path9) {
  try {
    if (!(0, import_node_fs2.statSync)(path9).isFile()) return false;
    (0, import_node_fs2.accessSync)(path9, import_node_fs2.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function resolveOnPath(name, env) {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!import_node_path2.posix.isAbsolute(dir)) continue;
    const candidate = import_node_path2.posix.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

// src/lib/path-search.ts
function notFoundError(syscall, name) {
  return Object.assign(new Error(`${syscall} ENOENT`), { code: "ENOENT", syscall, path: name });
}

// src/lib/run-files.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var STAMP = "YYYYMMDD-hhmmss";
var OUTPUT_EXT = ".md";
var LOG_EXT = ".log";
function runFileStem(prefix, now, n) {
  const p = (v, width = 2) => String(v).padStart(width, "0");
  const fields = {
    YYYY: p(now.getFullYear(), 4),
    MM: p(now.getMonth() + 1),
    DD: p(now.getDate()),
    hh: p(now.getHours()),
    mm: p(now.getMinutes()),
    ss: p(now.getSeconds())
  };
  const stamp = STAMP.replace(/YYYY|MM|DD|hh|mm|ss/g, (f) => fields[f]);
  return `${prefix}-${stamp}${n === 1 ? "" : `-${n}`}`;
}
function runFilePattern(prefix) {
  const literal = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stamp = STAMP.replace(/[A-Za-z]/g, "\\d");
  const ext = [OUTPUT_EXT, LOG_EXT].map(literal).join("|");
  return new RegExp(`^${literal(prefix)}-${stamp}(?:-\\d+)?(?:${ext})$`);
}
function reserveRunFiles(dir, prefix, now = /* @__PURE__ */ new Date()) {
  for (let n = 1; ; n++) {
    const stem = (0, import_node_path3.join)(dir, runFileStem(prefix, now, n));
    const outputPath = `${stem}${OUTPUT_EXT}`;
    const logPath = `${stem}${LOG_EXT}`;
    if ((0, import_node_fs3.existsSync)(outputPath)) continue;
    try {
      (0, import_node_fs3.closeSync)((0, import_node_fs3.openSync)(logPath, "wx", 384));
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    return { outputPath, logPath };
  }
}
function pruneRunFiles(dir, prefix, maxAgeMs, now = Date.now()) {
  const runFile = runFilePattern(prefix);
  let names;
  try {
    names = (0, import_node_fs3.readdirSync)(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!runFile.test(name)) continue;
    const path9 = (0, import_node_path3.join)(dir, name);
    try {
      const st = (0, import_node_fs3.lstatSync)(path9);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) (0, import_node_fs3.rmSync)(path9);
    } catch {
    }
  }
}
function narrowOutput(outputPath) {
  try {
    (0, import_node_fs3.chmodSync)(outputPath, 384);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

// src/lib/run-codex.ts
var REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];
var CODEX_CLI_MISSING = "The Codex CLI was not found on PATH. Install it and run `codex login`, then retry.";
function codexMissing(res) {
  return res.error?.code === "ENOENT";
}
function codexNotFound(syscall) {
  return notFoundError(syscall, "codex");
}
function spawnCodexSync(args, options) {
  const command = resolveOnPath("codex", options.env ?? process.env);
  if (command === null) {
    const error = codexNotFound("spawnSync codex");
    return { pid: 0, output: [], stdout: "", stderr: "", status: null, signal: null, error };
  }
  return (0, import_node_child_process.spawnSync)(command, args, options);
}
var FORWARDED_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
function spawnCodex(args, options) {
  const command = resolveOnPath("codex", process.env);
  if (command === null) {
    return Promise.resolve({ status: null, signal: null, error: codexNotFound("spawn codex") });
  }
  return new Promise((resolve3) => {
    let child;
    const forward = (signal) => {
      try {
        child.kill(signal);
      } catch {
      }
      try {
        options.onStop?.();
      } catch {
      }
      stopForwarding();
      process.kill(process.pid, signal);
    };
    const stopForwarding = () => {
      for (const s of FORWARDED_SIGNALS) process.off(s, forward);
    };
    for (const s of FORWARDED_SIGNALS) process.on(s, forward);
    try {
      child = (0, import_node_child_process.spawn)(command, args, {
        cwd: options.cwd,
        stdio: ["pipe", "ignore", options.logFd]
      });
    } catch (err) {
      stopForwarding();
      throw err;
    }
    let spawnError;
    let stdinError;
    child.on("error", (err) => {
      spawnError ??= err;
    });
    child.stdin?.on("error", (err) => {
      stdinError ??= err;
    });
    child.stdin?.end(options.input);
    child.on("close", (code, signal) => {
      stopForwarding();
      resolve3({
        status: spawnError ? null : code,
        signal,
        error: spawnError ?? stdinError
      });
    });
  });
}
var FAILURE_TAIL_LINES = 40;
var NO_ERROR_LINE = "No error line at the end of codex's log.";
var CodexRunError = class extends Error {
  kind;
  logPath;
  exitStatus;
  constructor(message, kind, extra = {}) {
    super(message);
    this.name = "CodexRunError";
    this.kind = kind;
    this.logPath = extra.logPath;
    this.exitStatus = extra.exitStatus;
  }
};
function logTail(logPath) {
  const lines2 = (0, import_node_fs4.readFileSync)(logPath, "utf8").split(/\r\n|\n|\r/);
  if (lines2.at(-1) === "") lines2.pop();
  return lines2.slice(-FAILURE_TAIL_LINES);
}
var MAX_LINE_BYTES = 1e3;
var TRUNCATED = "\u2026[truncated]";
function capLogLine(line) {
  if (Buffer.byteLength(line) <= MAX_LINE_BYTES) return line;
  const budget = MAX_LINE_BYTES - Buffer.byteLength(TRUNCATED);
  let kept = "";
  let bytes = 0;
  for (const ch of line) {
    bytes += Buffer.byteLength(ch);
    if (bytes > budget) break;
    kept += ch;
  }
  return `${kept}${TRUNCATED}`;
}
var ERROR_LINE_RE = /^(?:ERROR|Error|error):/;
var CONTROL_RE = /[^\P{Cc}\t]/gu;
function tailErrorLines(logPath) {
  return logTail(logPath).filter((l) => ERROR_LINE_RE.test(l)).map((l) => l.replace(CONTROL_RE, "").trimEnd());
}
function reportLogTail(logPath) {
  const errors = tailErrorLines(logPath).map(capLogLine);
  const lines2 = errors.length > 0 ? errors : [NO_ERROR_LINE];
  process.stderr.write(`${lines2.join("\n")}
Log: ${logPath}
`);
}
function reportSpawnErrorLog(logPath) {
  const size = (0, import_node_fs4.statSync)(logPath, { throwIfNoEntry: false })?.size;
  if (size === void 0) return;
  if (size === 0) (0, import_node_fs4.rmSync)(logPath, { force: true });
  else reportLogTail(logPath);
}
function lastErrorLine(logPath) {
  let errors;
  try {
    errors = tailErrorLines(logPath);
  } catch {
    return void 0;
  }
  const last = errors.filter((l) => l.startsWith("ERROR:")).at(-1);
  return last === void 0 ? void 0 : capLogLine(last);
}
var CODEX_EXEC = "codex exec";
function codexExecArgs(opts) {
  const args = ["exec", "--ephemeral", "-s", "read-only"];
  if (opts.skipGitRepoCheck) args.push("--skip-git-repo-check");
  args.push("-o", opts.outputPath);
  if (opts.reasoning) args.push("-c", `model_reasoning_effort="${opts.reasoning}"`);
  args.push("-");
  return args;
}
async function runCodexExec(opts) {
  const logFd = (0, import_node_fs4.openSync)(opts.logPath, "w", 384);
  let res;
  try {
    res = await spawnCodex(codexExecArgs(opts), {
      cwd: opts.cwd,
      input: opts.input,
      logFd,
      onStop: opts.onStop
    });
  } finally {
    (0, import_node_fs4.closeSync)(logFd);
  }
  if (codexMissing(res)) {
    (0, import_node_fs4.rmSync)(opts.logPath, { force: true });
    throw new CodexRunError(CODEX_CLI_MISSING, "missing");
  }
  if (res.error && (res.status === null || res.status === 0)) {
    reportSpawnErrorLog(opts.logPath);
    reportNarrowFailure(opts.outputPath);
    throw res.error;
  }
  if (res.status !== 0) {
    reportLogTail(opts.logPath);
    reportNarrowFailure(opts.outputPath);
    throw new CodexRunError(
      `${CODEX_EXEC} failed (${res.status === null ? `signal ${res.signal}` : `exit ${res.status}`}).`,
      "exit",
      { logPath: opts.logPath, exitStatus: res.status }
    );
  }
  const output = (0, import_node_fs4.existsSync)(opts.outputPath) ? (0, import_node_fs4.readFileSync)(opts.outputPath, "utf8") : "";
  if (!output.trim()) {
    reportLogTail(opts.logPath);
    reportNarrowFailure(opts.outputPath);
    throw new CodexRunError(
      `${CODEX_EXEC} exited 0 but wrote no ${opts.outputNoun} to ${opts.outputPath}.`,
      "empty",
      { logPath: opts.logPath }
    );
  }
  narrowOutput(opts.outputPath);
  return output.endsWith("\n") ? output : `${output}
`;
}
function reportNarrowFailure(outputPath) {
  try {
    narrowOutput(outputPath);
  } catch (err) {
    process.stderr.write(
      `Could not narrow ${outputPath} to owner-only (0600): ${err.message}
`
    );
  }
}

// src/lib/state.ts
var import_node_child_process2 = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path4 = require("node:path");
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var FALLBACK_STATE_ROOT = (0, import_node_path4.join)((0, import_node_os.tmpdir)(), "harry");
function repoRootOf(cwd) {
  const git2 = resolveOnPath("git", process.env);
  if (git2 === null) return (0, import_node_path4.resolve)(cwd);
  try {
    const root = (0, import_node_child_process2.execFileSync)(git2, ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return root || (0, import_node_path4.resolve)(cwd);
  } catch {
    return (0, import_node_path4.resolve)(cwd);
  }
}
function resolveStateDir(cwd) {
  const workspaceRoot = repoRootOf(cwd);
  const slug = (0, import_node_path4.basename)(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = (0, import_node_crypto.createHash)("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  const dirName = `${slug}-${hash}`;
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  if (pluginDataDir) {
    return (0, import_node_path4.join)(pluginDataDir, "state", dirName);
  }
  return (0, import_node_path4.join)(FALLBACK_STATE_ROOT, dirName);
}
function ensureDir(dir) {
  (0, import_node_fs5.mkdirSync)(dir, { recursive: true, mode: 448 });
}

// src/commands/ask.ts
var ASK_FAILED_MARKER = "# Ask Failed";
var ASK_PREFIX = "ask";
var ASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
var ASK_PREAMBLE = [
  "You are one independent voice being consulted on a question.",
  "Answer from this prompt and any Background given below.",
  "Do not explore the working directory or run commands unless the prompt explicitly asks about files in it.",
  "Be concrete and decisive; state your key assumptions and the strongest counter-argument to your own position."
].join(" ");
function buildAskPrompt(prompt, context) {
  if (!context) return `${ASK_PREAMBLE}

${prompt}
`;
  return `${ASK_PREAMBLE}

## Background (settled facts from the working session)

${context}

## Prompt

${prompt}
`;
}
function failureReason(err) {
  const reason = err instanceof CodexRunError && err.kind === "exit" && err.logPath ? lastErrorLine(err.logPath) ?? err.message.replace(/\.$/, "") : err instanceof Error ? err.message : String(err);
  return reason.replace(/\s+/g, " ").trim();
}
function removeIsolatedDir(dir) {
  try {
    (0, import_node_fs6.rmSync)(dir, { recursive: true, force: true });
  } catch (err) {
    process.stderr.write(
      `ask: could not remove ${dir}: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
async function ask(cwd, options) {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");
  const context = resolveTextFlag(cwd, "--context", options.context);
  const dir = (0, import_node_path5.join)(resolveStateDir(cwd), "asks");
  ensureDir(dir);
  pruneRunFiles(dir, ASK_PREFIX, ASK_RETENTION_MS);
  const { outputPath, logPath } = reserveRunFiles(dir, ASK_PREFIX);
  const codexCwd = options.isolated ? (0, import_node_fs6.mkdtempSync)((0, import_node_path5.join)((0, import_node_os2.tmpdir)(), "harry-ask-")) : cwd;
  const isolated = codexCwd !== cwd;
  let answer;
  try {
    answer = await runCodexExec({
      skipGitRepoCheck: true,
      reasoning: options.reasoning,
      cwd: codexCwd,
      input: buildAskPrompt(prompt, context),
      outputPath,
      logPath,
      outputNoun: "answer",
      onStop: isolated ? () => removeIsolatedDir(codexCwd) : void 0
    });
  } finally {
    if (isolated) removeIsolatedDir(codexCwd);
  }
  process.stdout.write(answer);
  process.stderr.write(`Log: ${logPath}
`);
}
async function runAsk(cwd, options) {
  try {
    await ask(cwd, options);
  } catch (err) {
    const reason = failureReason(err);
    process.stdout.write(`${ASK_FAILED_MARKER}

${reason}
`);
    process.stderr.write(`Ask failed: ${reason}
`);
    process.exitCode = 1;
  }
}

// src/commands/metrics.ts
var import_node_fs14 = require("node:fs");
var import_node_path15 = __toESM(require("node:path"), 1);

// src/lib/git.ts
var import_node_child_process3 = require("node:child_process");
var import_node_path6 = require("node:path");
function failureReason2(result) {
  if (result.stderr.trim()) return result.stderr.trim();
  return result.status === null ? "killed by a signal or failed to spawn" : `exit ${result.status}`;
}
function git(cwd, args) {
  const command = resolveOnPath("git", process.env);
  if (command === null) {
    return { status: null, stdout: "", stderr: "", error: notFoundError("spawnSync git", "git") };
  }
  const result = (0, import_node_child_process3.spawnSync)(command, args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function gitChecked(cwd, args) {
  const result = git(cwd, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${failureReason2(result)}`);
  }
  return result;
}
function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error?.code === "ENOENT")
    throw new Error("git is not installed. Install Git and retry.");
  if (result.status !== 0) throw new Error("This command must run inside a Git repository.");
  return result.stdout.trim();
}
function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}
function getMainCheckoutRoot(cwd) {
  const commonDir = gitChecked(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  ]).stdout.trim();
  return (0, import_node_path6.dirname)(commonDir);
}
function getBranchOrShortSha(cwd) {
  const branch = gitChecked(cwd, ["branch", "--show-current"]).stdout.trim();
  return branch || gitChecked(cwd, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}
function countBranchChanges(cwd, baseRef) {
  return gitChecked(cwd, ["diff", "--name-only", `${baseRef}...HEAD`]).stdout.split("\n").filter(Boolean).length;
}
function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const head = symbolic.stdout.trim();
    if (head.startsWith("refs/remotes/")) return head.replace("refs/remotes/", "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0)
      return candidate;
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0)
      return `origin/${candidate}`;
  }
  throw new Error("Unable to detect the repository default branch. Pass --base <ref>.");
}
function getWorkingTreeState(cwd) {
  const split = (s) => s.trim().split("\n").filter(Boolean);
  const staged = split(gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout);
  const unstaged = split(gitChecked(cwd, ["diff", "--name-only"]).stdout);
  const untracked = split(gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}
function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  if (options.base) {
    return { mode: "branch", label: `branch diff against ${options.base}`, baseRef: options.base };
  }
  if (getWorkingTreeState(cwd).isDirty) {
    return { mode: "working-tree", label: "working tree diff" };
  }
  const detected = detectDefaultBranch(cwd);
  return { mode: "branch", label: `branch diff against ${detected}`, baseRef: detected };
}

// src/lib/metrics/crapper.ts
var import_node_child_process6 = require("node:child_process");
var import_node_fs8 = require("node:fs");
var import_node_path9 = __toESM(require("node:path"), 1);

// src/lib/metrics/edn.ts
var DELIMITERS = /* @__PURE__ */ new Set(["{", "}", "[", "]", '"', ";"]);
var Reader = class {
  pos = 0;
  text;
  constructor(text) {
    this.text = text;
  }
  fail(message) {
    throw new Error(`EDN: ${message} at offset ${this.pos}`);
  }
  skip() {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === ";") {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n") this.pos++;
      } else if (c === "," || /\s/.test(c)) {
        this.pos++;
      } else {
        return;
      }
    }
  }
  done() {
    this.skip();
    return this.pos >= this.text.length;
  }
  value() {
    this.skip();
    const c = this.text[this.pos];
    if (c === void 0) this.fail("unexpected end of input");
    if (c === "{") return this.map();
    if (c === "[") return this.vector();
    if (c === '"') return this.string();
    if (c === ":") {
      this.pos++;
      return this.token();
    }
    const token = this.token();
    if (token === "nil") return null;
    if (token === "true") return true;
    if (token === "false") return false;
    const n = Number(token);
    if (token === "" || Number.isNaN(n)) this.fail(`unsupported token "${token}"`);
    return n;
  }
  token() {
    const start = this.pos;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === "," || /\s/.test(c) || DELIMITERS.has(c)) break;
      this.pos++;
    }
    return this.text.slice(start, this.pos);
  }
  string() {
    this.pos++;
    let out = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos++];
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.text[this.pos++];
      out += e === "n" ? "\n" : e === "t" ? "	" : e === "r" ? "\r" : e;
    }
    return this.fail("unterminated string");
  }
  vector() {
    this.pos++;
    const items = [];
    for (; ; ) {
      this.skip();
      if (this.text[this.pos] === "]") {
        this.pos++;
        return items;
      }
      items.push(this.value());
    }
  }
  map() {
    this.pos++;
    const out = {};
    for (; ; ) {
      this.skip();
      if (this.text[this.pos] === "}") {
        this.pos++;
        return out;
      }
      const key2 = this.value();
      if (typeof key2 !== "string") this.fail("map key is not a keyword or string");
      out[key2] = this.value();
    }
  }
};
function parseEdn(text) {
  const reader = new Reader(text);
  const value = reader.value();
  if (!reader.done()) reader.fail("trailing input");
  return value;
}

// src/lib/metrics/interrupt.ts
var import_node_os3 = require("node:os");
var STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
var Interrupted = class extends Error {
  signal;
  constructor(signal) {
    super(`metrics interrupted by ${signal}`);
    this.signal = signal;
  }
  get exitCode() {
    return 128 + import_node_os3.constants.signals[this.signal];
  }
};
function throwIfInterrupted(res) {
  if (res.signal && STOP_SIGNALS.includes(res.signal)) {
    throw new Interrupted(res.signal);
  }
}
function rethrowInterrupt(err) {
  if (err instanceof Interrupted) throw err;
}
function holdStopSignals() {
  const ignore = () => {
  };
  for (const s of STOP_SIGNALS) process.on(s, ignore);
  return () => {
    for (const s of STOP_SIGNALS) process.off(s, ignore);
  };
}

// src/lib/metrics/tools.ts
var import_node_child_process5 = require("node:child_process");
var import_node_os5 = __toESM(require("node:os"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);

// scripts/lib/tools.mjs
var import_node_child_process4 = require("node:child_process");
var import_node_fs7 = require("node:fs");
var import_node_os4 = require("node:os");
var import_node_path7 = require("node:path");
function toolsDir() {
  return (0, import_node_path7.join)((0, import_node_os4.homedir)(), ".claude", "harry", "tools");
}

// src/lib/metrics/tools.ts
var TOOL_NAMES = ["dryer", "crapper", "mutator"];
function displayPath(p) {
  const home = import_node_os5.default.homedir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}
function findTool(name) {
  const dir = import_node_path8.default.join(toolsDir(), name);
  const launcher = import_node_path8.default.join(dir, name);
  if (!isExecutableFile(launcher)) return null;
  const head = git(dir, ["rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : "unknown";
  return { name, dir, launcher, commit };
}
function runTool(tool, args, cwd) {
  const res = (0, import_node_child_process5.spawnSync)(tool.launcher, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  throwIfInterrupted(res);
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
function failureTail(run) {
  const lines2 = `${run.stderr}
${run.stdout}`.trim().split("\n");
  return lines2.slice(-12).join("\n");
}

// src/lib/metrics/crapper.ts
var CRAP_LIMIT = 10;
var key = (namespace, name) => `${namespace}\0${name}`;
function runCrapper(tool, root, files, coverage) {
  const mode = coverage ? "--use-existing-coverage" : "--no-coverage";
  const run = runTool(tool, [mode, "--root", root, ...files], root);
  if (run.status !== 0) throw new Error(`crapper exited ${run.status}
${failureTail(run)}`);
  const text = (0, import_node_fs8.readFileSync)(import_node_path9.default.join(root, ".metrics", "crap.edn"), "utf8");
  const snap = parseEdn(text);
  if (!Array.isArray(snap?.entries)) throw new Error("crap.edn has no :entries vector");
  return snap.entries;
}
var SPANS_SCRIPT = `
import json, sys
from pathlib import Path
from crapper.discover import language_of
from crapper.languages import functions_in_file
root = Path(sys.argv[1]).resolve()
out = []
for rel in sys.argv[2:]:
    p = (root / rel).resolve()
    lang = language_of(p)
    if lang is None:
        continue
    src = p.read_text(encoding="utf-8", errors="replace")
    for f in functions_in_file(lang, src, p.relative_to(root).as_posix(), str(root)):
        out.append({"file": rel, "namespace": f.namespace, "name": f.name, "start": f.start_line, "end": f.end_line})
print(json.dumps(out))
`;
function functionSpans(tool, root, files) {
  const python = import_node_path9.default.join(tool.dir, ".venv", "bin", "python");
  const res = (0, import_node_child_process6.spawnSync)(python, ["-c", SPANS_SCRIPT, root, ...files], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  throwIfInterrupted(res);
  if (res.status !== 0) {
    throw new Error(
      `function spans failed (${python}): ${(res.stderr ?? res.error?.message ?? "").trim()}`
    );
  }
  return JSON.parse(res.stdout);
}
function changedRanges(repo, base, file) {
  const diff = gitChecked(repo, ["diff", "-U0", "--no-renames", `${base}...HEAD`, "--", file]);
  const ranges = [];
  for (const m of diff.stdout.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === void 0 ? 1 : Number(m[2]);
    ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return ranges;
}
function touches(span2, ranges) {
  return ranges.some(([a, b]) => a <= span2.end && b >= span2.start);
}
function crapFloor(e) {
  return e.crap ?? e.complexity;
}
function judge(after, before, spans, rangesOf) {
  const spanOf = new Map(spans.map((s) => [key(s.namespace, s.name), s]));
  const out = [];
  for (const entry of after) {
    const k = key(entry.namespace, entry.name);
    const span2 = spanOf.get(k);
    const old = before.get(k);
    if (old === void 0) {
      if (crapFloor(entry) >= CRAP_LIMIT) out.push({ kind: "new", entry, span: span2 });
      continue;
    }
    if (span2 === void 0 || !touches(span2, rangesOf(span2.file))) continue;
    if (entry.complexity > old || crapFloor(entry) >= CRAP_LIMIT) {
      out.push({ kind: "touched", entry, span: span2, before: old });
    }
  }
  return out;
}
function beforeComplexity(entries) {
  return new Map(entries.map((e) => [key(e.namespace, e.name), e.complexity]));
}
function scored(e) {
  return e.crap === null ? `CRAP \u2265 ${e.complexity} (complexity only)` : `coverage ${(e.coverage ?? 0).toFixed(1)}%, CRAP ${e.crap.toFixed(1)}`;
}
function renderJudged(j, where) {
  const e = j.entry;
  const at = j.span ? ` ${where(j.span)}` : "";
  const cc = j.before === void 0 ? `CC ${e.complexity}` : `CC ${j.before} \u2192 ${e.complexity}`;
  return `- ${j.kind} \`${e.name}\` (${e.namespace})${at} \u2014 ${cc}, ${scored(e)}`;
}
function renderOverBar(entries) {
  const over = entries.filter((e) => crapFloor(e) >= CRAP_LIMIT).sort((a, b) => crapFloor(b) - crapFloor(a));
  if (over.length === 0) return "No function crosses the bar.";
  return over.map((e) => `- \`${e.name}\` (${e.namespace}) \u2014 CC ${e.complexity}, ${scored(e)}`).join("\n");
}

// src/lib/metrics/dryer.ts
var import_node_fs9 = require("node:fs");
var import_node_path10 = __toESM(require("node:path"), 1);
var DRYER_SCOPE_NOTE = "dryer compares TypeScript (.ts .tsx .mts .cts), Java, Go, Rust, Python and Clojure; .js/.mjs files are not compared.";
function runDryer(tool, dir) {
  const run = runTool(tool, [], dir);
  if (run.status !== 0) throw new Error(`dryer exited ${run.status}
${failureTail(run)}`);
  let text;
  try {
    text = (0, import_node_fs9.readFileSync)(import_node_path10.default.join(dir, ".metrics", "dry.edn"), "utf8");
  } catch {
    if (/No source files to analyze/.test(run.stdout)) return [];
    throw new Error(`dryer wrote no .metrics/dry.edn
${failureTail(run)}`);
  }
  const snap = parseEdn(text);
  if (!Array.isArray(snap?.candidates)) throw new Error("dry.edn has no :candidates vector");
  return snap.candidates;
}
function span(s) {
  return `${s.file}:${s["start-line"]}-${s["end-line"]}`;
}
function renderPairs(pairs, empty) {
  if (pairs.length === 0) return empty;
  return pairs.map((p) => `- score ${p.score.toFixed(2)}: ${span(p.left)} \u2194 ${span(p.right)}`).join("\n");
}
function touching(pairs, files) {
  return pairs.filter((p) => files.has(p.left.file) || files.has(p.right.file));
}

// src/lib/metrics/groups.ts
var import_node_child_process7 = require("node:child_process");
var import_node_fs10 = require("node:fs");
var import_node_module = require("node:module");
var import_node_path11 = __toESM(require("node:path"), 1);
var NODE_EXT = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
var PYTHON_MARKERS = ["pyproject.toml", "setup.cfg", "setup.py", "pytest.ini"];
function kindOf(rel) {
  const ext = import_node_path11.default.posix.extname(rel);
  if (NODE_EXT.has(ext)) return "node";
  if (ext === ".py") return "python";
  return "other";
}
function nearest(root, rel, markers) {
  let dir = import_node_path11.default.posix.dirname(rel);
  for (; ; ) {
    const here = dir === "." ? "" : dir;
    if (markers.some((m) => (0, import_node_fs10.existsSync)(import_node_path11.default.join(root, here, m)))) return here;
    if (here === "") return "";
    dir = import_node_path11.default.posix.dirname(dir);
  }
}
function groupFiles(root, files) {
  const groups = /* @__PURE__ */ new Map();
  for (const rel of files) {
    const kind = kindOf(rel);
    const dir = kind === "node" ? nearest(root, rel, ["package.json"]) : kind === "python" ? nearest(root, rel, PYTHON_MARKERS) : "";
    const key2 = `${kind}\0${dir}`;
    const group = groups.get(key2) ?? { dir, kind, files: [] };
    group.files.push(dir === "" ? rel : import_node_path11.default.posix.relative(dir, rel));
    groups.set(key2, group);
  }
  return [...groups.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}
function repoPath(group, file) {
  return group.dir === "" ? file : `${group.dir}/${file}`;
}
function packageManager(root) {
  if ((0, import_node_fs10.existsSync)(import_node_path11.default.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if ((0, import_node_fs10.existsSync)(import_node_path11.default.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}
function readPackage(dir) {
  try {
    return JSON.parse((0, import_node_fs10.readFileSync)(import_node_path11.default.join(dir, "package.json"), "utf8"));
  } catch {
    return {};
  }
}
function resolvesFrom(dir, request) {
  try {
    (0, import_node_module.createRequire)(import_node_path11.default.join(dir, "package.json")).resolve(request);
    return true;
  } catch {
    return false;
  }
}
function nodePlan(groupDir, pm) {
  const pkg = readPackage(groupDir);
  const scripts = pkg.scripts ?? {};
  if (scripts.coverage) return { commands: [[pm, "run", "coverage"]] };
  const usesVitest = Boolean(pkg.dependencies?.vitest ?? pkg.devDependencies?.vitest) || /\bvitest\b/.test(scripts.test ?? "");
  if (usesVitest) {
    if (!resolvesFrom(groupDir, "@vitest/coverage-v8/package.json")) {
      return {
        skip: "vitest without @vitest/coverage-v8 resolvable from this package; install it to score coverage"
      };
    }
    return {
      commands: [
        [
          pm,
          "exec",
          "vitest",
          "run",
          "--coverage",
          "--coverage.reporter=lcov",
          "--coverage.reportsDirectory=target/coverage/typescript"
        ]
      ]
    };
  }
  if (!scripts.test) return { skip: "package.json has no test script" };
  return {
    commands: [
      [
        "npx",
        "--yes",
        "c8",
        "--reporter=lcov",
        "--reports-dir",
        "target/coverage/typescript",
        pm,
        "test"
      ]
    ]
  };
}
function pythonInterpreter(groupDir) {
  for (const venv of [".venv", "venv"]) {
    const py = import_node_path11.default.join(groupDir, venv, "bin", "python");
    if ((0, import_node_fs10.existsSync)(py)) return py;
  }
  return resolveOnPath("python3", process.env);
}
function canImport(python, module2, cwd) {
  const res = (0, import_node_child_process7.spawnSync)(python, ["-c", `import ${module2}`], { cwd });
  throwIfInterrupted(res);
  return res.status === 0;
}
function pythonPlan(groupDir) {
  const py = pythonInterpreter(groupDir);
  if (py === null) return { skip: "no python3 on PATH" };
  if (!canImport(py, "coverage", groupDir)) {
    return { skip: `coverage is not installed in ${py}; install coverage there to score coverage` };
  }
  const runner = canImport(py, "pytest", groupDir) ? ["pytest"] : ["unittest", "discover"];
  return {
    commands: [
      [py, "-m", "coverage", "run", "-m", ...runner],
      [py, "-m", "coverage", "lcov", "-o", "target/coverage/python/lcov.info"]
    ]
  };
}
function coveragePlan(root, group) {
  const dir = import_node_path11.default.join(root, group.dir);
  if (group.kind === "node") return nodePlan(dir, packageManager(root));
  if (group.kind === "python") return pythonPlan(dir);
  return { skip: "metrics runs coverage for JavaScript/TypeScript and Python only" };
}
function findLcov(dir) {
  if (!(0, import_node_fs10.existsSync)(dir)) return false;
  return (0, import_node_fs10.readdirSync)(dir, { recursive: true, encoding: "utf8" }).some(
    (f) => import_node_path11.default.basename(f) === "lcov.info"
  );
}
function hasLcovReport(groupDir) {
  return findLcov(import_node_path11.default.join(groupDir, "target", "coverage")) || findLcov(import_node_path11.default.join(groupDir, "coverage"));
}
function runCoverage(groupDir, commands) {
  for (const [bin, ...args] of commands) {
    const resolved = import_node_path11.default.isAbsolute(bin) ? bin : resolveOnPath(bin, process.env);
    if (resolved === null) return `${bin} is not on PATH`;
    const res = (0, import_node_child_process7.spawnSync)(resolved, args, { cwd: groupDir, stdio: "ignore" });
    throwIfInterrupted(res);
    if (res.status !== 0) {
      return `coverage command \`${[bin, ...args].join(" ")}\` exited ${res.status ?? "by signal"}`;
    }
  }
  if (!hasLcovReport(groupDir)) {
    return `coverage command \`${commands.map((c) => c.join(" ")).join(" && ")}\` produced no lcov.info`;
  }
  return null;
}
function describe(commands) {
  return commands.map((c) => c.map((p) => import_node_path11.default.isAbsolute(p) ? import_node_path11.default.basename(p) : p).join(" ")).join(" && ");
}

// src/lib/metrics/guard.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs11 = require("node:fs");
var import_node_path12 = __toESM(require("node:path"), 1);
var ARTIFACTS = [
  ".metrics",
  ".coverage",
  "coverage",
  "target/coverage",
  "target/mutation-workers",
  "target/mutator-backup"
];
var STASH_NAME = "harry-metrics-stash";
function statusEntries(root) {
  const tokens = gitChecked(root, ["status", "--porcelain", "-z", "-uall"]).stdout.split("\0");
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "") continue;
    const xy = token.slice(0, 2);
    const file = token.slice(3);
    if (/[RC]/.test(xy)) {
      entries.push({ line: `${xy} ${tokens[i + 1]} -> ${file}`, path: file });
      i++;
    } else {
      entries.push({ line: token, path: file });
    }
  }
  return entries;
}
function present(p) {
  try {
    (0, import_node_fs11.lstatSync)(p);
    return true;
  } catch {
    return false;
  }
}
function fingerprint(file) {
  try {
    const st = (0, import_node_fs11.lstatSync)(file);
    if (st.isSymbolicLink()) return `link:${(0, import_node_fs11.readlinkSync)(file)}`;
    if (!st.isFile()) return `other:${st.mode}`;
    return `file:${(0, import_node_crypto2.createHash)("sha256").update((0, import_node_fs11.readFileSync)(file)).digest("hex")}`;
  } catch {
    return "absent";
  }
}
function readManifest(stash) {
  try {
    return (0, import_node_fs11.readFileSync)(import_node_path12.default.join(stash, "manifest"), "utf8").split("\n").filter(Boolean).map((l) => l.replace("	", " \u2192 "));
  } catch {
    return [];
  }
}
function claimStash(stash) {
  try {
    (0, import_node_fs11.mkdirSync)(stash);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const held = readManifest(stash);
    const entries = (0, import_node_fs11.readdirSync)(stash).filter((e) => e !== "manifest");
    throw new Error(
      [
        `${stash} exists: another metrics run is in progress, or an earlier one stopped before restoring.`,
        held.length > 0 ? `It holds (entry \u2192 original path):
${held.map((h) => `  ${h}`).join("\n")}` : `It holds: ${entries.length > 0 ? entries.join(", ") : "nothing"}`,
        "Once no run is in progress, move each entry back to its path and remove the dir."
      ].join("\n")
    );
  }
}
function withArtifactGuard(root, dirs, fn) {
  const gitDir = gitChecked(root, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
  const stash = import_node_path12.default.join(gitDir, STASH_NAME);
  claimStash(stash);
  const releaseSignals = holdStopSignals();
  const unrestored = [];
  try {
    return guarded(root, dirs, stash, unrestored, fn);
  } finally {
    if (unrestored.length === 0) (0, import_node_fs11.rmSync)(stash, { recursive: true, force: true });
    releaseSignals();
  }
}
function guarded(root, dirs, stash, unrestored, fn) {
  const before = statusEntries(root);
  const sums = new Map(before.map((e) => [e.path, fingerprint(import_node_path12.default.join(root, e.path))]));
  const unique = [...new Set(dirs.map((d) => import_node_path12.default.resolve(root, d)))];
  const existed = new Set(
    unique.flatMap((d) => ARTIFACTS.map((rel) => import_node_path12.default.join(d, rel))).filter(present)
  );
  const hadTarget = new Map(unique.map((d) => [d, present(import_node_path12.default.join(d, "target"))]));
  const moved = [];
  const notRemoved = [];
  const remove = (p) => {
    try {
      (0, import_node_fs11.rmSync)(p, { recursive: true, force: true });
    } catch (err) {
      notRemoved.push(`${p} (could not remove: ${err.message})`);
    }
  };
  let outcome;
  try {
    for (const p of existed) {
      const aside = import_node_path12.default.join(stash, String(moved.length));
      (0, import_node_fs11.appendFileSync)(import_node_path12.default.join(stash, "manifest"), `${moved.length}	${p}
`);
      (0, import_node_fs11.renameSync)(p, aside);
      moved.push([p, aside]);
    }
    outcome = { ok: true, value: fn() };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    const restoring = new Set(moved.map(([p]) => p));
    for (const dir of unique) {
      for (const rel of ARTIFACTS) {
        const p = import_node_path12.default.join(dir, rel);
        if (!existed.has(p) || restoring.has(p)) remove(p);
      }
      if (!hadTarget.get(dir)) remove(import_node_path12.default.join(dir, "target"));
    }
    for (const [p, aside] of moved) {
      try {
        (0, import_node_fs11.mkdirSync)(import_node_path12.default.dirname(p), { recursive: true });
        (0, import_node_fs11.renameSync)(aside, p);
      } catch (err) {
        unrestored.push(`${p} (left at ${aside}: ${err.message})`);
      }
    }
  }
  const after = statusEntries(root);
  const beforeLines = new Set(before.map((e) => e.line));
  const afterLines = new Set(after.map((e) => e.line));
  const changedInPlace = before.filter((e) => afterLines.has(e.line)).filter((e) => fingerprint(import_node_path12.default.join(root, e.path)) !== sums.get(e.path)).map((e) => `${e.line} (content changed during the run)`);
  const leftovers = [
    ...after.filter((e) => !beforeLines.has(e.line)).map((e) => e.line),
    ...before.filter((e) => !afterLines.has(e.line)).map((e) => e.line),
    ...changedInPlace,
    ...notRemoved
  ];
  if (!outcome.ok) {
    const error = outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    if (leftovers.length > 0) error.message += `
left in the checkout:
${leftovers.join("\n")}`;
    if (unrestored.length > 0) error.message += `
not restored:
${unrestored.join("\n")}`;
    throw error;
  }
  return { result: outcome.value, leftovers, unrestored };
}

// src/lib/metrics/mutator.ts
var import_node_fs12 = require("node:fs");
var import_node_path13 = __toESM(require("node:path"), 1);
function lineAt(dir, file, byte) {
  const buf = (0, import_node_fs12.readFileSync)(import_node_path13.default.join(dir, file));
  let line = 1;
  for (let i = 0; i < byte && i < buf.length; i++) if (buf[i] === 10) line++;
  return line;
}
function snapshots(dir) {
  const root = import_node_path13.default.join(dir, ".metrics", "mutate");
  if (!(0, import_node_fs12.existsSync)(root)) return [];
  return (0, import_node_fs12.readdirSync)(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".edn")).map((f) => import_node_path13.default.join(root, f));
}
function runMutator(tool, dir, files, coverage, testCommand) {
  const args = ["--root", dir, coverage ? "--use-existing-coverage" : "--no-coverage"];
  if (testCommand !== null) args.push("--test-command", testCommand);
  const run = runTool(tool, [...args, ...files], dir);
  if (run.status === 2) throw new Error(`baseline tests fail
${failureTail(run)}`);
  if (run.status !== 0 && run.status !== 3) {
    throw new Error(`mutator exited ${run.status}
${failureTail(run)}`);
  }
  const wanted = new Set(files);
  const survivors = [];
  for (const snap of snapshots(dir)) {
    const data = parseEdn((0, import_node_fs12.readFileSync)(snap, "utf8"));
    for (const [id, outcome] of Object.entries(data.outcomes ?? {})) {
      if (outcome !== "survived") continue;
      const [file, , form, start, , original, mutant] = JSON.parse(id);
      if (!wanted.has(file)) continue;
      survivors.push({ file, line: lineAt(dir, file, start), original, mutant, form });
    }
  }
  return survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
function renderSurvivor(s, where) {
  const fn = s.form.replace(/^defn-?\//, "");
  const mutation = s.mutant === "" ? `delete \`${s.original}\`` : `\`${s.original}\` \u2192 \`${s.mutant}\``;
  return `- ${where} ${mutation} in ${fn}`;
}

// src/lib/metrics/scope.ts
var import_node_child_process8 = require("node:child_process");
var import_node_fs13 = require("node:fs");
var import_node_os6 = __toESM(require("node:os"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".clj",
  ".cljc",
  ".cljs",
  ".bb",
  ".java",
  ".go",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".py"
]);
var TEST_DIRS = /* @__PURE__ */ new Set(["test", "tests", "spec", "specs", "__tests__"]);
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".venv",
  "venv",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".metrics",
  "testdata",
  "__pycache__",
  ".clj-kondo"
]);
var TEST_SUFFIX = /(_test\.(go|clj|cljc|cljs|bb|py)|\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs))$/;
function isSourceFile(rel) {
  const name = import_node_path14.default.posix.basename(rel);
  if (name.endsWith(".d.ts")) return false;
  if (!SOURCE_EXTENSIONS.has(import_node_path14.default.posix.extname(name))) return false;
  if (TEST_SUFFIX.test(name) || name === "conftest.py") return false;
  if (name.startsWith("test_") && name.endsWith(".py")) return false;
  return !rel.split("/").some((part) => TEST_DIRS.has(part) || SKIP_DIRS.has(part));
}
function lines(text) {
  return text.split("\n").filter(Boolean);
}
function changedSourceFiles(root, base) {
  const diff = gitChecked(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=AM",
    `${base}...HEAD`
  ]);
  return lines(diff.stdout).filter(isSourceFile).sort();
}
function trackedSourceFiles(root) {
  return lines(gitChecked(root, ["ls-files"]).stdout).filter(isSourceFile).sort();
}
function withSnapshot(root, ref, fn) {
  const dir = (0, import_node_fs13.mkdtempSync)(import_node_path14.default.join(import_node_os6.default.tmpdir(), "harry-metrics-snap-"));
  try {
    const tar = import_node_path14.default.join(dir, "..", `${import_node_path14.default.basename(dir)}.tar`);
    try {
      gitChecked(root, ["archive", "--format=tar", "-o", tar, ref]);
      const tarBin = resolveOnPath("tar", process.env);
      if (tarBin === null) throw new Error("tar is not on PATH");
      const res = (0, import_node_child_process8.spawnSync)(tarBin, ["-xf", tar, "-C", dir], { encoding: "utf8" });
      throwIfInterrupted(res);
      if (res.status !== 0) throw new Error(`tar -xf failed: ${res.stderr.trim()}`);
    } finally {
      (0, import_node_fs13.rmSync)(tar, { force: true });
    }
    return fn(dir);
  } finally {
    (0, import_node_fs13.rmSync)(dir, { recursive: true, force: true });
  }
}

// src/commands/metrics.ts
function notInstalled(name) {
  const where = displayPath(import_node_path15.default.join(toolsDir(), name, name));
  return `not installed (expected at ${where}; \`/harry:sync --tools\` installs it)`;
}
function failed(err, tool) {
  return `failed: ${err.message.trim()} (tool commit ${tool.commit})`;
}
function attempt(tool, body) {
  try {
    return body(tool);
  } catch (err) {
    rethrowInterrupt(err);
    return failed(err, tool);
  }
}
function section(name, tool, body) {
  if (tool === null) return `## ${name}

${notInstalled(name)}
`;
  return `## ${name} (${tool.commit.slice(0, 7)})

${attempt(tool, body)}
`;
}
function measureCoverage(root, group) {
  const plan = coveragePlan(root, group);
  if ("skip" in plan) return { gap: plan.skip, how: `complexity only: ${plan.skip}` };
  const gap = runCoverage(import_node_path15.default.join(root, group.dir), plan.commands);
  return {
    gap,
    how: gap === null ? `coverage: ${describe(plan.commands)}` : `complexity only: ${gap}`
  };
}
function groupLabel(group) {
  return group.dir === "" ? "(repo root)" : group.dir;
}
function beforeRun(tool, root, base, groups) {
  return withSnapshot(root, base, (snap) => {
    const out = /* @__PURE__ */ new Map();
    for (const group of groups) {
      const dir = import_node_path15.default.join(snap, group.dir);
      const files = group.files.filter((f) => (0, import_node_fs14.existsSync)(import_node_path15.default.join(dir, f)));
      const entries = files.length > 0 ? runCrapper(tool, dir, files, false) : [];
      out.set(group, beforeComplexity(entries));
    }
    return out;
  });
}
function crapperGroup(tool, root, base, group, before, coverageGap) {
  const dir = import_node_path15.default.join(root, group.dir);
  const after = runCrapper(tool, dir, group.files, coverageGap === null);
  const spans = functionSpans(tool, dir, group.files);
  const hits = judge(
    after,
    before,
    spans,
    (file) => changedRanges(root, base, repoPath(group, file))
  );
  const lines2 = hits.map((h) => renderJudged(h, (s) => `${repoPath(group, s.file)}:${s.start}`));
  return lines2.length > 0 ? lines2.join("\n") : "No new or touched function crosses the bar.";
}
function eachGroup(groups, tool, body) {
  return groups.map((group) => {
    let heading;
    let text;
    try {
      [heading, text] = body(group);
    } catch (err) {
      rethrowInterrupt(err);
      heading = "";
      text = failed(err, tool);
    }
    return `### ${groupLabel(group)}${heading ? ` \u2014 ${heading}` : ""}

${text}`;
  }).join("\n\n");
}
function checkoutPhase(root, groups, tools, crapperBody) {
  const guarded2 = withArtifactGuard(root, ["", ...groups.map((g) => g.dir)], () => {
    const needsCoverage = crapperBody && tools.crapper || tools.mutator;
    const coverage = new Map(
      needsCoverage ? groups.map((g) => [g, measureCoverage(root, g)]) : []
    );
    const covOf = (g) => coverage.get(g);
    const crapper = crapperBody === null || tools.crapper === null ? null : attempt(tools.crapper, (tool) => {
      const score = crapperBody(tool);
      return eachGroup(groups, tool, (g) => [covOf(g).how, score(g, covOf(g).gap)]);
    });
    const mutator = tools.mutator === null ? null : attempt(tools.mutator, (tool) => {
      const pm = packageManager(root);
      return eachGroup(groups, tool, (group) => {
        const gap = covOf(group).gap;
        const testCommand = group.kind === "node" ? `${pm} test` : null;
        const dir = import_node_path15.default.join(root, group.dir);
        const survivors = runMutator(tool, dir, group.files, gap === null, testCommand);
        const text = survivors.length > 0 ? survivors.map((s) => renderSurvivor(s, `${repoPath(group, s.file)}:${s.line}`)).join("\n") : "No mutant survived.";
        return [
          gap === null ? "uncovered lines skipped" : "every site run (no coverage)",
          text
        ];
      });
    });
    return { crapper, mutator };
  });
  return {
    ...guarded2.result,
    problems: [
      ...guarded2.leftovers.map((l) => `left in the checkout: ${l}`),
      ...guarded2.unrestored.map((u) => `not restored: ${u}`)
    ]
  };
}
function writeFacts(file, header, sections, problems) {
  const facts = ["# Metrics facts", "", header, "", ...sections];
  if (problems.length > 0) {
    facts.push("## Checkout", "", ...problems.map((p) => `- ${p}`), "");
    console.error(`metrics changed the checkout:
${problems.join("\n")}`);
    process.exitCode = 1;
  }
  (0, import_node_fs14.mkdirSync)(import_node_path15.default.dirname(file), { recursive: true });
  (0, import_node_fs14.writeFileSync)(file, facts.join("\n"));
}
function loadTools() {
  return Object.fromEntries(TOOL_NAMES.map((n) => [n, findTool(n)]));
}
function headOf(root) {
  return gitChecked(root, ["rev-parse", "HEAD"]).stdout.trim();
}
async function runUnit(cwd, baseRef, out) {
  const root = getRepoRoot(cwd);
  const base = gitChecked(root, ["merge-base", baseRef, "HEAD"]).stdout.trim();
  const changed = changedSourceFiles(root, base);
  const head = headOf(root);
  const tools = loadTools();
  const none = "skipped: no changed source files";
  const dryer = section("dryer", tools.dryer, (tool) => {
    if (changed.length === 0) return none;
    const pairs = withSnapshot(root, head, (dir) => runDryer(tool, dir));
    const hits = renderPairs(
      touching(pairs, new Set(changed)),
      "No duplicate pair touches a changed file."
    );
    return `${hits}

${DRYER_SCOPE_NOTE}`;
  });
  const groups = changed.length > 0 ? groupFiles(root, changed) : [];
  const phase = groups.length === 0 ? { crapper: none, mutator: none, problems: [] } : checkoutPhase(root, groups, tools, (tool) => {
    const before = beforeRun(tool, root, base, groups);
    return (group, gap) => crapperGroup(tool, root, base, group, before.get(group) ?? /* @__PURE__ */ new Map(), gap);
  });
  writeFacts(
    import_node_path15.default.resolve(cwd, out),
    `Base: ${baseRef} (branch point ${base.slice(0, 7)}) \xB7 Head: ${head.slice(0, 7)} \xB7 Changed source files: ${changed.length}`,
    [
      dryer,
      section("crapper", tools.crapper, () => phase.crapper ?? ""),
      section("mutator", tools.mutator, () => phase.mutator ?? "")
    ],
    phase.problems
  );
}
function copyFrom(dir, rel, to) {
  (0, import_node_fs14.mkdirSync)(import_node_path15.default.dirname(to), { recursive: true });
  (0, import_node_fs14.copyFileSync)(import_node_path15.default.join(dir, rel), to);
}
async function runAudit(cwd, out, runTests) {
  const root = getRepoRoot(cwd);
  const head = headOf(root);
  const tools = loadTools();
  const outDir = import_node_path15.default.resolve(cwd, out);
  (0, import_node_fs14.mkdirSync)(outDir, { recursive: true });
  const dryer = section("dryer", tools.dryer, (tool) => {
    const pairs = withSnapshot(root, head, (dir) => {
      const found = runDryer(tool, dir);
      if ((0, import_node_fs14.existsSync)(import_node_path15.default.join(dir, ".metrics/dry.edn"))) {
        copyFrom(dir, ".metrics/dry.edn", import_node_path15.default.join(outDir, "dry.edn"));
      }
      return found;
    });
    return `${renderPairs(pairs, "No duplicate pair found.")}

${DRYER_SCOPE_NOTE}`;
  });
  const phase = runTests ? checkoutPhase(
    root,
    groupFiles(root, trackedSourceFiles(root)),
    tools,
    (tool) => (group, gap) => renderOverBar(runCrapper(tool, import_node_path15.default.join(root, group.dir), group.files, gap === null))
  ) : null;
  const crapper = section("crapper", tools.crapper, (tool) => {
    const complexity = attempt(
      tool,
      () => withSnapshot(root, head, (dir) => {
        const entries = runCrapper(tool, dir, [], false);
        copyFrom(dir, ".metrics/crap.edn", import_node_path15.default.join(outDir, "crap.edn"));
        return renderOverBar(entries);
      })
    );
    const parts = [`### complexity only, tracked files at ${head.slice(0, 7)}

${complexity}`];
    if (phase?.crapper) parts.push(phase.crapper);
    return parts.join("\n\n");
  });
  const mutator = section(
    "mutator",
    tools.mutator,
    () => phase?.mutator ?? "skipped: runs only with --run-tests (it runs the test suite once per mutant)"
  );
  writeFacts(
    import_node_path15.default.join(outDir, "metrics.md"),
    `Audit of ${head.slice(0, 7)} (tracked files)${runTests ? " \xB7 with --run-tests" : ""}`,
    [dryer, crapper, mutator],
    phase?.problems ?? []
  );
}
async function runMetrics(cwd, options) {
  try {
    await dispatch(cwd, options);
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
    console.error(err.message);
    process.exitCode = err.exitCode;
  }
}
async function dispatch(cwd, options) {
  if (!options.out) throw new Error("metrics requires --out <file|dir>.");
  if (options.audit) {
    if (options.base) throw new Error("metrics --audit takes no --base.");
    return runAudit(cwd, options.out, options.runTests === true);
  }
  if (options.runTests) throw new Error("--run-tests applies only to metrics --audit.");
  if (!options.base) throw new Error("metrics requires --base <ref> (or --audit).");
  return runUnit(cwd, options.base, options.out);
}

// src/commands/review.ts
var import_node_fs16 = require("node:fs");
var import_node_path17 = require("node:path");

// src/lib/review-modes.ts
var import_node_fs15 = require("node:fs");
var import_node_path16 = require("node:path");
function pluginRoot() {
  return (0, import_node_path16.dirname)((0, import_node_path16.dirname)((0, import_node_fs15.realpathSync)(process.argv[1])));
}
var PER_DIFF = [
  { file: "review-rubric.md", heading: "Review standard" },
  { file: "red-green.md", heading: "Test standard (`references/red-green.md`)" }
];
function loadReference(file) {
  const refPath = (0, import_node_path16.join)(pluginRoot(), "references", file);
  let text;
  try {
    text = (0, import_node_fs15.readFileSync)(refPath, "utf8");
  } catch (err) {
    throw new Error(
      `Review reference not found at ${refPath} (${err.message}). Reinstall the harry plugin.`
    );
  }
  if (!text.trim()) throw new Error(`Review reference at ${refPath} is empty.`);
  return text.trim();
}
function cutSection(file, text, title) {
  const lines2 = text.split("\n");
  const start = lines2.indexOf(`## ${title}`);
  if (start === -1) {
    throw new Error(
      `Review reference ${(0, import_node_path16.join)(pluginRoot(), "references", file)} has no \`## ${title}\` section. Reinstall the harry plugin.`
    );
  }
  const end = lines2.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  return lines2.slice(start, end === -1 ? void 0 : end).join("\n").trim();
}
function embed({ file, heading, section: section2 }) {
  const text = loadReference(file);
  return `# ${heading}

${section2 ? cutSection(file, text, section2) : text}`;
}
var OUTSIDE_THE_DIFF = "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";
var OUTSIDE_THE_SHAPES = "Code outside those changes is context for judging the shapes this change adds or alters: read it, one level up and through the recent history, as the review standard below asks. Report findings about those shapes only, not unrelated problems elsewhere.";
function reviewTarget(target, outside) {
  if (target.mode === "branch") {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    return [
      "# Review target",
      "",
      `Review the changes this branch makes against \`${target.baseRef}\`. Run \`git diff ${target.baseRef}...HEAD\` to see them \u2014 that diff is the review target.`,
      "",
      outside
    ].join("\n");
  }
  return [
    "# Review target",
    "",
    "Review the uncommitted changes in this working tree \u2014 staged, unstaged and untracked. See them with:",
    "",
    "- `git status --short --untracked-files=all` \u2014 every changed and untracked path",
    "- `git diff HEAD` \u2014 staged and unstaged changes to tracked files",
    "- read each untracked file in full \u2014 it has no diff",
    "",
    outside
  ].join("\n");
}
function fixCheckTarget(target) {
  if (target.mode !== "branch" || !target.baseRef)
    throw new Error("A fix check requires a branch target.");
  return [
    "# Fix check target",
    "",
    `This is a fix check, not a review. An earlier review of this branch raised the findings handed below, each with a proposed fix that is not built yet. The unit's changes are \`git diff ${target.baseRef}...HEAD\` \u2014 run it to see the code the findings point at.`,
    "",
    "Read the whole repo as far as you need to trace the data flow and the system around each fix: callers, producers and copies of the same knowledge, wherever they live. Judge only the handed fixes: one line per handed fix, in the output form of the fix check standard below, under its finding's number \u2014 the number the handed text gives the finding (its `1.`, `2.` \u2026), never a number from the handed file's title or name; raise no new findings."
  ].join("\n");
}
var REREVIEW_MODE = [
  "# Re-review mode",
  "",
  "This is a scoped re-review, not a fresh review. The diff above is the fix range: the fixes made for the open findings handed below, after an earlier review of this branch. Report in the review standard's re-review form, not its fresh form:",
  "",
  "- Under `### Open findings`, one line per handed finding, under its handed number: ADDRESSED or NOT ADDRESSED, with the evidence read. Attempted is not addressed.",
  "- Judge each handed finding at the levels in the Three levels section above: ADDRESSED means the cause is gone, not only this instance.",
  "- Number new issues on from the last number handed, never from 1."
].join("\n");
var MODES = {
  review: {
    files: PER_DIFF,
    target: (target) => reviewTarget(target, OUTSIDE_THE_DIFF),
    onEmpty: "summary"
  },
  architecture: {
    flag: "--architecture",
    files: [{ file: "architecture-review.md", heading: "Review standard" }],
    target: (target) => reviewTarget(target, OUTSIDE_THE_SHAPES),
    onEmpty: "summary"
  },
  rereview: {
    flag: "--rereview",
    files: [
      ...PER_DIFF,
      {
        file: "fix-check.md",
        heading: "Fix levels (`references/fix-check.md` **Three levels**)",
        section: "Three levels"
      }
    ],
    target: (target) => reviewTarget(target, OUTSIDE_THE_DIFF),
    baseReason: "the head the review it follows reviewed",
    modeSection: REREVIEW_MODE,
    heading: "Open findings handed to this re-review",
    onEmpty: "fail"
  },
  "fix-check": {
    flag: "--fix-check",
    files: [{ file: "fix-check.md", heading: "Fix check standard (`references/fix-check.md`)" }],
    target: fixCheckTarget,
    baseReason: "the unit's branch point",
    heading: "Fixes handed to this fix check",
    onEmpty: "fail"
  }
};
function takesHanded(standard) {
  return "heading" in MODES[standard];
}
var SPEC_HEADING = "Acceptance criteria handed to this review";
var SPEC_NOTE = "Judge Spec compliance per AC against the acceptance criteria below. A probe line beside an AC is its author's report, not a settled fact: check it as the review standard's Spec compliance says.";
function buildReviewPrompt(input) {
  const mode = MODES[input.standard];
  const sections = [mode.target(input.target), ...mode.files.map(embed)];
  if ("handed" in input && "heading" in mode) {
    if (mode.modeSection) sections.push(mode.modeSection);
    const handed = input.handed.trim();
    if (!handed) throw new Error(`A ${input.standard} prompt requires its handed text.`);
    sections.push(`# ${mode.heading}

${handed}`);
  }
  const spec = input.standard === "review" ? input.spec?.trim() : void 0;
  if (spec) sections.push(`# ${SPEC_HEADING}

${SPEC_NOTE}

${spec}`);
  const context = input.context?.trim();
  if (context) {
    sections.push(`## Background (settled facts from the working session)

${context}`);
  }
  const focus = input.focusText?.trim();
  if (focus) sections.push(`## Focus

${focus}`);
  return `${sections.join("\n\n")}
`;
}

// src/commands/review.ts
function assertOneStdinReader(context, flag, raw) {
  if (context === "@-" && raw === "@-") {
    throw new Error(`--context and ${flag} cannot both read stdin (@-): pass one as @file.`);
  }
}
function resolveStandard(cwd, options) {
  const handedRaw = {
    rereview: options.rereview,
    "fix-check": options.fixCheck
  };
  const given = {
    architecture: options.architecture === true,
    rereview: handedRaw.rereview !== void 0,
    "fix-check": handedRaw["fix-check"] !== void 0
  };
  const chosen = Object.keys(given).filter(
    (standard2) => given[standard2]
  );
  if (chosen.length > 1) {
    const flags = chosen.map((standard2) => MODES[standard2].flag);
    throw new Error(`${flags.join(" and ")} cannot be combined: each is its own review.`);
  }
  const standard = chosen.at(0) ?? "review";
  if (options.spec !== void 0 && standard !== "review") {
    throw new Error(
      `--spec goes with the plain review only: ${MODES[standard].flag} judges no spec.`
    );
  }
  if (standard === "review") {
    assertOneStdinReader(options.context, "--spec", options.spec);
    return { standard, spec: resolveTextFlag(cwd, "--spec", options.spec) };
  }
  if (!takesHanded(standard)) return { standard };
  const mode = MODES[standard];
  const raw = handedRaw[standard];
  assertOneStdinReader(options.context, mode.flag, raw);
  if (!options.base) {
    throw new Error(`${mode.flag} requires --base <ref>: ${mode.baseReason}.`);
  }
  return { standard, handed: resolveTextFlag(cwd, mode.flag, raw) ?? "" };
}
var REVIEW_WRITTEN = "Review written to";
function resolveOutputDir(repoRoot) {
  const branch = getBranchOrShortSha(repoRoot);
  const local = (0, import_node_path17.join)(getMainCheckoutRoot(repoRoot), ".local");
  const dir = (0, import_node_fs16.existsSync)(local) && (0, import_node_fs16.statSync)(local).isDirectory() ? (0, import_node_path17.join)(local, "tmp", branch) : (0, import_node_path17.join)(resolveStateDir(repoRoot), "reviews", branch);
  ensureDir(dir);
  return dir;
}
function reserveReviewFiles(dir, now = /* @__PURE__ */ new Date()) {
  const { outputPath, logPath } = reserveRunFiles(dir, "codex-review", now);
  return { reviewPath: outputPath, logPath };
}
async function runReview(cwd, options = {}) {
  const selected = resolveStandard(cwd, options);
  const mode = MODES[selected.standard];
  const target = resolveReviewTarget(cwd, { base: options.base });
  const repoRoot = getRepoRoot(cwd);
  const empty = target.mode === "branch" && countBranchChanges(repoRoot, target.baseRef ?? "") === 0;
  if (empty && mode.onEmpty === "summary") {
    process.stdout.write(`# Review Summary

No changes to review under ${target.label}.
`);
    return;
  }
  const prompt = buildReviewPrompt({
    ...selected,
    target,
    // Strict: a reviewer silently missing its facts would review a different question.
    context: resolveTextFlag(cwd, "--context", options.context),
    focusText: options.focusText
  });
  if (empty && mode.onEmpty === "fail") {
    throw new Error(
      `${mode.flag} has no changes to judge under ${target.label}: commit them first, or check --base.`
    );
  }
  const { reviewPath: outputPath, logPath } = reserveReviewFiles(resolveOutputDir(repoRoot));
  process.stderr.write(`Reviewing ${target.label} with ${CODEX_EXEC}\u2026
`);
  const review = await runCodexExec({
    reasoning: options.reasoning,
    cwd: repoRoot,
    input: prompt,
    outputPath,
    logPath,
    outputNoun: "review"
  });
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}
Log: ${logPath}
`);
}

// package.json
var package_default = { version: "0.26.0" };

// src/lib/version.ts
var PLUGIN_VERSION = package_default.version;
var CLIENT_NAME = "harry";

// src/commands/setup.ts
function callCodex(cwd, args) {
  const res = spawnCodexSync(args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (codexMissing(res)) return { missing: true, status: null, lines: [] };
  if (res.error) throw res.error;
  const lines2 = `${String(res.stderr ?? "")}
${String(res.stdout ?? "")}`.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return { missing: false, status: res.status, lines: lines2 };
}
function pickLine(call, pattern) {
  return call.lines.find((l) => pattern.test(l)) ?? call.lines.at(-1) ?? "";
}
async function runSetup(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const versionCall = callCodex(cwd, ["--version"]);
  const available = !versionCall.missing && versionCall.status === 0;
  const version = available ? pickLine(versionCall, /^codex-cli\s+\S/).replace(/^codex-cli\s+/, "") : null;
  const loginCall = available ? callCodex(cwd, ["login", "status"]) : void 0;
  const loggedIn = loginCall?.status === 0;
  const detail = versionCall.missing ? CODEX_CLI_MISSING : !available ? `codex --version failed (exit ${versionCall.status}): ${pickLine(versionCall, /^codex-cli\s/)}` : loginCall && pickLine(loginCall, /\b(?:Not logged in|Logged in)\b/i) || `codex login status exited ${loginCall?.status}`;
  if (options.json) {
    console.log(
      JSON.stringify(
        { status: loggedIn ? "ok" : "error", available, version, loggedIn, detail },
        null,
        2
      )
    );
    return;
  }
  const lines2 = [];
  lines2.push(`## Codex Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines2.push("");
  lines2.push(`**Availability:** ${available ? `available \u2014 codex-cli ${version}` : "unavailable"}`);
  lines2.push(`**Status:** ${loggedIn ? "Authenticated" : "Not authenticated"}`);
  lines2.push(`**Detail:** ${detail}`);
  if (!available) {
    lines2.push("");
    lines2.push("### Next steps");
    lines2.push("- Install the Codex CLI, run `codex login`, then re-run setup.");
  } else if (!loggedIn) {
    lines2.push("");
    lines2.push("### Next steps");
    lines2.push("- Run `codex login` to authenticate, then re-run setup.");
  }
  console.log(lines2.join("\n"));
}

// src/lib/args.ts
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set([
  "help",
  "json",
  "architecture",
  "isolated",
  "audit",
  "run-tests"
]);
var KNOWN_FLAGS = {
  setup: /* @__PURE__ */ new Set(["json"]),
  review: /* @__PURE__ */ new Set([
    "base",
    "reasoning",
    "context",
    "spec",
    "architecture",
    "rereview",
    "fix-check"
  ]),
  ask: /* @__PURE__ */ new Set(["task", "reasoning", "context", "isolated"]),
  metrics: /* @__PURE__ */ new Set(["base", "out", "audit", "run-tests"])
};
function assertKnownFlags(command, flags) {
  const allowed = KNOWN_FLAGS[command];
  if (!allowed) return;
  for (const key2 of Object.keys(flags)) {
    if (key2 === "help") continue;
    if (!allowed.has(key2)) {
      throw new Error(`Unknown flag --${key2} for '${command}'. Run 'companion help' for usage.`);
    }
  }
}
function parseArgs(argv) {
  const command = argv[0] ?? "help";
  const args = [];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key3 = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(key3)) {
          const lc = value.toLowerCase();
          if (lc === "" || lc === "true" || lc === "1" || lc === "yes") {
            flags[key3] = true;
          } else if (lc === "false" || lc === "0" || lc === "no") {
            flags[key3] = false;
          } else {
            throw new Error(
              `Flag --${key3} is boolean and cannot take value "${value}". Use --${key3} or --no-${key3}.`
            );
          }
          continue;
        }
        flags[key3] = value;
        continue;
      }
      const key2 = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key2)) {
        flags[key2] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("--")) {
        flags[key2] = next;
        i++;
      } else {
        flags[key2] = true;
      }
    } else {
      args.push(arg);
    }
  }
  return { command, args, flags };
}
function flagEnum(flags, key2, allowed) {
  const v = flags[key2];
  if (v === void 0) return void 0;
  if (typeof v !== "string") {
    throw new Error(`Flag --${key2} requires a value (one of: ${allowed.join(", ")}).`);
  }
  if (!allowed.includes(v)) {
    throw new Error(`Invalid --${key2} value "${v}". Expected one of: ${allowed.join(", ")}.`);
  }
  return v;
}
function extractTask(args, flags) {
  const positional = args.join(" ").trim();
  if (positional) return positional;
  const flag = flags.task;
  return typeof flag === "string" ? flag.trim() : "";
}
function flagRequiredString(flags, key2) {
  const v = flags[key2];
  if (v === void 0) return void 0;
  if (typeof v !== "string") throw new Error(`Flag --${key2} requires a value.`);
  if (v.trim() === "") throw new Error(`Flag --${key2} requires a value; got an empty one.`);
  return v;
}

// src/companion.ts
if (import_node_process.default.platform === "win32") {
  console.error("harry's companion supports macOS and Linux only; Windows is not supported.");
  import_node_process.default.exit(1);
}
function printUsage() {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [--base <ref>] [--reasoning <low|medium|high|xhigh>]",
      "                   [--context <text|@file|@->] [--spec <text|@file|@->]",
      "                   [--architecture | --rereview <text|@file|@-> | --fix-check <text|@file|@->]",
      "                   [focus...]",
      '  companion ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->] [--isolated]',
      "  companion metrics --base <ref> --out <file>",
      "  companion metrics --audit --out <dir> [--run-tests]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec`",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  metrics     Run the installed crapper, dryer and mutator; write a facts file"
    ].join("\n")
  );
}
async function main() {
  const { command, args, flags } = parseArgs(import_node_process.default.argv.slice(2));
  if (flags.help === true) {
    printUsage();
    return;
  }
  assertKnownFlags(command, flags);
  switch (command) {
    case "setup": {
      await runSetup({
        json: flags.json === true
      });
      break;
    }
    case "review": {
      await runReview(import_node_process.default.cwd(), {
        base: flagRequiredString(flags, "base"),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context"),
        spec: flagRequiredString(flags, "spec"),
        architecture: flags.architecture === true,
        rereview: flagRequiredString(flags, "rereview"),
        fixCheck: flagRequiredString(flags, "fix-check"),
        focusText: args.join(" ")
      });
      break;
    }
    case "ask": {
      await runAsk(import_node_process.default.cwd(), {
        prompt: extractTask(args, flags),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context"),
        isolated: flags.isolated === true
      });
      break;
    }
    case "metrics": {
      await runMetrics(import_node_process.default.cwd(), {
        base: flagRequiredString(flags, "base"),
        out: flagRequiredString(flags, "out"),
        audit: flags.audit === true,
        runTests: flags["run-tests"] === true
      });
      break;
    }
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      import_node_process.default.exit(1);
  }
}
main().catch((err) => {
  console.error(`
Fatal error: ${err.message}`);
  if (import_node_process.default.env.DEBUG) console.error(err.stack);
  import_node_process.default.exit(1);
});

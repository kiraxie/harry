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
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
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
var import_node_path5 = require("node:path");

// src/lib/context.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function resolveExtraContext(cwd, context) {
  const raw = context;
  if (!raw?.trim()) return void 0;
  if (!raw.startsWith("@")) return raw.trim();
  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text;
  try {
    text = (0, import_node_fs.readFileSync)(ref === "-" ? 0 : (0, import_node_path.resolve)(cwd, ref), "utf-8").trim();
  } catch (err) {
    throw new Error(`Could not read --context ${source}: ${err.message}`);
  }
  if (!text) throw new Error(`--context ${source} is empty.`);
  return text;
}

// src/lib/run-codex.ts
var import_node_child_process = require("node:child_process");
var import_node_fs4 = require("node:fs");

// src/lib/path-search.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
function isExecutableFile(path) {
  try {
    if (!(0, import_node_fs2.statSync)(path).isFile()) return false;
    (0, import_node_fs2.accessSync)(path, import_node_fs2.constants.X_OK);
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
    const path = (0, import_node_path3.join)(dir, name);
    try {
      const st = (0, import_node_fs3.lstatSync)(path);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) (0, import_node_fs3.rmSync)(path);
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
  const command = resolveOnPath("codex", options.env ?? process.env);
  if (command === null) {
    return Promise.resolve({ status: null, signal: null, error: codexNotFound("spawn codex") });
  }
  return new Promise((resolve3) => {
    const child = (0, import_node_child_process.spawn)(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "ignore", options.logFd]
    });
    const forward = (signal) => {
      try {
        child.kill(signal);
      } catch {
      }
      stopForwarding();
      process.kill(process.pid, signal);
    };
    const stopForwarding = () => {
      for (const s of FORWARDED_SIGNALS) process.off(s, forward);
    };
    for (const s of FORWARDED_SIGNALS) process.on(s, forward);
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
  /** The run's log; absent for `missing`, whose empty log is deleted. */
  logPath;
  /** The exit code for `exit` (null when killed by a signal). */
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
  const lines = (0, import_node_fs4.readFileSync)(logPath, "utf8").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-FAILURE_TAIL_LINES);
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
  const lines = errors.length > 0 ? errors : [NO_ERROR_LINE];
  process.stderr.write(`${lines.join("\n")}
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
async function runCodexExec(opts) {
  const logFd = (0, import_node_fs4.openSync)(opts.logPath, "w", 384);
  let res;
  try {
    res = await spawnCodex(opts.args, { cwd: opts.cwd, input: opts.input, logFd });
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
      `${opts.label} failed (${res.status === null ? `signal ${res.signal}` : `exit ${res.status}`}).`,
      "exit",
      { logPath: opts.logPath, exitStatus: res.status }
    );
  }
  const output = (0, import_node_fs4.existsSync)(opts.outputPath) ? (0, import_node_fs4.readFileSync)(opts.outputPath, "utf8") : "";
  if (!output.trim()) {
    reportLogTail(opts.logPath);
    reportNarrowFailure(opts.outputPath);
    throw new CodexRunError(
      `${opts.label} exited 0 but wrote no ${opts.outputNoun} to ${opts.outputPath}.`,
      "empty",
      { logPath: opts.logPath }
    );
  }
  narrowOutput(opts.outputPath);
  return output;
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
async function ask(cwd, options) {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");
  const context = resolveExtraContext(cwd, options.context);
  const dir = (0, import_node_path5.join)(resolveStateDir(cwd), "asks");
  ensureDir(dir);
  pruneRunFiles(dir, ASK_PREFIX, ASK_RETENTION_MS);
  const { outputPath, logPath } = reserveRunFiles(dir, ASK_PREFIX);
  const args = [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "-o",
    outputPath
  ];
  if (options.reasoning) args.push("-c", `model_reasoning_effort="${options.reasoning}"`);
  args.push("-");
  const answer = await runCodexExec({
    args,
    cwd,
    input: buildAskPrompt(prompt, context),
    outputPath,
    logPath,
    label: "codex exec",
    outputNoun: "answer"
  });
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

// src/commands/review.ts
var import_node_fs7 = require("node:fs");
var import_node_path8 = require("node:path");

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

// src/lib/review-prompts.ts
var import_node_fs6 = require("node:fs");
var import_node_path7 = require("node:path");
function pluginRoot() {
  return (0, import_node_path7.dirname)((0, import_node_path7.dirname)((0, import_node_fs6.realpathSync)(process.argv[1])));
}
var RUBRIC_FILES = {
  review: "review-rubric.md",
  architecture: "architecture-review.md"
};
function loadReviewRubric(standard) {
  const rubricPath = (0, import_node_path7.join)(pluginRoot(), "references", RUBRIC_FILES[standard]);
  let text;
  try {
    text = (0, import_node_fs6.readFileSync)(rubricPath, "utf8");
  } catch (err) {
    throw new Error(
      `Review rubric not found at ${rubricPath} (${err.message}). Reinstall the harry plugin.`
    );
  }
  if (!text.trim()) throw new Error(`Review rubric at ${rubricPath} is empty.`);
  return text.trim();
}
var OUTSIDE_THE_DIFF = "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";
var OUTSIDE_THE_SHAPES = "Code outside those changes is context for judging the shapes this change adds or alters: read it, one level up and through the recent history, as the review standard below asks. Report findings about those shapes only, not unrelated problems elsewhere.";
function targetSection(target, standard) {
  const outside = standard === "architecture" ? OUTSIDE_THE_SHAPES : OUTSIDE_THE_DIFF;
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
function buildReviewPrompt(input) {
  const sections = [
    targetSection(input.target, input.standard),
    `# Review standard

${loadReviewRubric(input.standard)}`
  ];
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
var REVIEW_WRITTEN = "Review written to";
function resolveOutputDir(repoRoot) {
  const branch = getBranchOrShortSha(repoRoot);
  const local = (0, import_node_path8.join)(getMainCheckoutRoot(repoRoot), ".local");
  const dir = (0, import_node_fs7.existsSync)(local) && (0, import_node_fs7.statSync)(local).isDirectory() ? (0, import_node_path8.join)(local, "tmp", branch) : (0, import_node_path8.join)(resolveStateDir(repoRoot), "reviews", branch);
  ensureDir(dir);
  return dir;
}
function reserveReviewFiles(dir, now = /* @__PURE__ */ new Date()) {
  const { outputPath, logPath } = reserveRunFiles(dir, "codex-review", now);
  return { reviewPath: outputPath, logPath };
}
async function runReview(cwd, options = {}) {
  const target = resolveReviewTarget(cwd, { base: options.base });
  const repoRoot = getRepoRoot(cwd);
  if (target.mode === "branch" && countBranchChanges(repoRoot, target.baseRef ?? "") === 0) {
    process.stdout.write(`# Review Summary

No changes to review under ${target.label}.
`);
    return;
  }
  const prompt = buildReviewPrompt({
    target,
    standard: options.architecture ? "architecture" : "review",
    // Strict: a reviewer silently missing its facts would review a different question.
    context: resolveExtraContext(cwd, options.context),
    focusText: options.focusText
  });
  const { reviewPath: outputPath, logPath } = reserveReviewFiles(resolveOutputDir(repoRoot));
  const args = [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPath
  ];
  if (options.reasoning) args.push("-c", `model_reasoning_effort="${options.reasoning}"`);
  args.push("-");
  process.stderr.write(`Reviewing ${target.label} with codex exec review\u2026
`);
  const review = await runCodexExec({
    args,
    cwd: repoRoot,
    input: prompt,
    outputPath,
    logPath,
    label: "codex exec review",
    outputNoun: "review"
  });
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}
Log: ${logPath}
`);
}

// package.json
var package_default = {
  name: "harry",
  version: "0.22.0",
  description: "Personal engineering workflow plugin distilled from Superpowers + ponytail, fused with multi-model review/debate.",
  type: "module",
  license: "MIT",
  author: "kiraxie <kiraxie11287@gmail.com>",
  homepage: "https://github.com/kiraxie/harry",
  repository: "https://github.com/kiraxie/harry",
  engines: {
    node: ">=26.0.0"
  },
  packageManager: "pnpm@12.5.1",
  scripts: {
    build: "node build.mjs",
    test: "node --test",
    typecheck: "tsc -p tsconfig.json --noEmit",
    lint: "biome check .",
    format: "biome format --write .",
    "install-laws": "node scripts/install.mjs",
    "install-laws-codex": "node scripts/install-codex.mjs",
    "init-ignore": "node scripts/init.mjs",
    evals: "node scripts/run-evals.mjs"
  },
  dependencies: {},
  devDependencies: {
    "@biomejs/biome": "^2.5.14",
    "@types/node": "^26.6.2",
    esbuild: "^0.28.2",
    typescript: "^7.0.2"
  }
};

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
  const lines = `${String(res.stderr ?? "")}
${String(res.stdout ?? "")}`.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return { missing: false, status: res.status, lines };
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
  const lines = [];
  lines.push(`## Codex Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(`**Availability:** ${available ? `available \u2014 codex-cli ${version}` : "unavailable"}`);
  lines.push(`**Status:** ${loggedIn ? "Authenticated" : "Not authenticated"}`);
  lines.push(`**Detail:** ${detail}`);
  if (!available) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Install the Codex CLI, run `codex login`, then re-run setup.");
  } else if (!loggedIn) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Run `codex login` to authenticate, then re-run setup.");
  }
  console.log(lines.join("\n"));
}

// src/lib/args.ts
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["help", "json", "architecture"]);
var KNOWN_FLAGS = {
  setup: /* @__PURE__ */ new Set(["json"]),
  review: /* @__PURE__ */ new Set(["base", "reasoning", "context", "architecture"]),
  ask: /* @__PURE__ */ new Set(["task", "reasoning", "context"])
};
function assertKnownFlags(command, flags) {
  const allowed = KNOWN_FLAGS[command];
  if (!allowed) return;
  for (const key of Object.keys(flags)) {
    if (key === "help") continue;
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag --${key} for '${command}'. Run 'companion help' for usage.`);
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
        const key2 = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(key2)) {
          const lc = value.toLowerCase();
          if (lc === "" || lc === "true" || lc === "1" || lc === "yes") {
            flags[key2] = true;
          } else if (lc === "false" || lc === "0" || lc === "no") {
            flags[key2] = false;
          } else {
            throw new Error(
              `Flag --${key2} is boolean and cannot take value "${value}". Use --${key2} or --no-${key2}.`
            );
          }
          continue;
        }
        flags[key2] = value;
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }
  return { command, args, flags };
}
function flagEnum(flags, key, allowed) {
  const v = flags[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string") {
    throw new Error(`Flag --${key} requires a value (one of: ${allowed.join(", ")}).`);
  }
  if (!allowed.includes(v)) {
    throw new Error(`Invalid --${key} value "${v}". Expected one of: ${allowed.join(", ")}.`);
  }
  return v;
}
function extractTask(args, flags) {
  const positional = args.join(" ").trim();
  if (positional) return positional;
  const flag = flags.task;
  return typeof flag === "string" ? flag.trim() : "";
}
function flagRequiredString(flags, key) {
  const v = flags[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string") throw new Error(`Flag --${key} requires a value.`);
  if (v.trim() === "") throw new Error(`Flag --${key} requires a value; got an empty one.`);
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
      "                   [--context <text|@file|@->] [--architecture] [focus...]",
      '  companion ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec review`",
      "  ask         Ask a single prompt (read-only) and print the answer"
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
        architecture: flags.architecture === true,
        focusText: args.join(" ")
      });
      break;
    }
    case "ask": {
      await runAsk(import_node_process.default.cwd(), {
        prompt: extractTask(args, flags),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context")
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

/**
 * The one place the companion spawns the Codex CLI (`spawnCodexSync`, also used by
 * `setup`), and the one-shot run
 * (`codex exec …`, `codex exec review …`).
 *
 * Every run gets its own output file plus a `.log` beside it. codex writes its
 * whole session transcript to stderr (prompt echo, every command's output) —
 * hundreds of KB on a real run — so stderr goes to the log, never to the
 * caller; a failure prints only the error lines of the log's tail, where codex
 * puts its `ERROR:` line, and names the log.
 *
 * No fallback anywhere: a missing CLI, a non-zero exit, or an absent/empty
 * output file each throw.
 */

import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, win32 } from "node:path";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

export const CODEX_CLI_MISSING =
  "The Codex CLI was not found on PATH. Install it and run `codex login`, then retry.";

export interface CodexSpawn {
  command: string;
  args: string[];
  shell: boolean;
}

/** cmd.exe metacharacters; each is caret-escaped so cmd never enters a quoted state. */
const CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Quote one argument for a cmd.exe command line that runs npm's `codex.cmd`
 * shim (the cross-spawn algorithm, after https://qntm.org/cmd): escape it for
 * the C runtime's argv split, wrap it in quotes, then caret-escape every cmd
 * metacharacter twice — once for cmd's parse of the `/c` line, once for the
 * shim's `%*` re-expansion.
 */
function quoteWindowsArg(arg: string): string {
  const crt = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return crt.replace(CMD_META_RE, "^$1").replace(CMD_META_RE, "^$1");
}

/** A Windows env lookup: variable names are case-insensitive there (`Path`, `PATH`). */
function winEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * What to spawn for `codex`. Off Windows: `codex`, left to the OS's PATH search.
 * On Windows: the first `<PATH entry>\codex<PATHEXT ext>` that exists, in PATH
 * order then PATHEXT order (default `.COM;.EXE;.BAT;.CMD`), or null when there is
 * none. The current directory is not searched.
 */
export function resolveCodex(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string | null {
  if (platform !== "win32") return "codex";
  const split = (v: string): string[] =>
    v
      .split(";")
      .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
      .filter((s) => s !== "");
  const exts = split(winEnv(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD");
  for (const dir of split(winEnv(env, "PATH") ?? "")) {
    for (const ext of exts) {
      const candidate = win32.join(dir, `codex${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * How to spawn `codex` with `args` on `platform`, or null when Windows has no
 * `codex` on PATH. Off Windows: the binary directly. On Windows the resolved
 * file decides: a native executable (`codex.exe`) is spawned directly with its
 * argv untouched; a `.cmd`/`.bat` shim (npm's `codex.cmd`), which Node cannot
 * spawn without a shell, becomes one cmd.exe command line — the shim path
 * caret-escaped once, each argument quoted by {@link quoteWindowsArg} (Node adds
 * no quoting of its own under `shell: true`). Callers keep the prompt on stdin,
 * never on this line.
 *
 * DEBT: both Windows paths are verified only against a fake filesystem and a
 * simulated cmd.exe/CRT round trip (tests/run-codex.test.ts), never on a real
 * Windows install. Known cmd.exe limits on the shim path, not handled: a UNC
 * `cwd` makes cmd fall back to `C:\Windows`, and registry-enabled delayed
 * expansion turns a `!` in a path into a variable reference. Upgrade path: a
 * Windows CI job running the companion against a real `npm i -g @openai/codex`
 * and a native `codex.exe`.
 */
export function codexSpawn(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): CodexSpawn | null {
  const command = resolveCodex(env, platform, exists);
  if (command === null) return null;
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args: [...args], shell: false };
  }
  const line = [command.replace(CMD_META_RE, "^$1"), ...args.map(quoteWindowsArg)].join(" ");
  return { command: line, args: [], shell: true };
}

/**
 * Whether a spawn result means codex is not installed: ENOENT, which
 * {@link spawnCodexSync} also reports when Windows resolves no `codex`. A cmd.exe
 * exit 9009 is deliberately not one — the shim was resolved first, so 9009 means
 * something the shim runs (e.g. `node`) is missing, and the log names it.
 */
export function codexMissing(res: { error?: Error; status: number | null }): boolean {
  return (res.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** `spawnSync` for codex, through {@link codexSpawn} — the one place either command spawns it. */
export function spawnCodexSync(
  args: readonly string[],
  options: Omit<SpawnSyncOptions, "shell">,
): SpawnSyncReturns<string | Buffer> {
  const spec = codexSpawn(args, process.platform, options.env ?? process.env);
  if (spec === null) {
    const error = Object.assign(new Error("spawnSync codex ENOENT"), {
      code: "ENOENT",
      syscall: "spawnSync codex",
      path: "codex",
    });
    return { pid: 0, output: [], stdout: "", stderr: "", status: null, signal: null, error };
  }
  return spawnSync(spec.command, spec.args, { ...options, shell: spec.shell, windowsHide: true });
}

/** How much of codex's log a failure prints — enough to carry its closing `ERROR:` line. */
const FAILURE_TAIL_LINES = 40;

/**
 * What a failure prints in place of error lines when the log's tail has none.
 * The doors quote it verbatim, so it names no tail size that could drift.
 */
export const NO_ERROR_LINE = "No error line at the end of codex's log.";

function timestamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * One output file per run: `<prefix>-<YYYYMMDD-HHMMSS>[-N].md` plus the
 * matching `.log`, so a re-run never clobbers an earlier one and a failed run
 * can never print an older output. A stem is taken when either file exists; the
 * log is created exclusively (`wx`, mode 0600) to claim the stem against a
 * concurrent run.
 */
export function reserveRunFiles(
  dir: string,
  prefix: string,
  now: Date = new Date(),
): { outputPath: string; logPath: string } {
  const base = `${prefix}-${timestamp(now)}`;
  for (let n = 1; ; n++) {
    const stem = join(dir, n === 1 ? base : `${base}-${n}`);
    const outputPath = `${stem}.md`;
    const logPath = `${stem}.log`;
    if (existsSync(outputPath)) continue;
    try {
      // Owner-only: the log is codex's transcript, which echoes files the model read.
      closeSync(openSync(logPath, "wx", 0o600));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    return { outputPath, logPath };
  }
}

/** Why a codex run failed. `missing`: never started (its log is removed). */
export type CodexFailureKind = "missing" | "exit" | "empty";

export class CodexRunError extends Error {
  readonly kind: CodexFailureKind;
  /** The run's log; absent for `missing`, whose empty log is deleted. */
  readonly logPath?: string;
  /** The exit code for `exit` (null when killed by a signal). */
  readonly exitStatus?: number | null;

  constructor(
    message: string,
    kind: CodexFailureKind,
    extra: { logPath?: string; exitStatus?: number | null } = {},
  ) {
    super(message);
    this.name = "CodexRunError";
    this.kind = kind;
    this.logPath = extra.logPath;
    this.exitStatus = extra.exitStatus;
  }
}

/**
 * The log's last {@link FAILURE_TAIL_LINES} lines — where codex puts its closing
 * `ERROR:` line. A lone CR ends a line too: a line redrawn in place must not
 * carry what follows its CR onto an error line.
 */
function logTail(logPath: string): string[] {
  const lines = readFileSync(logPath, "utf8").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-FAILURE_TAIL_LINES);
}

/** The most bytes a failure prints of any one log line, marker included. */
const MAX_LINE_BYTES = 1000;

const TRUNCATED = "…[truncated]";

/**
 * Cut `line` to at most {@link MAX_LINE_BYTES} UTF-8 bytes, ending in
 * `…[truncated]` when cut. Walks whole code points, so the cut never splits one.
 */
export function capLogLine(line: string): string {
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

/**
 * An error-shaped log line: codex's closing `ERROR:`, a pre-run `Error: …`, or
 * clap's `error: …`. Exact prefixes at column 0 of the raw line only — anything
 * looser (an indented `error:` in a JSON or YAML file codex echoed) lets the
 * transcript, which echoes files the model read, `.env` included, back out.
 */
const ERROR_LINE_RE = /^(?:ERROR|Error|error):/;

/**
 * Every control character except tab: C0, DEL and C1. Stripped from a printed
 * line so no terminal escape (ANSI/OSC, 7- or 8-bit) reaches the caller.
 */
const CONTROL_RE = /[^\P{Cc}\t]/gu;

/**
 * The error lines of the log's tail, matched at column 0 of the raw line, with
 * control characters and trailing whitespace dropped.
 */
function tailErrorLines(logPath: string): string[] {
  return logTail(logPath)
    .filter((l) => ERROR_LINE_RE.test(l))
    .map((l) => l.replace(CONTROL_RE, "").trimEnd());
}

/**
 * Print the error lines of the log's tail, then its path, for a failed run.
 * Only error lines: the rest of the tail is transcript, and the caller's
 * stderr lands in its own transcript.
 */
function reportLogTail(logPath: string): void {
  const errors = tailErrorLines(logPath).map(capLogLine);
  const lines = errors.length > 0 ? errors : [NO_ERROR_LINE];
  process.stderr.write(`${lines.join("\n")}\nLog: ${logPath}\n`);
}

/**
 * The log after a spawn error: removed when codex never wrote to it (nothing
 * would name it), otherwise kept and reported like any failed run's.
 */
function reportSpawnErrorLog(logPath: string): void {
  const size = statSync(logPath, { throwIfNoEntry: false })?.size;
  if (size === undefined) return;
  if (size === 0) rmSync(logPath, { force: true });
  else reportLogTail(logPath);
}

/**
 * The last `ERROR:` line in the log's tail, if any. Only the tail: earlier in
 * the transcript an `ERROR:` line is output of a command the model ran (a grep,
 * a test log), not codex's own failure. Capped by {@link capLogLine}.
 */
export function lastErrorLine(logPath: string): string | undefined {
  let errors: string[];
  try {
    errors = tailErrorLines(logPath);
  } catch {
    return undefined;
  }
  const last = errors.filter((l) => l.startsWith("ERROR:")).at(-1);
  return last === undefined ? undefined : capLogLine(last);
}

export interface CodexExecInput {
  /** Arguments after `codex`; must carry `-o <outputPath>`. */
  args: string[];
  cwd: string;
  /** Sent on stdin (the prompt, with a trailing `-` in `args`). */
  input: string;
  outputPath: string;
  logPath: string;
  /** Names the run in failure messages, e.g. `codex exec review`. */
  label: string;
  /** Names what `-o` should hold, e.g. `review`. */
  outputNoun: string;
}

/**
 * Spawn codex and return the non-empty contents of its `-o` file. On `exit` and
 * `empty` failures the log tail's error lines and `Log:` path are already on
 * stderr when the {@link CodexRunError} is thrown. Any other spawn error is
 * rethrown as is, after the same report when codex wrote to its log.
 */
export function runCodexExec(opts: CodexExecInput): string {
  // stdout is ignored: codex echoes its final message there, and the output is
  // read from the -o file instead.
  const logFd = openSync(opts.logPath, "w", 0o600);
  let res: SpawnSyncReturns<string | Buffer>;
  try {
    res = spawnCodexSync(opts.args, {
      cwd: opts.cwd,
      input: opts.input,
      stdio: ["pipe", "ignore", logFd],
    });
  } finally {
    closeSync(logFd);
  }
  if (codexMissing(res)) {
    // codex never ran, so the reserved log holds nothing of codex's and nothing names it.
    rmSync(opts.logPath, { force: true });
    throw new CodexRunError(CODEX_CLI_MISSING, "missing");
  }
  narrowOutput(opts.outputPath);
  // A codex that ran and exited non-zero failed on its own terms: an EPIPE from
  // it exiting before reading its prompt (clap rejecting argv) is only a symptom,
  // so that case takes the exit path below, where its error line is reported.
  if (res.error && (res.status === null || res.status === 0)) {
    reportSpawnErrorLog(opts.logPath);
    throw res.error;
  }
  if (res.status !== 0) {
    reportLogTail(opts.logPath);
    throw new CodexRunError(
      `${opts.label} failed (${res.status === null ? `signal ${res.signal}` : `exit ${res.status}`}).`,
      "exit",
      { logPath: opts.logPath, exitStatus: res.status },
    );
  }

  const output = existsSync(opts.outputPath) ? readFileSync(opts.outputPath, "utf8") : "";
  if (!output.trim()) {
    reportLogTail(opts.logPath);
    throw new CodexRunError(
      `${opts.label} exited 0 but wrote no ${opts.outputNoun} to ${opts.outputPath}.`,
      "empty",
      { logPath: opts.logPath },
    );
  }
  return output;
}

/**
 * Narrow the `-o` file to owner-only (0600) once codex has run, whether the run
 * succeeded or not: codex creates it with its own umask, and it can quote files
 * the model read. No file (codex never wrote one) is not an error.
 */
function narrowOutput(outputPath: string): void {
  try {
    chmodSync(outputPath, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

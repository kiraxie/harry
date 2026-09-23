/**
 * The one place the companion spawns the Codex CLI: `spawnCodexSync` for
 * `setup`'s quick queries, `spawnCodex` for the one-shot run (`codex exec …`,
 * `codex exec review …`) with signal forwarding, and `runCodexExec`'s failure
 * handling. Both spawn the absolute path `resolveOnPath` finds, never the bare
 * name (execvp would search the cwd); finding `codex` on PATH lives in
 * `path-search.ts`; the run files it writes into live in `run-files.ts`.
 *
 * codex writes its whole session transcript to stderr (prompt echo, every
 * command's output) — hundreds of KB on a real run — so stderr goes to the run's
 * log, never to the caller; a failure prints only the error lines of the log's
 * tail, where codex puts its `ERROR:` line, and names the log.
 *
 * No fallback anywhere: a missing CLI, a non-zero exit, or an absent/empty
 * output file each throw.
 */

import { type SpawnSyncOptions, type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from "node:fs";

import { notFoundError, resolveOnPath } from "./path-search.ts";
import { narrowOutput } from "./run-files.ts";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

export const CODEX_CLI_MISSING =
  "The Codex CLI was not found on PATH. Install it and run `codex login`, then retry.";

/**
 * Whether a spawn result means codex is not installed: ENOENT, which
 * {@link spawnCodex} and {@link spawnCodexSync} also report when PATH holds no
 * `codex`. A non-zero exit is never one: codex ran and failed on its own terms.
 */
export function codexMissing(res: { error?: Error; status: number | null }): boolean {
  return (res.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** The ENOENT a spawn reports when PATH holds no `codex` (see {@link codexMissing}). */
function codexNotFound(syscall: string): Error {
  return notFoundError(syscall, "codex");
}

/**
 * `spawnSync` for codex: `setup`'s short queries. A long run goes through
 * {@link spawnCodex}, which a signal can interrupt.
 */
export function spawnCodexSync(
  args: readonly string[],
  options: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer> {
  const command = resolveOnPath("codex", options.env ?? process.env);
  if (command === null) {
    const error = codexNotFound("spawnSync codex");
    return { pid: 0, output: [], stdout: "", stderr: "", status: null, signal: null, error };
  }
  return spawnSync(command, args, options);
}

/** How a {@link spawnCodex} run ended, in `spawnSync`'s terms. */
export interface CodexResult {
  /** The exit code; null when codex never started or was killed by a signal. */
  status: number | null;
  signal: NodeJS.Signals | null;
  /** A spawn error (codex never started), else a stdin write error such as EPIPE. */
  error?: Error;
}

/** The termination signals a companion passes on to its running codex. */
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];

/**
 * Run codex with `input` on stdin, stdout ignored and stderr to `logFd`, and
 * resolve once it has exited. Asynchronous, unlike `spawnSync`, so the
 * companion can act on a signal while codex runs: a SIGTERM, SIGINT or SIGHUP
 * (e.g. a Bash tool timeout) is sent on to codex, and then re-raised on the
 * companion, which dies by it as it would unhandled — even when the send fails.
 *
 * DEBT: the signal reaches codex's own pid only. The real codex CLI (an npm
 * node launcher) forwards it to its native binary itself, but anything codex
 * leaves running outside that chain survives. Upgrade path: spawn codex as its
 * own process group and signal the group — at the cost of taking codex out of
 * the terminal's foreground group, so Ctrl-C would reach it only through us.
 */
export function spawnCodex(
  args: readonly string[],
  options: { cwd: string; input: string; logFd: number; env?: NodeJS.ProcessEnv },
): Promise<CodexResult> {
  const command = resolveOnPath("codex", options.env ?? process.env);
  if (command === null) {
    return Promise.resolve({ status: null, signal: null, error: codexNotFound("spawn codex") });
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "ignore", options.logFd],
    });
    const forward = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal);
      } catch {
        // Undeliverable here: codex is left running, but the companion must still
        // die by the signal rather than by an uncaught exception in this handler.
      }
      stopForwarding();
      // No listener is left, so the default action applies: the companion dies by it.
      process.kill(process.pid, signal);
    };
    const stopForwarding = (): void => {
      for (const s of FORWARDED_SIGNALS) process.off(s, forward);
    };
    for (const s of FORWARDED_SIGNALS) process.on(s, forward);

    let spawnError: Error | undefined;
    let stdinError: Error | undefined;
    child.on("error", (err) => {
      spawnError ??= err;
    });
    // A codex exiting before it reads its prompt makes this write fail (EPIPE).
    child.stdin?.on("error", (err) => {
      stdinError ??= err;
    });
    child.stdin?.end(options.input);
    // `close` follows a spawn error too, and comes after stdin's own error.
    child.on("close", (code, signal) => {
      stopForwarding();
      resolve({
        status: spawnError ? null : code,
        signal,
        error: spawnError ?? stdinError,
      });
    });
  });
}

/** How much of codex's log a failure prints — enough to carry its closing `ERROR:` line. */
const FAILURE_TAIL_LINES = 40;

/**
 * What a failure prints in place of error lines when the log's tail has none.
 * The doors quote it verbatim, so it names no tail size that could drift.
 */
export const NO_ERROR_LINE = "No error line at the end of codex's log.";

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
export async function runCodexExec(opts: CodexExecInput): Promise<string> {
  // stdout is ignored: codex echoes its final message there, and the output is
  // read from the -o file instead.
  const logFd = openSync(opts.logPath, "w", 0o600);
  let res: CodexResult;
  try {
    res = await spawnCodex(opts.args, { cwd: opts.cwd, input: opts.input, logFd });
  } finally {
    closeSync(logFd);
  }
  if (codexMissing(res)) {
    // codex never ran, so the reserved log holds nothing of codex's and nothing names it.
    rmSync(opts.logPath, { force: true });
    throw new CodexRunError(CODEX_CLI_MISSING, "missing");
  }
  // A codex that ran and exited non-zero failed on its own terms: an EPIPE from
  // it exiting before reading its prompt (clap rejecting argv) is only a symptom,
  // so that case takes the exit path below, where its error line is reported.
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
      { logPath: opts.logPath, exitStatus: res.status },
    );
  }

  const output = existsSync(opts.outputPath) ? readFileSync(opts.outputPath, "utf8") : "";
  if (!output.trim()) {
    reportLogTail(opts.logPath);
    reportNarrowFailure(opts.outputPath);
    throw new CodexRunError(
      `${opts.label} exited 0 but wrote no ${opts.outputNoun} to ${opts.outputPath}.`,
      "empty",
      { logPath: opts.logPath },
    );
  }
  // Loud: a run whose output may stay readable by others does not succeed.
  narrowOutput(opts.outputPath);
  return output;
}

/**
 * {@link narrowOutput} for a failed run, after its codex failure is reported: a
 * narrow error is printed in addition, since the file may be readable by others,
 * and never replaces the codex failure the caller throws next.
 */
function reportNarrowFailure(outputPath: string): void {
  try {
    narrowOutput(outputPath);
  } catch (err) {
    process.stderr.write(
      `Could not narrow ${outputPath} to owner-only (0600): ${(err as Error).message}\n`,
    );
  }
}

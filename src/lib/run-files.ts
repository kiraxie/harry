import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

/**
 * The timestamp in every run-file stem, local time. The one statement of the
 * run-file name: {@link runFileStem} fills it in, {@link runFilePattern} matches
 * it, so pruning can never drift from what reserving writes. `MM` is the month,
 * `mm` the minute.
 */
const STAMP = "YYYYMMDD-hhmmss";

const OUTPUT_EXT = ".md";
const LOG_EXT = ".log";

function runFileStem(prefix: string, now: Date, n: number): string {
  const p = (v: number, width = 2): string => String(v).padStart(width, "0");
  const fields: Record<string, string> = {
    YYYY: p(now.getFullYear(), 4),
    MM: p(now.getMonth() + 1),
    DD: p(now.getDate()),
    hh: p(now.getHours()),
    mm: p(now.getMinutes()),
    ss: p(now.getSeconds()),
  };
  const stamp = STAMP.replace(/YYYY|MM|DD|hh|mm|ss/g, (f) => fields[f]);
  return `${prefix}-${stamp}${n === 1 ? "" : `-${n}`}`;
}

function runFilePattern(prefix: string): RegExp {
  const literal = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stamp = STAMP.replace(/[A-Za-z]/g, "\\d");
  const ext = [OUTPUT_EXT, LOG_EXT].map(literal).join("|");
  return new RegExp(`^${literal(prefix)}-${stamp}(?:-\\d+)?(?:${ext})$`);
}

/**
 * A fresh stem per run, so a re-run never clobbers an earlier one and a failed
 * run can never print an older output. A stem is taken when either file exists;
 * the log is created exclusively (`wx`, mode 0600) to claim the stem against a
 * concurrent run.
 */
export function reserveRunFiles(
  dir: string,
  prefix: string,
  now: Date = new Date(),
): { outputPath: string; logPath: string } {
  for (let n = 1; ; n++) {
    const stem = join(dir, runFileStem(prefix, now, n));
    const outputPath = `${stem}${OUTPUT_EXT}`;
    const logPath = `${stem}${LOG_EXT}`;
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

export function pruneRunFiles(
  dir: string,
  prefix: string,
  maxAgeMs: number,
  now: number = Date.now(),
): void {
  const runFile = runFilePattern(prefix);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!runFile.test(name)) continue;
    const path = join(dir, name);
    try {
      const st = lstatSync(path);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) rmSync(path);
    } catch {
      // Best-effort: a prune failure must never fail the run that triggered it.
    }
  }
}

/**
 * Narrow the `-o` file to owner-only (0600) once codex has run, whether the run
 * succeeded or not: codex creates it with its own umask, and it can quote files
 * the model read. No file (codex never wrote one) is not an error.
 */
export function narrowOutput(outputPath: string): void {
  try {
    chmodSync(outputPath, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

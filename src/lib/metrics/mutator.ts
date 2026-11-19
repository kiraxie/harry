import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { pluginRoot } from "../plugin-root.ts";
import { parseEdn } from "./edn.ts";
import { throwIfInterrupted } from "./interrupt.ts";
import { byPath } from "./scope.ts";
import { failureTail, runTool, type Tool, toolCwd } from "./tools.ts";

/** One mutant mutator ran, with the outcome its snapshot recorded. */
export interface Outcome {
  file: string;
  line: number;
  original: string;
  mutant: string;
  form: string;
  survived: boolean;
}

/** A mutation site `mutator --scan` lists; `file` is relative to the scanned root. */
export interface Site {
  file: string;
  line: number;
}

export interface MutatorRun {
  /** Null runs mutator's default for the language. */
  testCommand: string | null;
  /** Only mutations on these lines run; null runs every site. */
  lines: number[] | null;
  maxWorkers: number | null;
}

/** A site's identity: its file and line. */
export const siteKey = (s: Site) => `${s.file}:${s.line}`;

function lineAt(dir: string, file: string, byte: number): number {
  const buf = readFileSync(path.join(dir, file));
  let line = 1;
  for (let i = 0; i < byte && i < buf.length; i++) if (buf[i] === 0x0a) line++;
  return line;
}

function snapshots(dir: string): string[] {
  const root = path.join(dir, ".metrics", "mutate");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".edn"))
    .map((f) => path.join(root, f));
}

const SCAN_HEADER = /^Scan: (\d+) mutation sites in (.+)$/;
// Each site line opens with a two-character mark, "* " when its function changed since
// the last snapshot; mutator may close the list with a "* marks …" legend.
const SCAN_SITE = /^[* ] (.+?):(\d+) /;

/**
 * Parses `mutator --scan` output for the handed `files`: a file whose listed sites
 * disagree with its own count, or a handed file without exactly one header, is an error.
 */
function parseScan(stdout: string, files: string[], tail: string): Site[] {
  const sites: Site[] = [];
  const headers = new Map<string, number>();
  let current: { file: string; expected: number; listed: number } | null = null;
  const close = () => {
    if (current && current.listed !== current.expected) {
      throw new Error(
        `mutator --scan lists ${current.listed} sites in ${current.file} but counts ${current.expected}`,
      );
    }
  };
  for (const line of stdout.split("\n")) {
    const header = SCAN_HEADER.exec(line);
    if (header) {
      close();
      current = { file: header[2], expected: Number(header[1]), listed: 0 };
      headers.set(header[2], (headers.get(header[2]) ?? 0) + 1);
      continue;
    }
    const site = SCAN_SITE.exec(line);
    if (!site || current === null || site[1] !== current.file) continue;
    current.listed++;
    sites.push({ file: site[1], line: Number(site[2]) });
  }
  close();
  const missing = files.filter((f) => !headers.has(f));
  const repeated = files.filter((f) => (headers.get(f) ?? 0) > 1);
  if (missing.length > 0 || repeated.length > 0) {
    const why = [
      missing.length > 0 ? `printed no header for ${missing.join(", ")}` : "",
      repeated.length > 0 ? `printed more than one header for ${repeated.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`mutator --scan ${why.join(" and ")}\n${tail}`);
  }
  return sites;
}

/**
 * Lists the mutation sites in `files` (relative to `dir`) on `lines`, running no
 * test. A symlink is not handed: it has no sites of its own, and mutator reports
 * its target's path.
 */
function scanSites(tool: Tool, dir: string, handed: string[], lines: number[]): Site[] {
  const files = handed.filter((f) => !lstatSync(path.join(dir, f)).isSymbolicLink());
  if (files.length === 0 || lines.length === 0) return [];
  const run = runTool(tool, [
    "--root",
    dir,
    "--scan",
    "--no-coverage",
    "--lines",
    lines.join(","),
    ...files,
  ]);
  if (run.status !== 0) throw new Error(`mutator --scan exited ${run.status}\n${failureTail(run)}`);
  return parseScan(run.stdout, files, failureTail(run));
}

/**
 * Runs mutator over `files` (relative to `dir`) and returns every outcome its
 * snapshots record for them. Coverage comes from the report already on disk,
 * never from mutator's own coverage run, which installs packages.
 */
export function runMutator(
  tool: Tool,
  dir: string,
  files: string[],
  coverage: boolean,
  opts: MutatorRun,
): Outcome[] {
  const args = ["--root", dir, coverage ? "--use-existing-coverage" : "--no-coverage"];
  if (opts.testCommand !== null) args.push("--test-command", opts.testCommand);
  if (opts.lines !== null) args.push("--lines", opts.lines.join(","));
  if (opts.maxWorkers !== null) args.push("--max-workers", String(opts.maxWorkers));
  const run = runTool(tool, [...args, ...files]);
  if (run.status === 2) throw new Error(`baseline tests fail\n${failureTail(run)}`);
  if (run.status !== 0 && run.status !== 3) {
    throw new Error(`mutator exited ${run.status}\n${failureTail(run)}`);
  }
  const wanted = new Set(files);
  const outcomes: Outcome[] = [];
  for (const snap of snapshots(dir)) {
    const data = parseEdn(readFileSync(snap, "utf8")) as { outcomes?: Record<string, string> };
    for (const [id, outcome] of Object.entries(data.outcomes ?? {})) {
      const [file, , form, start, , original, mutant] = JSON.parse(id) as [
        string,
        string,
        string,
        number,
        number,
        string,
        string,
      ];
      if (!wanted.has(file)) continue;
      outcomes.push({
        file,
        line: lineAt(dir, file, start),
        original,
        mutant,
        form,
        survived: outcome === "survived",
      });
    }
  }
  return outcomes.sort((a, b) => byPath(a.file, b.file) || a.line - b.line);
}

export function renderSurvivor(s: Outcome, where: string): string {
  const fn = s.form.replace(/^defn-?\//, "");
  const mutation =
    s.mutant === "" ? `delete \`${s.original}\`` : `\`${s.original}\` → \`${s.mutant}\``;
  return `- ${where} ${mutation} in ${fn}`;
}

export interface ChangedScan {
  /** Every site the scan lists: the changed files' sites on any changed line number of the dir. */
  scanned: Site[];
  /** The scanned sites on a line their own file changed. */
  onChanged: Site[];
}

/**
 * Scans the files in `changedByFile` (relative to `dir`, each with its changed
 * lines). Mutator takes one `--lines` set for every handed file, so the scan
 * hands the union and `onChanged` keeps each file's own changed lines.
 */
export function scanChanged(
  tool: Tool,
  dir: string,
  changedByFile: Map<string, Set<number>>,
): ChangedScan {
  const files = [...changedByFile].filter(([, lines]) => lines.size > 0).map(([f]) => f);
  const on = (file: string) => changedByFile.get(file) ?? new Set<number>();
  const lines = [...new Set(files.flatMap((f) => [...on(f)]))].sort((a, b) => a - b);
  const scanned = scanSites(tool, dir, files, lines);
  return { scanned, onChanged: scanned.filter((s) => on(s.file).has(s.line)) };
}

/** What a run hands mutator for `selected`: the files holding one, and the line numbers they sit on. */
function handed(selected: Site[]): { files: string[]; lines: number[] } {
  return {
    files: [...new Set(selected.map((s) => s.file))].sort(byPath),
    lines: [...new Set(selected.map((s) => s.line))].sort((a, b) => a - b),
  };
}

/**
 * Per file handed for `selected`, the scanned sites mutator executes: one
 * `--lines` set serves every handed file, so a file also runs its sites on line
 * numbers that carry a selected site only in another handed file.
 */
function handOff(scanned: Site[], selected: Site[]): Map<string, number> {
  const { files, lines } = handed(selected);
  const executed = new Map<string, number>(files.map((f) => [f, 0]));
  const onLine = new Set(lines);
  for (const s of scanned) {
    const n = executed.get(s.file);
    if (n !== undefined && onLine.has(s.line)) executed.set(s.file, n + 1);
  }
  return executed;
}

/** A handed file mutator's worker cannot measure, so mutator never runs it. */
export interface NotMeasured {
  file: string;
  reason: string;
  /** The worker baseline's output tail; empty for an unseen file. */
  tail: string;
}

export const NOT_MEASURED = {
  baseline: "not measured: tests fail in mutator's worker without a mutant",
  unseen: "not measured: no test sees this file in mutator's worker",
} as const;

/** The overlay check runs the test command twice per handed file: the worker baseline, then the canary. */
export const OVERLAY_CHECK_RUNS = 2;

const OVERLAY_VERDICTS = { baseline: ["pass", "fail"], canary: ["pass", "fail"] } as const;

/**
 * Checks `file` (relative to `dir`) in one worker that mutator's own code builds
 * (src/lib/metrics/overlay-check.py): a red worker baseline, or a canary that
 * breaks the file and leaves the tests green, means mutator's outcomes for it
 * would be false kills or false survivors. Null when mutator can measure it.
 * A check that exits non-zero or prints no verdict throws, as a mutator failure does.
 */
function checkOverlay(
  tool: Tool,
  dir: string,
  file: string,
  testCommand: string | null,
): NotMeasured | null {
  const script = path.join(pluginRoot(), "src", "lib", "metrics", "overlay-check.py");
  const res = spawnSync(tool.python, [script, dir, file, testCommand ?? ""], {
    cwd: toolCwd(tool),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  throwIfInterrupted(res);
  if (res.error) throw res.error;
  const run = { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  const verdict = run.status === 0 ? parseVerdict(run.stdout) : null;
  if (verdict === null) {
    throw new Error(
      `overlay check of ${file} exited ${run.status} with no verdict\n${failureTail(run)}`,
    );
  }
  if (verdict.baseline === "fail")
    return { file, reason: NOT_MEASURED.baseline, tail: verdict.tail };
  if (verdict.canary === "pass") return { file, reason: NOT_MEASURED.unseen, tail: "" };
  return null;
}

function parseVerdict(stdout: string): { baseline: string; canary: string; tail: string } | null {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return null;
  }
  const v = parsed as Record<string, unknown> | null;
  if (
    v === null ||
    typeof v !== "object" ||
    !OVERLAY_VERDICTS.baseline.some((b) => b === v.baseline) ||
    !OVERLAY_VERDICTS.canary.some((c) => c === v.canary) ||
    typeof v.tail !== "string"
  ) {
    return null;
  }
  return { baseline: v.baseline as string, canary: v.canary as string, tail: v.tail };
}

export interface SelectedRun {
  /** Only the outcomes of the selected sites. */
  outcomes: Outcome[];
  /** Per file mutator ran, the outcomes it recorded, off-line sites included. */
  executedPerFile: Map<string, number>;
  /** The handed files the overlay check kept from mutator, by path. */
  notMeasured: NotMeasured[];
}

/**
 * Checks each file handed for `selected` in mutator's worker, then runs mutator
 * on the selected sites of the files it can measure; nothing runs when none is left.
 */
export function runSelected(
  tool: Tool,
  dir: string,
  selected: Site[],
  coverage: boolean,
  opts: Omit<MutatorRun, "lines">,
): SelectedRun {
  const notMeasured = handed(selected).files.flatMap((f) => {
    const v = checkOverlay(tool, dir, f, opts.testCommand);
    return v === null ? [] : [v];
  });
  const skipped = new Set(notMeasured.map((n) => n.file));
  const measured = selected.filter((s) => !skipped.has(s.file));
  const { files, lines } = handed(measured);
  const all = files.length === 0 ? [] : runMutator(tool, dir, files, coverage, { ...opts, lines });
  const wanted = new Set(measured.map(siteKey));
  return {
    outcomes: all.filter((o) => wanted.has(siteKey(o))),
    executedPerFile: new Map(files.map((f) => [f, all.filter((o) => o.file === f).length])),
    notMeasured,
  };
}

/**
 * Mutator's worker rule for one file (`worker_count` in its workers.py): the
 * fewest of the sites, the cores and an explicit --max-workers; each round runs
 * one mutant per worker. A file with nothing executed takes no worker.
 */
function roundsPerFile(
  executed: number,
  maxWorkers: number | null,
  cores: number,
): { workers: number; rounds: number } {
  if (executed === 0) return { workers: 0, rounds: 0 };
  const workers = Math.max(1, Math.min(executed, cores, maxWorkers ?? cores));
  return { workers, rounds: Math.ceil(executed / workers) };
}

/**
 * The mutator commit `runCost`, `mutatorCores` and the overlay check were read at.
 * `runCost` and `mutatorCores` copy three scheduling facts from it: workers per file
 * are `worker_count` (workers.py:75, sized by `os.cpu_count()`); files run one at a
 * time, with one baseline cache per invocation (cli.py:531); a baseline is cached by
 * command and cwd (engine.py:191). The executing skill's Workers bullet restates them.
 * The overlay check (src/lib/metrics/overlay-check.py) builds and runs a worker with
 * mutator's own internals: `ensure_crapper` (crapper_link.py); `CommandRunner` and
 * `test_plan` (runner.py); `create_workers`, `delete_tree`, `mapped_cwd` and
 * `new_run_dir` (workers.py). A test holds the mutator pin to this commit, so a pin
 * bump re-reads them all.
 */
export const SCHEDULE_READ_AT = "a5a0cb803b66e0cdb8bf471b3b08af701d424a41";

/** The core count mutator sizes its workers by: Python's `os.cpu_count()`. */
export function mutatorCores(): number {
  return os.cpus().length;
}

export interface FileCost {
  executed: number;
  workers: number;
  rounds: number;
}

export interface RunCost {
  /** Per handed file. */
  files: Map<string, FileCost>;
  /** Files run one at a time, so the run's rounds are the files' sum. */
  rounds: number;
  /** One per invocation that hands a file: one mutator call per group. */
  baselines: number;
  /** The overlay check's test-command runs, OVERLAY_CHECK_RUNS per handed file, one after another. */
  checkRuns: number;
}

/**
 * What one mutator run on `selected` costs, before coverage skips any line and
 * before the overlay check keeps any file from mutator.
 */
export function runCost(
  scanned: Site[],
  selected: Site[],
  maxWorkers: number | null,
  cores: number,
): RunCost {
  const files = new Map<string, FileCost>();
  let rounds = 0;
  for (const [file, executed] of handOff(scanned, selected)) {
    const cost = { executed, ...roundsPerFile(executed, maxWorkers, cores) };
    files.set(file, cost);
    rounds += cost.rounds;
  }
  return {
    files,
    rounds,
    baselines: files.size > 0 ? 1 : 0,
    checkRuns: files.size * OVERLAY_CHECK_RUNS,
  };
}

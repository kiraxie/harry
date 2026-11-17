import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseEdn } from "./edn.ts";
import { failureTail, runTool, type Tool } from "./tools.ts";

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
export function scanSites(tool: Tool, dir: string, handed: string[], lines: number[]): Site[] {
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
  return outcomes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function renderSurvivor(s: Outcome, where: string): string {
  const fn = s.form.replace(/^defn-?\//, "");
  const mutation =
    s.mutant === "" ? `delete \`${s.original}\`` : `\`${s.original}\` → \`${s.mutant}\``;
  return `- ${where} ${mutation} in ${fn}`;
}

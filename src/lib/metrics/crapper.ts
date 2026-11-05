import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { gitChecked } from "../git.ts";
import { parseEdn } from "./edn.ts";
import { throwIfInterrupted } from "./interrupt.ts";
import { failureTail, runTool, type Tool } from "./tools.ts";

export interface CrapEntry {
  name: string;
  namespace: string;
  complexity: number;
  coverage: number | null;
  crap: number | null;
}

export interface FunctionSpan {
  file: string;
  namespace: string;
  name: string;
  start: number;
  end: number;
}

export const CRAP_LIMIT = 10;

const key = (namespace: string, name: string) => `${namespace}\0${name}`;

/** Scores `files` (relative to `root`; none walks the whole of `root`) and returns crap.edn's entries. */
export function runCrapper(
  tool: Tool,
  root: string,
  files: string[],
  coverage: boolean,
): CrapEntry[] {
  const mode = coverage ? "--use-existing-coverage" : "--no-coverage";
  const run = runTool(tool, [mode, "--root", root, ...files], root);
  if (run.status !== 0) throw new Error(`crapper exited ${run.status}\n${failureTail(run)}`);
  const text = readFileSync(path.join(root, ".metrics", "crap.edn"), "utf8");
  const snap = parseEdn(text) as { entries?: CrapEntry[] };
  if (!Array.isArray(snap?.entries)) throw new Error("crap.edn has no :entries vector");
  return snap.entries;
}

const SPANS_SCRIPT = `
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

export function functionSpans(tool: Tool, root: string, files: string[]): FunctionSpan[] {
  const python = path.join(tool.dir, ".venv", "bin", "python");
  const res = spawnSync(python, ["-c", SPANS_SCRIPT, root, ...files], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  throwIfInterrupted(res);
  if (res.status !== 0) {
    throw new Error(
      `function spans failed (${python}): ${(res.stderr ?? res.error?.message ?? "").trim()}`,
    );
  }
  return JSON.parse(res.stdout) as FunctionSpan[];
}

/** New-side line ranges `git diff -U0` reports for one file; a pure deletion after line n is [n, n+1]. */
export function changedRanges(repo: string, base: string, file: string): [number, number][] {
  const diff = gitChecked(repo, ["diff", "-U0", "--no-renames", `${base}...HEAD`, "--", file]);
  const ranges: [number, number][] = [];
  for (const m of diff.stdout.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return ranges;
}

function touches(span: FunctionSpan, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => a <= span.end && b >= span.start);
}

export interface Judged {
  kind: "new" | "touched";
  entry: CrapEntry;
  span: FunctionSpan | undefined;
  before?: number;
}

/** CRAP when scored, else complexity: CRAP >= CC, so CC is its lower bound. */
function crapFloor(e: CrapEntry): number {
  return e.crap ?? e.complexity;
}

export function judge(
  after: CrapEntry[],
  before: Map<string, number>,
  spans: FunctionSpan[],
  rangesOf: (file: string) => [number, number][],
): Judged[] {
  const spanOf = new Map(spans.map((s) => [key(s.namespace, s.name), s]));
  const out: Judged[] = [];
  for (const entry of after) {
    const k = key(entry.namespace, entry.name);
    const span = spanOf.get(k);
    const old = before.get(k);
    if (old === undefined) {
      if (crapFloor(entry) >= CRAP_LIMIT) out.push({ kind: "new", entry, span });
      continue;
    }
    if (span === undefined || !touches(span, rangesOf(span.file))) continue;
    if (entry.complexity > old || crapFloor(entry) >= CRAP_LIMIT) {
      out.push({ kind: "touched", entry, span, before: old });
    }
  }
  return out;
}

export function beforeComplexity(entries: CrapEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [key(e.namespace, e.name), e.complexity]));
}

function scored(e: CrapEntry): string {
  return e.crap === null
    ? `CRAP ≥ ${e.complexity} (complexity only)`
    : `coverage ${(e.coverage ?? 0).toFixed(1)}%, CRAP ${e.crap.toFixed(1)}`;
}

export function renderJudged(j: Judged, where: (span: FunctionSpan) => string): string {
  const e = j.entry;
  const at = j.span ? ` ${where(j.span)}` : "";
  const cc = j.before === undefined ? `CC ${e.complexity}` : `CC ${j.before} → ${e.complexity}`;
  return `- ${j.kind} \`${e.name}\` (${e.namespace})${at} — ${cc}, ${scored(e)}`;
}

export function renderOverBar(
  entries: CrapEntry[],
  located?: { spans: FunctionSpan[]; where: (span: FunctionSpan) => string },
): string {
  const over = entries
    .filter((e) => crapFloor(e) >= CRAP_LIMIT)
    .sort((a, b) => crapFloor(b) - crapFloor(a));
  if (over.length === 0) return "No function crosses the bar.";
  const spanOf = new Map((located?.spans ?? []).map((s) => [key(s.namespace, s.name), s]));
  return over
    .map((e) => {
      const span = spanOf.get(key(e.namespace, e.name));
      const at = span && located ? ` ${located.where(span)}` : "";
      return `- \`${e.name}\` (${e.namespace})${at} — CC ${e.complexity}, ${scored(e)}`;
    })
    .join("\n");
}

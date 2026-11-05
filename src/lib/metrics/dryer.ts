import { readFileSync } from "node:fs";
import path from "node:path";

import { parseEdn } from "./edn.ts";
import { failureTail, runTool, type Tool } from "./tools.ts";

interface Span {
  file: string;
  "start-line": number;
  "end-line": number;
}

export interface Pair {
  score: number;
  left: Span;
  right: Span;
}

export const DRYER_SCOPE_NOTE =
  "dryer compares TypeScript (.ts .tsx .mts .cts), Java, Go, Rust, Python and Clojure; .js/.mjs files are not compared.";

export function runDryer(tool: Tool, dir: string): Pair[] {
  const run = runTool(tool, [], dir);
  if (run.status !== 0) throw new Error(`dryer exited ${run.status}\n${failureTail(run)}`);
  let text: string;
  try {
    text = readFileSync(path.join(dir, ".metrics", "dry.edn"), "utf8");
  } catch {
    if (/No source files to analyze/.test(run.stdout)) return [];
    throw new Error(`dryer wrote no .metrics/dry.edn\n${failureTail(run)}`);
  }
  const snap = parseEdn(text) as { candidates?: Pair[] };
  if (!Array.isArray(snap?.candidates)) throw new Error("dry.edn has no :candidates vector");
  return snap.candidates;
}

function span(s: Span): string {
  return `${s.file}:${s["start-line"]}-${s["end-line"]}`;
}

export function renderPairs(pairs: Pair[], empty: string): string {
  if (pairs.length === 0) return empty;
  return pairs
    .map((p) => `- score ${p.score.toFixed(2)}: ${span(p.left)} ↔ ${span(p.right)}`)
    .join("\n");
}

export function touching(pairs: Pair[], files: Set<string>): Pair[] {
  return pairs.filter((p) => files.has(p.left.file) || files.has(p.right.file));
}

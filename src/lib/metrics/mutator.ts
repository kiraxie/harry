import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseEdn } from "./edn.ts";
import { failureTail, runTool, type Tool } from "./tools.ts";

export interface Survivor {
  file: string;
  line: number;
  original: string;
  mutant: string;
  form: string;
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

/**
 * Runs mutator over `files` (relative to `dir`) and returns the surviving
 * mutants in them. Coverage comes from the report already on disk, never from
 * mutator's own coverage run, which installs packages.
 */
export function runMutator(
  tool: Tool,
  dir: string,
  files: string[],
  coverage: boolean,
  testCommand: string | null,
): Survivor[] {
  const args = ["--root", dir, coverage ? "--use-existing-coverage" : "--no-coverage"];
  if (testCommand !== null) args.push("--test-command", testCommand);
  const run = runTool(tool, [...args, ...files]);
  if (run.status === 2) throw new Error(`baseline tests fail\n${failureTail(run)}`);
  if (run.status !== 0 && run.status !== 3) {
    throw new Error(`mutator exited ${run.status}\n${failureTail(run)}`);
  }
  const wanted = new Set(files);
  const survivors: Survivor[] = [];
  for (const snap of snapshots(dir)) {
    const data = parseEdn(readFileSync(snap, "utf8")) as { outcomes?: Record<string, string> };
    for (const [id, outcome] of Object.entries(data.outcomes ?? {})) {
      if (outcome !== "survived") continue;
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
      survivors.push({ file, line: lineAt(dir, file, start), original, mutant, form });
    }
  }
  return survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function renderSurvivor(s: Survivor, where: string): string {
  const fn = s.form.replace(/^defn-?\//, "");
  const mutation =
    s.mutant === "" ? `delete \`${s.original}\`` : `\`${s.original}\` → \`${s.mutant}\``;
  return `- ${where} ${mutation} in ${fn}`;
}

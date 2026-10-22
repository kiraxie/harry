import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The one list of prose files and directories. Top-level files, directories and data
// files are split by whether a plugin build or the marketplace loads them; NOTICE has no
// split. Every prose scan derives its corpus from here, so a file or directory added or
// moved is seen by every scan that reads its kind, or by none. prose-refs keeps each
// side's data files under that side's dirs (the manifest dirs on the shipped side) equal
// to what git tracks there, minus the code exemption; a top-level data file is only
// checked for being tracked.
//
// PROSE_NON_MD_FILES (NOTICE and the data files in one list) goes to the scans whose
// rule is about what any file says to a reader: pipeline-stages (a stale stage),
// grilling-contract's cadence scan, prose-refs' path and citation checks, and
// review-cli's AC-11 scan (the codex subcommand); prose-refs' shipped .claude/ check
// reads the shipped data files. Scans of shipped markdown's own vocabulary or structure
// leave it out: upstream.json names the hoist dimension a cut-term scan would flag. A
// scan reads a file as raw text where its hits cite a line, and through proseStrings
// where its hits quote a string.
export const SHIPPED_TOP_LEVEL = ["HARRY.md"];
export const REPO_TOP_LEVEL = ["README.md", "CLAUDE.md"];
export const SHIPPED_PROSE_DIRS = ["skills", "commands", "codex-skills", "references", "agents"];
export const REPO_LOCAL_PROSE_DIRS = [".claude/commands", ".claude/references"];
export const REPO_LOCAL_DIRS = [...REPO_LOCAL_PROSE_DIRS, ".claude/scripts"];
export const PROSE_DIRS = [...SHIPPED_PROSE_DIRS, ...REPO_LOCAL_PROSE_DIRS];
export const SHIPPED_DATA_FILES = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "references/audit/report-schema.json",
];
export const REPO_LOCAL_DATA_FILES = ["upstream.json"];
export const PROSE_NON_MD_FILES = ["NOTICE", ...SHIPPED_DATA_FILES, ...REPO_LOCAL_DATA_FILES];

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const jsonStrings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(jsonStrings)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(jsonStrings)
        : [];

export const proseStrings = (rel: string): string[] => {
  const text = readFileSync(path.join(repoRoot, rel), "utf-8");
  return rel.endsWith(".json") ? jsonStrings(JSON.parse(text)) : [text];
};

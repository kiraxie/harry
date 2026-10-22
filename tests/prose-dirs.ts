import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The one list of prose files and directories. Top-level files, directories and data
// files are split by whether a plugin build or the marketplace loads them; NOTICE has no
// split. Every prose scan takes its corpus from here, built from one walk of the files
// git tracks, so a file or directory added or moved is seen by every scan that reads its
// kind, or by none, and an untracked file is seen by none.
//
// MARKDOWN_CORPUS is the top-level files and the markdown under PROSE_DIRS. READER_CORPUS
// adds PROSE_NON_MD_FILES (NOTICE and the data files) and goes to the scans whose rule is
// about what any file says to a reader: pipeline-stages (a stale stage), grilling-
// contract's cadence scan, prose-refs' path and citation checks, and review-cli's AC-11
// scan (the codex subcommand). Scans of shipped markdown's own vocabulary or structure
// leave the data files out: upstream.json names the hoist dimension a cut-term scan would
// flag. PROSE_DIR_FILES is every tracked file under PROSE_DIRS, for the scan that reads
// the code and data files there too. A scan reads a file as raw text where its hits cite
// a line, and through proseStrings where its hits quote a string.
//
// Only prose-refs reads the side lists of data files: it keeps each side's data files
// under that side's dirs (MANIFEST_DIRS on the shipped side) equal to what git tracks
// there, minus CODE_EXEMPTIONS.
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
export const MANIFEST_DIRS = [".claude-plugin", ".codex-plugin", ".agents"];
export const CODE_EXEMPTIONS = ["references/audit/validate-findings.cjs"];

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const gitFiles = (...args: string[]): string[] =>
  execFileSync("git", ["ls-files", "-z", ...args], { cwd: repoRoot, encoding: "utf-8" })
    .split("\0")
    .filter(Boolean);
const deleted = new Set(gitFiles("--deleted"));

export const PROSE_DIR_FILES = gitFiles("--", ...PROSE_DIRS).filter((rel) => !deleted.has(rel));
export const MARKDOWN_CORPUS = [
  ...SHIPPED_TOP_LEVEL,
  ...REPO_TOP_LEVEL,
  ...PROSE_DIR_FILES.filter((rel) => rel.endsWith(".md")),
];
export const READER_CORPUS = [...MARKDOWN_CORPUS, ...PROSE_NON_MD_FILES];

export const under =
  (dirs: string[]) =>
  (rel: string): boolean =>
    dirs.some((dir) => rel.startsWith(`${dir}/`));

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

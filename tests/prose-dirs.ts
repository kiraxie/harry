import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MARKDOWN_CORPUS leaves out READER_CORPUS's data files: upstream.json names cut terms.
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

export const under =
  (dirs: string[]) =>
  (rel: string): boolean =>
    dirs.some((dir) => rel.startsWith(`${dir}/`));

export const TRACKED_FILES = gitFiles().filter((rel) => !deleted.has(rel));
export const PROSE_DIR_FILES = TRACKED_FILES.filter(under(PROSE_DIRS));

const parentOf = (rel: string): string => path.posix.dirname(rel);
const isSkill = (rel: string): boolean => path.posix.basename(rel) === "SKILL.md";

export const TOP_LEVEL = [...SHIPPED_TOP_LEVEL, ...REPO_TOP_LEVEL];
export const MARKDOWN_CORPUS = [
  ...TOP_LEVEL,
  ...PROSE_DIR_FILES.filter((rel) => rel.endsWith(".md")),
];
export const SHIPPED_MARKDOWN = [
  ...SHIPPED_TOP_LEVEL,
  ...MARKDOWN_CORPUS.filter(under(SHIPPED_PROSE_DIRS)),
];
export const READER_CORPUS = [...MARKDOWN_CORPUS, ...PROSE_NON_MD_FILES];

export const inDir = (dir: string, corpus: string[] = MARKDOWN_CORPUS): string[] => {
  const files = corpus.filter((rel) => parentOf(rel) === dir);
  assert.ok(files.length > 0, `inDir("${dir}"): no corpus file directly in it`);
  return files;
};

export const filesUnder = (dir: string, corpus: string[] = MARKDOWN_CORPUS): string[] => {
  const files = corpus.filter(under([dir]));
  assert.ok(files.length > 0, `filesUnder("${dir}"): no corpus file under it`);
  return files;
};

export const skillFiles = (dir: string): string[] => {
  const files = MARKDOWN_CORPUS.filter((rel) => isSkill(rel) && parentOf(parentOf(rel)) === dir);
  assert.ok(files.length > 0, `skillFiles("${dir}"): no tracked ${dir}/<name>/SKILL.md`);
  return files;
};

export const COMMAND_FILES = inDir("commands");
export const CODEX_SKILL_FILES = skillFiles("codex-skills");

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

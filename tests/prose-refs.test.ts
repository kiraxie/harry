import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The plugin's real product is ~3,000 lines of markdown that an AI agent follows,
// full of file-path references (references/tier-gates.md, ${CLAUDE_PLUGIN_ROOT}/...,
// scripts/init.mjs). Nothing else verifies those paths exist — renames/deletes leave
// dangling references (this exact failure class was found twice in recent reviews).
// This test extracts candidate repo-relative paths from all prose and asserts each exists.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const TOP_LEVEL_FILES = ["HARRY.md", "README.md", "CLAUDE.md"];
const PROSE_DIRS = ["skills", "commands", "codex-skills", "references"];

function listMarkdownFiles(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

const proseFiles = [
  ...TOP_LEVEL_FILES.filter((f) => existsSync(path.join(repoRoot, f))),
  ...PROSE_DIRS.flatMap(listMarkdownFiles),
].filter((f) => f !== "CHANGELOG.md");

// Two reference shapes:
// 1. `${CLAUDE_PLUGIN_ROOT}/<path>` — path is everything after the prefix. Checked
//    everywhere (fenced or not) — this is how the plugin's own docs express real
//    runtime invocations (e.g. commands/init.md's `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"`).
// 2. Bare repo-relative mentions of known top-level dirs, with a recognized file
//    extension. Checked only OUTSIDE fenced code blocks — inside fences these are
//    frequently fabricated illustration (e.g. writing-plans/SKILL.md's fictional
//    `tests/auth/token.test.ts` example, or a skill-relative `scripts/start-server.sh`
//    shown as a shell snippet), not real cross-references. A `(?<!\/)` guard also
//    stops a longer real path like `src/commands/fix.ts` from being mis-sliced into
//    the shorter bare candidate `commands/fix.ts`.
const PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g;
const BARE_PATH_RE =
  /(?<!\/)\b(?:references|scripts|dist|tests|skills|commands|codex-skills)\/[\w./-]+\.(?:md|json|cjs|mjs|ts|sh)\b/g;
// Markdown fences nest by backtick-run length (CommonMark): a ```` fence isn't
// closed by a shorter ``` line inside it, so track the opening run length rather
// than a plain boolean toggle.
const FENCE_OPEN_RE = /^\s*(`{3,})/;

function isPlaceholder(candidate: string): boolean {
  if (candidate.includes(".local/")) return true;
  if (/[<>*$\\]/.test(candidate)) return true;
  if (candidate.split("/").includes("N")) return true;
  if (candidate.includes("YYYY")) return true;
  return false;
}

function extractCandidates(line: string, inFence: boolean): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(PLUGIN_ROOT_RE)) found.push(m[1]);
  if (!inFence) {
    for (const m of line.matchAll(BARE_PATH_RE)) found.push(m[0]);
  }
  return found.filter((c) => !isPlaceholder(c));
}

test("every repo-relative path referenced in prose exists on disk", () => {
  const failures: string[] = [];

  for (const relFile of proseFiles) {
    const abs = path.join(repoRoot, relFile);
    const fileDir = path.dirname(abs);
    const lines = readFileSync(abs, "utf-8").split("\n");
    let fenceLen = 0;
    lines.forEach((line, idx) => {
      const fenceMatch = line.match(FENCE_OPEN_RE);
      if (fenceMatch) {
        const runLen = fenceMatch[1].length;
        if (fenceLen === 0) fenceLen = runLen;
        else if (runLen >= fenceLen) fenceLen = 0;
        return;
      }
      for (const candidate of extractCandidates(line, fenceLen > 0)) {
        // Most references are repo-root-relative, but some prose (e.g. a skill
        // pointing at its own scripts/ subfolder) writes paths relative to the
        // prose file's own directory instead — accept either resolution.
        const rootHit = existsSync(path.join(repoRoot, candidate));
        const dirHit = existsSync(path.join(fileDir, candidate));
        if (!rootHit && !dirHit) {
          failures.push(`${relFile}:${idx + 1} -> ${candidate}`);
        }
      }
    });
  }

  assert.deepEqual(failures, []);
});

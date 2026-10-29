import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { REPO_TOP_LEVEL, SHIPPED_MARKDOWN } from "./prose-dirs.ts";

// A tier is set by what a failure can break, not by how many files change. HARRY.md **Tiers** owns
// the triggers; tier-gates.md points at them instead of keeping a second copy.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const prose = (): string[] => [...SHIPPED_MARKDOWN, ...REPO_TOP_LEVEL];
const FILE_COUNT_TRIGGER =
  /\b(?:a single file|one file,|1 file,|\d+\s*[–-]\s*\d+[\s-]files?|\d+\+ files|\d+ files or more|up to \w+ files|(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more files|more than (?:one|two|three|four|five|\d+) files)\b/i;

test("no prose paragraph states a file-count tier trigger", () => {
  const hits = prose().flatMap((f) =>
    read(f)
      .split(/\n\s*\n/)
      .map((para) => para.replace(/\s+/g, " "))
      .filter(
        (para) => /Trivial|Standard|Major|\btier/i.test(para) && FILE_COUNT_TRIGGER.test(para),
      )
      .map((para) => `${f}: ${para.match(FILE_COUNT_TRIGGER)?.[0]}`),
  );
  assert.deepEqual(hits, []);
});

test("tier-gates.md takes every tier's trigger from HARRY.md Tiers", () => {
  const rows = read(path.join("references", "tier-gates.md"))
    .split("\n")
    .filter((l) => l.startsWith("| Trigger |"));
  assert.equal(rows.length, 3, "one Trigger row per tier");
  for (const row of rows) assert.match(row, /HARRY\.md \*\*Tiers\*\*/, row);
});

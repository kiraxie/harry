import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { REPO_TOP_LEVEL, SHIPPED_PROSE_DIRS, SHIPPED_TOP_LEVEL } from "./prose-dirs.ts";

// A tier is set by what a failure can break, not by how many files change. HARRY.md **Tiers** owns
// the triggers; tier-gates.md points at them instead of keeping a second copy.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const prose = (): string[] => [
  ...SHIPPED_TOP_LEVEL,
  ...REPO_TOP_LEVEL,
  ...SHIPPED_PROSE_DIRS.flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(dir, f)),
  ),
];
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

test("HARRY.md Tiers sets the Major trigger by risk", () => {
  const s3 = read("HARRY.md").split("## Tiers")[1]?.split("## Ask first")[0] ?? "";
  const major = s3.split("\n").find((l) => l.startsWith("- **Major**")) ?? "";
  assert.match(major, /red line/);
  assert.match(major, /hard to see or hard to undo/);
  assert.match(major, /always-loaded agent instructions/);
});

test("tier-gates.md takes every tier's trigger from HARRY.md Tiers", () => {
  const rows = read(path.join("references", "tier-gates.md"))
    .split("\n")
    .filter((l) => l.startsWith("| Trigger |"));
  assert.deepEqual(
    rows.map((row) => row.replace(/\s+/g, " ")),
    [
      "| Trigger | HARRY.md **Tiers**' Trivial trigger |",
      "| Trigger | HARRY.md **Tiers**' Standard trigger |",
      "| Trigger | HARRY.md **Tiers**' Major trigger — **any red line (see below)** among them |",
    ],
  );
});

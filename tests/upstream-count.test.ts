import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROSE_DIRS, REPO_TOP_LEVEL, SHIPPED_TOP_LEVEL } from "./prose-dirs.ts";

// upstream.json is the only count of harry's sources. A number written into prose goes
// stale on the next pin or retirement, and has before.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const NUMBER = String.raw`(?:two|three|four|five|six|seven|eight|nine|ten|\d+)`;
const COUNT_RE = new RegExp(
  String.raw`\b${NUMBER}(?:\s+[\w-]+){0,2}?\s+(?:upstreams?|sources?|influences)\b|\ball ${NUMBER} pinned\b`,
  "i",
);
// A count only matters in a paragraph about harry's lineage; elsewhere "two sources" is prose.
const LINEAGE_RE = /upstream|pinned|historical|influence/i;
const isCount = (text: string) => LINEAGE_RE.test(text) && COUNT_RE.test(text);

test("the count pattern sees the phrasings a count takes", () => {
  for (const line of [
    "Harry is distilled from four upstreams",
    "Two historical sources are not pinned",
    "all four pinned by commit",
    "four pinned sources",
    "Four more sources are historical influences",
  ])
    assert.ok(isCount(line), line);
  for (const line of [
    "`## Follow-ups` entries come from two sources",
    "upstream.json is the one source of truth",
    "one upstream pin per derived area",
  ])
    assert.ok(!isCount(line), line);
});

test("no prose states a count of upstream or historical sources", () => {
  const files = [
    ...SHIPPED_TOP_LEVEL,
    ...REPO_TOP_LEVEL,
    ...PROSE_DIRS.flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf-8" })
        .filter((rel) => rel.endsWith(".md"))
        .map((rel) => path.join(dir, rel)),
    ),
  ];
  const hits: string[] = [];
  for (const rel of files) {
    for (const para of readFileSync(path.join(repoRoot, rel), "utf-8").split(/\n\s*\n/)) {
      const text = para.replace(/\s+/g, " ");
      if (isCount(text)) hits.push(`${rel}: ${text.match(COUNT_RE)?.[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

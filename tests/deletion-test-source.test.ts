import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SHIPPED_MARKDOWN } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const OWNER = path.join("references", "architecture-review.md");

const flatten = (text: string): string => text.replace(/\s+/g, " ");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const read = (rel: string): string => flatten(raw(rel));

test("the deletion test is defined once in shipped prose, in architecture-review.md", () => {
  const defining = SHIPPED_MARKDOWN.filter((f) =>
    /\*\*deletion test\*\*|picture the codebase without/i.test(read(f)),
  );
  assert.deepEqual(defining, [OWNER]);
});

const SCAN = "references/audit/SCAN-DIMENSIONS.md";
const ABSTRACTION_TIMING = "`references/architecture-review.md` **Abstraction timing**";

const dimensionTenParagraph = (topic: RegExp): string => {
  const paragraphs = headingSection(raw(SCAN), SCAN, "## 10.")
    .split(/\n\s*\n/)
    .map(flatten)
    .filter((p) => topic.test(p));
  assert.equal(paragraphs.length, 1, `expected one dimension-10 paragraph matching ${topic}`);
  return paragraphs[0] ?? "";
};

test("/audit dimension 10's deletion-test paragraph cites Abstraction timing", () => {
  const paragraph = dimensionTenParagraph(/\bthe deletion test\b/);
  assert.ok(paragraph.includes(ABSTRACTION_TIMING), paragraph);
});

test("/audit dimension 10's What paragraph, on single-implementation interfaces, cites Abstraction timing", () => {
  const paragraph = dimensionTenParagraph(/^\*\*What:\*\*/);
  assert.ok(paragraph.includes(ABSTRACTION_TIMING), paragraph);
});

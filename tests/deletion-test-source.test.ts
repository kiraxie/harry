import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS, SHIPPED_PROSE_DIRS, SHIPPED_TOP_LEVEL, under } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const OWNER = path.join("references", "architecture-review.md");

const shippedProse = (): string[] => [
  ...SHIPPED_TOP_LEVEL,
  ...MARKDOWN_CORPUS.filter(under(SHIPPED_PROSE_DIRS)),
];
const flatten = (text: string): string => text.replace(/\s+/g, " ");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const read = (rel: string): string => flatten(raw(rel));

test("the deletion test is defined once in shipped prose, in architecture-review.md", () => {
  const defining = shippedProse().filter((f) =>
    /\*\*deletion test\*\*|picture the codebase without/i.test(read(f)),
  );
  assert.deepEqual(defining, [OWNER]);
});

test("/audit dimension 10 points at architecture-review.md for the deletion test", () => {
  const ten = flatten(
    headingSection(
      raw("references/audit/SCAN-DIMENSIONS.md"),
      "references/audit/SCAN-DIMENSIONS.md",
      "## 10.",
    ),
  );
  assert.match(ten, /deletion test[^.]*`references\/architecture-review\.md`/i);
  assert.match(ten, /\*\*Bar:\*\*/);
});

test("/audit dimension 10 takes when a single implementation is too early from Abstraction timing", () => {
  const ten = flatten(
    headingSection(
      raw("references/audit/SCAN-DIMENSIONS.md"),
      "references/audit/SCAN-DIMENSIONS.md",
      "## 10.",
    ),
  );
  assert.match(
    ten,
    /single-implementation[^.]*`references\/architecture-review\.md` \*\*Abstraction timing\*\*/i,
  );
});

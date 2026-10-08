import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SHIPPED_PROSE_DIRS, SHIPPED_TOP_LEVEL } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const OWNER = path.join("references", "architecture-review.md");

const shippedProse = (): string[] => [
  ...SHIPPED_TOP_LEVEL,
  ...SHIPPED_PROSE_DIRS.flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(dir, f)),
  ),
];
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");

test("the deletion test is defined once in shipped prose, in architecture-review.md", () => {
  const defining = shippedProse().filter((f) =>
    /\*\*deletion test\*\*|picture the codebase without/i.test(read(f)),
  );
  assert.deepEqual(defining, [OWNER]);
});

test("/audit dimension 10 points at architecture-review.md for the deletion test", () => {
  const dims = read(path.join("references", "audit", "SCAN-DIMENSIONS.md"));
  const ten = dims.slice(dims.indexOf("## 10."), dims.indexOf("## 11."));
  assert.match(ten, /deletion test[^.]*`references\/architecture-review\.md`/i);
  assert.match(ten, /\*\*Bar:\*\*/);
});

test("/audit dimension 10 takes when a single implementation is too early from category 4", () => {
  const dims = read(path.join("references", "audit", "SCAN-DIMENSIONS.md"));
  const ten = dims.slice(dims.indexOf("## 10."), dims.indexOf("## 11."));
  assert.match(
    ten,
    /single-implementation[^.]*`references\/architecture-review\.md`[^.]*category 4/i,
  );
});

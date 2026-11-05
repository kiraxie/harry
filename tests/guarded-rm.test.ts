import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LINE_END_RE } from "./lines.ts";
import { SHIPPED_MARKDOWN } from "./prose-dirs.ts";
import { inOrder } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const RM_RECURSIVE = /\brm\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[rR]|--recursive\b)/;

// An exact list, not a shell grammar: no regex can prove the guard tests the path the rm
// removes, so each approved removal is pinned with the reason a reviewer read.
const REMOVALS: { file: string; guard: string; rm: string; why: string }[] = [
  {
    file: "commands/rethink.md",
    guard: `[ -f "$D/brief.md" ]`,
    rm: `trap 'rm -rf "$D"'`,
    why: "brief.md confirms <D> is step 1's dir before the trap can remove it",
  },
  {
    file: "commands/rethink.md",
    guard: `[ -d '<D>/cwd' ]`,
    rm: `rm -rf '<D>'`,
    why: "cwd exists only where step 1 made it; the brief may be the missing piece",
  },
];

type Hit = { rel: string; n: number; line: string };

const hits: Hit[] = SHIPPED_MARKDOWN.flatMap((rel) =>
  readFileSync(path.join(repoRoot, rel), "utf-8")
    .split(LINE_END_RE)
    .map((line, i) => ({ rel, n: i + 1, line }))
    .filter(({ line }) => RM_RECURSIVE.test(line)),
);

test("recursive rm detection matches every flag form and nothing else", () => {
  for (const cmd of ["rm -rf X", "rm -f -r X", "rm -Rf X", "rm --recursive X"])
    assert.ok(RM_RECURSIVE.test(cmd), cmd);
  for (const cmd of ["rm -f X", "rm X"]) assert.ok(!RM_RECURSIVE.test(cmd), cmd);
});

test("every recursive rm in shipped prose is an approved removal, guarded in the same command", () => {
  for (const { rel, n, line } of hits) {
    const at = `${rel}:${n}: ${line.trim()}`;
    const entries = REMOVALS.filter((e) => e.file === rel && line.includes(e.rm));
    assert.equal(
      entries.length,
      1,
      `guard it in the same command and add a REMOVALS entry with its reason: ${at}`,
    );
    assert.equal((line.match(/\brm\b/g) ?? []).length, 1, `one rm per approved line: ${at}`);
    const [entry] = entries;
    if (entry) inOrder(line, rel, entry.guard, entry.rm);
  }
});

test("every REMOVALS entry still matches a line in its file", () => {
  for (const e of REMOVALS)
    assert.ok(
      hits.some(({ rel, line }) => rel === e.file && line.includes(e.rm)),
      `stale REMOVALS entry: ${e.file}: ${e.rm}`,
    );
});

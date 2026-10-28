import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A command that points at a reference for its procedure is a thin door: it may name the
// reference and its headings, but must not carry its prose. A paragraph copied back into
// the door is a second copy that drifts from the first.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

// Every reference each door reaches, at any depth. Hand-kept so the equality test below
// catches a citation reworded out of path form, which would silently unguard every file
// it used to reach. The two audit entries that are not prose are listed, not exempted:
// the equality assertion is what keeps this map honest.
const HOISTED: Record<string, string[]> = {
  debt: ["references/debt-audit.md", "references/doc-types.md", "references/sync-migration.md"],
  review: [
    "references/review-rubric.md",
    "references/fix-check.md",
    "references/architecture-review.md",
    "references/doc-types.md",
    "references/debt-audit.md",
    "references/red-green.md",
    "references/tier-gates.md",
    "references/grilling.md",
    "references/sync-migration.md",
  ],
  sync: ["references/sync-migration.md", "references/doc-types.md", "references/debt-audit.md"],
  audit: [
    "references/audit/ORCHESTRATION.md",
    "references/audit/RECON.md",
    "references/audit/DEEP-DIVE.md",
    "references/audit/SCAN-DIMENSIONS.md",
    "references/audit/VALIDATION-AND-REPORTING.md",
    "references/audit/report-schema.json",
    "references/audit/validate-findings.cjs",
    "references/red-green.md",
    "references/architecture-review.md",
    "references/review-rubric.md",
    "references/fix-check.md",
    "references/doc-types.md",
    "references/debt-audit.md",
    "references/tier-gates.md",
    "references/grilling.md",
    "references/sync-migration.md",
  ],
  grill: [
    "references/grilling.md",
    "references/architecture-review.md",
    "references/review-rubric.md",
    "references/fix-check.md",
    "references/red-green.md",
    "references/tier-gates.md",
    "references/doc-types.md",
    "references/debt-audit.md",
    "references/sync-migration.md",
  ],
  "wait-what": [
    "references/plain-language.md",
    "references/architecture-review.md",
    "references/grilling.md",
    "references/review-rubric.md",
    "references/fix-check.md",
    "references/red-green.md",
    "references/tier-gates.md",
    "references/doc-types.md",
    "references/debt-audit.md",
    "references/sync-migration.md",
  ],
};

const refPaths = (rel: string): Set<string> =>
  new Set(
    [...read(rel).matchAll(/references\/[A-Za-z0-9._/-]+/g)].map((m) => m[0].replace(/[./]+$/, "")),
  );

const isReferenceFile = (rel: string): boolean => {
  const abs = path.join(repoRoot, rel);
  return existsSync(abs) && statSync(abs).isFile();
};

// Full closure: references cite references (`sync-migration.md` -> `doc-types.md` ->
// `debt-audit.md`), and `doc-types.md` <-> `debt-audit.md` is a cycle, so a worklist with
// a `seen` set, not a fixed depth.
const reachedRefs = (door: string): string[] => {
  const stack = [...refPaths(door)];
  const all = new Set(stack);
  const seen = new Set<string>();
  while (stack.length) {
    const ref = stack.pop() as string;
    if (seen.has(ref) || !isReferenceFile(ref)) continue;
    seen.add(ref);
    for (const nested of refPaths(ref))
      if (!all.has(nested)) {
        all.add(nested);
        stack.push(nested);
      }
  }
  return [...all].filter(isReferenceFile).sort();
};

// 40 chars: long enough that a shared line is prose rather than a common phrase.
const PROSE_LINE_MIN = 40;
const normalizeLine = (l: string): string =>
  l
    .trim()
    .replace(/^(?:[-*>]\s+|\d+\.\s+)+/, "")
    .replace(/\s+/g, " ");
const isProse = (l: string): boolean => l.length >= PROSE_LINE_MIN && !l.startsWith("#");

test("each door reaches exactly the references HOISTED declares", () => {
  const actual = Object.fromEntries(
    Object.keys(HOISTED).map((name) => [name, reachedRefs(`commands/${name}.md`)]),
  );
  assert.deepEqual(
    actual,
    Object.fromEntries(Object.entries(HOISTED).map(([k, v]) => [k, [...v].sort()])),
    "the reached references changed. A door that GAINED paths is normal; one that LOST " +
      "them usually is a citation reworded out of `references/...` path form, which " +
      "unguards every file it used to reach — restore the path form instead.",
  );
});

for (const name of Object.keys(HOISTED)) {
  test(`commands/${name}.md re-inlines no prose from a reference it reaches`, () => {
    const door = `commands/${name}.md`;
    const doorProse = read(door).split("\n").map(normalizeLine).filter(isProse);
    for (const ref of reachedRefs(door)) {
      const refProse = new Set(read(ref).split("\n").map(normalizeLine).filter(isProse));
      assert.ok(refProse.size > 0, `${ref} yielded no prose lines, so the check is vacuous`);
      assert.deepEqual(
        doorProse.filter((l) => refProse.has(l)),
        [],
        `${door} carries prose verbatim from ${ref}; it belongs in one place`,
      );
    }
  });
}

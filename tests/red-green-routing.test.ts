import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// red-green.md is read on demand, so its rules bind only a model something sends there:
// the author at write time (executing's Build step) and the analyst lane at review. The
// Codex lane gets it embedded in the prompt (tests/review-cli.test.ts).

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
const RED_GREEN = "`references/red-green.md`";

const executing = read(path.join("skills", "executing", "SKILL.md"));
const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `no section from "${from}" to "${to}"`);
  return text.slice(start, end);
};

test("executing's Build step sends Standard and Major to red-green.md before a test", () => {
  const build = between(executing, "1. **Build.**", "2. **Verify**");
  assert.match(
    build,
    /Standard and Major[^.]*read `references\/red-green\.md` before writing a test/,
  );
});

test("executing's analyst lane is handed every file the rubric declares as its standard", () => {
  const lane = between(executing, "**analyst lane**", "**Codex lane**");
  assert.ok(
    lane.includes("every file `references/review-rubric.md` declares as its standard"),
    lane,
  );
});

// A pointer is a sentence or two; anything longer is a second copy that drifts.
const POINTER_WORDS = 60;

test("the rubric's test-hygiene item points at red-green.md and stays pointer-sized", () => {
  const rubric = read(path.join("references", "review-rubric.md"));
  const item = between(rubric, "4. **Test hygiene**", "## Engineering judgment");
  assert.ok(item.includes(RED_GREEN), item);
  const words = item.split(" ").filter(Boolean).length;
  assert.ok(words <= POINTER_WORDS, `item 4 is ${words} words — restating red-green.md?`);
});

// Each section binds exactly the tiers its group heading names; a section outside both
// groups binds no one, and one in the wrong group binds the wrong tier.
test("red-green.md sorts every section under an every-test or a Major group", () => {
  const raw = readFileSync(path.join(repoRoot, "references", "red-green.md"), "utf-8");
  const every = raw.indexOf("\n## Every test");
  const major = raw.indexOf("\n## Major / red line");
  assert.ok(every > 0 && major > every, "two group headings, every-test first");
  const inEvery = raw.slice(every, major);
  const inMajor = raw.slice(major);
  for (const s of [
    "### What a good test is",
    "**One owner per contract.**",
    "**Exercise the real thing**",
    "### Seams and what sits behind them",
  ])
    assert.ok(inEvery.includes(s), `${s} belongs to every test`);
  for (const s of [
    "### The cycle",
    "**Agree the seams before writing tests.**",
    "### Regression test verification",
    "### Red flags",
  ])
    assert.ok(inMajor.includes(s), `${s} belongs to Major / red line`);
  const before = raw.slice(0, every);
  assert.doesNotMatch(before, /\n### /, "no section before the groups");
  assert.deepEqual(
    [...raw.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    ["When this is mandatory (tiered)", "Every test", "Major / red line"],
    "a section outside both groups binds no tier",
  );
  assert.match(
    before,
    /\*\*Every test\*\* below binds every tier that writes a test; \*\*Major \/ red line\*\* adds/,
    "the scope sentence names both groups",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, inOrder, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const FINISHING = path.join("skills", "finishing", "SKILL.md");
const ARCH_REVIEW = path.join("references", "architecture-review.md");
const DOC_TYPES = path.join("references", "doc-types.md");

const plain = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/[*`]/g, "")
    .replace(/(^|[^\w])_(?=\S)|(?<=\S)_(?=[^\w]|$)/g, "$1");

const STEP2 = /^## \d+\. Architecture review/;
const archReview = (): string => plain(read(ARCH_REVIEW));

test("AC-1: the architecture review is step 2, after verify-tests and before merge-or-PR", () => {
  inOrder(
    read(FINISHING),
    FINISHING,
    "## 1. Verify tests",
    "## 2. Architecture review",
    "## 3. Ask: merge or PR",
  );
});

test("AC-2: a shape is one of four kinds, defined the same in the step and the architecture-review reference", () => {
  const kinds =
    /A shape is the outward form other code depends on: an API, a DB schema, a public interface, or a module or service boundary\./;
  assert.match(
    plain(headingSection(read(FINISHING), FINISHING, STEP2)),
    kinds,
    "step 2's shape definition drifted",
  );
  assert.match(
    archReview(),
    kinds,
    "the architecture-review reference's shape definition drifted from step 2's",
  );
});

test("AC-4: the architecture-review reference carries the five categories", () => {
  const cats = headingSection(read(ARCH_REVIEW), ARCH_REVIEW, "## Five categories");
  const names = [
    "API and interfaces.",
    "DB schema.",
    "Boundaries.",
    "Abstraction timing",
    "System level (across services).",
  ];
  for (const [i, name] of names.entries())
    assert.ok(
      cats.includes(`${i + 1}. **${name}`),
      `the architecture-review reference lost category ${i + 1}, "${name}"`,
    );
});

test("AC-5: exactly three rulings — fix now, backlog, leave as is", () => {
  const bullets = (text: string, arrow: string): string[] =>
    text
      .replace(/\*/g, "")
      .split("\n")
      .filter((l) => l.startsWith("- ") && l.includes(` ${arrow} `))
      .map((l) => l.slice(2, l.indexOf(` ${arrow} `)));

  const rulings = section(
    headingSection(read(FINISHING), FINISHING, STEP2),
    FINISHING,
    "**Rulings.**",
    "No findings →",
  );
  assert.deepEqual(bullets(rulings, "→"), ["fix now", "backlog", "leave as is"]);

  const out = section(read(ARCH_REVIEW), ARCH_REVIEW, "## Output", "Severity is judged");
  assert.deepEqual(bullets(out, "—"), ["fix now", "backlog", "leave as is"]);
});

test("review-round-cap AC-5(c): brainstorming points at doc-types for the Follow-ups sources", () => {
  const template = read(DOC_TYPES)
    .split("\n")
    .find((l) => l.startsWith("## Follow-ups"));
  assert.ok(template, "doc-types' item template no longer has a ## Follow-ups line");
  const rel = path.join("skills", "brainstorming", "SKILL.md");
  const paragraph = read(rel)
    .split(/\n\s*\n/)
    .find((p) => p.includes("MAY be created here at step 6"));
  assert.ok(paragraph, `${rel} no longer has the paragraph on where Follow-ups lines come from`);
  assert.ok(
    paragraph.includes("references/doc-types.md"),
    "brainstorming no longer points at doc-types for the Follow-ups sources",
  );
});

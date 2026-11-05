import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SHIPPED_MARKDOWN } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*\*/g, "");

const HOME = "references/review-rubric.md";
const CITE = '"Lesson or check" bullet of `references/review-rubric.md` Engineering judgment';
const CLASSIFIERS = ["skills/finishing/SKILL.md", "commands/retro.md"];
const MECHANICAL_LIST = "a fixed syntax pattern, a banned API";

test("the lesson-or-check classification is cited, not restated, by its users", () => {
  assert.ok(flat(read(HOME)).includes("Lesson or check."), `${HOME} has no Lesson or check bullet`);
  const uncited = CLASSIFIERS.filter((f) => !flat(read(f)).includes(CITE));
  assert.deepEqual(uncited, [], `these files no longer cite ${CITE}`);
  const restating = SHIPPED_MARKDOWN.filter(
    (f) => f !== HOME && flat(read(f)).includes(MECHANICAL_LIST),
  );
  assert.deepEqual(restating, [], `state the mechanical-violation list only in ${HOME}`);
});

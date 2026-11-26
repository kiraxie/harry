import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readProse } from "./citations.ts";
import { section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const EXECUTING = path.join("skills", "executing", "SKILL.md");
const DOC_TYPES = path.join("references", "doc-types.md");

const spans = (rel: string, text: string, opening: string): string[] => [
  ...new Set(
    readProse(rel, text)
      .flatMap((block) => block.code.map((span) => span.value))
      .filter((value) => value.startsWith(opening)),
  ),
];

test("each metrics failed line step 2 writes is one Resuming reads", () => {
  const executing = read(EXECUTING);
  const written = spans(
    EXECUTING,
    section(executing, EXECUTING, "**Metrics** (Standard and Major)", "3. **Review.**"),
    "metrics failed at ",
  );
  const read_ = spans(
    EXECUTING,
    section(executing, EXECUTING, "**Resuming**", "## Steps"),
    "metrics failed … ",
  ).map((span) => span.slice("metrics failed … ".length));
  assert.ok(written.length > 0, "step 2 writes no `metrics failed at` line");
  for (const marker of read_) {
    const forms = written.filter((form) => form.includes(marker));
    assert.equal(forms.length, 1, `Resuming reads "${marker}", which ${forms.length} forms hold`);
  }
  for (const form of written) {
    const markers = read_.filter((marker) => form.includes(marker));
    assert.equal(markers.length, 1, `step 2 writes \`${form}\`, which Resuming does not read once`);
  }
});

test("doc-types lists the metrics failed lines among those rules read back", () => {
  const listed = section(
    read(DOC_TYPES),
    DOC_TYPES,
    "`## Progress` is append-only",
    "A **leave as is** record",
  );
  assert.ok(
    listed.includes("`metrics failed`"),
    "doc-types no longer lists the metrics failed lines",
  );
});

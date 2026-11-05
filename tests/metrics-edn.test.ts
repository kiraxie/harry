/**
 * The EDN reader against snapshots the pinned tools actually wrote
 * (tests/fixtures/metrics/, captured from crapper 6fd92c4, dryer 66ff6d2 and
 * mutator a5a0cb8 on a small TypeScript project).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseEdn } from "../src/lib/metrics/edn.ts";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/metrics");
const fixture = (name: string) => parseEdn(readFileSync(path.join(FIXTURES, name), "utf8"));

test("crap.edn with coverage reads every entry's fields", () => {
  assert.deepEqual(fixture("crap.edn"), {
    entries: [
      { name: "copyTwo", namespace: "b", complexity: 3, coverage: 0, crap: 12 },
      { name: "classify", namespace: "a", complexity: 5, coverage: 71.4286, crap: 5.5831 },
      { name: "copyOne", namespace: "a", complexity: 3, coverage: 100, crap: 3 },
    ],
  });
});

test("crap.edn from --no-coverage reads nil as null", () => {
  const entries = (fixture("crap-no-coverage.edn") as { entries: unknown[] }).entries;
  assert.deepEqual(entries[0], {
    name: "classify",
    namespace: "a",
    complexity: 5,
    coverage: null,
    crap: null,
  });
});

test("dry.edn reads a candidate's spans", () => {
  assert.deepEqual(fixture("dry.edn"), {
    candidates: [
      {
        score: 1,
        language: "typescript",
        left: { file: "src/a2.ts", "start-line": 9, "end-line": 17 },
        right: { file: "src/b2.ts", "start-line": 1, "end-line": 9 },
        "left-nodes": 59,
        "right-nodes": 59,
      },
    ],
  });
});

test("a mutate snapshot keeps string-keyed outcomes with escaped quotes and keyword values", () => {
  const snap = fixture("mutate-a.edn") as {
    source: string;
    outcomes: Record<string, string>;
    forms: { id: string; line: number; "end-line": number }[];
  };
  assert.equal(snap.source, "src/a.mjs");
  assert.equal(snap.outcomes['["src/a.mjs","a","defn/classify",44,45,">",">="]'], "survived");
  assert.equal(Object.keys(snap.outcomes).length, 8);
  assert.deepEqual(
    snap.forms.map((f) => [f.id, f.line, f["end-line"]]),
    [
      ["defn/classify", 1, 7],
      ["defn/copyOne", 9, 17],
    ],
  );
});

test("unparsable input throws with its position", () => {
  assert.throws(() => parseEdn("{:entries [1 2"), /EDN/);
  assert.throws(() => parseEdn("{:a 1} trailing"), /EDN/);
});

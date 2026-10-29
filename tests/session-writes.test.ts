import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const proseFiles = (): string[] => MARKDOWN_CORPUS;

test("AC-8: no prose names a retired dispatch concept", () => {
  const retired: [RegExp, string][] = [
    [/ultrathink/i, "a dated thinking keyword"],
    [/dispatch cap/i, "the retired dispatch cap"],
    [/subagent mode\b/i, "the retired subagent mode"],
    [/harry:(mech|writer|security)\b/, "a retired writing role"],
    [/`(mech|writer|security)`/, "a retired writing role"],
    [/## Dispatch/, "the retired parallel-dispatch section"],
    [/subagent execution|per-(task|AC) review/i, "the retired per-task review"],
  ];
  const hits: string[] = [];
  for (const rel of proseFiles()) {
    const text = readFileSync(path.join(repoRoot, rel), "utf-8");
    for (const [re, why] of retired) if (re.test(text)) hits.push(`${rel}: ${why} (${re})`);
  }
  assert.deepEqual(hits, []);
});

const flatten = (text: string): string => text.replace(/\s+/g, " ").replace(/[*`]/g, "");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const plain = (rel: string): string => flatten(raw(rel));
const EXECUTING = path.join("skills", "executing", "SKILL.md");

test("AC-1: executing's Who writes routes exactly the three roles", () => {
  const who = headingSection(raw(EXECUTING), EXECUTING, "## Who writes");
  // A role is the token right after an arrow, whatever markup wraps it, so an added
  // "orchestration → driver" clause lands in the set and fails the equality below.
  const routed = new Set(
    [...who.matchAll(/→\s*(?:`|\*\*|\*|"|')?([\w-]+)(?:`|\*\*|\*|"|')?/g)].map((m) => m[1]),
  );
  assert.deepEqual([...routed].sort(), ["analyst", "referee", "scout"]);
});

test("AC-17: no prose reads older Progress lines; users finish in-flight units first", () => {
  const hits = proseFiles().filter((rel) => /Older Progress lines/.test(plain(rel)));
  assert.deepEqual(hits, []);
});

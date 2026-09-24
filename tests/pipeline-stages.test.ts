import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The pipeline is brainstorm → execute → finish, and an active item carries
// acceptance criteria instead of a plan. Both halves of that live in prose across
// a dozen shipped files, so a stale "brainstorm → plan → execute" line or a
// surviving `writing-plans` reference is the exact drift nothing else catches:
// the skill directory is gone, so a door naming it sends the model at nothing.
//
// Legacy `## Plan` mentions are allowed only where a file explains that an item
// written under the old shape keeps its plan — the three references that still
// have to read one.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

/** Files that instruct the model or describe the product to a consumer. */
function shippedFiles(): string[] {
  const files = ["HARRY.md", "README.md", "CLAUDE.md", "NOTICE", "upstream.json"];
  for (const dir of [
    "skills",
    "codex-skills",
    "commands",
    "agents",
    "references",
    ".claude-plugin",
    ".codex-plugin",
    ".agents",
  ]) {
    const abs = path.join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    for (const rel of readdirSync(abs, { recursive: true, encoding: "utf-8" })) {
      if (rel.endsWith(".md") || rel.endsWith(".json")) files.push(path.join(dir, rel));
    }
  }
  return files;
}

/** `brainstorm → plan → execute`, in either arrow spelling. */
const PLAN_STAGE_RE = /brainstorm\s*(?:→|->)\s*plan\b/i;

/** Files allowed to name `## Plan`, each because it must read a legacy item. */
const LEGACY_PLAN_READERS = new Set([
  "references/doc-types.md",
  "references/debt-audit.md",
  "references/sync-migration.md",
  path.join("skills", "executing", "SKILL.md"),
]);

test("no shipped file sends the model at the deleted writing-plans skill", () => {
  assert.ok(
    !existsSync(path.join(repoRoot, "skills/writing-plans")),
    "skills/writing-plans/ is back",
  );
  const offenders = shippedFiles().filter((rel) => read(rel).includes("writing-plans"));
  assert.deepEqual(offenders, [], "these name a skill that no longer exists");
});

test("no shipped file still describes a plan stage in the pipeline", () => {
  const offenders: string[] = [];
  for (const rel of shippedFiles()) {
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        if (PLAN_STAGE_RE.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
  }
  assert.deepEqual(offenders, [], "the pipeline is brainstorm → execute → finish");
});

test("`## Plan` survives only where a legacy item has to be read", () => {
  const offenders: string[] = [];
  for (const rel of shippedFiles()) {
    if (LEGACY_PLAN_READERS.has(rel)) continue;
    const lines = read(rel).split("\n");
    lines.forEach((line, i) => {
      if (!/`## Plan`|^## Plan\b/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      if (!/legacy|older shape/i.test(window)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "an item's plan section is gone; say 'legacy' where one is still read",
  );
});

test("prose counts the pipeline skills that actually ship", () => {
  // Removing a stage renames the set: "the four pipeline skills" outlived
  // `writing-plans` in three files while a fourth already said three. Count the
  // directories instead of pinning a number, so the next stage change fails here.
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const actual = readdirSync(path.join(repoRoot, "skills"), { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  ).length;
  const allowed = new Set([words[actual], String(actual)]);
  const offenders: string[] = [];
  for (const rel of shippedFiles()) {
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        const count = line.match(
          new RegExp(`\\b(${words.join("|")}|\\d+)\\s+pipeline skills\\b`, "i"),
        )?.[1];
        if (count && !allowed.has(count.toLowerCase()))
          offenders.push(`${rel}:${i + 1} (${count})`);
      });
  }
  assert.deepEqual(offenders, [], `${actual} pipeline skills ship`);
});

test("the item template carries acceptance criteria and Progress", () => {
  // doc-types.md defines the shape; brainstorming writes it. Both must agree, or a
  // written item and the reference that documents it drift on day one.
  for (const rel of ["references/doc-types.md", path.join("skills", "brainstorming", "SKILL.md")]) {
    const text = read(rel);
    for (const heading of ["### Acceptance criteria", "## Progress"]) {
      assert.ok(text.includes(heading), `${rel} no longer defines ${heading}`);
    }
  }
});

test("the acceptance-criteria rule keeps its two load-bearing halves", () => {
  // Outcomes not steps, and every criterion carries its own verification. Lose
  // either and AC degrades into a task list or an unverifiable wish.
  const docTypes = read("references/doc-types.md");
  assert.match(docTypes, /outcome/i, "doc-types no longer says an AC states an outcome");
  assert.match(docTypes, /verif/i, "doc-types no longer says an AC carries its verification");
  const rubric = read("references/review-rubric.md");
  assert.match(
    rubric,
    /one line per AC/i,
    "the review rubric's output block no longer demands a verdict per acceptance criterion",
  );
});

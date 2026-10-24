import assert from "node:assert/strict";
import test from "node:test";
import { filesUnder, inDir, PROSE_DIR_FILES, skillFiles } from "./prose-dirs.ts";

const names = (call: string) => (err: unknown) =>
  err instanceof Error && err.message.includes(call);

test("inDir returns the corpus files directly in a dir", () => {
  assert.deepEqual(inDir("agents").sort(), [
    "agents/analyst.md",
    "agents/referee.md",
    "agents/scout.md",
  ]);
  const audit = inDir("references/audit", PROSE_DIR_FILES);
  for (const rel of [
    "references/audit/report-schema.json",
    "references/audit/validate-findings.cjs",
  ])
    assert.ok(audit.includes(rel) && !inDir("references/audit").includes(rel), rel);
});

test("inDir fails loud on a dir that is not a prose dir or has none of its own files", () => {
  for (const dir of ["nope", "src", "codex-skills", ".claude/scripts"])
    assert.throws(() => inDir(dir), names(`inDir("${dir}")`), dir);
});

test("inDir fails loud on a prose dir whose files the corpus leaves out", () => {
  const nonMarkdown = PROSE_DIR_FILES.filter((rel) => !rel.endsWith(".md"));
  assert.throws(() => inDir("agents", nonMarkdown), names(`inDir("agents")`));
});

test("filesUnder includes a nested file inDir leaves out", () => {
  const rel = "references/audit/RECON.md";
  assert.ok(filesUnder("references").includes(rel) && !inDir("references").includes(rel));
});

test("filesUnder fails loud on a dir with no corpus file under it", () => {
  for (const dir of ["nope", "src"])
    assert.throws(() => filesUnder(dir), names(`filesUnder("${dir}")`), dir);
});

test("skillFiles fails loud on a dir with no tracked <dir>/<name>/SKILL.md", () => {
  for (const dir of ["nope", "references"])
    assert.throws(() => skillFiles(dir), names(`skillFiles("${dir}")`), dir);
  for (const dir of ["codex-skills", "skills"]) assert.doesNotThrow(() => skillFiles(dir), dir);
});

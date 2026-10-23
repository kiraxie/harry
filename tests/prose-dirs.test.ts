import assert from "node:assert/strict";
import test from "node:test";
import { inDir, skillFiles } from "./prose-dirs.ts";

const names = (call: string) => (err: unknown) =>
  err instanceof Error && err.message.includes(call);

test("inDir fails loud on a dir with no tracked prose file directly in it", () => {
  for (const dir of ["nope", "src", "codex-skills"])
    assert.throws(() => inDir(dir), names(`inDir("${dir}")`), dir);
  for (const dir of ["references", "references/audit", "agents"])
    assert.doesNotThrow(() => inDir(dir), dir);
});

test("skillFiles fails loud on a dir with no tracked <dir>/<name>/SKILL.md", () => {
  for (const dir of ["nope", "references"])
    assert.throws(() => skillFiles(dir), names(`skillFiles("${dir}")`), dir);
  for (const dir of ["codex-skills", "skills"]) assert.doesNotThrow(() => skillFiles(dir), dir);
});

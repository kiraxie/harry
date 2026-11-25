import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { filesUnder, inDir, listRepoFiles, PROSE_DIR_FILES, skillFiles } from "./prose-dirs.ts";

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
  for (const dir of ["nope", "src", ".claude/scripts"])
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

test("skillFiles fails loud on a dir with no <dir>/<name>/SKILL.md", () => {
  for (const dir of ["nope", "references"])
    assert.throws(() => skillFiles(dir), names(`skillFiles("${dir}")`), dir);
  assert.doesNotThrow(() => skillFiles("skills"));
});

test("listRepoFiles lists an unadded file as working and untracked, never an ignored, deleted or nested-repo one, and exposes no tracked list", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "harry-prose-dirs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd });
  const write = (rel: string) => writeFileSync(path.join(dir, rel), "x\n");
  git(dir, "init", "-q");
  for (const rel of ["kept.md", "gone.md"]) write(rel);
  writeFileSync(path.join(dir, ".gitignore"), "ignored.md\n");
  git(dir, "add", ".");
  unlinkSync(path.join(dir, "gone.md"));
  for (const rel of ["new.md", "ignored.md"]) write(rel);
  mkdirSync(path.join(dir, "nested"));
  git(path.join(dir, "nested"), "init", "-q");

  const files = listRepoFiles(dir);
  assert.deepEqual(Object.keys(files).sort(), ["trackedKind", "working"]);
  assert.deepEqual(["kept.md", "new.md", "ignored.md", "gone.md"].map(files.trackedKind), [
    "file",
    "untracked",
    "untracked",
    "untracked",
  ]);
  assert.deepEqual(files.working.sort(), [".gitignore", "kept.md", "new.md"]);
});

test("listRepoFiles on a directory that is not a git repository says so, naming the directory", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "harry-prose-dirs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => listRepoFiles(dir), names(`${dir} is not a git repository`));
});

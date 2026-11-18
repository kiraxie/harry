import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS, trackedKind } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");

const CODEX_PLUGIN_DIRS = [".codex-plugin", ".agents/plugins", "codex-skills"];
const CODEX_PLUGIN_FILES = ["scripts/install-codex.mjs", "references/codex-role-mapping.md"];

test("the repo tracks no Codex CLI plugin file", () => {
  const tracked = [
    ...CODEX_PLUGIN_DIRS.filter((dir) => trackedKind(dir) === "dir"),
    ...CODEX_PLUGIN_FILES.filter((rel) => trackedKind(rel) === "file"),
  ];
  assert.deepEqual(tracked, []);
});

test("package.json has no script that installs the Codex build", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  assert.equal(scripts["install-laws-codex"], undefined);
});

test("no corpus file branches its prose by build", () => {
  const branching = MARKDOWN_CORPUS.filter((rel) =>
    /\b(Codex|Claude Code) build\b|\bboth builds\b/i.test(read(rel)),
  );
  assert.deepEqual(branching, []);
});

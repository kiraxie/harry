/**
 * The command harry's own Metrics step hands mutator (`pnpm run test:mutation`, pinned in
 * CLAUDE.md) and what keeps it safe inside mutator's worker overlay, where unchanged
 * dirs are symlinks into this checkout and the tests run under --preserve-symlinks-main.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WORKING_FILES } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const testFiles = WORKING_FILES.filter((rel) => /^tests\/[^/]+\.ts$/.test(rel)).sort();

test("mutator's worker dirs are ignored, so a scan of untracked files never lists them", () => {
  const probe = "target/mutation-workers/run-1/worker-0/tests";
  // -v names the rule's source: a global excludes file or .git/info/exclude holding
  // `target` would otherwise pass this with the repo's own line gone.
  const res = execFileSync("git", ["check-ignore", "--no-index", "-v", probe], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.match(res.trim(), /^\.gitignore:\d+:[^\t]+\t/, "the rule must come from .gitignore");
  assert.ok(res.trim().endsWith(`\t${probe}`), res);
});

/** Each `cpSync(...)` or `cp(...)` call's argument text, by file and line. */
const cpSyncCalls = (rel: string, text: string): { at: string; args: string }[] => {
  const calls: { at: string; args: string }[] = [];
  for (const m of text.matchAll(/\bcp(?:Sync)?\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    const line = text.slice(0, m.index).split("\n").length;
    calls.push({ at: `${rel}:${line}`, args: text.slice(open + 1, end) });
  }
  return calls;
};

test("every recursive cpSync in tests/ dereferences symlinks, so a fixture copied in a worker is a copy", () => {
  const calls = testFiles.flatMap((rel) =>
    cpSyncCalls(rel, readFileSync(path.join(repoRoot, rel), "utf8")),
  );
  assert.ok(
    calls.some((c) => /recursive:\s*true/.test(c.args)),
    "the scan found no recursive cpSync",
  );
  const bare = calls
    .filter((c) => /recursive:\s*true/.test(c.args) && !/dereference:\s*true/.test(c.args))
    .map((c) => c.at);
  assert.deepEqual(bare, [], "a recursive cpSync without dereference: true");
});

test("cpSyncCalls reads cpSync and cp calls across lines and nested parens", () => {
  // Built, so the scan above does not read this fixture as a call.
  const text = `x;\n${"cp"}Sync(path.join(a, "b"), c, {\n  recursive: true,\n});\nawait fs.${"cp"}(a, b, { recursive: true });\nrcp(x);\n`;
  assert.deepEqual(cpSyncCalls("t.ts", text), [
    { at: "t.ts:2", args: 'path.join(a, "b"), c, {\n  recursive: true,\n}' },
    { at: "t.ts:5", args: "a, b, { recursive: true }" },
  ]);
});

/**
 * The test files mutator's worker cannot run, each with why. Decided by running each file
 * in mutator-built workers inside a git clone, for a file in src/ and one in scripts/lib/:
 * only these failed there.
 *
 * DEBT: test:mutation stands in for the full suite, so a mutant only one of these files
 * kills reads as a survivor. Once mutator's own overlay runs the full suite in a worker,
 * drop the test:mutation script, its pin in CLAUDE.md and this list, and let Metrics run
 * the default test command.
 */
const EXCLUDED: { file: string; why: string }[] = [
  {
    file: "tests/build.test.ts",
    why: "bundles src/ with esbuild, which follows the worker's symlinks back into the checkout",
  },
  { file: "tests/prose-refs.test.ts", why: "reads dist/companion.cjs; a worker has no dist/" },
  { file: "tests/version-sync.test.ts", why: "reads dist/companion.cjs; a worker has no dist/" },
];

test("test:mutation runs every test file but the ones a worker cannot run", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const script: string = pkg.scripts["test:mutation"] ?? "";
  // The literal tests/ prefix matters: in a worker whose tests dir is a symlink, node's
  // default discovery finds no file.
  const m = script.match(
    /^node --preserve-symlinks-main --test '(tests\/!\(([^()']+)\)\.test\.ts)'$/,
  );
  assert.ok(m, `test:mutation is not the expected glob: ${script}`);
  const [, pattern, alternation] = m;
  const all = testFiles.filter((rel) => rel.endsWith(".test.ts"));
  for (const { file, why } of EXCLUDED) {
    assert.ok(all.includes(file), `${file} is excluded but no longer exists`);
    assert.ok(why.trim().length > 0, `${file} is excluded with no reason`);
  }
  const excluded = EXCLUDED.map((e) => e.file).sort();
  assert.deepEqual(
    alternation
      .split("|")
      .map((name) => `tests/${name}.test.ts`)
      .sort(),
    excluded,
  );
  assert.deepEqual(
    globSync(pattern, { cwd: repoRoot }).sort(),
    all.filter((rel) => !excluded.includes(rel)),
  );
});

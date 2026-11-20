/**
 * A script run by a path through a symlink still runs its CLI: Node gives the module its
 * real path in import.meta.url while argv[1] keeps the path it was started by, so a guard
 * comparing the two as written skips the CLI and exits 0 with no output. That is how
 * install.mjs behaved when a test spawned it from inside mutator's worker overlay.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WORKING_FILES } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Each case starts node and prints what isMain answers for one module. The temp dir is
// a real path (macOS's tmpdir is /var, a symlink to /private/var), so "as written" is.
const IS_MAIN = pathToFileURL(path.join(repoRoot, "scripts", "lib", "is-main.mjs")).href;
const PRINT_OWN = `import { isMain } from ${JSON.stringify(IS_MAIN)};\nconsole.log(isMain(import.meta.url));\n`;

const IS_MAIN_CASES: {
  name: string;
  args: (dir: string) => string[];
  want: string;
  /** What isMain writes to stderr: nothing, unless it cannot resolve argv[1]. */
  stderr?: RegExp;
}[] = [
  { name: "started as written", args: (d) => [path.join(d, "own.mjs")], want: "true" },
  {
    name: "started through a symlinked dir",
    args: (d) => [path.join(d, "link", "own.mjs")],
    want: "true",
  },
  { name: "imported by another entry", args: (d) => [path.join(d, "entry.mjs")], want: "false" },
  {
    name: "imported with no argv[1] (node -e)",
    args: (d) => [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(path.join(d, "own.mjs"))})`,
    ],
    want: "false",
  },
  {
    name: "imported while argv[1] names a path not on disk",
    args: (d) => [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(path.join(d, "own.mjs"))})`,
      path.join(d, "gone.mjs"),
    ],
    want: "false",
    stderr: /^isMain: cannot resolve .*gone\.mjs: ENOENT: no such file or directory/,
  },
  {
    name: "asked for argv[1] itself, not on disk: equal as written needs no real path",
    args: (d) => [
      "--input-type=module",
      "-e",
      `import { pathToFileURL } from "node:url"; import { isMain } from ${JSON.stringify(IS_MAIN)}; console.log(isMain(pathToFileURL(process.argv[1]).href));`,
      path.join(d, "gone.mjs"),
    ],
    want: "true",
  },
];

for (const c of IS_MAIN_CASES) {
  test(`isMain: ${c.name} → ${c.want}`, () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-is-main-case-")));
    try {
      writeFileSync(path.join(dir, "own.mjs"), PRINT_OWN);
      writeFileSync(path.join(dir, "entry.mjs"), 'import "./own.mjs";\n');
      symlinkSync(dir, path.join(dir, "link"));
      const r = spawnSync(process.execPath, c.args(dir), { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), c.want);
      if (c.stderr) assert.match(r.stderr, c.stderr, r.stderr);
      else assert.equal(r.stderr, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("init.mjs started through a symlinked scripts dir runs its CLI", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-is-main-"));
  try {
    symlinkSync(path.join(repoRoot, "scripts"), path.join(dir, "scripts"));
    const target = mkdtempSync(path.join(dir, "target-"));
    const r = spawnSync(process.execPath, [path.join(dir, "scripts", "init.mjs"), target], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Updated /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The entry scripts: every tracked .mjs or .mts module outside tests/ and evals/. */
const MODULES = WORKING_FILES.filter(
  (rel) => /\.(mjs|mts)$/.test(rel) && !/^(tests|evals)\//.test(rel),
);
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

test("only isMain reads argv[1]; no script decides it is the entry point by itself", () => {
  assert.ok(MODULES.includes("scripts/install.mjs"), "the scan lost the scripts");
  const hits = MODULES.filter(
    // Any read of argv but its CLI arguments, so a destructure or .at(1) counts too.
    (rel) => rel !== "scripts/lib/is-main.mjs" && /process\.argv(?!\.slice\(2\))/.test(read(rel)),
  );
  assert.deepEqual(hits, [], "use import.meta.main, or isMain in a script that ships");
});

/**
 * The scripts whose CLI runs when a guard says they are the entry point, by guard form:
 * any isMain call or any import.meta.main read, whatever the condition around it.
 */
const GUARDS = Object.fromEntries(
  MODULES.filter((rel) => rel !== "scripts/lib/is-main.mjs").flatMap((rel) => {
    const text = read(rel);
    if (/\bisMain\(/.test(text)) return [[rel, "isMain"]];
    if (/\bimport\.meta\.main\b/.test(text)) return [[rel, "import.meta.main"]];
    return [];
  }),
);

/** Ships to consumers: an .mjs under scripts/ (CLAUDE.md, "Lint and typecheck scope"). */
const ships = (rel: string): boolean => /^scripts\/.*\.mjs$/.test(rel);

test("a shipped script guards with isMain, a repo-local one with import.meta.main", () => {
  assert.ok(
    GUARDS["scripts/install.mjs"] && GUARDS["scripts/run-evals.mts"],
    `the scan lost the guarded scripts: ${Object.keys(GUARDS).join(", ")}`,
  );
  const wrong = Object.entries(GUARDS)
    .filter(([rel, form]) => form !== (ships(rel) ? "isMain" : "import.meta.main"))
    .map(([rel, form]) => `${rel}: ${form}`);
  assert.deepEqual(wrong, [], "the reason is in scripts/lib/is-main.mjs");
});

/** Guarded scripts a test may import bare, each with why loadScript does not apply. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "build.mjs",
    why: "its CLI reads no HOME, and its one write lands in esbuild's working dir, fixed when build.test.ts loads esbuild, so loadScript's chdir cannot move it",
  },
];

// A relative specifier ending in .mjs or .mts, and what may stand right before it. Only
// an import loads the module into the test's own process; a path handed to spawn does not.
const SPECIFIER = /["'](\.{1,2}\/[^"']+\.m[jt]s)["']/g;
const IMPORTED = /(?:\bfrom\s*|\bimport\s*|\bimport\(\s*)$/;
const TYPE_ONLY = /(?:\bimport\s+type\b[^;]*?\bfrom\s*|\btypeof\s+import\(\s*)$/;
const LOADED = /\bloadScript\(\s*\(\)\s*=>\s*import\(\s*$/;

test("a test reaches a guarded script only by type or through loadScript", () => {
  for (const { file, why } of EXEMPT) {
    assert.ok(file in GUARDS, `${file} is exempt but not guarded`);
    assert.ok(why.trim().length > 0, `${file} is exempt with no reason`);
  }
  const exempt = new Set(EXEMPT.map((e) => e.file));
  const guarded = Object.keys(GUARDS).filter((rel) => !exempt.has(rel));
  const loaders = new Set<string>();
  const bare: string[] = [];
  for (const rel of WORKING_FILES.filter((r) => /^tests\/[^/]+\.ts$/.test(r))) {
    const text = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const m of text.matchAll(SPECIFIER)) {
      const target = path.posix.normalize(path.posix.join("tests", m[1]));
      if (!guarded.includes(target)) continue;
      const before = text.slice(0, m.index);
      if (LOADED.test(before)) loaders.add(rel);
      else if (IMPORTED.test(before) && !TYPE_ONLY.test(before)) bare.push(`${rel}: ${target}`);
    }
  }
  assert.deepEqual(bare, [], "load it with loadScript(() => import(…)) from tests/load-script.ts");
  assert.ok(loaders.size >= 3, `the scan found loaders ${[...loaders].join(", ")}`);
});

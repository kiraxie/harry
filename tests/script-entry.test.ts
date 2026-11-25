/**
 * The shipped CLIs (scripts/install.mjs, scripts/init.mjs) run on import, with no
 * entry-point guard: their logic lives in scripts/lib modules the tests import, so no
 * test has a reason to load a CLI. The repo-local scripts that are both a library and
 * a CLI guard with import.meta.main, and the tests load those through loadScript.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WORKING_FILES } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const SHIPPED_CLIS = ["scripts/install.mjs", "scripts/init.mjs"];

// Node gives a module its real path in import.meta.url while argv[1] keeps the path it
// was started by; a guard comparing the two skipped the CLI and exited 0 with no output
// when a test spawned it from inside mutator's worker overlay.
const SYMLINKED_RUNS: { script: string; args: (dir: string) => string[]; stdout: RegExp }[] = [
  { script: "init.mjs", args: (d) => [mkdtempSync(path.join(d, "target-"))], stdout: /^Updated / },
  { script: "install.mjs", args: () => [], stdout: /^Wired HARRY\.md into / },
];

for (const c of SYMLINKED_RUNS) {
  test(`${c.script} started through a symlinked scripts dir runs its CLI`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "harry-script-entry-"));
    try {
      symlinkSync(path.join(repoRoot, "scripts"), path.join(dir, "scripts"));
      const r = spawnSync(process.execPath, [path.join(dir, "scripts", c.script), ...c.args(dir)], {
        encoding: "utf8",
        env: { ...process.env, HOME: dir, HARRY_GLOBAL: path.join(dir, ".claude", "CLAUDE.md") },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, c.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Node 25 cannot be installed here, so the run reports one: the CLI reads the same field.
const AS_NODE_25 =
  'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"25.9.0"})';

for (const [script, args] of [
  ["init.mjs", (d: string) => [d]],
  ["init.mjs", (d: string) => ["--remove", d]],
  ["install.mjs", () => []],
  ["install.mjs", () => ["--explore", "--tools"]],
  ["install.mjs", () => ["--remove"]],
] as const) {
  test(`${script} ${args("<dir>").join(" ")} on Node 25 exits 1 with one line, writing nothing`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "harry-script-entry-"));
    try {
      writeFileSync(path.join(dir, ".gitignore"), ".local/\n");
      const r = spawnSync(
        process.execPath,
        ["--import", AS_NODE_25, path.join(repoRoot, "scripts", script), ...args(dir)],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: dir,
            HARRY_GLOBAL: path.join(dir, ".claude", "CLAUDE.md"),
          },
        },
      );
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, "harry: Node 26 or newer is required; this is Node 25.9.0.\n");
      assert.deepEqual(readdirSync(dir), [".gitignore"], "nothing written");
      assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), ".local/\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** Every tracked .mjs or .mts module outside tests/ and evals/. */
const MODULES = WORKING_FILES.filter(
  (rel) => /\.(mjs|mts)$/.test(rel) && !/^(tests|evals)\//.test(rel),
);
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

test("no module reads process.argv beyond its CLI arguments", () => {
  assert.ok(MODULES.includes("scripts/install.mjs"), "the scan lost the scripts");
  // Any read but slice(2), so a destructure or .at(1) counts too.
  const hits = MODULES.filter((rel) => /process\.argv(?!\.slice\(2\))/.test(read(rel)));
  assert.deepEqual(hits, [], "decide the entry point with import.meta.main");
});

/** Ships to consumers: an .mjs under scripts/ (CLAUDE.md, "Lint and typecheck scope"). */
const ships = (rel: string): boolean => /^scripts\/.*\.mjs$/.test(rel);

/** Modules that read import.meta.main: each a library whose CLI runs only as the entry. */
const GUARDED = MODULES.filter((rel) => /\bimport\.meta\.main\b/.test(read(rel)));

test("no shipped script guards its CLI; the repo-local ones guard with import.meta.main", () => {
  assert.ok(
    GUARDED.includes("scripts/run-evals.mts"),
    `the scan lost the guarded scripts: ${GUARDED.join(", ")}`,
  );
  // A shipped module runs on the consumer's Node, which has import.meta.main only from
  // 24.2; a guard there would also make it a library again, which scripts/lib is for.
  assert.deepEqual(GUARDED.filter(ships), [], "move the logic into a scripts/lib module");
  const ownGuard = MODULES.filter((rel) => /\bisMain\b/.test(read(rel)));
  assert.deepEqual(ownGuard, [], "use import.meta.main");
});

// A static import: `import … from "x"`, `export … from "x"` or a bare `import "x"`.
const STATIC_IMPORT = /^\s*(?:import|export)\b(?:[^;]*?\bfrom\s*|\s*)["']([^"']+)["']/gm;

test("each shipped CLI imports only scripts/lib/node-floor.mjs statically", () => {
  for (const rel of SHIPPED_CLIS) {
    const targets = [...read(rel).matchAll(STATIC_IMPORT)].map(([, spec = ""]) =>
      spec.startsWith(".") ? path.posix.join(path.posix.dirname(rel), spec) : spec,
    );
    assert.deepEqual(
      targets,
      ["scripts/lib/node-floor.mjs"],
      `${rel}: load the rest with await import() after the floor check`,
    );
  }
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

test("a test reaches a shipped CLI only by type, and a guarded script only through loadScript", () => {
  for (const { file, why } of EXEMPT) {
    assert.ok(GUARDED.includes(file), `${file} is exempt but not guarded`);
    assert.ok(why.trim().length > 0, `${file} is exempt with no reason`);
  }
  const exempt = new Set(EXEMPT.map((e) => e.file));
  const guarded = GUARDED.filter((rel) => !exempt.has(rel));
  const loaded = new Set<string>();
  const wrong: string[] = [];
  for (const rel of WORKING_FILES.filter((r) => /^tests\/[^/]+\.ts$/.test(r))) {
    const text = read(rel);
    for (const m of text.matchAll(SPECIFIER)) {
      const target = path.posix.normalize(path.posix.join("tests", m[1] as string));
      const before = text.slice(0, m.index);
      const typeOnly = TYPE_ONLY.test(before);
      if (SHIPPED_CLIS.includes(target)) {
        if (!typeOnly && (LOADED.test(before) || IMPORTED.test(before)))
          wrong.push(`${rel}: ${target} (import its scripts/lib module)`);
      } else if (guarded.includes(target)) {
        if (LOADED.test(before)) loaded.add(target);
        else if (IMPORTED.test(before) && !typeOnly)
          wrong.push(`${rel}: ${target} (load it with loadScript from tests/load-script.ts)`);
      }
    }
  }
  assert.deepEqual(wrong, []);
  assert.deepEqual(
    [...loaded].sort(),
    [
      ".claude/scripts/item-edit.mts",
      ".claude/scripts/release-state.mts",
      ".claude/scripts/scratch-clone.mts",
      ".claude/scripts/test-path.mts",
      "scripts/run-evals.mts",
    ],
    "loadScript serves only the repo-local guarded scripts",
  );
});

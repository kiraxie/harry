import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
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
import { build } from "esbuild";

import { versionOnly } from "../build.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function tempDir(): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-build-")));
  test.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function bundle(entry: string) {
  return build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    plugins: [versionOnly],
  });
}

const ROGUE_IMPORTS: Record<string, (manifest: string) => string> = {
  "an import of package.json": (manifest) =>
    `import pkg from ${JSON.stringify(`${manifest}.json`)} with { type: "json" };\nexport const name = pkg.name;\n`,
  "an extensionless require": (manifest) =>
    `export const name = require(${JSON.stringify(manifest)}).name;\n`,
};

for (const [route, source] of Object.entries(ROGUE_IMPORTS)) {
  test(`the build fails, naming the importer, when a module other than version.ts reaches package.json through ${route}`, async () => {
    const dir = tempDir();
    const entry = path.join(dir, "rogue-importer.ts");
    writeFileSync(entry, source(path.relative(dir, path.join(REPO_ROOT, "package"))));
    await assert.rejects(bundle(entry), (err: { errors?: { text: string }[] }) => {
      assert.match(err.errors?.[0]?.text ?? "", /rogue-importer\.ts/);
      return true;
    });
  });
}

test("the build lets src/lib/version.ts import package.json", async () => {
  const result = await bundle(path.join(REPO_ROOT, "src/lib/version.ts"));
  assert.deepEqual(result.errors, []);
});

test("the plugin refuses a host that lets esbuild write its outfile", async () => {
  const entry = path.join(REPO_ROOT, "src/lib/version.ts");
  await assert.rejects(
    build({ entryPoints: [entry], bundle: true, logLevel: "silent", plugins: [versionOnly] }),
    (err: { errors?: { text: string; pluginName: string }[] }) => {
      assert.equal(err.errors?.[0]?.pluginName, "package-version-only");
      assert.match(err.errors?.[0]?.text ?? "", /needs write: false/);
      assert.match(err.errors?.[0]?.text ?? "", /before onEnd runs/);
      return true;
    },
  );
});

test("a build that fails on a rogue importer leaves dist/companion.cjs as it was", () => {
  const dir = tempDir();
  for (const file of ["build.mjs", "package.json"]) {
    copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file));
  }
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  mkdirSync(path.join(dir, "src"));
  writeFileSync(
    path.join(dir, "src/companion.ts"),
    `import pkg from "../package.json" with { type: "json" };\nconsole.log(pkg.name);\n`,
  );
  mkdirSync(path.join(dir, "dist"));
  const outfile = path.join(dir, "dist/companion.cjs");
  writeFileSync(outfile, "the committed bundle\n");

  const res = spawnSync(process.execPath, ["build.mjs"], { cwd: dir, encoding: "utf8" });

  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /src\/companion\.ts imports package\.json/);
  assert.equal(readFileSync(outfile, "utf8"), "the committed bundle\n");
});

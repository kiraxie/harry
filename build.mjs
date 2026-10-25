#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { build } from "esbuild";

// Bundle all npm deps into the output, keep Node built-ins external.
// We keep a defensive external list for Node built-ins in case any transitive
// dependency uses dynamic `require()` against them.

const manifest = resolve(import.meta.dirname, "package.json");
const versionModule = resolve(import.meta.dirname, "src/lib/version.ts");

/** @type {import("esbuild").Plugin} */
export const versionOnly = {
  name: "package-version-only",
  setup(b) {
    if (b.initialOptions.write !== false) {
      throw new Error(
        "package-version-only needs write: false: esbuild writes the outfile before onEnd runs, so a failed importer check would still overwrite it",
      );
    }
    b.initialOptions.metafile = true;
    b.onEnd((result) => {
      const cwd = b.initialOptions.absWorkingDir ?? process.cwd();
      const errors = Object.entries(result.metafile?.inputs ?? {})
        .map(([input, { imports }]) => ({ file: resolve(cwd, input), imports }))
        .filter(
          ({ file, imports }) =>
            file !== versionModule && imports.some((i) => resolve(cwd, i.path) === manifest),
        )
        .map(({ file }) => ({
          text: `${relative(import.meta.dirname, file)} imports package.json; only src/lib/version.ts may, since the bundle inlines its version alone`,
        }));
      return errors.length > 0 ? { errors } : undefined;
    });
    b.onLoad({ filter: /package\.json$/ }, (args) => {
      if (args.path !== manifest) return undefined;
      const { version } = JSON.parse(readFileSync(manifest, "utf-8"));
      return { contents: JSON.stringify({ version }), loader: "json" };
    });
  },
};

if (import.meta.main) {
  const { outputFiles } = await build({
    entryPoints: ["src/companion.ts"],
    outfile: "dist/companion.cjs",
    write: false,
    bundle: true,
    platform: "node",
    target: "node26",
    format: "cjs",
    sourcemap: false,
    minify: false,
    external: builtinModules.flatMap((m) => [m, `node:${m}`]),
    plugins: [versionOnly],
  });
  for (const out of outputFiles) {
    mkdirSync(dirname(out.path), { recursive: true });
    writeFileSync(out.path, out.contents, { mode: 0o755 });
  }

  console.log("Built dist/companion.cjs");
}

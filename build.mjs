#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

// Bundle all npm deps into the output, keep Node built-ins external.
// We keep a defensive external list for Node built-ins in case any transitive
// dependency uses dynamic `require()` against them.

const manifest = resolve("package.json");
const versionOnly = {
  name: "package-version-only",
  setup(b) {
    b.onLoad({ filter: /package\.json$/ }, (args) => {
      if (args.path !== manifest) return undefined;
      const { version } = JSON.parse(readFileSync(manifest, "utf-8"));
      return { contents: JSON.stringify({ version }), loader: "json" };
    });
  },
};

await build({
  entryPoints: ["src/companion.ts"],
  outfile: "dist/companion.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: builtinModules.flatMap((m) => [m, `node:${m}`]),
  plugins: [versionOnly],
});

console.log("Built dist/companion.cjs");

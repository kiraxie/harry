#!/usr/bin/env node
import { builtinModules } from "node:module";
import { build } from "esbuild";

// Bundle all npm deps into the output, keep Node built-ins external.
// We keep a defensive external list for Node built-ins in case any transitive
// dependency uses dynamic `require()` against them.

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
});

console.log("Built dist/companion.cjs");

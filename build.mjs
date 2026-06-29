#!/usr/bin/env node
import { builtinModules } from "node:module";
import { build } from "esbuild";

// Bundle all npm deps into the output, keep Node built-ins external.
// @github/copilot-sdk ships both ESM and CJS entry points; esbuild resolves
// the CJS entry via package.json "exports" when format: 'cjs' is set.
// We keep a defensive external list for Node built-ins in case any transitive
// dependency uses dynamic `require()` against them (same pattern as the
// sibling gemini plugin's handling of google-auth-library).

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

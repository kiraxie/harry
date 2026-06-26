#!/usr/bin/env node
import { builtinModules } from "node:module";
import { build } from "esbuild";

// Bundle all npm deps into the output, keep Node built-ins external.
// @github/copilot-sdk ships both ESM and CJS entry points; esbuild resolves
// the CJS entry via package.json "exports" when format: 'cjs' is set.
// We keep a defensive external list for Node built-ins in case any transitive
// dependency uses dynamic `require()` against them (same pattern as the
// sibling gemini plugin's handling of google-auth-library).

// DEBT: ported runtime still bundles the `implement`/`background` subcommands,
// which harry no longer exposes as commands (implementer = CC subagents). Ceiling:
// dormant dead code in dist, harmless. Upgrade path: drop src/commands/implement.ts
// + background.ts and their dispatch in copilot-companion.ts, then rebuild.
await build({
  entryPoints: ["src/copilot-companion.ts"],
  outfile: "dist/copilot-companion.cjs",
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: builtinModules.flatMap((m) => [m, `node:${m}`]),
});

console.log("Built dist/copilot-companion.cjs");

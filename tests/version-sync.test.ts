import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// `src/lib/version.ts` single-sources PLUGIN_VERSION from package.json, but both
// plugin manifests carry an independently hand-maintained `version`. Divergence
// would be a bug (HARRY.md §2 drift test), and nothing else enforces it — so this
// test is the enforcement: all three must agree.
function versionOf(relPath: string): string {
  const raw = readFileSync(new URL(relPath, import.meta.url), "utf-8");
  return (JSON.parse(raw) as { version?: string }).version ?? "";
}

test("package.json and both plugin manifests declare the same version", () => {
  const pkg = versionOf("../package.json");
  assert.ok(pkg, "package.json must declare a version");
  assert.equal(versionOf("../.claude-plugin/plugin.json"), pkg, ".claude-plugin/plugin.json");
  assert.equal(versionOf("../.codex-plugin/plugin.json"), pkg, ".codex-plugin/plugin.json");
});

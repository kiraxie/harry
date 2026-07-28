import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// `src/lib/version.ts` single-sources PLUGIN_VERSION from package.json, but the
// plugin manifests each carry an independently hand-maintained `version`.
// Divergence would be a bug (HARRY.md §2 drift test), and nothing else enforces
// it — so this test is the enforcement: every version-carrying manifest must
// agree with package.json.
function read(relPath: string): unknown {
  return JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf-8"));
}

function versionOf(relPath: string): string {
  return (read(relPath) as { version?: string }).version ?? "";
}

// The marketplace manifest nests its version inside the plugin entry — that is
// the string the marketplace picker displays, so it needs the same lock as the
// top-level ones. (`.agents/plugins/marketplace.json`, the Codex twin, carries
// no version field at all; there is nothing to check there.)
function marketplaceVersionOf(relPath: string, pluginName: string): string {
  const entries = (read(relPath) as { plugins?: Array<{ name?: string; version?: string }> })
    .plugins;
  const entry = entries?.find((p) => p.name === pluginName);
  assert.ok(entry, `${relPath}: no plugins[] entry named "${pluginName}"`);
  return entry.version ?? "";
}

test("package.json and every version-carrying manifest declare the same version", () => {
  const pkg = versionOf("../package.json");
  assert.ok(pkg, "package.json must declare a version");
  assert.equal(versionOf("../.claude-plugin/plugin.json"), pkg, ".claude-plugin/plugin.json");
  assert.equal(versionOf("../.codex-plugin/plugin.json"), pkg, ".codex-plugin/plugin.json");
  assert.equal(
    marketplaceVersionOf("../.claude-plugin/marketplace.json", "harry"),
    pkg,
    ".claude-plugin/marketplace.json plugins[harry].version",
  );
});

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// harry ships four durable-routing role agents. Each binds model+effort ONCE in
// frontmatter so predictable work self-routes (see .local item
// subagent-control-hardening). Nothing else enforces these invariants, so this test
// is the enforcement: model must be a churn-safe alias (never a pinned ID), writing
// roles must be leaf (can't recursively fan out), and the CC/Codex role sets must not
// drift apart.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ROLES = ["harry-scout", "harry-mech", "harry-writer", "harry-security"];
const WRITING_ROLES = new Set(["harry-mech", "harry-writer", "harry-security"]);
const MODEL_ALIASES = new Set(["haiku", "sonnet", "opus"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CODEX_EFFORTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "none",
]);

// Flat `key: value` YAML frontmatter (all agent frontmatter is flat scalars).
function readFrontmatter(file: string): Record<string, string> {
  const raw = readFileSync(file, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${file}: missing YAML frontmatter`);
  const fm: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1] as string] = (kv[2] ?? "").trim();
  }
  return fm;
}

const ccDir = path.join(repoRoot, "agents");

test("every CC role agent binds an alias model, a valid effort, and leaf-ness where it writes", () => {
  for (const role of ROLES) {
    const file = path.join(ccDir, `${role}.md`);
    assert.ok(existsSync(file), `missing CC agent: agents/${role}.md`);
    const fm = readFrontmatter(file);
    assert.equal(fm.name, role, `${role}: frontmatter name must equal the role`);
    assert.ok(fm.description, `${role}: description required`);
    assert.ok(
      MODEL_ALIASES.has(fm.model ?? ""),
      `${role}: model must be an alias (haiku|sonnet|opus), got "${fm.model}" — no pinned IDs`,
    );
    assert.ok(EFFORTS.has(fm.effort ?? ""), `${role}: effort must be one of ${[...EFFORTS]}`);
    if (WRITING_ROLES.has(role)) {
      const denied = fm.disallowedTools ?? "";
      assert.match(
        denied,
        /Agent/,
        `${role}: writing role must be leaf (disallowedTools includes Agent)`,
      );
      assert.match(denied, /Workflow/, `${role}: disallowedTools includes Workflow`);
    } else {
      // recon is read-only: a positive tools allowlist, no write capability
      assert.ok(fm.tools, `${role}: read-only recon must declare a tools allowlist`);
    }
  }
});

// Codex .toml agents are authored per the Codex distribution spike (item Task 2), at a
// path that spike confirms. Until they exist this test SKIPS (announced, not silently
// green); it activates the moment a Codex agents dir appears, guarding CC/Codex drift.
const CODEX_DIR_CANDIDATES = ["codex-agents", "agents"];

function readToml(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const kv = line.match(/^([A-Za-z_]+)\s*=\s*"(.*)"\s*$/);
    if (kv) out[kv[1] as string] = kv[2] as string;
  }
  return out;
}

test("Codex role agents pin effort only (no model) and mirror the CC role set — or are pending", (t) => {
  const dir = CODEX_DIR_CANDIDATES.map((d) => path.join(repoRoot, d)).find(
    (d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith(".toml")),
  );
  if (!dir) {
    t.skip(
      "Codex .toml agents not authored yet (pending the Codex distribution spike, item Task 2)",
    );
    return;
  }
  const codexRoles = readdirSync(dir)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => f.replace(/\.toml$/, ""));
  assert.deepEqual(
    [...codexRoles].sort(),
    [...ROLES].sort(),
    "Codex role set must match the CC role set (no drift)",
  );
  for (const role of ROLES) {
    const fm = readToml(path.join(dir, `${role}.toml`));
    assert.equal(fm.name, role, `${role}.toml: name must equal the role`);
    assert.ok(fm.description, `${role}.toml: description required`);
    assert.ok(fm.developer_instructions, `${role}.toml: developer_instructions required`);
    assert.ok(
      CODEX_EFFORTS.has(fm.model_reasoning_effort ?? ""),
      `${role}.toml: model_reasoning_effort invalid: "${fm.model_reasoning_effort}"`,
    );
    assert.ok(!("model" in fm), `${role}.toml: must OMIT model (effort-only routing on Codex)`);
  }
});

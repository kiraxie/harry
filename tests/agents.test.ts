import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// harry ships four durable-routing role agents (Claude Code only — Codex has no
// per-subagent model/effort binding; its routing is prose-only via HARRY.md §5).
// Each binds model+effort ONCE in frontmatter so predictable work self-routes.
// Nothing else enforces these invariants, so this test is the enforcement: model
// must be a churn-safe alias (never a pinned ID), and writing roles must be leaf
// (can't recursively fan out).

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ROLES = ["scout", "mech", "writer", "security"];
const WRITING_ROLES = new Set(["mech", "writer", "security"]);
const MODEL_ALIASES = new Set(["haiku", "sonnet", "opus"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

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
      // recon is read-only: a positive tools allowlist that grants no write or
      // fan-out capability (a bare truthy check would let a future edit slip Write in).
      assert.ok(fm.tools, `${role}: read-only recon must declare a tools allowlist`);
      const granted = (fm.tools ?? "").split(",").map((s) => s.trim());
      for (const forbidden of ["Write", "Edit", "NotebookEdit", "Bash", "Agent", "Workflow"]) {
        assert.ok(
          !granted.includes(forbidden),
          `${role}: read-only role must not grant ${forbidden} (tools: ${fm.tools})`,
        );
      }
    }
  }
});

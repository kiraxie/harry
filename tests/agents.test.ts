import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ROLES = ["scout", "analyst"];
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

test("AC-2: every role agent binds an alias model and effort, and neither has edit or spawn tools", () => {
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
    if (role === "analyst") {
      assert.equal(fm.model, "opus", "analyst: judgment runs on opus");
      assert.equal(fm.effort, "high", "analyst: judgment runs at high effort");
      const denied = (fm.disallowedTools ?? "").split(",").map((t) => t.trim());
      for (const tool of ["Edit", "Write", "NotebookEdit", "Agent", "Workflow"])
        assert.ok(denied.includes(tool), `analyst: disallowedTools must include ${tool}`);
    } else {
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

// A role's final-message contract says what the answer contains, not how many
// lines it may run to: a numeric cap is dated prompting and truncates real
// findings. scripts/assets/explore-override.md repeats scout's contract for the
// built-in Explore agent, so it is held to the same rule — edit both together.
test("no role's final-message contract caps its length in lines", () => {
  const files = [
    ...ROLES.map((role) => path.join(ccDir, `${role}.md`)),
    path.join(repoRoot, "scripts", "assets", "explore-override.md"),
  ];
  const lineCap = /~?\d+\s*-?\s*lines?\b/i;
  for (const file of files) {
    const body = readFileSync(file, "utf-8");
    assert.doesNotMatch(body, lineCap, `${path.relative(repoRoot, file)}: states a line cap`);
  }
});

test("AC-2: agents/ holds exactly the two roles", () => {
  const files = readdirSync(ccDir).filter((f) => f.endsWith(".md"));
  assert.deepEqual(files.sort(), ROLES.map((r) => `${r}.md`).sort());
});

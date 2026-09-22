import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Codex does not set `${CLAUDE_PLUGIN_ROOT}` in the shell a skill's commands run in
// (verified on codex-cli 0.155.1: `env` there has only CODEX_* names), so
// `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs"` expands to `/dist/companion.cjs`.
// Every Codex skill that uses the variable must first tell the model how to resolve it,
// and must do so before the first use — a rule stated after the command it governs is
// read too late.
//
// Codex auto-discovers the shared pipeline skills in `skills/` too, so the same rule
// binds any of them that uses the variable.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal variable name, as the skills write it.
const VAR = "${CLAUDE_PLUGIN_ROOT}";
/**
 * The rule as a skill's own SKILL.md must state it: the suffix to cut is that skill's
 * own path (`<dir>/<name>/SKILL.md`), so a rule copy-pasted from another skill (which
 * would cut the wrong suffix and resolve no root) does not pass.
 */
const rule = (dir: string, name: string): RegExp =>
  new RegExp(
    "\\*\\*Plugin root\\.\\*\\* Codex does not set `\\$\\{CLAUDE_PLUGIN_ROOT\\}`[\\s\\S]*?" +
      `cut the trailing \`${dir}/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/SKILL\\.md\` ` +
      "and the slash before it",
  );

/** Every skill directory under `dir` that has a SKILL.md. */
const skillsIn = (dir: string): string[] =>
  readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => readdirSync(path.join(repoRoot, dir, name)).includes("SKILL.md"));

/** The skills under `dir` whose SKILL.md uses the variable. */
const usersIn = (dir: string): string[] =>
  skillsIn(dir).filter((name) =>
    readFileSync(path.join(repoRoot, dir, name, "SKILL.md"), "utf-8").includes(VAR),
  );

/** Each of `names` under `dir` states its own rule, before its first use of the variable. */
function assertResolvedBeforeUse(dir: string, names: string[]): void {
  for (const name of names) {
    const rel = path.join(dir, name, "SKILL.md");
    const text = readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
    const found = rule(dir, name).exec(text);
    assert.ok(
      found,
      `${rel} uses ${VAR} but never says how to resolve it on Codex from its own path (${rel})`,
    );
    assert.equal(
      text.indexOf(VAR),
      found.index + found[0].indexOf(VAR),
      `${rel} uses ${VAR} before the rule that resolves it`,
    );
  }
}

test("every Codex skill that uses CLAUDE_PLUGIN_ROOT resolves it before first use", () => {
  const users = usersIn("codex-skills");
  assert.ok(
    users.length > 0,
    "no Codex skill uses the variable — renamed? this check is now blind",
  );
  assertResolvedBeforeUse("codex-skills", users);
});

test("every shared pipeline skill that uses CLAUDE_PLUGIN_ROOT resolves it before first use", () => {
  // None uses the variable today, so the only proof this scan still looks at
  // something is that it finds the skill files at all.
  assert.ok(
    skillsIn("skills").length > 0,
    "no SKILL.md found under skills/ — moved? this check is now blind",
  );
  assertResolvedBeforeUse("skills", usersIn("skills"));
});

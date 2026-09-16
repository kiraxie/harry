import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A gate the model cannot execute is not a gate. `commands/review.md` sets
// `disable-model-invocation: true` (inherited from codex-plugin-cc, which sets it on every
// quota-spending command), which blocks BOTH the SlashCommand and Skill tools — only a human
// typing the command can run it. Meanwhile HARRY.md §3 named `/review` as Major's review gate,
// so every Major silently ran on the declared fallback instead. The same shape already bit
// `/review --full`, whose `/code-review max` lane could never execute (dropped in 0.13.4).
//
// This test pins the invariant: files that tell the MODEL what to do may not name a command the
// model cannot invoke. Descriptive prose elsewhere (references/review-rubric.md's note that the
// frontier lane carries its own rubric, the audit reference's tool comparison, CHANGELOG history)
// is deliberately out of scope — the ban is on instructions, not on mentioning the command exists.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function markdownUnder(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

/**
 * Files that instruct the model: the resident laws, the tier gates, both builds' skill trees
 * (`skills/` is shared, `codex-skills/` is the Codex build's own tree), the role agents, and every
 * command the model can reach.
 *
 * Two deliberate exclusions, both blind spots on purpose. A blocked command's OWN file
 * (`commands/review.md`) is skipped: it only ever runs because a human typed it, and its body
 * documents its own flag and the `/code-review` lane dropped for carrying the same one. The cost is
 * real — those four documentary lines are exactly the shape this test hunts, so a genuine defect
 * added to that file would not be caught here. Rewording accurate documentation to satisfy a guard
 * is the wrong trade; the skip stays and the blind spot is written down. Likewise `references/`
 * beyond the tier gates describes the slash commands rather than telling the model to run them
 * (`review-orchestration.md`, `audit/ORCHESTRATION.md`) — the ban is on instructions.
 */
function gateFiles(blocked: string[]): string[] {
  const ownFiles = new Set(blocked.map((name) => path.join("commands", `${name}.md`)));
  return [
    "HARRY.md",
    "references/tier-gates.md",
    ...["skills", "codex-skills", "agents", "commands", ".claude/commands"].flatMap(markdownUnder),
  ].filter((rel) => !ownFiles.has(rel));
}

/**
 * Claude Code's own `/code-review` also sets the flag. It lives outside this repo, so it cannot be
 * read from frontmatter — it is pinned here from the 0.13.4 finding that no agent could drive it.
 */
const EXTERNAL_BLOCKED = ["code-review"];

function blockedCommandNames(): string[] {
  const dir = path.join(repoRoot, "commands");
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => {
      const text = readFileSync(path.join(dir, f), "utf-8");
      const frontmatter = text.startsWith("---") ? text.slice(3).split("\n---")[0] : "";
      return /^disable-model-invocation:\s*true\s*$/m.test(frontmatter);
    })
    .map((f) => path.basename(f, ".md"));
  return [...names, ...EXTERNAL_BLOCKED];
}

/**
 * `/name` as a command mention, bare or namespaced: Claude Code exposes a plugin's commands as
 * `/harry:review`, which is the form a real instruction uses, so both must be caught. Not a path
 * (`commands/review.md`, `codex-skills/review/SKILL.md`) and not a file reference; backticks
 * around it are fine — that is how prose writes it.
 */
function commandMention(name: string): RegExp {
  return new RegExp(`(?<![\\w/.\\-])/(?:harry:)?${name}\\b(?!\\.md|/)`);
}

test("the mention matcher catches both invocation forms and no path", () => {
  const re = () => commandMention("review");
  for (const hit of [
    "Route to harry's `/review` (frontier)",
    "run /harry:review now",
    "| `/review` |",
  ]) {
    assert.ok(re().test(hit), `should have matched: ${hit}`);
  }
  for (const miss of [
    "see commands/review.md",
    "codex-skills/review/SKILL.md is the Codex door",
    "the /audit command",
  ]) {
    assert.ok(!re().test(miss), `should NOT have matched: ${miss}`);
  }
});

test("the blocked-command scan actually finds the commands it is meant to find", () => {
  const blocked = blockedCommandNames();
  assert.ok(
    blocked.includes("review"),
    `expected commands/review.md to carry disable-model-invocation; scan found: ${blocked.join(", ") || "(none)"}`,
  );
});

test("no gate file instructs the model to invoke a command the model cannot invoke", () => {
  const blocked = blockedCommandNames();
  const offences: string[] = [];

  for (const rel of gateFiles(blocked)) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const lines = readFileSync(abs, "utf-8").split("\n");
    for (const name of blocked) {
      const mention = commandMention(name);
      lines.forEach((line, i) => {
        if (mention.test(line)) offences.push(`${rel}:${i + 1} names /${name}`);
      });
    }
  }

  assert.deepEqual(
    offences,
    [],
    `Gate files may not tell the model to invoke a disable-model-invocation command.\n${offences.join("\n")}\n` +
      "Fix the instruction (name a callable lane), not this test.",
  );
});

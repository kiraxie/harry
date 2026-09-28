import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A gate the model cannot execute is not a gate. `commands/review.md` used to set
// `disable-model-invocation: true` (inherited from codex-plugin-cc, which sets it on every
// quota-spending command), which blocks BOTH the SlashCommand and Skill tools — only a human
// typing the command can run it. Meanwhile HARRY.md §3 named `/review` as Major's review gate,
// so every Major silently ran on the declared fallback instead. The same shape already bit
// `/review --full`, whose `/code-review max` lane could never execute (dropped in 0.13.4).
// `/review` has since dropped the flag so the executing skill can call it; Claude Code's own
// `/code-review` still carries it.
//
// This test pins the invariant: files that tell the MODEL what to do may not name a command the
// model cannot invoke. Descriptive prose elsewhere (the audit reference's tool comparison,
// CHANGELOG history)
// is deliberately out of scope — the ban is on instructions, not on mentioning the command exists.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function markdownUnder(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  assert.ok(
    existsSync(abs),
    `markdownUnder("${dir}"): scanned tree does not exist at ${abs} — a deleted-last-file ` +
      "tree must fail this assertion, not throw a raw ENOENT out of readdirSync.",
  );
  return readdirSync(abs, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

/**
 * Own-file exemptions: files the scan skips even though they may name a blocked command,
 * each with the blocked name(s) it documents and why that mention is not an instruction to
 * the model. Hand-maintained and explicit — deliberately NOT derived from `blockedCommandNames()`
 * — so a newly blocked command's own file is scanned like every other gate file until someone
 * adds it here by name, with its own reasoning. A generic "skip every blocked command's own
 * commands/<name>.md" rule would silently exempt that future file too; this list is the fix.
 *
 * Empty today: no command in this repo currently carries `disable-model-invocation` (the file
 * banner's history is why the shape exists — `commands/review.md` used to, back when `/review`
 * itself set the flag). A blocked name with no matching entry here gets no free pass; its file
 * is scanned in full, own-file or not.
 */
const GATE_SCAN_EXEMPTIONS: ReadonlyArray<{ path: string; names: string[]; reason: string }> = [];

/**
 * Files that instruct the model: the resident laws, the tier gates, `CLAUDE.md` (repo guidance
 * the model reads every session), both builds' skill trees (`skills/` is shared, `codex-skills/`
 * is the Codex build's own tree), the role agents, and every command the model can reach.
 *
 * One deliberate exclusion beyond `GATE_SCAN_EXEMPTIONS`: `references/` beyond the tier gates
 * describes the slash commands rather than telling the model to run them
 * (`audit/ORCHESTRATION.md`) — the ban is on instructions, not on mentioning a command exists.
 */
function gateFiles(): string[] {
  const exempt = new Set(GATE_SCAN_EXEMPTIONS.map((e) => e.path));
  return [
    "HARRY.md",
    "CLAUDE.md",
    "references/tier-gates.md",
    ...["skills", "codex-skills", "agents", "commands", ".claude/commands"].flatMap(markdownUnder),
  ].filter((rel) => !exempt.has(rel));
}

/**
 * Claude Code's own `/code-review` also sets the flag. It lives outside this repo, so it cannot be
 * read from frontmatter — it is pinned here from the 0.13.4 finding that no agent could drive it.
 */
const EXTERNAL_BLOCKED = ["code-review"];

function blockedCommandNames(dir = path.join(repoRoot, "commands")): string[] {
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
  // No command in this repo carries the flag any more, so the frontmatter parse is proven
  // against a fixture — otherwise a broken parse would read as "nothing is blocked".
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-gates-"));
  try {
    writeFileSync(
      path.join(dir, "blocked.md"),
      "---\ndescription: x\ndisable-model-invocation: true\n---\nbody\n",
    );
    writeFileSync(
      path.join(dir, "open.md"),
      "---\ndescription: x\n---\ndisable-model-invocation: true\n",
    );
    const blocked = blockedCommandNames(dir);
    assert.ok(blocked.includes("blocked"), `frontmatter flag not detected: ${blocked.join(", ")}`);
    assert.ok(!blocked.includes("open"), "a body mention must not count as the frontmatter flag");
    assert.ok(blocked.includes("code-review"), "the external /code-review pin went missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/review is model-invocable, so the executing skill can call it", () => {
  assert.ok(
    !blockedCommandNames().includes("review"),
    "commands/review.md sets disable-model-invocation again",
  );
});

test("GATE_SCAN_EXEMPTIONS: every entry's path exists and every name it lists is actually blocked", () => {
  // A stale entry is the same disease in reverse: an exemption whose command is no longer
  // blocked (or whose file was renamed/removed) silently keeps a file out of the scan for no
  // live reason. This guards the allowlist itself, not just the scan it feeds.
  const blocked = blockedCommandNames();
  for (const entry of GATE_SCAN_EXEMPTIONS) {
    assert.ok(
      existsSync(path.join(repoRoot, entry.path)),
      `GATE_SCAN_EXEMPTIONS: "${entry.path}" does not exist — remove the stale entry`,
    );
    for (const name of entry.names) {
      assert.ok(
        blocked.includes(name),
        `GATE_SCAN_EXEMPTIONS: "${entry.path}" exempts "/${name}", which is not currently ` +
          "blocked — remove the stale entry",
      );
    }
  }
});

test("no gate file instructs the model to invoke a command the model cannot invoke", () => {
  const blocked = blockedCommandNames();
  const offences: string[] = [];

  for (const rel of gateFiles()) {
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

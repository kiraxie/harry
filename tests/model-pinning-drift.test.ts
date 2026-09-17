import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// harry passes no model to Codex: `review` and `ask` spawn the Codex CLI without
// `-m`, so `~/.codex/config.toml` decides. The doors are the prose a consumer
// acts on, and a model id there reads as a claim about what harry sends. This
// guard keeps them from regrowing one — the same drift the old per-lane pins had,
// when a door kept naming `gpt-5.6-sol` long after an account could not reach it.
//
// Out of scope, on purpose: README.md and references/codex-role-mapping.md name
// models as configuration advice (the advisory CC-role -> Codex-model table), and
// upstream.json records history. They say what an operator may choose, not what
// harry sends.
//
// One exception: a line may name a model while saying it is NOT usable — an
// honest note about an account that cannot reach a model is not a claim.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Any `gpt-<major>[.<minor>][-<name>]` id — suffix-less ids (`gpt-5.5`) are claims too. */
const MODEL_ID_RE = /gpt-\d+(?:\.\d+)?(?:-[a-z]+)?/g;

const UNAVAILABILITY_MARKERS = [/not supported/i, /\b400\b/, /why not/i, /reject/i];

function doorFiles(): string[] {
  const files = readdirSync(path.join(repoRoot, "commands"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `commands/${f}`);
  for (const dir of readdirSync(path.join(repoRoot, "codex-skills"), { withFileTypes: true })) {
    if (dir.isDirectory()) files.push(`codex-skills/${dir.name}/SKILL.md`);
  }
  return files;
}

const excused = (line: string): boolean => UNAVAILABILITY_MARKERS.some((m) => m.test(line));

test("no door claims a model harry sends", () => {
  const files = doorFiles();
  assert.ok(files.length >= 8, `expected the door corpus, found ${files.length} files`);

  const claims: string[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(path.join(repoRoot, rel), "utf-8");
    } catch {
      continue; // a codex-skills entry without a SKILL.md is not a door
    }
    text.split("\n").forEach((line, i) => {
      for (const id of line.match(MODEL_ID_RE) ?? []) {
        if (!excused(line)) claims.push(`${rel}:${i + 1} names ${id}`);
      }
    });
  }
  assert.deepEqual(
    claims,
    [],
    "a door names a model as if harry sent it; the Codex config decides",
  );
});

test("the scan sees a model id and the exception is narrow", () => {
  // Non-vacuity: the pattern must match the shape a stale claim takes, and the
  // unavailability exception must not excuse that claim.
  const staleClaim = "- design-challenge review, `gpt-5.6-sol`.";
  const honestNote = "**Why not `gpt-5.6-sol`:** it is not supported on a ChatGPT account.";
  assert.deepEqual(staleClaim.match(MODEL_ID_RE), ["gpt-5.6-sol"]);
  // A suffix-less id is still a claim, and a suffixed one matches whole.
  assert.deepEqual("- the gpt voice runs `gpt-5.5`.".match(MODEL_ID_RE), ["gpt-5.5"]);
  assert.deepEqual("uses gpt-5.6-luna here".match(MODEL_ID_RE), ["gpt-5.6-luna"]);
  assert.equal(excused(staleClaim), false, "a stale claim must NOT be excused");
  assert.equal(excused(honestNote), true, "the documented rejection must be excused");
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  KNOWN_MODELS,
  MODEL_WITHOUT_SOL,
  modelEnvVar,
  PINNED_MODELS,
  resolveModel,
} from "../src/lib/models.ts";

// Every shipped door, reference and manifest that NAMES a Codex model is claiming
// what harry will actually send, and eleven sites name one. On 2026-08-08 a
// model-swap touched all eleven BY HAND — nothing tied the prose to the code — and
// the swap was then reverted, which is exactly the shape that leaves half the sites
// stale without a single test going red.
//
// This ties them: a model id in shipped prose must be one src/lib/models.ts knows
// (a default, or the documented `--model` override), UNLESS that line is explicitly
// about a model being unavailable. That exception is deliberately narrow — without
// it, an honest note about an account that cannot reach a model would be
// indistinguishable from a stale claim about what harry sends.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

/** Any `gpt-<major>.<minor>-<name>` id, the shape every current pin uses. */
const MODEL_ID_RE = /gpt-\d+(?:\.\d+)?-[a-z]+/g;

/**
 * A line may name an unpinned model only while saying it is NOT usable. Requiring a
 * specific marker (rather than any prose) keeps the exception from swallowing the
 * rule: a stale "--adversarial uses gpt-5.6-sol" carries none of these.
 */
const UNAVAILABILITY_MARKERS = [
  /not supported/i,
  /\b400\b/,
  /why not/i,
  /reject/i,
  /not a default/i,
];

function shippedProseFiles(): string[] {
  const files = ["README.md", "upstream.json", "references/codex-role-mapping.md"];
  for (const entry of readdirSync(path.join(repoRoot, "commands"))) {
    if (entry.endsWith(".md")) files.push(`commands/${entry}`);
  }
  for (const dir of readdirSync(path.join(repoRoot, "codex-skills"))) {
    const skill = `codex-skills/${dir}/SKILL.md`;
    try {
      readFileSync(path.join(repoRoot, skill));
      files.push(skill);
    } catch {
      // not every entry is a skill directory
    }
  }
  return files;
}

test("shipped prose names only models src/lib/models.ts knows", () => {
  const known = new Set(KNOWN_MODELS);
  assert.ok(known.size > 0, "KNOWN_MODELS is empty — the guard would be vacuous");

  const files = shippedProseFiles();
  assert.ok(files.length >= 8, `expected the shipped prose corpus, found ${files.length} files`);

  let sightings = 0;
  const stale: string[] = [];
  for (const rel of files) {
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        for (const id of line.match(MODEL_ID_RE) ?? []) {
          sightings++;
          if (known.has(id)) continue;
          if (UNAVAILABILITY_MARKERS.some((m) => m.test(line))) continue;
          stale.push(`${rel}:${i + 1} names ${id}, which src/lib/models.ts does not know`);
        }
      });
  }
  // Vacuity guard: if a refactor stops prose naming models at all, this test must
  // fail loudly rather than pass by finding nothing.
  assert.ok(sightings > 0, "no model id found anywhere in shipped prose — guard is vacuous");
  assert.deepEqual(stale, [], "prose naming a model the code does not pin");
});

test("the unavailability exception cannot swallow a stale claim", () => {
  // Proves the marker list is doing work: the sentence shape that broke (a door
  // presenting an unpinned model as the one it uses) is NOT excused, while the
  // sentence that documents the rejection is.
  const staleClaim = "- `--adversarial` → design-challenge review, `gpt-5.6-sol`.";
  const honestNote = "**Why not `gpt-5.6-sol`:** it is not supported on a ChatGPT account.";
  const excused = (line: string): boolean => UNAVAILABILITY_MARKERS.some((m) => m.test(line));

  assert.equal(excused(staleClaim), false, "a stale claim must NOT be excused");
  assert.equal(excused(honestNote), true, "the documented rejection must be excused");
});

// The durable escape hatch for a login that cannot reach a default. Without it the
// only remedy is `--model` on every invocation, which is why an unsubscribed account
// had no working ask/fix/adversarial path at all.
test("HARRY_MODEL_* overrides the shipped default, and only when set", () => {
  assert.equal(resolveModel("judgment", {}), "gpt-5.6-sol", "default when unset");
  assert.equal(
    resolveModel("judgment", { HARRY_MODEL_JUDGMENT: MODEL_WITHOUT_SOL }),
    MODEL_WITHOUT_SOL,
    "override wins",
  );
  // Blank / whitespace is treated as unset: an exported-but-empty variable is the
  // shape a shell profile produces by accident, and it must not blank the model.
  for (const blank of ["", "   "]) {
    assert.equal(
      resolveModel("judgment", { HARRY_MODEL_JUDGMENT: blank }),
      "gpt-5.6-sol",
      `blank override (${JSON.stringify(blank)}) falls back to the default`,
    );
  }
  // Roles are independent — overriding one must not move another.
  const env = { HARRY_MODEL_JUDGMENT: MODEL_WITHOUT_SOL };
  assert.equal(resolveModel("standard", env), "gpt-5.6-terra", "standard untouched");
  assert.equal(resolveModel("adversarial", env), "gpt-5.6-sol", "adversarial untouched");
  assert.equal(modelEnvVar("adversarial"), "HARRY_MODEL_ADVERSARIAL");
});

test("PINNED_MODELS describes the SHIPPED defaults, not the overridden ones", () => {
  // The prose guard checks documentation against this list, so an operator's local
  // override must not silently redefine what the docs are held to.
  assert.deepEqual([...PINNED_MODELS].sort(), ["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-terra"]);
});

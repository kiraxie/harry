import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { section } from "./section.ts";

// HARRY.md's red-line list (in **Tiers**) and references/tier-gates.md's promotion-trigger list
// encode the SAME nine domains that auto-promote a task to Major. tier-gates.md itself
// declares "HARRY.md is authoritative: if this list and HARRY.md diverge, HARRY.md wins" — so the two
// must not drift, and nothing else enforces that. This test does: nine wording-tolerant
// probes, each asserted present in BOTH files' marked regions (a dropped or renamed
// domain fails its probe), plus a count lock on each region (a 10th domain added to one
// file only fails the count). Probes target the domain CONCEPT as it actually appears,
// not exact prose, so benign rewording doesn't false-alarm.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

// The canonical nine promotion-trigger domains, derived ONCE (the drift test's hoist closure:
// no per-assertion re-listing). Each regex is tolerant of wording — it targets the concept
// as it appears in BOTH files, not a fixed phrase, and is derived from their actual text.
const DOMAIN_PROBES: Record<string, RegExp> = {
  security: /security/i,
  money: /money|payment/i,
  "destructive / delete": /destructive|irreversible|deletion|\bdelete\b/i,
  migration: /migration/i,
  "external contract": /external contract/i,
  "cross-boundary contract": /cross-boundary/i,
  "input validation": /input validation/i,
  "data-loss error handling": /data[\s-]?loss|losing data/i,
  accessibility: /accessibility/i,
};
const N = Object.keys(DOMAIN_PROBES).length; // 9 — the locked domain count

// --- region extractors (no markdown parser; the structure is stable and simple) ---

// HARRY.md's red-line sentence, in **Tiers**: the domains after its colon.
function harryRedLines(): string {
  const line = read("HARRY.md")
    .split("\n")
    .find((l) => l.startsWith("**Red lines**"));
  assert.ok(line, "HARRY.md: no '**Red lines**' sentence found");
  return line.slice(line.indexOf(":") + 1);
}

// tier-gates.md promotion-domain list: from "If the task touches any of:" through just
// before "…then it is **Major**" — i.e. exactly the nine domain bullets and nothing else.
const TIER_GATES = "references/tier-gates.md";
const DOMAIN_LIST = ["If the task touches any of:", "then it is **Major**"] as const;

// --- probes: every domain present in BOTH files (catches a dropped/renamed domain) ---

test("HARRY.md's red-line list names all nine promotion-trigger domains", () => {
  const region = harryRedLines();
  for (const [name, probe] of Object.entries(DOMAIN_PROBES)) {
    assert.match(region, probe, `HARRY.md's red lines miss the "${name}" domain (probe ${probe})`);
  }
});

test("tier-gates.md promotion list names all nine promotion-trigger domains", () => {
  const region = section(read(TIER_GATES), TIER_GATES, ...DOMAIN_LIST);
  for (const [name, probe] of Object.entries(DOMAIN_PROBES)) {
    assert.match(
      region,
      probe,
      `tier-gates.md promotion list missing the "${name}" domain (probe ${probe})`,
    );
  }
});

// --- count locks: a 10th domain added to ONE file only must fail ---

test("tier-gates.md promotion list has exactly N domain bullets", () => {
  // Each domain is one "- **…**" sub-bullet in the marked region; count them.
  const bullets =
    section(read(TIER_GATES), TIER_GATES, ...DOMAIN_LIST).match(/^\s*-\s+\*\*/gm) ?? [];
  assert.equal(
    bullets.length,
    N,
    `tier-gates.md promotion list must hold exactly ${N} domain bullets, found ${bullets.length}`,
  );
});

test("HARRY.md's red-line sentence lists exactly N domains", () => {
  // One sentence of semicolon-separated domains. A semicolon added inside one
  // domain's phrasing trips this too; that loudness is acceptable.
  const domains = harryRedLines()
    .replace(/\.\s*$/, "")
    .split(/;\s*/)
    .filter(Boolean);
  assert.equal(
    domains.length,
    N,
    `HARRY.md's red-line sentence must list ${N} domains, found ${domains.length}: ${domains.join(" | ")}`,
  );
});

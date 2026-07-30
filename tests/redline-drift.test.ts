import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// HARRY.md §2's red-line list and references/tier-gates.md's promotion-trigger list
// encode the SAME nine domains that auto-promote a task to Major. tier-gates.md itself
// declares "§2 is authoritative: if this list and §2 diverge, §2 wins" — so the two
// must not drift, and nothing else enforces that. This test does: nine wording-tolerant
// probes, each asserted present in BOTH files' marked regions (a dropped or renamed
// domain fails its probe), plus a count lock on each region (a 10th domain added to one
// file only fails the count). Probes target the domain CONCEPT as it actually appears,
// not exact prose, so benign rewording doesn't false-alarm.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

// The canonical nine promotion-trigger domains, derived ONCE (HARRY.md §2 hoist-closure:
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

// HARRY.md §2 body: the "## §2 …" heading through just before the next "## " heading.
function harrySection2(): string {
  const lines = read("HARRY.md").split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes("§2"));
  assert.ok(start >= 0, "HARRY.md: no '## §2' heading found");
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join("\n");
}

// tier-gates.md promotion-domain list: from "If the task touches any of:" through just
// before "…then it is **Major**" — i.e. exactly the nine domain bullets and nothing else.
function tierGatesDomainList(): string {
  const text = read("references/tier-gates.md");
  const start = text.search(/If the task touches any of:/);
  assert.ok(start >= 0, "tier-gates.md: no 'If the task touches any of:' marker");
  const rest = text.slice(start);
  const end = rest.search(/then it is \*\*Major\*\*/);
  assert.ok(end >= 0, "tier-gates.md: no 'then it is **Major**' marker");
  return rest.slice(0, end);
}

// --- probes: every domain present in BOTH files (catches a dropped/renamed domain) ---

test("HARRY.md §2 red-line list names all nine promotion-trigger domains", () => {
  const region = harrySection2();
  for (const [name, probe] of Object.entries(DOMAIN_PROBES)) {
    assert.match(
      region,
      probe,
      `HARRY.md §2 missing the "${name}" red-line domain (probe ${probe})`,
    );
  }
});

test("tier-gates.md promotion list names all nine promotion-trigger domains", () => {
  const region = tierGatesDomainList();
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
  const bullets = tierGatesDomainList().match(/^\s*-\s+\*\*/gm) ?? [];
  assert.equal(
    bullets.length,
    N,
    `tier-gates.md promotion list must hold exactly ${N} domain bullets, found ${bullets.length}`,
  );
});

test("HARRY.md §2 encodes exactly N domains (N-1 inline + cross-boundary bullet)", () => {
  const region = harrySection2();
  // The first "- " item after "Never simplify these away:" is the inline red-line bullet:
  // one line of semicolon-separated domains. The ninth domain — cross-boundary contract —
  // is its own named bullet (asserted by its probe above). The remaining named bullet in
  // §2 (user-requested; the hoist rules now live inside the cross-boundary bullet) is NOT
  // a promotion trigger and is deliberately excluded, so a bare bullet count is not lockable here — we lock the
  // honestly-lockable inline list instead.
  // The lock is also brittle toward false POSITIVES: a semicolon added inside one
  // domain's phrasing, or a reorder changing which bullet comes first, trips it.
  // That loudness is acceptable — adjust the split if §2's phrasing legitimately changes.
  const firstBullet = region.split("\n").find((l) => /^-\s+\S/.test(l));
  assert.ok(firstBullet, "HARRY.md §2: no red-line list bullet found");
  const inline = firstBullet
    .replace(/^-\s+/, "")
    .replace(/\.\s*$/, "")
    .split(/;\s*/)
    .filter(Boolean);
  assert.equal(
    inline.length,
    N - 1,
    `HARRY.md §2 inline red-line bullet must list ${N - 1} domains, found ${inline.length}: ${inline.join(" | ")}`,
  );
  assert.match(
    region,
    DOMAIN_PROBES["cross-boundary contract"] as RegExp,
    "HARRY.md §2 must carry cross-boundary contract as the ninth domain (its own bullet)",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LINE_END_RE } from "./lines.ts";
import { PROSE_DIR_FILES, TOP_LEVEL } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ");
const PLAIN_LANGUAGE = "references/plain-language.md";
const DOOR = path.join("commands", "wait-what.md");

test("AC-4: the /wait-what door points at plain-language.md", () => {
  assert.ok(
    read(DOOR).includes(PLAIN_LANGUAGE),
    `${DOOR} no longer points at ${PLAIN_LANGUAGE}, which owns the deeper level`,
  );
});

const corpus = (): string[] => [...TOP_LEVEL, ...PROSE_DIR_FILES];

const GONE = {
  breaker: /\bbreakers?\b/i,
  "law-wiring": /law[-\s]wiring/i,
} as const;

const SURVIVING: Record<string, { re: RegExp; allowed: string[] }> = {
  "premise check": {
    re: /premise[-\s]checks?/i,
    allowed: [path.join("skills", "brainstorming", "SKILL.md"), "references/debt-audit.md"],
  },
  flush: {
    re: /\bflush\w*/i,
    allowed: [path.join("skills", "finishing", "SKILL.md"), "references/doc-types.md"],
  },
  hoist: {
    re: /\bhoist\w*/i,
    allowed: [
      path.join("commands", "audit.md"),
      "references/audit/DEEP-DIVE.md",
      "references/audit/ORCHESTRATION.md",
      "references/audit/RECON.md",
      "references/audit/SCAN-DIMENSIONS.md",
      "references/audit/VALIDATION-AND-REPORTING.md",
      "references/audit/report-schema.json",
      "references/audit/validate-findings.cjs",
    ],
  },
};

test("AC-5: the cut-term regexes still match the prose they replaced", () => {
  assert.ok(
    GONE.breaker.test("the breaker trips after three failed fixes"),
    "Proven against literals from the text this unit removed, so a regex that stopped matching cannot read the same as a corpus with nothing to flag.",
  );
  assert.ok(GONE["law-wiring"].test("`sync`'s law-wiring inlines HARRY.md's content"));
  assert.ok(GONE["law-wiring"].test("the law wiring runs at install time"));
  assert.ok(SURVIVING["premise check"]?.re.test("run step 9's premise check"));
  assert.ok(SURVIVING["premise check"]?.re.test("run step 9's premise-check"));
  assert.ok(SURVIVING.flush?.re.test("only `## Follow-ups` is flushed"));
  assert.ok(SURVIVING.flush?.re.test("flushing `## Follow-ups` before the archive"));
  assert.ok(SURVIVING.hoist?.re.test("suggest the hoist and its destination"));
});

test("AC-5: the terms cut entirely are absent from all prose", () => {
  const files = corpus();
  assert.ok(files.includes("HARRY.md"), "the resident laws dropped out of the jargon scan");
  const offenders: string[] = [];
  for (const rel of files) {
    const text = flat(read(rel));
    for (const [term, re] of Object.entries(GONE))
      if (re.test(text)) offenders.push(`${rel} (${term})`);
  }
  assert.deepEqual(
    offenders,
    [],
    "a term this unit cut is back in the prose with no definition behind it" +
      " — " +
      "Whole file, flattened — not line by line: a hard wrap inside `law\\nwiring` would otherwise split the term across two lines that each pass.",
  );
});

for (const [term, { re, allowed }] of Object.entries(SURVIVING)) {
  test(`AC-5: "${term}" appears only where it is defined`, () => {
    const offenders = corpus()
      .filter((rel) => !allowed.includes(rel))
      .filter((rel) => re.test(read(rel)));
    assert.deepEqual(
      offenders,
      [],
      `"${term}" is used in a file that does not define it. Either gloss it at the new ` +
        "site and add the file here, or use the plain words instead (HARRY.md Talk). " +
        "Limit: a second, ungrounded use inside an allowlisted file is not caught; " +
        "that is not mechanically decidable. Deliberately not an exact equality with the " +
        "files on disk, so a copy-edit that drops one use does not fail.",
    );

    assert.ok(
      allowed.some((rel) => re.test(read(rel))),
      `"${term}" no longer appears in any allowlisted file — move it to GONE` +
        " — " +
        "The allowlist is only honest while the term is still in use: once every allowed file drops it, the entry belongs in GONE, where a reappearance is flagged anywhere rather than silently permitted across this whole list.",
    );
  });
}

test("AC-6: 'tier' is defined by the enumeration in HARRY.md's Tiers and tier-gates.md", () => {
  const tiersLaw = headingSection(read("HARRY.md"), "HARRY.md", "## Tiers");
  const tiers = tiersLaw
    .split("\n")
    .map((l) => /^- \*\*(\w+)\*\* — /.exec(l)?.[1])
    .filter(Boolean);
  assert.deepEqual(
    tiers,
    ["Trivial", "Standard", "Major"],
    "HARRY.md Tiers no longer enumerates exactly the three tiers; the enumeration is the definition of 'tier', and every trigger line is read so a fourth tier fails too",
  );
});

test("plain-language and pr-body never use 'shape', finishing's term for an API, schema or boundary", () => {
  for (const rel of [PLAIN_LANGUAGE, "references/pr-body.md"]) {
    const hits = read(rel)
      .split(LINE_END_RE)
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /shape/i.test(l))
      .map(([n, l]) => `${rel}:${n}: ${l.trim()}`);
    assert.deepEqual(
      hits,
      [],
      "'shape' is finishing's defined term for an API, schema or boundary",
    );
  }
});

test("the visual rule is named 'Show the structure' in plain-language and pr-body", () => {
  assert.ok(
    read(PLAIN_LANGUAGE).includes("**Show the structure.**"),
    "plain-language lost the bullet",
  );
  assert.ok(
    read("references/pr-body.md").includes("**Show the structure**"),
    "pr-body no longer points to the bullet",
  );
});

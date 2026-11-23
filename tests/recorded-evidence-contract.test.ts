import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, outline, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const EXECUTING = path.join("skills", "executing", "SKILL.md");
const FINISHING = path.join("skills", "finishing", "SKILL.md");
const RULES = path.join("references", "recorded-evidence.md");

const plain = (text: string): string => text.replace(/\s+/g, " ");

const dispatches = (): [string, string][] => {
  const executing = read(EXECUTING);
  return [
    [
      "executing's fix check",
      section(executing, EXECUTING, "**Check the fixes first.**", "A small fix ("),
    ],
    [
      "executing's scoped re-review",
      section(
        executing,
        EXECUTING,
        "**exactly one scoped re-review**",
        "It reports in the rubric's",
      ),
    ],
    [
      "finishing's fix check",
      section(read(FINISHING), FINISHING, "- Any other **fix now**", "\n- **backlog**"),
    ],
  ];
};

const handOver = (): string[] => {
  const opening = /hand it over: (.*?)\. It applies/.exec(plain(read(RULES)));
  assert.ok(opening, "the rule file no longer lists what its callers hand over");
  return (opening[1] ?? "")
    .split(/, (?:and )?/)
    .map((part) => part.replace(/^this file\b/, "`references/recorded-evidence.md`"));
};

test("AC-2: each reviewer dispatch hands what the rule file says its callers hand", () => {
  const parts = handOver();
  assert.equal(parts.length, 3, `the hand-over list changed shape: ${parts.join(" | ")}`);
  for (const [name, text] of dispatches())
    for (const part of parts)
      assert.ok(plain(text).includes(part), `${name} no longer hands ${part}`);
});

const suiteForms = (text: string): string[] => [
  ...new Set([...text.matchAll(/`suite at [^`]*`/g)].map((m) => m[0])),
];

test("AC-3: the suite line has one form in Verify, finishing's opening run and the rule file", () => {
  const sites: [string, string][] = [
    ["executing Verify", section(read(EXECUTING), EXECUTING, "2. **Verify**", "**Metrics**")],
    ["finishing step 1", headingSection(read(FINISHING), FINISHING, /^## 1\. Verify tests/)],
    ["the rule file", read(RULES)],
  ];
  const forms = sites.map(([name, text]) => {
    const found = suiteForms(text);
    assert.equal(found.length, 1, `${name} holds ${found.length} suite-line forms`);
    return found[0];
  });
  assert.equal(new Set(forms).size, 1, `the suite line drifted: ${forms.join(" | ")}`);
});

test("AC-8: the rule file's report template holds the Recorded evidence heading", () => {
  const template = outline(headingSection(read(RULES), RULES, "## Rules")).filter((l) => l.fenced);
  assert.ok(
    template.some((l) => l.text === "### Recorded evidence"),
    "the report template lost its section heading",
  );
});

test("AC-4: the agents that receive the hand-over send it to the rule file", () => {
  for (const role of ["analyst", "referee"]) {
    const rel = path.join("agents", `${role}.md`);
    const body = read(rel).split(/^---$/m)[2] ?? "";
    assert.ok(
      body.includes("`references/recorded-evidence.md`"),
      `${rel} body does not cite the rule file`,
    );
  }
});

const shaClause = (text: string): string[] => [
  ...new Set([...plain(text).matchAll(/`<sha7>` naming [^;]*/g)].map((m) => m[0])),
];

test("AC-9: both skills define a suite line's sha the same way", () => {
  const clauses = [
    ["executing Verify", section(read(EXECUTING), EXECUTING, "2. **Verify**", "**Metrics**")],
    ["finishing step 1", headingSection(read(FINISHING), FINISHING, /^## 1\. Verify tests/)],
  ].map(([name, text]) => {
    const found = shaClause(text as string);
    assert.equal(found.length, 1, `${name} holds ${found.length} sha clauses`);
    return found[0];
  });
  assert.equal(clauses[0], clauses[1], "the two skills define the suite line's sha differently");
});

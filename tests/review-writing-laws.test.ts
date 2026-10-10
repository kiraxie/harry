import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const flatten = (text: string): string => text.replace(/\s+/g, " ").replace(/[*`]/g, "");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const plain = (rel: string): string => flatten(raw(rel));

const HARRY = "HARRY.md";
const EXECUTING = path.join("skills", "executing", "SKILL.md");
const RUBRIC = path.join("references", "review-rubric.md");
const ARCH_REVIEW = path.join("references", "architecture-review.md");
const PLAIN_LANGUAGE = path.join("references", "plain-language.md");

function lawBullet(label: string): string {
  const text = plain(HARRY);
  const from = text.indexOf(`- ${label}`);
  assert.ok(from !== -1, `HARRY.md has no "${label}" bullet`);
  const ends = [text.indexOf(" - ", from + 2), text.indexOf("## ", from)].filter((i) => i !== -1);
  return text.slice(from, ends.length ? Math.min(...ends) : undefined);
}

test("AC-1: HARRY.md Code makes code comments the exception", () => {
  const s4 = flatten(headingSection(raw(HARRY), HARRY, /^## Code$/));
  assert.match(s4, /Code carries no comment by default/i);
  assert.match(s4, /no comment by default, however densely nearby code is commented/i);
  assert.match(s4, /one kept kind is a trade-off in one short, neutral line/i);
  assert.match(s4, /DEBT: note is that kind/i);
  assert.match(s4, /every deliberate shortcut MUST leave one naming its ceiling and upgrade path/i);
  assert.match(
    s4,
    /tool directives \(biome-ignore, @ts-expect-error\) are not comments/i,
    "Code would strip directives a toolchain needs",
  );
});

test("AC-4/AC-12: the rubric cites HARRY.md Code for tool directives instead of restating it", () => {
  const dims = flatten(headingSection(raw(RUBRIC), RUBRIC, "## Four dimensions"));
  assert.doesNotMatch(dims, /A directive a tool reads/i, "the rubric restates Code's carve-out");
  assert.match(dims, /HARRY\.md Code/);
});

test("AC-2: HARRY.md Talk binds plain writing to every text written for people", () => {
  const bullet = lawBullet("Plain language.");
  assert.match(bullet, /Every text written for people is plain, short and to the point/i);
  for (const kind of [
    /chat replies/i,
    /PR bodies and comments/i,
    /commit messages/i,
    /README/,
    /CHANGELOG/,
    /skills and references/i,
    /code comments/i,
    /drafted Slack, Jira or email messages/i,
  ])
    assert.match(bullet, kind, `the plain-writing list no longer names ${kind}`);
  assert.match(bullet, /Subagent briefs and review reports stay precision-first/i);
});

test("AC-2: plain-language.md puts commit messages and code comments on the people side", () => {
  const head = section(plain(PLAIN_LANGUAGE), PLAIN_LANGUAGE, "# Plain Language", "## Callers");
  assert.match(head, /every text written for people/i);
  assert.match(head, /commit messages/i);
  assert.match(head, /code comments/i);
  const modelSide = /[^.]*precision-first[^.]*\./i.exec(head)?.[0] ?? "";
  assert.match(modelSide, /subagent briefs and review reports/i);
  assert.doesNotMatch(modelSide, /commit message|code comment/i);
});

test("AC-3: the review standard answers every review finding with a structural fix", () => {
  const bullet = section(
    plain(RUBRIC),
    RUBRIC,
    "Findings carry their structural fix.",
    "Automated findings",
  );
  assert.match(bullet, /Every review finding reaches the user with its long-term structural fix/i);
  assert.match(bullet, /a short-term one only when that is not simple/i);
  assert.match(bullet, /a workaround \(treats the symptom, leaves the cause\) never/i);
});

test("AC-4: the review rubric's findings carry a structural fix", () => {
  const rubric = plain(RUBRIC);
  const output = section(rubric, RUBRIC, "## Output", "### Assessment");
  assert.match(output, /structural fix/i);
  assert.match(output, /short-term fix, only when the structural one is not simple/i);
  assert.doesNotMatch(output, /how to fix/i);
});

test("AC-4: the rubric flags a comment that restates the code, justifies a workaround, or resists a change", () => {
  const dims = flatten(headingSection(raw(RUBRIC), RUBRIC, "## Four dimensions"));
  assert.match(
    dims,
    /comment that restates the code, justifies a workaround, or resists a change/i,
  );
});

test("AC-4: the architecture review's findings carry a structural fix", () => {
  const out = section(
    plain(ARCH_REVIEW),
    ARCH_REVIEW,
    "## Output",
    "A finding phrased as a question",
  );
  assert.match(out, /Structural fix: <the long-term/);
  assert.match(out, /Short-term fix: <only when the structural one is not simple/);
  assert.doesNotMatch(out, /Suggested change/i);
});

test("AC-12: tier-gates tiers a fix like a task, small only when Trivial and no test weakens", () => {
  const s3 = section(
    plain(path.join("references", "tier-gates.md")),
    "references/tier-gates.md",
    "Fixes inside a unit.",
    "## ",
  );
  const rule = /A fix inside a unit is tiered like a task[^;]*;[^.]*\./i.exec(s3)?.[0] ?? "";
  assert.match(
    rule,
    /one that is Trivial and weakens no test/i,
    "small is no longer bound to the Trivial row",
  );
  assert.match(rule, /gets the full suite and no re-review/i);
  assert.match(rule, /any other is re-reviewed/i, "a non-Trivial fix is no longer re-reviewed");
  assert.doesNotMatch(
    s3,
    /changes no behavior|no red line/i,
    "tier-gates restates what the Trivial trigger and the red-line promotion already cover",
  );
});

test("AC-5: executing's one fix wave applies the fix tier", () => {
  const wave = section(plain(EXECUTING), EXECUTING, "4. One fix wave.", "Codex build.");
  assert.match(
    wave,
    /small fix \(references\/tier-gates\.md, Fixes inside a unit\)/i,
    "the wave lost the fix tier",
  );
  assert.doesNotMatch(
    wave,
    /no branching|one-glance|weakens no test|changes no behavior/i,
    "the wave restates tier-gates' definition instead of citing it",
  );
  assert.equal(
    wave.match(/Fixes inside a unit/g)?.length,
    1,
    "the wave should cite the fix tier exactly once",
  );
  assert.match(wave, /When a wave has both kinds, its small fixes are re-reviewed with the rest/);
  assert.match(wave, /same file or same rule/, 'the wave leaves "same area" undefined');
  assert.match(
    wave,
    /AC-<n>: small fix: <what> \(commit <sha7>\)/,
    "the wave records no small fix",
  );
  assert.match(wave, /Any other fix is re-reviewed: exactly one scoped re-review/);
  assert.match(wave, /There is no second wave/);
  assert.match(wave, /review clean after small fixes/);
});

test("AC-6: HARRY.md Root cause keeps the three-failed-fixes rule", () => {
  assert.match(
    flatten(headingSection(raw(HARRY), HARRY, /^## Root cause$/)),
    /After three failed fixes of one hypothesis/i,
  );
});

test("AC-6: executing applies the scope brake to the re-review", () => {
  const wave = section(plain(EXECUTING), EXECUTING, "4. One fix wave.", "Codex build.");
  assert.match(
    wave,
    /re-review raising new findings in the same area[^.]*as the review → stop and ask the user whether the scope still serves the unit's goal; name the goal/i,
  );
});

test("AC-5: tier-gates owns the small-fix rule and gives examples", () => {
  const gates = plain(path.join("references", "tier-gates.md"));
  const fixes = section(gates, "references/tier-gates.md", "Fixes inside a unit.", "## ");
  assert.match(fixes, /A fix inside a unit is tiered like a task, whatever the unit's tier/i);
  assert.match(
    fixes,
    /mechanical rename or move the typecheck covers/i,
    "a mechanical rename is small whatever its file span",
  );
  assert.match(fixes, /refactor that restructures logic or adds a decision/i);
  assert.match(fixes, /for example/i);
  assert.doesNotMatch(fixes, /changes no behavior/i, "tier-gates restates the Trivial trigger");
  assert.match(
    fixes,
    /rewording a sentence without changing what it asks of a model/i,
    "a pure rewording is Trivial: mechanical, no decision",
  );
  assert.match(
    fixes,
    /a sentence that changes what a model does \(a real decision, rule 2\)/i,
    "a rule change is a decision, so not Trivial",
  );
  assert.match(fixes, /red-line domain \(it tiers Major\)/i, "a red line promotes, so never small");
});

test("AC-12: plain-language.md's dense example is not labelled as law or skill prose", () => {
  const text = plain(PLAIN_LANGUAGE);
  assert.doesNotMatch(text, /HARRY\.md \S+, model-side/, "the example calls law prose model-side");
  assert.match(text, /Before \(a subagent brief/i);
});

test("AC-12: doc-types lists the small-fix Progress line as a record only", () => {
  assert.match(
    plain(path.join("references", "doc-types.md")),
    /small fix: <what> \(commit <sha7>\) is a record only; no rule reads it back/,
  );
});

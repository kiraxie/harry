import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plain = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ").replace(/[*`]/g, "");

const HARRY = "HARRY.md";
const EXECUTING = path.join("skills", "executing", "SKILL.md");
const RUBRIC = path.join("references", "review-rubric.md");
const ARCH_REVIEW = path.join("references", "architecture-review.md");
const PLAIN_LANGUAGE = path.join("references", "plain-language.md");

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.ok(from !== -1, `missing "${start}"`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to !== -1, `missing "${end}" after "${start}"`);
  return text.slice(from, to);
}

const lawSection = (n: number): string => between(plain(HARRY), `## §${n}`, `## §${n + 1}`);

function lawBullet(label: string): string {
  const text = plain(HARRY);
  const from = text.indexOf(`- ${label}`);
  assert.ok(from !== -1, `HARRY.md has no "${label}" bullet`);
  const ends = [text.indexOf(" - ", from + 2), text.indexOf("## §", from)].filter((i) => i !== -1);
  return text.slice(from, ends.length ? Math.min(...ends) : undefined);
}

test("AC-1: HARRY.md §4 makes code comments the exception", () => {
  const s4 = lawSection(4);
  assert.match(s4, /Code carries no comment by default/i);
  assert.match(s4, /no comment by default, however densely nearby code is commented/i);
  assert.match(s4, /one kept kind is a trade-off in one short, neutral line/i);
  assert.match(s4, /DEBT: note is that kind/i);
  assert.match(s4, /every deliberate shortcut MUST leave one naming its ceiling and upgrade path/i);
  assert.match(
    s4,
    /tool directives \(biome-ignore, @ts-expect-error\) are not comments/i,
    "§4 would strip directives a toolchain needs",
  );
});

test("AC-4/AC-12: the rubric cites §4 for tool directives instead of restating it", () => {
  const dims = between(plain(RUBRIC), "## Four dimensions", "## Severity");
  assert.doesNotMatch(dims, /A directive a tool reads/i, "the rubric restates §4's carve-out");
  assert.match(dims, /HARRY\.md §4/);
});

test("AC-2: HARRY.md §6 binds plain writing to every text written for people", () => {
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
  const head = between(plain(PLAIN_LANGUAGE), "# Plain Language", "## Callers");
  assert.match(head, /every text written for people/i);
  assert.match(head, /commit messages/i);
  assert.match(head, /code comments/i);
  const modelSide = /[^.]*precision-first[^.]*\./i.exec(head)?.[0] ?? "";
  assert.match(modelSide, /subagent briefs and review reports/i);
  assert.doesNotMatch(modelSide, /commit message|code comment/i);
});

test("AC-3: HARRY.md §6 answers every review finding with a structural fix", () => {
  const bullet = lawBullet("Honesty & evidence.");
  assert.match(bullet, /Every review finding reaches the user with its long-term structural fix/i);
  assert.match(bullet, /a short-term one only when that is not simple/i);
  assert.match(bullet, /a workaround \(treats the symptom, leaves the cause\) never/i);
});

test("AC-4: the review rubric's findings carry a structural fix", () => {
  const rubric = plain(RUBRIC);
  const output = between(rubric, "## Output", "### Assessment");
  assert.match(output, /structural fix/i);
  assert.match(output, /short-term fix, only when the structural one is not simple/i);
  assert.doesNotMatch(output, /how to fix/i);
});

test("AC-4: the rubric flags a comment that restates the code, justifies a workaround, or resists a change", () => {
  const dims = between(plain(RUBRIC), "## Four dimensions", "## Severity");
  assert.match(
    dims,
    /comment that restates the code, justifies a workaround, or resists a change/i,
  );
});

test("AC-4: the architecture review's findings carry a structural fix", () => {
  const out = between(plain(ARCH_REVIEW), "## Output", "A finding phrased as a question");
  assert.match(out, /Structural fix: <the long-term/);
  assert.match(out, /Short-term fix: <only when the structural one is not simple/);
  assert.doesNotMatch(out, /Suggested change/i);
});

test("AC-12: HARRY.md §3 tiers a fix like a task, small only when Trivial and no test weakens", () => {
  const s3 = lawSection(3);
  const rule = /A fix inside a unit is tiered like a task[^.]*\./i.exec(s3)?.[0] ?? "";
  assert.match(
    rule,
    /one that is Trivial and weakens no test/i,
    "small is no longer bound to the Trivial row",
  );
  assert.match(rule, /weakens no test/i, "a small fix may now weaken a test");
  assert.match(rule, /in-session, full suite, no re-review/i);
  assert.match(rule, /any other[^.]*full loop/i, "a non-Trivial fix no longer takes the loop");
  assert.match(s3, /The final review is unchanged/i);
  assert.doesNotMatch(
    s3,
    /changes no behavior|no §2 red line/i,
    "§3 restates what the Trivial row and the red-line promotion already cover",
  );
});

test("AC-5: executing applies the fix tier in both fix loops", () => {
  const executing = plain(EXECUTING);
  const standard = between(
    executing,
    "4. Standard: mandatory independent review",
    "## Subagent mode",
  );
  const loop = between(executing, "4. Fix loop", "5. Integrate, then mark complete");
  for (const [name, text] of [
    ["session mode step 4", standard],
    ["subagent mode step 4", loop],
  ] as const) {
    assert.match(text, /small fix \(HARRY\.md §3\)/i, `${name} lost the fix tier`);
    assert.doesNotMatch(
      text,
      /no branching|one-glance|weakens no test|changes no behavior/i,
      `${name} restates §3's definition instead of citing it`,
    );
    assert.equal(text.match(/HARRY\.md §3/g)?.length, 1, `${name} should cite §3 exactly once`);
    assert.match(
      text,
      /When a round has both kinds/,
      `${name} lets a second writer make small fixes beside the round's fixer`,
    );
    assert.match(text, /same file or same rule/, `${name} leaves "same area" undefined`);
    assert.match(
      text,
      /AC-<n>: small fix: <what> \(commit <sha7>\)/,
      `${name} records no small fix`,
    );
    assert.match(text, /Any other fix takes the loop/, `${name} lost the route to the loop`);
  }
  assert.match(
    loop,
    /Integration findings \(step 5\) always take the loop, under that step's limits/,
  );
  assert.doesNotMatch(
    loop,
    /Step 5's integration findings enter this loop/,
    "integration routing is stated twice",
  );
  assert.match(
    between(executing, "4. Mark complete.", "5. Remove the task's worktree"),
    /review clean only when the last review raised nothing; review clean after small fixes when/,
    "5.4 can record review clean over unreviewed small fixes",
  );
  const final = between(executing, "6. Final review", "7. → finishing");
  assert.match(final, /exactly one scoped re-review/i, "the final review changed");
  assert.match(final, /fixes to this review's findings are never small/i);
});

test("AC-6: HARRY.md §6 states the scope brake beside the three-failed-fixes rule", () => {
  const bullet = lawBullet("Root cause before any fix.");
  assert.match(bullet, /After 3 failed fixes/i);
  assert.match(
    bullet,
    /New findings in the same area in two consecutive review rounds → stop and ask the user whether the scope still serves the unit's goal; name the goal\./i,
  );
});

test("AC-6: executing applies the scope brake in both fix loops", () => {
  const executing = plain(EXECUTING);
  const standard = between(
    executing,
    "4. Standard: mandatory independent review",
    "## Subagent mode",
  );
  const loop = between(executing, "4. Fix loop", "5. Integrate, then mark complete");
  for (const text of [standard, loop])
    assert.match(
      text,
      /same area[^.]*two consecutive review rounds[^.]*stop and ask the user whether the scope still serves the unit's goal; name the goal/i,
    );
});

test("AC-5: tier-gates cites §3's small-fix rule and gives examples only", () => {
  const gates = plain(path.join("references", "tier-gates.md"));
  const fixes = between(gates, "Fixes inside a unit.", "## ");
  assert.match(fixes, /whatever the unit's tier, a fix is small or not by HARRY\.md §3/i);
  assert.match(fixes, /local one-line rename/i, "renaming an exported symbol is not small");
  assert.match(fixes, /for example/i);
  assert.doesNotMatch(fixes, /changes no behavior/i, "tier-gates restates §3's definition");
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
  assert.doesNotMatch(text, /HARRY\.md §5, model-side/, "the example calls law prose model-side");
  assert.match(text, /Before \(a subagent brief/i);
});

test("AC-12: doc-types lists the small-fix Progress line as a record only", () => {
  assert.match(
    plain(path.join("references", "doc-types.md")),
    /small fix: <what> \(commit <sha7>\) is a record only; no rule reads it back/,
  );
});

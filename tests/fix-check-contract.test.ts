import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const FIX_CHECK = "references/fix-check.md";
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*+|`/g, "");

function fixCheck(): string {
  assert.ok(existsSync(path.join(repoRoot, FIX_CHECK)), `${FIX_CHECK} is missing`);
  return flat(read(FIX_CHECK));
}

test("AC-1: fix-check names the three levels and what each checks", () => {
  const text = fixCheck();
  const levels: [RegExp, string][] = [
    [/1\. Finding site — [^.]*resolves? what the finding names/i, "the finding site"],
    [/2\. Data flow — [^.]*where the data comes from and goes/i, "the data flow"],
    [/3\. System — [^.]*the unit's goal[^.]*neighbouring modules[^.]*conventions/i, "the system"],
  ];
  for (const [re, what] of levels)
    assert.match(text, re, `fix-check no longer defines what level "${what}" checks`);
});

test("review-round-cap AC-3: a returning cause needs a fix that adds a class-wide check", () => {
  const text = fixCheck();
  const [two, three] = [text.indexOf("2. Data flow —"), text.indexOf("3. System —")];
  assert.ok(two !== -1 && three > two, "fix-check no longer has level 2 followed by level 3");
  const level2 = text.slice(two, three);
  assert.match(
    level2,
    /a previous fix left (?:something )?incomplete.*?adds a check that catches the whole class.*?fails at this level/i,
  );
});

test("review-round-cap AC-5(a): the referee's own comparison with earlier findings triggers the class rule", () => {
  const text = fixCheck();
  const level2 = section(text, "references/fix-check.md", "2. Data flow —", "3. System —");
  assert.match(
    level2,
    /an earlier findings file holds a finding with the same cause in the same area — same file or same rule — whose fix was built, whether or not the finding under check says so/i,
    "the class rule keys only on what the finding says, which a later reviewer cannot know",
  );
});

test("fix-check level 2 fails a fix whose side-effect flags go unlisted", () => {
  const text = fixCheck();
  const level2 = section(text, "references/fix-check.md", "2. Data flow —", "3. System —");
  assert.match(
    level2,
    /A fix that flips any setting beyond the one it targets lists each one — its side-effect flags; an unlisted one fails at this level\./,
  );
});

test("AC-1: fix-check lists every input the check is handed", () => {
  const text = fixCheck();
  const inputs: [RegExp, string][] = [
    [/each finding, its proposed fix and the code at its site/i, "the finding, fix and code"],
    [/the unit's full diff/i, "the unit's diff"],
    [/read access to the whole repo/i, "repo read access"],
    [/the item's Why \/ What and its acceptance criteria/i, "the item's design and AC"],
    [/every ruling so far, with its reason/i, "the rulings"],
    [/every earlier findings file of the unit/i, "earlier findings files"],
    [/the area's recent git history/i, "the git history"],
  ];
  for (const [re, what] of inputs) assert.match(text, re, `fix-check no longer lists ${what}`);
});

test("AC-1: fix-check is never handed the session transcript", () => {
  assert.match(
    fixCheck(),
    /never handed the session transcript/i,
    "fix-check no longer keeps the session transcript out, which carries the micro-level bias into the check",
  );
});

test("AC-1: fix-check's verdict is per fix: holds at all three, or fails at a named level with a fix that holds", () => {
  const text = fixCheck();
  assert.match(text, /holds at all three levels/i, "the passing verdict is gone");
  assert.match(
    text,
    /fails at level <N>[^.]*the reason[^.]*a fix that holds at all three/i,
    "a failing verdict no longer names its level, its reason and a fix that holds at every level",
  );
});

test("AC-1: fix-check names the cases that stop for the user", () => {
  const text = fixCheck();
  const cases: [RegExp, string][] = [
    [/goes beyond the acceptance criteria/i, "a fix beyond the AC"],
    [/conflicts with an acceptance criterion or a ruling/i, "a conflict with an AC or ruling"],
    [/the finding is not real at a wider level/i, "a finding not real at a wider level"],
    [/the fix's direction is wrong/i, "a wrong fix direction"],
  ];
  for (const [re, what] of cases)
    assert.match(text, re, `fix-check no longer stops for the user on ${what}`);
});

test("AC-7: executing routes fix checks to the referee", () => {
  const who = flat(
    headingSection(read("skills/executing/SKILL.md"), "skills/executing/SKILL.md", "## Who writes"),
  );
  assert.match(
    who,
    /fix checks → referee/,
    "executing no longer routes a fix check to the referee",
  );
});

test("AC-7: CLAUDE.md describes the referee role", () => {
  assert.match(
    flat(read("CLAUDE.md")),
    /referee \(fix check, fable\/high/,
    "CLAUDE.md's role-agent description no longer names the referee",
  );
});

const executingStep4 = (): string => {
  const rel = "skills/executing/SKILL.md";
  return flat(section(read(rel), rel, "4. **One fix wave.**", "**There is no second wave.**"));
};

test("AC-3: executing checks every non-small fix with one referee dispatch before building", () => {
  assert.match(
    executingStep4(),
    /Check the fixes first\..*?Before building any fix that is not small, dispatch ONE harry:referee over every such Critical and Important finding at once, handed what references\/fix-check\.md lists/,
    "executing no longer checks the wave's non-small fixes with one referee dispatch before building",
  );
});

test("AC-3: executing builds each fix as the referee's line says", () => {
  assert.match(
    executingStep4(),
    /Build each fix as its line says\./,
    "executing no longer builds per the verdict",
  );
});

test("AC-3: executing takes the reference's stop cases to the user before building that fix", () => {
  assert.match(
    executingStep4(),
    /A line that stops for the user[^.]*put it to the user before building that fix/,
    "a fix the referee stops on is no longer put to the user first",
  );
});

test("AC-3: executing records the verdicts in the findings file and one Progress line", () => {
  assert.match(
    executingStep4(),
    /Append the verdicts to the findings file under ## Fix check, and append fix check at <sha7>: <h> held, <r> revised/,
    "the fix check's verdicts or its Progress line are no longer recorded",
  );
});

test("AC-5: a report missing a line for a handed fix is sent back", () => {
  assert.match(
    executingStep4(),
    /A report missing a line for a handed fix is sent back\./,
    "an incomplete fix-check report is no longer sent back",
  );
});

test("AC-5: a failed dispatch falls back to the session, recorded as not independent", () => {
  assert.match(
    executingStep4(),
    /The dispatch fails → apply references\/fix-check\.md yourself and record the Progress line with not independent in place of referee/,
    "a failed referee dispatch no longer falls back to the session with a not-independent record",
  );
});

test("AC-5: on the Codex build the fix check runs in a separate read-only codex exec through ask", () => {
  const text = read("skills/executing/SKILL.md");
  const codex = flat(section(text, "skills/executing/SKILL.md", "**Codex build.**"));
  assert.match(
    codex,
    /The fix check runs in a separate read-only codex exec through that build's ask skill \(codex-skills\/ask\)/,
    "the Codex build no longer runs the fix check out of session",
  );
  assert.match(
    codex,
    /its failure falls back to the session applying references\/fix-check\.md itself, recorded as not independent/,
    "the Codex build's fix check no longer falls back with a not-independent record",
  );
});

test("AC-4: a fix now ruling runs the referee's check before the AC is drafted, and its line sets the fix", () => {
  const ruling = flat(
    read("skills/finishing/SKILL.md")
      .split("\n")
      .find((l) => l.startsWith("- **fix now** →")) ?? "",
  );
  assert.match(
    ruling,
    /fix now → first the fix check: dispatch ONE harry:referee over every fix now finding at once, handed what references\/fix-check\.md lists, as executing step 4 does[^→]*its line sets the fix the new AC states[^→]*→ draft a new AC/,
    "a fix now ruling no longer runs the referee's check before its AC is drafted",
  );
});

test("AC-6: the re-review accepts a fix as ADDRESSED only when the cause is gone", () => {
  const rubric = flat(read("references/review-rubric.md"));
  assert.match(
    rubric,
    /ADDRESSED means the cause is gone, not only this instance/,
    "the re-review form no longer defines ADDRESSED by the cause",
  );
});

test("AC-6: the re-review is handed the fix check's verdicts", () => {
  assert.match(
    flat(read("references/review-rubric.md")),
    /handed the fix range, the open findings under their numbers, the fix check's verdicts and the last number in use/,
    "the rubric's re-review form no longer lists the fix check's verdicts among its inputs",
  );
});

test("executing cites the fix check's inputs instead of re-listing them", () => {
  assert.match(
    executingStep4(),
    /handed what references\/fix-check\.md lists, all by resolved absolute path\./,
    "executing re-lists the fix check's inputs, and a hand-copied list drifts from the reference",
  );
});

test("fix-check gives a line shape for a fix that stops for the user", () => {
  assert.match(
    fixCheck(),
    /<n> · stops for the user · <case> · the reason/,
    "a fix the referee stops on has no line shape",
  );
});

test("executing's fix-check Progress line counts the fixes that stopped", () => {
  assert.match(
    executingStep4(),
    /<h> held, <r> revised, <s> stopped/,
    "stopped fixes have no slot in the Progress line",
  );
});

test("the Codex fix-check prompt tells the model to read and trace the repo, rulings as facts", () => {
  const text = read("skills/executing/SKILL.md");
  assert.match(
    flat(section(text, "skills/executing/SKILL.md", "**Codex build.**")),
    /its prompt naming references\/fix-check\.md, the inputs it lists and an explicit instruction to read and trace the repo, with rulings passed as facts/,
    "the Codex fix check may answer at level 1 only, since ask's preamble forbids exploring unless the prompt asks",
  );
});

test("AC-11: executing hands the referee fix-check itself, in full", () => {
  assert.match(
    executingStep4(),
    /Hand it references\/fix-check\.md itself too, in full, as step 3 hands the review standard\./,
    "the referee is handed only a path to its standard, which a consumer repo cannot resolve",
  );
});

test("AC-12: a failing verdict line names its level as well as its number", () => {
  assert.match(
    fixCheck(),
    /<n> · fails at level <N>, <finding site \| data flow \| system> · the reason · a fix that holds at all three levels/,
    "a failing verdict names its level only by number, which a re-reviewer without fix-check cannot read",
  );
});

test("AC-12: the re-review judges ADDRESSED at the levels the handed verdicts name", () => {
  assert.match(
    flat(read("references/review-rubric.md")),
    /judged at the levels the handed verdicts name/,
    "the rubric points the re-reviewer at levels it was never told the meaning of",
  );
});

test("AC-13: finishing's fix now writes its findings file, the referee's verdicts and the Progress line", () => {
  const ruling = flat(
    read("skills/finishing/SKILL.md")
      .split("\n")
      .find((l) => l.startsWith("- **fix now** →")) ?? "",
  );
  assert.match(
    ruling,
    /write the round's numbered findings to <store>\/\.local\/tmp\/<branch>\/findings-<k>\.md, append the referee's verdicts there under ## Fix check, and append the fix check line to ## Progress/,
    "finishing's fix now leaves no record of the referee's verdicts, so a later fix check cannot see a revision",
  );
});

test("AC-14: fix-check's input list names the reference itself, in full", () => {
  assert.match(
    fixCheck(),
    /This file, in full\./,
    "fix-check relies on each caller to add it to what the referee is handed",
  );
});

test("AC-15: every verdict line that says all three levels names them", () => {
  const text = fixCheck();
  assert.match(
    text,
    /<n> · holds at all three levels \(finding site, data flow, system\) · evidence read/,
    "the holds line does not name the levels the re-review is told to judge at",
  );
  assert.match(
    text,
    /a fix that holds at all three levels \(finding site, data flow, system\)/,
    "the replacement clause does not name the levels",
  );
});

test("AC-16: the findings-<k> numbering rule lives once, in executing's Paths rule, for every writer", () => {
  const executing = flat(read("skills/executing/SKILL.md"));
  assert.match(
    executing,
    /For every numbered file under \$STORE\/\.local\/tmp\/<branch>, whichever skill writes it, <k> is one more than the files of that kind already there\./,
    "the <k> rule no longer covers every skill that writes the series",
  );
  assert.doesNotMatch(
    executing,
    /For every file this skill numbers/,
    "a second, executing-only copy of the rule remains",
  );
  assert.match(
    flat(read("skills/finishing/SKILL.md")),
    /number files as the same rule says/,
    "finishing writes findings-<k> without citing the numbering rule",
  );
});

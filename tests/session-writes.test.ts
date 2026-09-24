import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function shippedFiles(): string[] {
  const out: string[] = ["HARRY.md", "README.md"];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      const rel = path.join(dir, name);
      if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
      else if (rel.endsWith(".md")) out.push(rel);
    }
  };
  for (const dir of ["skills", "commands", "references", "agents", "codex-skills"]) walk(dir);
  return out;
}

test("AC-8: shipped text names no retired dispatch concept", () => {
  const retired: [RegExp, string][] = [
    [/ultrathink/i, "a dated thinking keyword"],
    [/dispatch cap/i, "the retired dispatch cap"],
    [/subagent mode\b/i, "the retired subagent mode"],
    [/harry:(mech|writer|security)\b/, "a retired writing role"],
    [/`(mech|writer|security)`/, "a retired writing role"],
    [/## Dispatch/, "the retired parallel-dispatch section"],
    [/subagent execution|per-(task|AC) review/i, "the retired per-task review"],
  ];
  const hits: string[] = [];
  for (const rel of shippedFiles()) {
    const text = readFileSync(path.join(repoRoot, rel), "utf-8");
    for (const [re, why] of retired) if (re.test(text)) hits.push(`${rel}: ${why} (${re})`);
  }
  assert.deepEqual(hits, []);
});

const plain = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ").replace(/[*`]/g, "");
const EXECUTING = path.join("skills", "executing", "SKILL.md");
const FINISHING = path.join("skills", "finishing", "SKILL.md");

test("AC-1: HARRY.md has the session write and dispatches only analyst and scout", () => {
  const harry = plain("HARRY.md");
  assert.match(harry, /\| Tier \| Trigger \| brainstorm \| item \| TDD \| review \|/);
  assert.doesNotMatch(harry, /\| execution \|/i);
  assert.match(harry, /The session does all implementation, fixing and writing itself/);
  assert.match(harry, /independent judgment — review, debate, audit analysis → analyst/);
  assert.match(harry, /bulk reading → scout/);
  assert.match(harry, /Parallel writing is separate units, each in its own worktree/);
  const words = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8").split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 2358, `HARRY.md grew to ${words.length} words`);
});

test("AC-3: executing has one mode, reviews by tier in parallel, one fix wave", () => {
  const text = plain(EXECUTING);
  for (const gone of [
    /task worktree/i,
    /base ref/i,
    /report log/i,
    /## Dispatch/,
    /Resuming table/i,
  ])
    assert.doesNotMatch(text, gone);
  assert.match(text, /Dispatch the tier's lanes at once, in one turn/);
  assert.match(text, /dispatch harry:analyst/);
  assert.match(text, /The session fixes every Critical and Important finding itself/);
  assert.match(text, /exactly one scoped re-review/);
  assert.match(text, /There is no second wave/);
});

test("AC-4: a failed Codex lane is recorded and the review goes on with one lane", () => {
  assert.match(
    plain(EXECUTING),
    /The lane fails[^.]*→ append its verbatim error and review: one lane ran to ## Progress and go on with the analyst lane alone — no substitute lane, and no question to the user/,
  );
});

test("AC-12: the findings list is a file Progress names, and a resume reads it", () => {
  const text = plain(EXECUTING);
  assert.match(text, /Resuming[^.]*reads ## Progress, git log, and the files ## Progress names/);
  assert.match(text, /write the merged list to <store>\/\.local\/tmp\/<branch>\/findings-<k>\.md/);
  assert.match(text, /review at <sha7>: <n> findings \(<lanes>\) — <findings file>/);
  assert.match(
    text,
    /fix wave: <X> addressed, <Y> open \(commits <base7>\.\.<head7>\) — <findings file>/,
  );
});

test("AC-13: /audit dispatches only analyst; Step 1b is the session's own script", () => {
  const orchestration = plain(path.join("references", "audit", "ORCHESTRATION.md"));
  assert.match(orchestration, /every research and general agent is harry:analyst/);
  assert.match(orchestration, /Subagents in Round 1 \(Step 2\)/);
  const recon = plain(path.join("references", "audit", "RECON.md"));
  assert.match(recon, /Run this as a script yourself: it is deterministic, so it needs no agent/);
  assert.doesNotMatch(recon, /Assign this to a research agent/);
});

test("AC-6: finishing handles no task refs and reviews with analyst", () => {
  const text = plain(FINISHING);
  for (const gone of [/Leftover tasks/i, /refs\/harry/, /task\/<branch>/, /executing's 5\.5/])
    assert.doesNotMatch(text, gone);
  assert.match(text, /dispatch ONE harry:analyst/);
});

test("AC-7: debate, audit, brainstorming and the Codex role map follow the two roles", () => {
  assert.match(plain(path.join("commands", "debate.md")), /\| opus \| Dispatch harry:analyst/);
  assert.match(
    plain(path.join("references", "audit", "ORCHESTRATION.md")),
    /every research and general agent is harry:analyst/,
  );
  assert.doesNotMatch(plain(path.join("skills", "brainstorming", "SKILL.md")), /## Dispatch/);
  const rows = readFileSync(path.join(repoRoot, "references", "codex-role-mapping.md"), "utf-8")
    .split("\n")
    .filter((l) => /^\| [a-z]+ \|/.test(l) && !l.startsWith("| role"))
    .map((l) => l.split("|")[1]?.trim());
  assert.deepEqual(rows, ["scout", "analyst"]);
});

test("AC-13: the audit hunter prompt says what to do with a thread it cannot finish", () => {
  const deepDive = readFileSync(
    path.join(repoRoot, "references", "audit", "DEEP-DIVE.md"),
    "utf-8",
  );
  const prompt = deepDive
    .slice(deepDive.indexOf("```"), deepDive.lastIndexOf("```"))
    .replace(/\s+/g, " ");
  assert.match(prompt, /return it as a lead: its location and the open question/i);
  assert.doesNotMatch(prompt, /SPAWN/);
});

const DOC_TYPES = path.join("references", "doc-types.md");

test("AC-17: no rule reads older Progress lines; users finish in-flight units first", () => {
  assert.doesNotMatch(plain(DOC_TYPES), /Older Progress lines/);
  assert.doesNotMatch(plain(EXECUTING), /Older Progress lines/);
});

test("AC-15: the CHANGELOG marks the removed roles breaking and says to re-sync", () => {
  const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf-8").replace(/\s+/g, " ");
  const unreleased = changelog.slice(0, changelog.indexOf(" ## [0"));
  const removed = unreleased.slice(unreleased.indexOf("### Removed"));
  assert.match(removed, /\*\*The `mech`, `writer` and `security` role agents \(breaking\)\.\*\*/);
  assert.match(removed, /`harry:analyst`/);
  assert.match(unreleased, /run `\/harry:sync` \(Claude Code\) and the `sync` skill \(Codex\)/);
  assert.match(unreleased, /finish or discard every in-flight Standard or Major unit/);
});

test("AC-16: files Progress names are unit state, and a missing findings file re-runs the review", () => {
  assert.match(
    plain(DOC_TYPES),
    /A file ## Progress names is unit state: it is kept until finishing's cleanup/,
  );
  assert.match(
    plain(EXECUTING),
    /A findings file ## Progress names that is missing → run step 3's review again over the whole branch \(<base>\.\.\.HEAD\)/,
  );
});

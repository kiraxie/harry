import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EXECUTING = path.join("skills", "executing", "SKILL.md");

const plain = (text: string): string => text.replace(/\s+/g, " ");

const secondPhase = (): string =>
  plain(
    section(
      readFileSync(path.join(repoRoot, EXECUTING), "utf-8"),
      EXECUTING,
      "**Second phase.**",
      "- **Codex lane**",
    ),
  );

const LINES_OWED: Record<string, string[]> = {
  "each metrics facts file by its resolved absolute path": ["hit in the facts files"],
  "each check the Codex report lists under `### Checks not run`": ["Codex check handed"],
  "the first report": ["check the first report held back", "finding of the first report"],
  "the fact that metrics has ended and the checkout is free": [],
};

const listed = (text: string, opening: RegExp, name: string): string[] => {
  const found = opening.exec(text);
  assert.ok(found, `the second phase no longer states ${name}`);
  return (found[1] ?? "").split(/, (?:and )?/).map((part) => part.replace(/ \([^)]*\)/g, ""));
};

test("the second phase asks a line back for everything it hands the analyst", () => {
  const text = secondPhase();
  const handed = new Set([
    ...listed(text, /Then send that same analyst — .*? — (.*?)\. It runs/, "its message"),
    ...listed(text, /dispatch a new `harry:analyst` with .*? plus: (.*?)\./, "its fallback"),
  ]);
  const accepted = /accept it only with (.*?)\. /.exec(text);
  assert.ok(accepted, "the second phase no longer states what a final report is accepted with");
  const asked = [...(accepted[1] ?? "").matchAll(/for every (.*?)(?=,| and|$)/g)].map((m) => m[1]);
  for (const part of handed) {
    const owed = LINES_OWED[part];
    assert.ok(owed, `the second phase hands "${part}": name the lines its acceptance owes for it`);
    for (const line of owed)
      assert.ok(
        asked.includes(line),
        `"${part}" is handed, but no line is asked for every ${line}`,
      );
  }
});

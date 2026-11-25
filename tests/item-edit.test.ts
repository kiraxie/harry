import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { loadScript } from "./load-script.ts";

const { apply, plan } = await loadScript(() => import("../.claude/scripts/item-edit.mts"));

const SCRIPT = fileURLToPath(new URL("../.claude/scripts/item-edit.mts", import.meta.url));

/** A repo whose store holds items/unit.md with `before`, and archive/old.md. */
const makeStore = (t: TestContext, before: string): { repo: string; item: string; old: string } => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-item-edit-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  mkdirSync(path.join(repo, ".local", "items"), { recursive: true });
  mkdirSync(path.join(repo, ".local", "archive"));
  const item = path.join(repo, ".local", "items", "unit.md");
  const old = path.join(repo, ".local", "archive", "old.md");
  writeFileSync(item, before);
  writeFileSync(old, "## Progress\n- archived\n");
  return { repo, item, old };
};

const cli = (repo: string, args: string[], input: string) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", input });

const EDITS: { name: string; op: string; before: string; line: string; after: string }[] = [
  {
    name: "progress, Progress the last section",
    op: "progress",
    before: "# T\n\n## Why / What\nx\n\n## Progress\n- a\n",
    line: "- b",
    after: "# T\n\n## Why / What\nx\n\n## Progress\n- a\n- b\n",
  },
  {
    name: "progress, an empty Progress",
    op: "progress",
    before: "## Why / What\nx\n\n## Progress\n",
    line: "- b",
    after: "## Why / What\nx\n\n## Progress\n- b\n",
  },
  {
    name: "progress, Progress followed by Follow-ups",
    op: "progress",
    before: "## Progress\n- a\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n- a\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, a fence holding a heading line inside Progress",
    op: "progress",
    before: "## Progress\n- a\n```\n## Notes\n```\n- c\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n- a\n```\n## Notes\n```\n- c\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, an indented fence closed at another indent",
    op: "progress",
    before: "## Progress\n- a\n  ```\n## Notes\n ```\n- c\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n- a\n  ```\n## Notes\n ```\n- c\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, a fence holding a line that opens with its marker and goes on",
    op: "progress",
    before: "## Progress\n```\n```js\n## Notes\n```\n- c\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n```\n```js\n## Notes\n```\n- c\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, backticks indented four spaces open no fence",
    op: "progress",
    before: "## Progress\n- a\n    ```\n- c\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n- a\n    ```\n- c\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, a deeper heading inside Progress",
    op: "progress",
    before: "## Progress\n- a\n### Wave 2\n- c\n\n## Follow-ups\n- f\n",
    line: "- b",
    after: "## Progress\n- a\n### Wave 2\n- c\n- b\n\n## Follow-ups\n- f\n",
  },
  {
    name: "progress, a longer fence holding a shorter one",
    op: "progress",
    before: "## Progress\n````\n```\n## Notes\n````\n- c\n",
    line: "- b",
    after: "## Progress\n````\n```\n## Notes\n````\n- c\n- b\n",
  },
  {
    name: "progress, a tilde fence holding a backtick line",
    op: "progress",
    before: "## Progress\n~~~\n```\n## Notes\n~~~\n- c\n\n## Follow-ups\n",
    line: "- b",
    after: "## Progress\n~~~\n```\n## Notes\n~~~\n- c\n- b\n\n## Follow-ups\n",
  },
  {
    name: "progress, the heading quoted in AC text and inside an earlier fence",
    op: "progress",
    before:
      "## Why / What\n- AC-1: the `## Progress` section\n```\n## Progress\n- fake\n```\n\n## Progress\n- a\n",
    line: "- b",
    after:
      "## Why / What\n- AC-1: the `## Progress` section\n```\n## Progress\n- fake\n```\n\n## Progress\n- a\n- b\n",
  },
  {
    name: "progress, no newline at the end of the file",
    op: "progress",
    before: "## Progress\n- a",
    line: "- b",
    after: "## Progress\n- a\n- b",
  },
  {
    name: "progress, a line the shell would expand",
    op: "progress",
    before: "## Progress\n",
    line: '- `x` $HOME "q" \\n $(id)',
    after: '## Progress\n- `x` $HOME "q" \\n $(id)\n',
  },
  {
    name: "followup-add, the section there",
    op: "followup-add",
    before: "## Progress\n- a\n\n## Follow-ups\n- f\n",
    line: "- g",
    after: "## Progress\n- a\n\n## Follow-ups\n- f\n- g\n",
  },
  {
    name: "followup-add, the section missing",
    op: "followup-add",
    before: "## Why / What\nx\n\n## Progress\n- a\n",
    line: "- g",
    after: "## Why / What\nx\n\n## Progress\n- a\n\n## Follow-ups\n- g\n",
  },
  {
    name: "followup-add, the section missing and no newline at the end",
    op: "followup-add",
    before: "## Progress\n- a",
    line: "- g",
    after: "## Progress\n- a\n\n## Follow-ups\n- g\n",
  },
  {
    name: "followup-remove, a middle line",
    op: "followup-remove",
    before: "## Follow-ups\n- f\n- g\n- h\n",
    line: "- g",
    after: "## Follow-ups\n- f\n- h\n",
  },
  {
    name: "followup-remove, a line Progress holds too",
    op: "followup-remove",
    before: "## Progress\n- g\n\n## Follow-ups\n- f\n- g\n",
    line: "- g",
    after: "## Progress\n- g\n\n## Follow-ups\n- f\n",
  },
  {
    name: "followup-remove, the last line with no newline at the end",
    op: "followup-remove",
    before: "## Follow-ups\n- f\n- g",
    line: "- g",
    after: "## Follow-ups\n- f",
  },
];

for (const c of EDITS) {
  test(`item-edit ${c.name}`, (t) => {
    const { repo, item } = makeStore(t, c.before);
    const r = cli(repo, [c.op, "unit"], `${c.line}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(item, "utf8"), c.after);
    assert.deepEqual(readdirSync(path.dirname(item)), ["unit.md"]);
  });
}

const WHOLE = "## Why / What\nx\n\n## Progress\n- a\n\n## Follow-ups\n- f\n- twice\n- twice\n";

const REFUSED: {
  name: string;
  args: string[];
  before?: string;
  input?: string;
  message: RegExp;
}[] = [
  {
    name: "progress with no Progress heading",
    args: ["progress", "unit"],
    before: "## Why / What\nx\n",
    message: /"## Progress" is there 0 times/,
  },
  {
    name: "progress with the heading only inside a fence",
    args: ["progress", "unit"],
    before: "## Why / What\n```\n## Progress\n```\n",
    message: /"## Progress" is there 0 times/,
  },
  {
    name: "progress with the heading twice",
    args: ["progress", "unit"],
    before: "## Progress\n- a\n\n## Progress\n- b\n",
    message: /"## Progress" is there 2 times/,
  },
  { name: "an empty stdin", args: ["progress", "unit"], input: "", message: /one line on stdin/ },
  { name: "a blank stdin", args: ["progress", "unit"], input: "\n", message: /one line on stdin/ },
  {
    name: "two lines on stdin",
    args: ["progress", "unit"],
    input: "- a\n- b\n",
    message: /one line on stdin/,
  },
  {
    name: "a heading on stdin",
    args: ["progress", "unit"],
    input: "## Notes\n",
    message: /one line on stdin/,
  },
  {
    name: "a code fence on stdin",
    args: ["progress", "unit"],
    input: "```\n",
    message: /one line on stdin/,
  },
  {
    name: "a slug the archive holds",
    args: ["progress", "old"],
    message: /no item old in /,
  },
  {
    name: "a slug that is a path",
    args: ["progress", "../archive/old"],
    message: /invalid slug/,
  },
  {
    name: "followup-remove of a line that is not there",
    args: ["followup-remove", "unit"],
    input: "- absent\n",
    message: /is there 0 times in "## Follow-ups"/,
  },
  {
    name: "followup-remove of a line only Progress holds",
    args: ["followup-remove", "unit"],
    input: "- a\n",
    message: /is there 0 times in "## Follow-ups"/,
  },
  {
    name: "followup-remove of a line that is there twice",
    args: ["followup-remove", "unit"],
    input: "- twice\n",
    message: /is there 2 times in "## Follow-ups"/,
  },
  {
    name: "followup-remove with no Follow-ups heading",
    args: ["followup-remove", "unit"],
    before: "## Progress\n- a\n",
    input: "- a\n",
    message: /"## Follow-ups" is there 0 times/,
  },
  { name: "an unknown operation", args: ["rewrite", "unit"], message: /usage:/ },
];

for (const c of REFUSED) {
  test(`item-edit refuses ${c.name} and leaves the files as they were`, (t) => {
    const before = c.before ?? WHOLE;
    const { repo, item, old } = makeStore(t, before);
    const r = cli(repo, c.args, c.input ?? "- new\n");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, c.message);
    assert.equal(readFileSync(item, "utf8"), before);
    assert.equal(readFileSync(old, "utf8"), "## Progress\n- archived\n");
    assert.deepEqual(readdirSync(path.dirname(item)), ["unit.md"]);
  });
}

test("item-edit refuses an item another edit holds, and leaves the item and that edit's file alone", (t) => {
  const before = "## Progress\n- a\n";
  const { repo, item } = makeStore(t, before);
  const held = `${item}.item-edit.tmp`;
  writeFileSync(held, "the other edit's bytes");

  const r = cli(repo, ["progress", "unit"], "- b\n");

  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stderr.includes(held), r.stderr);
  assert.match(r.stderr, /another edit/);
  assert.equal(readFileSync(item, "utf8"), before);
  assert.equal(readFileSync(held, "utf8"), "the other edit's bytes");
});

const TAMPERED: {
  name: string;
  change: (p: ReturnType<typeof plan>) => ReturnType<typeof plan>;
  why: RegExp;
}[] = [
  {
    name: "a piece holding a second line",
    change: (p) => ({ ...p, piece: "- b\n- c\n" }),
    why: /not the one line/,
  },
  {
    name: "a piece holding another heading",
    change: (p) => ({ ...p, piece: "## Notes\n- b\n" }),
    why: /not the one line/,
  },
  {
    name: "an offset inside a line",
    change: (p) => ({ ...p, at: p.at - 1 }),
    why: /inside a line/,
  },
  {
    name: "an offset past the end",
    change: (p) => ({ ...p, at: p.at + 10 }),
    why: /inside a line/,
  },
  {
    name: "a negative offset",
    change: (p) => ({ ...p, at: -1 }),
    why: /inside a line/,
  },
  {
    name: "a removal of text that is not at the offset",
    change: (p) => ({ ...p, kind: "remove" }),
    why: /not at the offset/,
  },
];

for (const c of TAMPERED) {
  test(`apply refuses a plan that is not one line at a line boundary: ${c.name}`, () => {
    const text = "## Progress\n- a\n";
    const good = plan(text, "progress", "- b");
    assert.equal(apply(text, good, "- b"), "## Progress\n- a\n- b\n");
    assert.throws(
      () => apply(text, c.change(good), "- b"),
      (err: Error) =>
        /^exact-difference check failed: /.test(err.message) && c.why.test(err.message),
    );
  });
}

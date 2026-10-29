import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*\*/g, "");
const DOC_TYPES = "references/doc-types.md";
const MENTION = /status: backlog|## Follow-ups/;

// The writers doc-types' Writers bullet must name, the sentences that open a backlog
// item and so cite the Similar backlog items rule, and the one writer doc-types puts
// outside that rule.
const WRITERS = [
  "brainstorming's residue manifest",
  "an author copying in a Non-Goal",
  "`/grill`'s residue manifest",
  "Critical and Important findings outside the fix range",
  "findings adjudicated to Follow-ups",
  "findings the user rules backlog before the fix wave",
  "executing: follow-on work found mid-build",
  "finishing's backlog ruling",
  "finishing's leftover check for a unit with no item",
  "finishing's leftover check",
  "`/debt`, on request",
  "`/sync`'s legacy migration",
];

const WRITER_RULES = ["Follow-ups flush", "Active → backlog (discard)"];

const SIMILAR_SITES: { file: string; snippet: string }[] = [
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's dispositions are *commitments*",
  },
  { file: "skills/brainstorming/SKILL.md", snippet: "Discharge step 5's manifest commitments" },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's deferred lines land the same way",
  },
  { file: "skills/brainstorming/SKILL.md", snippet: "rule it in step 5's residue manifest" },
  { file: "references/grilling.md", snippet: "becomes a `status: backlog` item" },
  { file: "skills/finishing/SKILL.md", snippet: "- **backlog** → the finding quoted" },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "always lands in a `status: backlog` item, never only in the reply",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "A kept leftover is appended to the item's `## Follow-ups`",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Conversation leftovers, before `gh pr create`.**",
  },
  { file: "references/debt-audit.md", snippet: "row as a `status: backlog` item" },
  {
    file: "references/debt-audit.md",
    snippet: "Sweep candidates persist, on request, as **one** `status: backlog` sweep item",
  },
];

const OUTSIDE_SIMILAR = ["references/sync-migration.md"];

const BLOCK_START = /^\s*(?:$|#|[-*] |\d+\. |[a-z]\. |\||```|<!--)/;

const sentences = (text: string): string[] =>
  text
    .split("\n")
    .reduce<string[]>((blocks, line) => {
      if (BLOCK_START.test(line) || blocks.length === 0) blocks.push(line.trim());
      else blocks[blocks.length - 1] += ` ${line.trim()}`;
      return blocks;
    }, [])
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=\S)/))
    .map((s) => s.trim());

const mentions = (file: string): string[] => sentences(read(file)).filter((s) => MENTION.test(s));

const lifecycleBullets = (): Map<string, string> =>
  new Map(
    headingSection(read(DOC_TYPES), DOC_TYPES, "## Lifecycle rules")
      .split(/\n(?=- \*\*)/)
      .flatMap((b) => {
        const name = /^- \*\*(.+?)\*\*:/.exec(b)?.[1];
        return name === undefined ? [] : [[name, flat(b)] as const];
      }),
  );

test("doc-types' Writers bullet names every writer", () => {
  const list = lifecycleBullets().get("Writers") ?? "";
  const missing = WRITERS.filter((w) => !list.includes(flat(w)));
  assert.deepEqual(missing, [], "doc-types' Writers bullet no longer names these writers");
});

test("the writers outside the Writers bullet are Lifecycle rules of their own", () => {
  const bullets = lifecycleBullets();
  const missing = WRITER_RULES.filter((rule) => !bullets.has(rule));
  assert.deepEqual(missing, [], "doc-types' Lifecycle rules no longer have these bullets");
});

const SIMILAR = "Similar backlog items";
const CITES_SIMILAR = new RegExp(
  `"${SIMILAR}" bullet of \`references/doc-types\\.md\` Lifecycle rules`,
);

test("every writer that opens a backlog item cites the Similar backlog items rule", () => {
  assert.ok(
    lifecycleBullets().has(SIMILAR),
    `doc-types' Lifecycle rules have no ${SIMILAR} bullet`,
  );
  const uncited = SIMILAR_SITES.flatMap(({ file, snippet }) => {
    const found = mentions(file).filter((s) => s.includes(snippet));
    assert.ok(found.length > 0, `${file} no longer has a mention holding "${snippet}"`);
    return found
      .filter((s) => !CITES_SIMILAR.test(flat(s)))
      .map((s) => `${file}: ${s.slice(0, 100)}`);
  });
  assert.deepEqual(
    uncited,
    [],
    `cite the "${SIMILAR}" bullet of \`references/doc-types.md\` **Lifecycle rules**`,
  );
});

const ITEM_MODEL = "The item model";
const ENTRY_SHAPE = /`## Notes` (line|section) quoting/;

test("the Notes entry's shape is stated only in doc-types", () => {
  const restating = MARKDOWN_CORPUS.filter(
    (f) => f !== DOC_TYPES && ENTRY_SHAPE.test(flat(read(f))),
  );
  assert.deepEqual(
    restating,
    [],
    `cite references/doc-types.md ${ITEM_MODEL} instead of restating the entry`,
  );
});

test("every site that writes a backlog item's Notes entry cites The item model", () => {
  const bullets = lifecycleBullets();
  const sites = [
    ["Follow-ups flush", bullets.get("Follow-ups flush") ?? ""],
    [SIMILAR, bullets.get(SIMILAR) ?? ""],
    ...[
      ["skills/finishing/SKILL.md", "For each line, open a `status: backlog` item"],
      ["references/debt-audit.md", "row as a `status: backlog` item"],
    ].map(([file, snippet]) => [file, flat(mentions(file).find((s) => s.includes(snippet)) ?? "")]),
  ];
  const uncited = sites.filter(([, text]) => !text.includes(ITEM_MODEL)).map(([site]) => site);
  assert.deepEqual(uncited, [], `these sites no longer cite ${ITEM_MODEL}`);
});

test("a writer outside the Similar backlog items rule never names it", () => {
  const citing = OUTSIDE_SIMILAR.filter((f) => flat(read(f)).includes(SIMILAR));
  assert.deepEqual(
    citing,
    [],
    `these files name ${SIMILAR} though doc-types' Writers puts them outside it`,
  );
});

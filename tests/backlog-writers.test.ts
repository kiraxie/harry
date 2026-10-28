import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS } from "./prose-dirs.ts";
import { headingSection, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*\*/g, "");
const DOC_TYPES = "references/doc-types.md";
const MENTION = /status: backlog|## Follow-ups/;

type Role = { writer: string[] } | { rule: string } | { reader: string } | { repoLocal: string };
type Entry = {
  file: string;
  snippet: string;
  sentences?: number;
  citesSimilar?: true;
  outsideSimilar?: true;
} & Role;

const KNOWN: Entry[] = [
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's dispositions are *commitments*",
    citesSimilar: true,
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "promote an existing `status: backlog` item",
    reader: "promotes a backlog item in place",
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "Discharge step 5's manifest commitments",
    citesSimilar: true,
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's deferred lines land the same way",
    citesSimilar: true,
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "and finishing carries only `## Follow-ups` forward",
    reader: "describes finishing's flush",
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "rule it in step 5's residue manifest",
    citesSimilar: true,
    writer: ["brainstorming's residue manifest", "an author copying in a Non-Goal"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "`## Follow-ups` MAY be created here at step 6",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "references/grilling.md",
    snippet: "becomes a `status: backlog` item",
    citesSimilar: true,
    writer: ["`/grill`'s residue manifest"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "anything outside it → the item's `## Follow-ups`",
    writer: ["findings of any severity outside the fix range"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "**There is no second wave.**",
    writer: ["findings adjudicated to Follow-ups"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "A **backlog** there goes to the item's `## Follow-ups`.",
    writer: ["findings the user rules backlog before the fix wave"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "A line the user's own ruling sends to `## Follow-ups`",
    reader: "marks the Follow-ups lines a user ruling wrote, for the triage",
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "Minor findings → `## Follow-ups`",
    writer: ["Minor findings;"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "## Follow-ups discovered during execution",
    writer: ["executing: follow-on work found mid-build"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "is appended as one line under the item's `## Follow-ups`",
    writer: ["executing: follow-on work found mid-build"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "`## Follow-ups` line is for process/scope-level follow-on work",
    reader: "contrasts a Follow-ups line with a DEBT: marker",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "On a later round, also hand it every ruling",
    reader: "hands the reviewer the Minors already in Follow-ups",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **backlog** → the finding quoted",
    citesSimilar: true,
    writer: ["finishing's backlog ruling"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "From round 2 on, each Minor finding goes to the item's `## Follow-ups`",
    writer: ["finishing's architecture review from round 2 on"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**No item (Trivial).**",
    reader: "moves item lines to the reply when there is no item",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "always lands in a `status: backlog` item, never only in the reply",
    citesSimilar: true,
    writer: ["finishing's backlog ruling", "finishing's leftover check for a unit with no item"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "A kept leftover is appended to the item's `## Follow-ups`",
    citesSimilar: true,
    writer: ["finishing's leftover check"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Skip anything already in `## Follow-ups`",
    reader: "skips what Follow-ups and the backlog already hold",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Conversation leftovers, before `gh pr create`.**",
    citesSimilar: true,
    writer: ["finishing's leftover check"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**Follow-ups triage, before the menu.**",
    citesSimilar: true,
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "the line leaves `## Follow-ups` for a new AC",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "and the line leaves `## Follow-ups`.",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "A unit with no item has no `## Follow-ups` and skips this.",
    reader: "skips the triage when there is no item",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Then flush: read the item's `## Follow-ups` section",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "For each line, open a `status: backlog` item",
    citesSimilar: true,
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Then clear the source item's `## Follow-ups` section.",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Non-Goals do NOT get this treatment",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Back to backlog**",
    rule: "Active → backlog (discard)",
  },
  {
    file: "references/debt-audit.md",
    snippet: "whose frontmatter has `status: backlog`",
    reader: "reads backlog items to re-judge them",
  },
  {
    file: "references/debt-audit.md",
    snippet: "row as a `status: backlog` item",
    citesSimilar: true,
    writer: ["`/debt`, on request"],
  },
  {
    file: "references/sync-migration.md",
    snippet: "`status: backlog`, its",
    outsideSimilar: true,
    writer: ["`/sync`'s legacy migration"],
  },
  {
    file: "references/review-rubric.md",
    snippet: "- **Scope grows only on the user's say.**",
    reader: "the rule the steps that write Follow-ups and backlog sort by",
  },
  {
    file: "references/review-rubric.md",
    snippet: "item's `## Follow-ups` for final triage; do not block",
    reader: "tells the reviewer where Minors go; executing writes them",
  },
  {
    file: "references/review-rubric.md",
    snippet: "#### Minor (nice to have — item's `## Follow-ups` for final triage)",
    sentences: 2,
    reader: "report-template headings, in the review and re-review forms",
  },
  {
    file: "references/architecture-review.md",
    snippet: "It lands in a `status: backlog` item",
    citesSimilar: true,
    reader: "tells the reviewer what a backlog ruling does; finishing writes it",
  },
  {
    file: "references/architecture-review.md",
    snippet: "which goes to the item's `## Follow-ups` without a ruling.",
    reader: "tells the reviewer where finishing files round-2 Minors",
  },
  {
    file: "references/architecture-review.md",
    snippet: "and the Minor findings sent to `## Follow-ups` from round 2 on.",
    reader: "tells the reviewer not to raise Minors already in Follow-ups",
  },
  {
    file: "references/architecture-review.md",
    snippet: "exception: it goes to the item's `## Follow-ups`",
    reader: "tells the reviewer where finishing files round-2 Minors",
  },
  {
    file: ".claude/commands/distill.md",
    snippet: "becomes a `status: backlog` item quoting",
    citesSimilar: true,
    repoLocal: "writes backlog items in harry's own store; shipped prose may not cite .claude/",
  },
];

const prose = (): string[] => MARKDOWN_CORPUS.filter((f) => f !== DOC_TYPES).sort();

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

test("every sentence that mentions backlog items or Follow-ups is on the known list", () => {
  const unlisted = prose().flatMap((file) =>
    mentions(file)
      .filter((s) => !KNOWN.some((k) => k.file === file && s.includes(k.snippet)))
      .map((s) => `${file}: ${s.trim().slice(0, 100)}`),
  );
  assert.deepEqual(
    unlisted,
    [],
    "class each new sentence: a writer named in doc-types' Writers bullet, a Lifecycle rule of its own, a reader with its reason, or repo-local",
  );
});

test("every known entry matches as many mention sentences as it declares", () => {
  const files = prose();
  const off = KNOWN.map((k) => ({
    k,
    n: files.includes(k.file) ? mentions(k.file).filter((s) => s.includes(k.snippet)).length : 0,
  })).filter(({ k, n }) => n !== (k.sentences ?? 1));
  assert.deepEqual(
    off.map(({ k, n }) => `${k.file}: ${k.snippet} (matches ${n})`),
    [],
    "remove a stale entry, or narrow a snippet that now covers more than its sentences",
  );
});

test("doc-types' Writers bullet names every writer", () => {
  const list = lifecycleBullets().get("Writers") ?? "";
  const missing = KNOWN.flatMap((k) =>
    "writer" in k
      ? k.writer.filter((w) => !list.includes(flat(w))).map((w) => `${k.file}: ${w}`)
      : [],
  );
  assert.deepEqual(missing, [], "doc-types' Writers bullet no longer names these writers");
});

test("the writers outside the Writers bullet are Lifecycle rules of their own", () => {
  const bullets = lifecycleBullets();
  const missing = [...new Set(KNOWN.flatMap((k) => ("rule" in k ? [k.rule] : [])))].filter(
    (rule) => !bullets.has(rule),
  );
  assert.deepEqual(missing, [], "doc-types' Lifecycle rules no longer have these bullets");
});

const SIMILAR = "Similar backlog items";
const CITES_SIMILAR = new RegExp(
  `"${SIMILAR}" bullet of \`references/doc-types\\.md\` Lifecycle rules`,
);

test("every sentence flagged citesSimilar cites the Similar backlog items rule", () => {
  assert.ok(
    lifecycleBullets().has(SIMILAR),
    `doc-types' Lifecycle rules have no ${SIMILAR} bullet`,
  );
  const uncited = KNOWN.filter((k) => k.citesSimilar).flatMap((k) =>
    mentions(k.file)
      .filter((s) => s.includes(k.snippet) && !CITES_SIMILAR.test(flat(s)))
      .map((s) => `${k.file}: ${s.slice(0, 100)}`),
  );
  assert.deepEqual(
    uncited,
    [],
    `cite the "${SIMILAR}" bullet of \`references/doc-types.md\` **Lifecycle rules**`,
  );
});

test("every sentence that cites the Similar backlog items rule is flagged citesSimilar", () => {
  const unflagged = prose().flatMap((file) =>
    mentions(file)
      .filter(
        (s) =>
          CITES_SIMILAR.test(flat(s)) &&
          !KNOWN.some((k) => k.citesSimilar && k.file === file && s.includes(k.snippet)),
      )
      .map((s) => `${file}: ${s.slice(0, 100)}`),
  );
  assert.deepEqual(unflagged, [], "flag each entry citesSimilar so its citation stays checked");
});

test("doc-types' flush and Writers bullets defer to the Similar backlog items rule", () => {
  const bullets = lifecycleBullets();
  const missing = ["Follow-ups flush", "Writers"].filter(
    (b) => !(bullets.get(b) ?? "").includes(SIMILAR),
  );
  assert.deepEqual(missing, [], `these doc-types bullets no longer name ${SIMILAR}`);
});

test("doc-types names /sync's migration as the one writer outside the Similar backlog items rule", () => {
  assert.match(
    lifecycleBullets().get("Writers") ?? "",
    /`\/sync`'s legacy migration[^;]*the one writer outside Similar backlog items/,
  );
});

test("every direct creator's sentence that opens a backlog item is classed for the Similar backlog items rule", () => {
  const writers = flat(lifecycleBullets().get("Writers") ?? "");
  const direct = section(
    writers,
    DOC_TYPES,
    "created directly by",
    "`## Follow-ups` entries come from",
  );
  const unclassed = KNOWN.filter(
    (k) =>
      "writer" in k &&
      k.writer.some((w) => direct.includes(flat(w))) &&
      !k.citesSimilar &&
      !k.outsideSimilar &&
      mentions(k.file).some((s) => s.includes(k.snippet) && s.includes("status: backlog")),
  ).map((k) => `${k.file}: ${k.snippet}`);
  assert.deepEqual(
    unclassed,
    [],
    "mark each citesSimilar (cites the rule) or outsideSimilar (the Writers exception)",
  );
});

test("doc-types' Non-Goal promotion goes through the Similar backlog items rule", () => {
  const para =
    read(DOC_TYPES)
      .split("\n\n")
      .find((b) => b.startsWith("**Non-Goals do not survive archiving.**")) ?? "";
  assert.ok(para, "doc-types has no Non-Goals do not survive archiving paragraph");
  assert.match(flat(para), new RegExp(SIMILAR));
});

test("brainstorming rules a kept Non-Goal in its residue manifest, not at step 6", () => {
  const line =
    mentions("skills/brainstorming/SKILL.md").find((s) =>
      s.includes("If a Non-Goal is something you genuinely expect to revisit"),
    ) ?? "";
  assert.ok(line, "the Item Template has no kept-Non-Goal sentence");
  assert.match(flat(line), /step 5's residue manifest as a destination-outside line/);
  assert.doesNotMatch(flat(line), /open a `status: backlog` item now/);
  assert.match(
    lifecycleBullets().get(SIMILAR) ?? "",
    /a writer with no list \(an author promoting a Non-Goal after the design/,
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

test("The item model defines a Notes entry as an ordered source rule and a closed blockquote", () => {
  const para = flat(
    read(DOC_TYPES)
      .split("\n\n")
      .find((b) => b.startsWith("A `## Notes` entry a writer files")) ?? "",
  );
  assert.ok(para, "doc-types' item model has no Notes entry paragraph");
  for (const rule of [
    /then the quote as a `>` blockquote/,
    /ends where its blockquote ends/,
    /belongs to no block/,
    /the item the line came from; with no item, the slash command that filed it and what it ran on; with neither, the branch/,
    /`references\/sync-migration\.md` Phase 3/,
  ])
    assert.match(para, rule);
  assert.doesNotMatch(para, /verbatim/, "point to /sync's own rule instead of restating it");
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
  const files = [...new Set(KNOWN.filter((k) => k.outsideSimilar).map((k) => k.file))];
  assert.ok(files.length > 0, "no KNOWN entry is marked outsideSimilar");
  const citing = files.filter((f) => flat(read(f)).includes(SIMILAR));
  assert.deepEqual(
    citing,
    [],
    `these files name ${SIMILAR} though doc-types' Writers puts them outside it`,
  );
});

test("the ruled backlog marker carries its target across sessions", () => {
  const bullets = lifecycleBullets();
  const writers = bullets.get("Writers") ?? "";
  const missing = [
    "`(ruled backlog → merge into <slug>)`",
    "`(ruled backlog → new item <slug>)`",
  ].filter((form) => !writers.includes(form));
  assert.deepEqual(missing, [], "the Writers bullet no longer defines these marker forms");
  assert.match(bullets.get(SIMILAR) ?? "", /reads the target from the line's marker/);
});

test("doc-types never calls the flush the only source of backlog items, anywhere in the file", () => {
  assert.doesNotMatch(flat(read(DOC_TYPES)), /the only place new backlog items get created/);
});

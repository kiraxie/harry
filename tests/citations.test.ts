import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  blockDimensionFailures,
  citationAttempts,
  citeFailures,
  dimensionFailures,
  fenceBlocks,
  fences,
  LEGACY_FORMS,
  lawAttempts,
  lawFailures,
  lawLabelFailures,
  legacyHits,
  namesIn,
  plainNameCitations,
  type Repo,
  readProse,
  resolveName,
  stepAttempts,
  strayBold,
} from "./citations.ts";

const docs: Record<string, string> = {
  "HARRY.md": "## Tiers\n## Evidence\n## Code\n",
  "commands/review.md": "## Target\n",
  "references/grilling.md": "## Handoff\n",
  "references/pr-body.md": "## Evidence\n",
  "references/red-green.md": "1. **Run *all* tests.** a\n2. **Use `**` marks.** b\n",
  "references/architecture-review.md": "## System level\n",
  "references/audit/SCAN-DIMENSIONS.md":
    "## 11. Low-value tests\n### Choosing dimensions and shaping agents\n" +
    "## 2. Reusability & hoist candidates (same-intent code that drifted apart)\n",
  "scripts/install.mjs": "",
  "skills/brainstorming/SKILL.md": "## Full Flow (full depth)\n",
  "skills/executing/SKILL.md": "## Steps\n## Review\n1. **One fix wave.** a\n",
  "skills/finishing/SKILL.md": "1. **Verify tests first** a\n",
};
const dirs = new Set(
  Object.keys(docs).flatMap((rel) =>
    rel
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const repo: Repo = {
  kind: (rel) => {
    const norm = path.posix.normalize(rel);
    if (norm === "." || dirs.has(norm)) return "dir";
    return norm in docs ? "file" : "untracked";
  },
  names: (rel) => namesIn(docs[path.posix.normalize(rel)] ?? ""),
};
const md = (text: string) => readProse("x.md", text);
const attempts = (text: string): string[] => citationAttempts(repo, md(text));
const steps = (text: string): string[] => stepAttempts(repo, md(text));
const laws = (text: string): string[] => lawAttempts(md(text));

test("citations.ts is pure: nothing it reaches reads git or the disk", () => {
  const reached = new Set<string>();
  const builtins = new Set<string>();
  const queue = [fileURLToPath(new URL("citations.ts", import.meta.url))];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const m of readFileSync(file, "utf-8").matchAll(/^import\b[^"';]*["']([^"']+)["']/gm)) {
      const spec = m[1] as string;
      if (spec.startsWith(".")) queue.push(path.resolve(path.dirname(file), spec));
      else builtins.add(spec);
    }
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(
    [...reached].map((f) => path.relative(root, f)).sort(),
    ["scripts/lib/evals-cases.mts", "tests/citations.ts"],
    "citations.ts reaches a new module; keep git and the disk out, take them through Repo",
  );
  assert.deepEqual(
    [...builtins].sort(),
    ["mdast-util-from-markdown", "mdast-util-gfm", "micromark-extension-gfm"],
    "a module citations.ts reaches imports more than the Markdown parser; it may read git or the disk",
  );
});

test("a cited name resolves to one heading or step", () => {
  assert.deepEqual(
    namesIn(
      "# Title\n## \n## 2. Top — sub (x)\n1. **Step one.** a\n   1. **Nested.** b\n**Paragraph.** c\n```\n1. **Fenced.** d\n```\n" +
        "2. **Run *all* tests.** e\n3. **A label\n   that wraps.** f\n4. **Use `**` marks.** g\n5. **After\n\n** gap\n## Last\n",
    ).map((n) => n.name),
    ["Top", "Step one", "Run *all* tests", "A label that wraps", "Use `**` marks", "Last"],
    "a name now comes from a title, an empty heading, a nested item, a bold paragraph, a fenced " +
      "line or bold across a blank line, or a label with italics, a code span or a wrap is lost",
  );
  assert.deepEqual(
    namesIn("1. **a\n2. b** c\n"),
    [],
    "a label's bold runs on into the next list item",
  );
  const doc = namesIn(
    "## Install\n### Flow (full depth)\n1. **One fix wave.** a\n## 3. Install — again\n### Check\n",
  );
  const fixtures: [string, number | undefined, string | null][] = [
    ["One fix wave", undefined, null],
    ["Flow", undefined, null],
    ["Flow", 3, null],
    ["Flow", 2, 'x.md has no ## heading "Flow"'],
    ["Check the fixes first", undefined, 'x.md has no heading or step "Check the fixes first"'],
    ["Flow (full depth)", undefined, "x.md **Flow (full depth)**: cite its core name **Flow**"],
    ["Install", undefined, 'x.md **Install** is ambiguous: "Install", "3. Install — again"'],
  ];
  for (const [name, level, expected] of fixtures)
    assert.equal(
      resolveName(doc, "x.md", name, level),
      expected,
      `the resolver misjudges "${name}" at level ${level}`,
    );
});

const BROKEN_CITE = "see `references/grilling.md` **Handof**";
const FENCED_CITE_ROWS: [string, string, string[]][] = [
  ["at top level", `intro\n\n\`\`\`\nfirst\n${BROKEN_CITE}\n\`\`\`\n`, ["5"]],
  ["in a list item", `- intro\n\n  \`\`\`\n  first\n  ${BROKEN_CITE}\n  \`\`\`\n`, ["5"]],
  ["in a > quote", `> intro\n>\n> \`\`\`\n> first\n> ${BROKEN_CITE}\n> \`\`\`\n`, ["5"]],
];

for (const [label, text, lines] of FENCED_CITE_ROWS)
  test(`a citation in an untagged fence fails at its file line: ${label}`, () => {
    assert.deepEqual(
      citeFailures(repo, md(text)).failures,
      lines.map((line) => `${line} -> references/grilling.md has no heading or step "Handof"`),
    );
  });

test("a tagged fence is not read", () => {
  assert.deepEqual(
    citeFailures(repo, md(`intro\n\n\`\`\`sh\nfirst\n${BROKEN_CITE}\n\`\`\`\n`)).failures,
    [],
  );
});

test("readProse returns a fence before a later paragraph in line order", () => {
  assert.deepEqual(
    md("```\nfenced\n```\n\nprose\n").map((block) => [block.lineAt(0), block.text]),
    [
      [2, "fenced"],
      [5, "prose"],
    ],
  );
});

test("hits are listed by block, then by offset", () => {
  assert.deepEqual(laws("x **Tiers** a\n\n**Tiers** b\n"), [
    "1 -> **Tiers** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**",
    "3 -> **Tiers** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**",
  ]);
});

test("a fence hit at the same block offset as a prose hit is kept, in line order", () => {
  assert.deepEqual(laws("**Tiers** a\n\n```\n**Tiers** b\n```\n"), [
    "1 -> **Tiers** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**",
    "4 -> **Tiers** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**",
  ]);
});

test("Markdown is read as GitHub renders it", () => {
  assert.deepEqual(
    citeFailures(repo, md("intro\n\n    per `references/grilling.md` **Handof**\n")),
    { seen: 0, failures: [] },
    "a citation in an indented code block is read",
  );
  assert.deepEqual(
    citeFailures(repo, md("> - per `references/grilling.md`\n>   **Handof** here")),
    { seen: 1, failures: ['1 -> references/grilling.md has no heading or step "Handof"'] },
    "a citation in a list item inside a quote is not read",
  );
  assert.deepEqual(
    namesIn("---\nname: x\ndescription: y\n---\n## A\n").map((n) => n.name),
    ["A"],
    "front matter is read as a heading",
  );
  assert.deepEqual(
    attempts('---\ndescription: per `references/grilling.md` "Handoff"\n---\n'),
    ["2 -> a name next to references/grilling.md; cite it as `path` **Name**"],
    "front matter is no longer read as prose",
  );
  assert.deepEqual(
    namesIn("- **Bullet.** a\n1) **Paren.** b\n\n1. see **Inside.** c\n"),
    [],
    "a bold name in a bullet item, a 1) item or past an item's start is read as a step label",
  );
  assert.deepEqual(
    lawFailures(md("## per HARRY.md **Tier**\n\n| a |\n|---|\n| per HARRY.md **Code** |\n")),
    { seen: 2, failures: ["1 -> HARRY.md **Tier**"] },
    "a citation in a heading or a table cell is not read",
  );
});

const FENCE_ROWS: [string, string, { info: string; text: string; line: number }[]][] = [
  [
    "a four-backtick fence holding a three-backtick line is one fence",
    "````\na\n```\nb\n````\n",
    [{ info: "", text: "a\n```\nb", line: 2 }],
  ],
  [
    "a fence under a nested list item is read",
    "- a\n  - b\n\n    ```\n    x\n    ```\n",
    [{ info: "", text: "x", line: 5 }],
  ],
  [
    "an unclosed fence runs to the end of its container",
    "> ```\n> x\n\nafter\n",
    [{ info: "", text: "x", line: 2 }],
  ],
  ["a ~~~ fence is read", "~~~\nx\n~~~\n", [{ info: "", text: "x", line: 2 }]],
  [
    "a fence tagged json carries its tag",
    "```json\n{}\n```\n",
    [{ info: "json", text: "{}", line: 2 }],
  ],
  ["an untagged fence is read", "intro\n\n```\nx\ny\n```\n", [{ info: "", text: "x\ny", line: 4 }]],
  ["an indented code block is not read", "intro\n\n    x\n", []],
];

for (const [label, src, expected] of FENCE_ROWS)
  test(`fences: ${label}`, () => {
    assert.deepEqual(fences(src), expected);
  });

const FENCE_BODY_ROWS: [string, string, { text: string; code: string[] }[]][] = [
  [
    "an indented line, an HTML line and a link definition in a fence are read as prose",
    "Agent brief:\n\n    focus on `low-value-tests` first\n\n<low-value-tests>\n\n[x]: url",
    [
      { text: "Agent brief:", code: [] },
      { text: "focus on `low-value-tests` first", code: ["`low-value-tests`"] },
      { text: "<low-value-tests>", code: [] },
      { text: "[x]: url", code: [] },
    ],
  ],
  [
    "a three-backtick fence inside a fence body is not read",
    "a\n```\nb\n```",
    [{ text: "a", code: [] }],
  ],
];

for (const [label, body, expected] of FENCE_BODY_ROWS)
  test(`fence body: ${label}`, () => {
    assert.deepEqual(
      fenceBlocks({ info: "", text: body, line: 1 }).map((b) => ({
        text: b.text,
        code: b.code.map((c) => b.text.slice(c.from, c.to)),
      })),
      expected,
    );
  });

test("a dimension citation on an indented line of a fence body is checked", () => {
  const body = "intro\n\n    dimension **Dead codes**";
  assert.deepEqual(
    fenceBlocks({ info: "", text: body, line: 1 }).flatMap((b) =>
      blockDimensionFailures(repo, b).map((f) => `${f.line} -> ${f.failure}`),
    ),
    ['3 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Dead codes"'],
  );
});

test("each legacy form matches its samples and names the form to use", () => {
  for (const { label, re, samples } of LEGACY_FORMS)
    for (const sample of samples)
      assert.equal([...sample.matchAll(re)].length, 1, `the "${label}" rule no longer matches`);
  assert.deepEqual(
    legacyHits(md("intro\nper dimension 10 and HARRY.md Tiers")),
    [
      "2 -> an audit dimension by number; cite it as dimension **<SCAN-DIMENSIONS ## core name>**",
      "2 -> a law named in plain text; cite it as HARRY.md **Heading**",
    ],
    "a legacy hit no longer carries its line or the form to use",
  );
  assert.deepEqual(
    legacyHits(md("intro\n```sh\nHARRY.md Tiers\n```\nrun `dimension 10` and ` HARRY.md` Tiers")),
    [],
    "a legacy form inside a tagged fence or a code span holding more than a path is read",
  );
  assert.deepEqual(
    legacyHits(md("per `skills/executing` step 4")),
    ["1 -> a skill's step with no path; cite it as `path` **Name**"],
    "a legacy form in a code span holding only a path is no longer read",
  );
  for (const at of ["~/.claude/harry", "~kira/.claude/harry", "$HOME/.claude/harry", "/Users/x"])
    assert.equal(
      legacyHits(md(`see \`${at}/HARRY.md\` Tiers`)).length,
      1,
      `a law named after a code span holding only ${at}/HARRY.md is no longer read`,
    );
});

test("a dimension citation names a SCAN-DIMENSIONS ## heading", () => {
  assert.deepEqual(
    dimensionFailures(
      repo,
      md(
        "a dimension **Low-value tests**,\nDimension **Low value tests**, dimension\n**Wrapped typo**,\n" +
          "dimension **Choosing dimensions and shaping agents** and\n" +
          "dimension **2. Reusability & hoist candidates (same-intent code that drifted apart)**",
      ),
    ),
    {
      seen: 5,
      failures: [
        '2 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Low value tests"',
        '2 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Wrapped typo"',
        '4 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Choosing dimensions and shaping agents"',
        "5 -> references/audit/SCAN-DIMENSIONS.md **2. Reusability & hoist candidates (same-intent code that drifted apart)**: cite its core name **Reusability & hoist candidates**",
      ],
    },
    "the dimension citation check no longer matches, accepts a wrong or ### name, lost the core-name hint or the line",
  );
  assert.deepEqual(
    dimensionFailures(repo, md("a dimension **Low-value\ntests** here")),
    { seen: 1, failures: [] },
    "a dimension name wrapped across a line no longer resolves",
  );
});

test("a cross-file citation names a heading or step its file has", () => {
  assert.deepEqual(
    citeFailures(
      repo,
      md(
        "per `references/grilling.md` **Handoff**, `skills/executing/SKILL.md` **One   fix\nwave**\n" +
          "and `references/grilling.md` **Handof**, `references/x.md` **Seams**",
      ),
    ),
    {
      seen: 4,
      failures: [
        '3 -> references/grilling.md has no heading or step "Handof"',
        "3 -> references/x.md is not tracked",
      ],
    },
    "the cross-file check no longer counts, cleans the name, resolves it or reports the line",
  );
  assert.deepEqual(
    citeFailures(
      repo,
      md(
        "per `references/red-green.md` **Run *all* tests** and `references/red-green.md` **Use `**` marks**",
      ),
    ),
    { seen: 2, failures: [] },
    "a step label with italics or a code span is no longer read as bold, or no longer resolves",
  );
});

test("a law citation names a HARRY.md ## heading", () => {
  assert.deepEqual(
    lawFailures(md("per HARRY.md **Tiers** and `HARRY.md` **Ask\nfirst**,\nHARRY.md **Tier**")),
    { seen: 3, failures: ["3 -> HARRY.md **Tier**"] },
    "the law check no longer counts, cleans the name, resolves it or reports the line",
  );
});

test("an eval case with a non-string id is named by its source line", () => {
  assert.deepEqual(
    lawLabelFailures('\n{"id":5,"law":"Tier"}\n').failures,
    ["line 2 -> law Tier"],
    "a case without a string id is no longer named by its source line",
  );
});

test("a non-object eval case line is a parse error, not thrown on", () => {
  assert.deepEqual(
    lawLabelFailures("null\n[]\n5\n").failures,
    ["line 1: not an object", "line 2: not an object", "line 3: not an object"],
    "a non-object line now throws, passes or is read as a case",
  );
});

test("an eval case's law label names a law or a known non-law label", () => {
  const { seen, failures } = lawLabelFailures(
    '{"law":"Tiers"}\n\n{"law":"rubric"}\n{"law":"Tier"}\n{"id":"x"}\n{oops\n{"law":"L&C"}\n',
  );
  assert.equal(seen, 6, "the law-label check no longer counts each non-empty line once");
  assert.deepEqual(
    failures.map((f) => f.replace(/^(line 6: not valid JSON) \(.*\)$/, "$1")),
    ["line 6: not valid JSON", "line 4 -> law Tier", 'case "x" -> law undefined'],
    "the law-label check no longer accepts a law or known label, or reports a bad one",
  );
});

test("a heading or step named in plain text after a path is caught", () => {
  const fixtures: [string, string[]][] = [
    ["per `references/grilling.md`'s Handoff, then", ['1 -> references/grilling.md "Handoff"']],
    ["per `references/grilling.md`’s Handoff, then", ['1 -> references/grilling.md "Handoff"']],
    ["per `references/grilling.md`: Handoff", ['1 -> references/grilling.md "Handoff"']],
    ["per `references/grilling.md` (Handoff)", ['1 -> references/grilling.md "Handoff"']],
    ["at `skills/executing/SKILL.md` Review, the", ['1 -> skills/executing/SKILL.md "Review"']],
    ["at `skills/executing` Review, the", ['1 -> skills/executing/SKILL.md "Review"']],
    ["at `skills/executing/` Review, the", ['1 -> skills/executing/SKILL.md "Review"']],
    ["per `references/grilling.md` — Handoff", ['1 -> references/grilling.md "Handoff"']],
    ["per `references/grilling.md` – Handoff", ['1 -> references/grilling.md "Handoff"']],
    ["per `references/grilling.md` - Handoff", ['1 -> references/grilling.md "Handoff"']],
    ["per references/grilling.md's Handoff, then", ['1 -> references/grilling.md "Handoff"']],
    ["at skills/executing Review, the", ['1 -> skills/executing/SKILL.md "Review"']],
    ["per `references/grilling.md`\nHandoff, then", ['1 -> references/grilling.md "Handoff"']],
    ["per ``references/grilling.md`` Handoff, then", ['1 -> references/grilling.md "Handoff"']],
    ["see `skills/executing/SKILL.md` review step", []],
    ["`references/grilling.md` covers it", []],
    ["`references/grilling.md` Handoffs list", []],
    ["run `cat references/grilling.md Handoff` here", []],
    ["run ``cat `references/grilling.md` Handoff`` here", []],
    ["intro\n```sh\ncat references/grilling.md Handoff\n```\n", []],
    [
      "intro\nper `references/grilling.md`'s Handoff, then",
      ['2 -> references/grilling.md "Handoff"'],
    ],
  ];
  for (const [sample, hits] of fixtures)
    assert.deepEqual(
      plainNameCitations(repo, md(sample)),
      hits,
      `the plain-text name check misjudges: ${sample}`,
    );
});

const checkFixtures = (
  scan: (text: string) => string[],
  mustFail: string[],
  mustPass: string[],
) => {
  for (const sample of mustFail) assert.ok(scan(sample).length > 0, `no longer fails: ${sample}`);
  for (const sample of mustPass)
    for (const [label, check] of [
      ["citationAttempts", attempts],
      ["stepAttempts", steps],
      ["lawAttempts", laws],
    ] as const)
      assert.deepEqual(check(sample), [], `now fails ${label}: ${sample}`);
};

test("a citation attempt next to a path must be in the one form", () => {
  checkFixtures(
    attempts,
    [
      "per `references/grilling.md`: (**Handoff**) here",
      "per `references/grilling.md`’s, **Handoff** here",
      "per `references/grilling.md`; **Handoff** here",
      "per `references/grilling.md` — **Handoff** here",
      'per `references/grilling.md`’s "Handoff" here',
      "per `references/grilling.md`, **Handof** here",
      "at `skills/executing` **Steps** here",
      'the "Handoff" section of `references/grilling.md` says so',
      "see `references/grilling.md` and then its **Handoff** rule",
      "per HARRY.md's **Tiers** here",
      "per HARRY.md’s **Tiers** here",
      "per `HARRY.md`'s **Tiers** here",
      "See **Handoff** in `references/grilling.md`",
      'per `references/grilling.md`, "Handoff"',
      "per `references/grilling.md`, **Handoff**",
      "per `references/grilling.md`'s **Handoff**",
      "per `references/grilling.md`’s **Handoff**",
      "per `references/grilling.md`’s **Handof**",
      'per `references/grilling.md`, \\"Handoff\\"',
      "per `references/grilling.md`: **Handoff**",
      "per `references/grilling.md` (**Handoff**)",
      "per `skills/executing/`'s **Steps**",
      "per `skills/executing` (**Steps**)",
      "per `references/grilling.md` — **Handof** here",
      "per `references/grilling.md` – **Handof** here",
      "per `references/grilling.md`–**Handof** here",
      "per `references/grilling.md` - **Handof** here",
      "per `references/grilling.md`: **Handof** here",
      "per `references/grilling.md` (**Handof**) here",
      "at `references/audit` **Recon** here",
      "at `skills/brainstrming` **Steps** here",
      'per `references/x.md`, "Seams"',
      "per `references/x.md`, **Seams**",
      "per `references/x.md`’s **Seams**",
      "per `references/x.md`: **Seams**",
      "per `references/x.md` (**Seams**)",
      "per `skills/x` **Steps**",
      "per `skills/x/`'s **Steps**",
      "per `skills/x` (**Steps**)",
      "per `references/grilling.md`, then run `x` **Handoff** here",
      "see `skills/brainstorming/SKILL.md` and its **Full Flow (full depth)** part",
      'per `references/grilling.md` and `x` "Handoff" here',
      "per references/grilling.md **Handoff** here",
      "per skills/executing **Steps** here",
      "run `x` then references/grilling.md **Handoff** here",
      "per ``references/grilling.md`` **Handoff** here",
      "per ` references/grilling.md ` **Handoff** here",
      "per ` skills/x ` **Steps** here",
      "per `\nreferences/grilling.md\n` **Handoff** here",
    ],
    [
      "simplify dual-lane — **Claude Code build:** in `commands/review.md`; **Codex build:**",
      "earns its place. **Run it after any material change to `HARRY.md`** to catch a",
      "The rubric the `analyst` reviewer applies at executing's review (`skills/executing/SKILL.md` **Review**,\nand its scoped re-review in `skills/executing/SKILL.md` **One fix wave**). The review standard",
      '      "skill": "HARRY.md",',
      'the "`references/grilling.md`" file',
      "Rebuild `dist/` when changing `src/` **or `package.json`** — the bundle",
      "per `references/audit/SCAN-DIMENSIONS.md` and dimension **Low-value tests**",
      "per `references/x.md` **Seams** here",
      "**see `references/grilling.md`**, then",
      'see `references/grilling.md` and its **"Handoff"** rule',
      "see `references/grilling.md` for it\n\n**Handoff** opens the next paragraph",
      'per `references/grilling.md` " and more" here',
      "and/or **x** here",
      "the `references/grilling.md`-**x** link",
      "the `references/grilling.md` -**x** link",
      "a URL like https://x.io/references/grilling.md **Handoff** here",
      "per $HOME/references/grilling.md **x** here",
      "per file:references/grilling.md **x** here",
      "per ~kira/references/grilling.md **x** here",
      "```\nsee references/grilling.md\n```\nthe **Handoff** rule",
      "see ``x `references/grilling.md` y`` then **Handoff** applies",
      "per `references/grilling.md`:\n```\ncode\n```\nthe **Handoff** rule applies.",
      "per `references/grilling.md`\n```\n(step 4)\n```\n",
      "per `references/grilling.md`` x` **Handoff** here",
      "per `  references/grilling.md  ` **Handoff** here",
      "see `references/grilling.md` for it\n- **Handoff** opens the item",
      "see `references/grilling.md` for it\n- (step 4) opens the item",
    ],
  );
  assert.deepEqual(
    attempts(
      "intro\nat `skills/executing` **Steps** and HARRY.md's **Tiers**\nat `references/audit` **Recon**, or `skills/x` **Steps**",
    ),
    [
      "2 -> a name next to skills/executing; cite it as `dir/SKILL.md` **Name**",
      "2 -> a name next to HARRY.md; cite it as HARRY.md **Heading**",
      "3 -> a name next to references/audit; cite it as `dir/FILE.md` **Name**",
      "3 -> a name next to skills/x; skills/x is not tracked",
      '3 -> skills/executing "Steps" outside the citation form; cite it as `dir/SKILL.md` **Name**',
    ],
    "a hit no longer carries its line or the form to use",
  );
  assert.deepEqual(
    [
      "per `references/grilling.md`, **Handoff** here",
      "per HARRY.md, **Tiers** here",
      "at `skills/executing` **Steps** here",
      "at `references/audit` **Recon** here",
      "at `scripts/install.mjs` **Recon** here",
      "at `references/x.md`, **Seams** here",
      "at `.local/INDEX.md`, **In flight** here",
      "at `tests/../.git`, **x** here",
      "at `./references/grilling.md`, **Handoff** here",
      "per references/grilling.md **Handoff** here",
      "per skills/executing **Steps** here",
      "per ``references/grilling.md`` **Handoff** here",
      "per ` skills/x ` **Steps** here",
    ].flatMap((sample) => attempts(sample)),
    [
      "1 -> a name next to references/grilling.md; cite it as `path` **Name**",
      "1 -> a name next to HARRY.md; cite it as HARRY.md **Heading**",
      "1 -> a name next to skills/executing; cite it as `dir/SKILL.md` **Name**",
      "1 -> a name next to references/audit; cite it as `dir/FILE.md` **Name**",
      "1 -> a name next to scripts/install.mjs; scripts/install.mjs is not markdown, so it has no section to cite",
      "1 -> a name next to references/x.md; references/x.md is not tracked",
      "1 -> a name next to .local/INDEX.md; .local/INDEX.md is not tracked",
      "1 -> a name next to tests/../.git; tests/../.git is not tracked",
      "1 -> a name next to ./references/grilling.md; cite it as `path` **Name**",
      "1 -> a name next to references/grilling.md; cite it as `path` **Name**",
      "1 -> a name next to skills/executing; cite it as `dir/SKILL.md` **Name**",
      "1 -> a name next to references/grilling.md; cite it as `path` **Name**",
      "1 -> a name next to skills/x; skills/x is not tracked",
    ],
    "a hint no longer follows the kind of path it names",
  );
});

test("bold is read where it renders", () => {
  assert.deepEqual(
    laws("a ** stray\n\nthe **Tiers** law holds"),
    ["3 -> **Tiers** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**"],
    "a stray ** swallows the next paragraph's bold",
  );
  for (const sample of [
    "run `a**b` here",
    "run ``a**`b`` here",
    "```sh\na ** b\n\nc\n```\n",
    "**a** and **Ask\nfirst** and **`--x`** and ***c***",
    "the **a *b* c** rule",
    "intro\n***\nafter",
    "****",
    "** *",
    "> **a\n> b** c",
    "**a\n-b** c",
    "**a\n#b** c",
    "**a\n__\nb** c",
    "> **a\nlazy\n> b** c",
    "> ***",
    "x **a\n2. item\nb** y",
    "x **a\n2) item\nb** y",
    "x **a\n    - item\nb** y",
    "x **a\n=-=\nb** y",
    "x **a\n   b\n2. c** d",
    "- a\n\nx **b\n2. c** d",
  ])
    assert.deepEqual(
      strayBold(md(sample)),
      [],
      `a ** that renders as bold is called stray: ${sample}`,
    );
});

test("quotes are read where they render", () => {
  checkFixtures(
    attempts,
    [
      "per `references/grilling.md` “Handoff” here",
      "per `references/grilling.md` ‘Handoff’ here",
      "per `references/grilling.md` 'Handoff' here",
      "per `references/grilling.md`, it's the 'Handoff' rule",
      'see `skills/brainstorming/SKILL.md` and its "Full\nFlow" part',
      'a " stray\n\nper `references/grilling.md`, **Handoff** "x"',
    ],
    [
      "it's the users' rule, `references/grilling.md` says",
      'see `references/grilling.md` and run `x "Handoff"` here',
      "see `references/grilling.md` and run `x 'Handoff'` here",
      "per `references/grilling.md`, the 'Handoff's rule' here",
      "per `references/grilling.md`, see l'Handoff' here",
    ],
  );
});

test("a ** that pairs with nothing is caught", () => {
  const hit = (line: number) =>
    `${line} -> a ** that pairs with nothing renders as asterisks; bold opens before a ` +
    "non-space and closes after one, in the same paragraph";
  const fixtures: [string, string[]][] = [
    ["per HARRY.md ** Tiers** here", [hit(1), hit(1)]],
    ["per HARRY.md **Evidence\n** here", [hit(1), hit(2)]],
    ["a **b\n\nc** d", [hit(1), hit(3)]],
    ["intro\nthe **Tiers law", [hit(2)]],
    ...[
      "* * *",
      "* item",
      "+ item",
      "- item",
      "   - item",
      "1. item",
      "1) item",
      "## Head",
      "#",
      "> q",
      ">",
      "---",
      "___",
      "==",
      "-",
    ].map((line): [string, string[]] => [`x **a\n${line}\nb** y`, [hit(1), hit(3)]]),
    ["***\nx **", [hit(2)]],
    ["intro\n    ***", [hit(2)]],
    ["> x **a\n>\n> b** y", [hit(1), hit(3)]],
    ["> x **a\n> - item\n> b** y", [hit(1), hit(3)]],
    ["> x **a\n> ## h\n> b** y", [hit(1), hit(3)]],
    ["> 1. a **x\n> 2. b** c", [hit(1), hit(2)]],
    ["- a **x\n2. b** z", [hit(1), hit(2)]],
    ["1. a **x\n   b\n2. c** d", [hit(1), hit(3)]],
    ["   - a **x\n     - b\n     c** d", [hit(1), hit(3)]],
    ["> q\n\nx **a\n> b** c", [hit(3), hit(4)]],
    ["[ u@h.co **", [hit(1)]],
    ["intro\n\n# [ u@h.co x **", [hit(3)]],
  ];
  for (const [sample, hits] of fixtures)
    assert.deepEqual(strayBold(md(sample)), hits, `the stray ** check misjudges: ${sample}`);
});

test("a step or category cited by its number is caught", () => {
  checkFixtures(
    steps,
    [
      "at `skills/executing/SKILL.md` **Steps**, step 4",
      "at `skills/executing/SKILL.md` **Steps**'s step 4",
      "at `skills/executing/SKILL.md` **Steps** (step 4)",
      "the `skills/finishing`'s architecture review (step 2)",
      "`skills/executing/SKILL.md` covers it (steps 2-3)",
      "the **Steps** step 4 applies",
      "per `references/architecture-review.md` category 4",
      "per `skills/executing/SKILL.md`, step 2",
      "per skills/executing/SKILL.md, step 2",
      "per `skills/executing` step 4",
      "the **Steps** (step 4) applies",
      "per `skills/executing/SKILL.md`'s step 4",
      "per `references/grilling.md` (category 4)",
      "per `references/grilling.md`: step 4",
      "per `references/grilling.md` — step 4",
      "per `references/grilling.md` – step 4",
      "per `references/grilling.md` - step 4",
      "the **Steps**: step 4 applies",
      'say "the **Steps** step 4" here',
      "the **Seams** step 4 applies",
      "per `references/x.md` category 4",
      "per `skills/x/SKILL.md`, step 2",
      "per `skills/x` step 4",
      "`references/x.md` covers it (steps 2-3)",
      "per ``skills/executing`` step 4",
    ],
    [
      "then `skills/finishing/SKILL.md` **Verify tests first** runs, and finishing again from step 1",
      "do **step 4** next",
      "Run **lint**, then **step 2** of the release.",
    ],
  );
});

test("a bold law name needs HARRY.md before it", () => {
  checkFixtures(
    laws,
    [
      "the **Tiers** law holds",
      "run `x` **Tiers** now",
      'say "the **Tiers** law holds" here',
      "the **Ask\nfirst** law holds",
      "the copy at ~/.claude/harry/HARRY.md, **Code** included",
      "the ***Tiers*** law holds",
      "per XHARRY.md **Code** here",
    ],
    [
      "per HARRY.md **Tiers** and `references/grilling.md` **Handoff**",
      "per `references/pr-body.md` **Evidence** here",
      "the copy at ~/.claude/harry/HARRY.md **Code** included",
    ],
  );
});

test("readProse reads a .md file as rendered and any other file as an untagged fence body", () => {
  const text = "x:\n\n    see HARRY.md **Nope**\n";
  assert.deepEqual(lawFailures(readProse("NOTICE", text)).failures, ["3 -> HARRY.md **Nope**"]);
  assert.equal(lawFailures(readProse("x.md", text)).seen, 0);
  assert.equal(lawFailures(readProse("NOTICE", "a\n```\nHARRY.md **Nope**\n```\n")).seen, 0);
});

test("a block led by [ and an autolink is read whole at its line", () => {
  const fixtures: [string, [number, string][]][] = [
    ["[ u@h.co x", [[1, "[ u@h.co x"]]],
    [
      "intro\n\n[ u@h.co x",
      [
        [1, "intro"],
        [3, "[ u@h.co x"],
      ],
    ],
    ["# [ u@h.co x", [[1, "[ u@h.co x"]]],
    [
      "| h |\n|---|\n| [ u@h.co x |",
      [
        [1, "h"],
        [3, "[ u@h.co x"],
      ],
    ],
  ];
  for (const [sample, blocks] of fixtures)
    assert.deepEqual(
      md(sample).map((block) => [block.lineAt(0), block.text]),
      blocks,
      `misread: ${sample}`,
    );
});

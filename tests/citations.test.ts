import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  citationAttempts,
  citeFailures,
  dimensionFailures,
  LEGACY_FORMS,
  lawAttempts,
  lawFailures,
  lawLabelFailures,
  legacyHits,
  namesIn,
  plainNameCitations,
  type Repo,
  resolveName,
  stepAttempts,
} from "./citations.ts";

const docs: Record<string, string> = {
  "HARRY.md": "## Tiers\n## Evidence\n## Code\n",
  "commands/review.md": "## Target\n",
  "references/grilling.md": "## Handoff\n",
  "references/pr-body.md": "## Evidence\n",
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
const attempts = (text: string): string[] => citationAttempts(repo, text);
const steps = (text: string): string[] => stepAttempts(repo, text);
const laws = (text: string): string[] => lawAttempts(text);

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
    ["scripts/lib/evals-cases.mts", "tests/citations.ts", "tests/section.ts"],
    "citations.ts reaches a new module; keep git and the disk out, take them through Repo",
  );
  assert.deepEqual(
    [...builtins].sort(),
    ["node:assert/strict"],
    "a module citations.ts reaches imports more than node:assert; it may read git or the disk",
  );
});

test("a cited name resolves to one heading or step", () => {
  assert.deepEqual(
    namesIn(
      "# Title\n## \n## 2. Top — sub (x)\n1. **Step one.** a\n   1. **Nested.** b\n**Paragraph.** c\n```\n1. **Fenced.** d\n```\n",
    ).map((n) => n.name),
    ["Top", "Step one"],
    "a name now comes from a title, an empty heading, a nested item, a bold paragraph or a fenced line",
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

test("each legacy form matches its samples and names the form to use", () => {
  for (const { label, re, samples } of LEGACY_FORMS)
    for (const sample of samples)
      assert.equal([...sample.matchAll(re)].length, 1, `the "${label}" rule no longer matches`);
  assert.deepEqual(
    legacyHits("intro\nper dimension 10 and HARRY.md Tiers"),
    [
      "2 -> an audit dimension by number; cite it as dimension **<SCAN-DIMENSIONS ## core name>**",
      "2 -> a law named in plain text; cite it as HARRY.md **Heading**",
    ],
    "a legacy hit no longer carries its line or the form to use",
  );
});

test("a dimension citation names a SCAN-DIMENSIONS ## heading", () => {
  assert.deepEqual(
    dimensionFailures(
      repo,
      "a dimension **Low-value tests**,\nDimension **Low value tests**, dimension\n**Wrapped typo**,\n" +
        "dimension **Choosing dimensions and shaping agents** and\n" +
        "dimension **2. Reusability & hoist candidates (same-intent code that drifted apart)**",
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
    dimensionFailures(repo, "a dimension **Low-value\ntests** here"),
    { seen: 1, failures: [] },
    "a dimension name wrapped across a line no longer resolves",
  );
});

test("a cross-file citation names a heading or step its file has", () => {
  assert.deepEqual(
    citeFailures(
      repo,
      "per `references/grilling.md` **Handoff**, `skills/executing/SKILL.md` **One   fix\nwave**\n" +
        "and `references/grilling.md` **Handof**, `references/x.md` **Seams**",
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
});

test("a law citation names a HARRY.md ## heading", () => {
  assert.deepEqual(
    lawFailures("per HARRY.md **Tiers** and `HARRY.md` **Evidence\n**,\nHARRY.md **Tier**"),
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
    ["see `skills/executing/SKILL.md` review step", []],
    ["`references/grilling.md` covers it", []],
    ["`references/grilling.md` Handoffs list", []],
    [
      "intro\nper `references/grilling.md`'s Handoff, then",
      ['2 -> references/grilling.md "Handoff"'],
    ],
  ];
  for (const [sample, hits] of fixtures)
    assert.deepEqual(
      plainNameCitations(repo, sample),
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
    ],
    "a hint no longer follows the kind of path it names",
  );
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
      "per `skills/executing` step 4",
      "the **Steps** (step 4) applies",
      "per `skills/executing/SKILL.md`'s step 4",
      "per `references/grilling.md` (category 4)",
      "per `references/grilling.md`: step 4",
      "per `references/grilling.md` — step 4",
      "the **Steps**: step 4 applies",
      'say "the **Steps** step 4" here',
      "the **Seams** step 4 applies",
      "per `references/x.md` category 4",
      "per `skills/x/SKILL.md`, step 2",
      "per `skills/x` step 4",
      "`references/x.md` covers it (steps 2-3)",
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
    ],
    [
      "per HARRY.md **Tiers** and `references/grilling.md` **Handoff**",
      "per `references/pr-body.md` **Evidence** here",
      "the copy at ~/.claude/harry/HARRY.md, **Code** included",
    ],
  );
});

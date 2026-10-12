import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROSE_DIRS as INSTRUCTION_DIRS,
  REPO_LOCAL_DIRS,
  REPO_LOCAL_PROSE_DIRS,
  REPO_TOP_LEVEL,
  SHIPPED_PROSE_DIRS,
  SHIPPED_TOP_LEVEL,
} from "./prose-dirs.ts";

// The plugin's real product is ~3,000 lines of markdown that an AI agent follows,
// full of file-path references (references/tier-gates.md, ${CLAUDE_PLUGIN_ROOT}/...,
// scripts/init.mjs). Nothing else verifies those paths exist — renames/deletes leave
// dangling references (this exact failure class was found twice in recent reviews).
// This test extracts candidate repo-relative paths from all prose and asserts each exists.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const TOP_LEVEL_FILES = [...SHIPPED_TOP_LEVEL, ...REPO_TOP_LEVEL];
const PROSE_DIRS = [...INSTRUCTION_DIRS, "evals"];

function listMarkdownFiles(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

const proseFiles = [
  ...TOP_LEVEL_FILES.filter((f) => existsSync(path.join(repoRoot, f))),
  ...PROSE_DIRS.flatMap(listMarkdownFiles),
].filter((f) => f !== "CHANGELOG.md");
const citeCorpus = [...proseFiles, "upstream.json"];

const lineOf = (text: string, index?: number): number => text.slice(0, index).split("\n").length;

// Three reference shapes:
// 1. `${CLAUDE_PLUGIN_ROOT}/<path>` — path is everything after the prefix. Checked
//    everywhere (fenced or not) — this is how the plugin's own docs express real
//    runtime invocations (e.g. commands/sync.md's `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"`).
// 2. Bare repo-relative mentions of known top-level dirs, with a recognized file
//    extension. Checked only OUTSIDE fenced code blocks — inside fences these are
//    frequently fabricated illustration (a skill's fenced `tests/auth/token.test.ts`
//    example, say), not real cross-references. A `(?<!\/)` guard also
//    stops a longer real path like `src/commands/fix.ts` from being mis-sliced into
//    the shorter bare candidate `commands/fix.ts`.
// 3. A path under one of `REPO_LOCAL_DIRS` (`.claude/…`) — the same bare-mention shape
//    as (2), scoped to exactly those subdirs (see CLAUDE_DIR_PATH_RE below for why).
const PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g;
// Extension whitelist shared by both path regexes below — kept as one constant
// composed into each pattern's source rather than duplicated literally, after
// this file's own `mts` addition had to edit two copies to stay in sync
// (the drift test in references/review-rubric.md: shared knowledge, not incidental duplication).
const EXT_SRC = String.raw`\.(?:md|json|cjs|mjs|mts|ts|sh)\b`;
const BARE_PATH_RE = new RegExp(
  String.raw`(?<!\/)\b(?:references|scripts|dist|tests|skills|commands|codex-skills)\/[\w./-]+${EXT_SRC}`,
  "g",
);
// A `\b` word-boundary anchor cannot match immediately before a literal `.` —
// both sides are non-word characters, so there is no \w|\W transition — hence
// the `(?<![\w./])` lookbehind instead (the `/` guards a home-relative mention
// like `~/.claude/commands/foo.md` from matching, same reason BARE_PATH_RE
// above guards with `(?<!\/)`). Deliberately NOT a blanket `\.claude\/` — that
// would sweep in `.claude/worktrees/…` mentions, which are per-worktree,
// gitignored, and never meant to resolve against a static path on disk. Only
// the subdirs that hold real, checked-in, referenceable content are named.
const REPO_LOCAL_ALT = REPO_LOCAL_DIRS.map((dir) => dir.replaceAll(".", "\\.")).join("|");
const CLAUDE_DIR_PATH_RE = new RegExp(
  String.raw`(?<![\w./])(?:${REPO_LOCAL_ALT})\/[\w./-]+${EXT_SRC}`,
  "g",
);
// Markdown fences nest by backtick-run length (CommonMark): a ```` fence isn't
// closed by a shorter ``` line inside it, so track the opening run length rather
// than a plain boolean toggle.
const FENCE_OPEN_RE = /^\s*(`{3,})/;

function isPlaceholder(candidate: string): boolean {
  if (candidate.includes(".local/")) return true;
  if (/[<>*$\\]/.test(candidate)) return true;
  if (candidate.split("/").includes("N")) return true;
  if (candidate.includes("YYYY")) return true;
  return false;
}

function extractCandidates(line: string, inFence: boolean): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(PLUGIN_ROOT_RE)) found.push(m[1]);
  if (!inFence) {
    for (const m of line.matchAll(BARE_PATH_RE)) found.push(m[0]);
    for (const m of line.matchAll(CLAUDE_DIR_PATH_RE)) found.push(m[0]);
  }
  return found.filter((c) => !isPlaceholder(c));
}

test("every repo-relative path referenced in prose exists on disk", () => {
  const failures: string[] = [];

  for (const relFile of proseFiles) {
    const abs = path.join(repoRoot, relFile);
    const fileDir = path.dirname(abs);
    const lines = readFileSync(abs, "utf-8").split("\n");
    let fenceLen = 0;
    lines.forEach((line, idx) => {
      const fenceMatch = line.match(FENCE_OPEN_RE);
      if (fenceMatch) {
        const runLen = fenceMatch[1].length;
        if (fenceLen === 0) fenceLen = runLen;
        else if (runLen >= fenceLen) fenceLen = 0;
        return;
      }
      for (const candidate of extractCandidates(line, fenceLen > 0)) {
        // Most references are repo-root-relative, but some prose (e.g. a skill
        // pointing at its own scripts/ subfolder) writes paths relative to the
        // prose file's own directory instead — accept either resolution.
        const rootHit = existsSync(path.join(repoRoot, candidate));
        const dirHit = existsSync(path.join(fileDir, candidate));
        if (!rootHit && !dirHit) {
          failures.push(`${relFile}:${idx + 1} -> ${candidate}`);
        }
      }
    });
  }

  assert.deepEqual(failures, []);
});

// The marketplace installs the whole tree, but no plugin build loads `.claude/`, so a
// shipped file citing it dangles for every consumer while the check above, which
// resolves against this checkout, stays green. Deny by default: any `.claude/` fails, so a
// new repo-local dir is covered before anyone lists it. `~/`, `$HOME/` and `${HOME}/`
// paths are the user's home, not this repo, and stay allowed.
const REPO_LOCAL_CITE_RE = /(?<!(?:~|\$HOME|\$\{HOME\})\/)(?<![\w.])\.claude\//;

// Shipped mentions of a CONSUMER project's own `.claude/` dir, not this repo's. Only the
// named text is exempt, never the rest of its line, and an entry that no longer matches
// fails. Each needs a stated reason; an entry here is a conscious exemption, not a silencer.
const REPO_LOCAL_CITE_EXEMPTIONS: ReadonlyArray<{ path: string; text: string; reason: string }> = [
  {
    path: "references/sync-migration.md",
    text: "`.claude/worktrees/`",
    reason: "names where Claude Code puts worktrees in the consumer's project",
  },
];

test("no shipped file cites a repo-local .claude/ path", () => {
  const shipped = [...SHIPPED_TOP_LEVEL, ...SHIPPED_PROSE_DIRS.flatMap(listMarkdownFiles)];
  const failures: string[] = [];
  const used = new Set<(typeof REPO_LOCAL_CITE_EXEMPTIONS)[number]>();
  for (const relFile of shipped) {
    readFileSync(path.join(repoRoot, relFile), "utf-8")
      .split("\n")
      .forEach((line, idx) => {
        let rest = line;
        for (const e of REPO_LOCAL_CITE_EXEMPTIONS) {
          if (e.path !== relFile || !rest.includes(e.text)) continue;
          used.add(e);
          rest = rest.replaceAll(e.text, " ");
        }
        if (REPO_LOCAL_CITE_RE.test(rest)) failures.push(`${relFile}:${idx + 1}`);
      });
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(
    REPO_LOCAL_CITE_EXEMPTIONS.filter((e) => !used.has(e)).map((e) => `${e.path}: ${e.text}`),
    [],
    "a stale exemption matches nothing — delete it",
  );
});

// The existence check and every prose scan see a `.claude/` dir only once it is listed,
// so the lists must equal what git tracks there (untracked `worktrees/` drops out).
test("prose-dirs.ts lists every tracked .claude/ subdir", () => {
  const tracked = execFileSync("git", ["ls-files", ".claude"], { cwd: repoRoot, encoding: "utf-8" })
    .split("\n")
    .filter((f) => f.split("/").length > 2);
  const dirOf = (f: string) => f.split("/").slice(0, 2).join("/");
  const all = [...new Set(tracked.map(dirOf))].sort();
  const prose = [...new Set(tracked.filter((f) => f.endsWith(".md")).map(dirOf))].sort();
  assert.deepEqual(all, [...REPO_LOCAL_DIRS].sort());
  assert.deepEqual(prose, [...REPO_LOCAL_PROSE_DIRS].sort());
});

// ---------------------------------------------------------------------------
// HARRY.md heading citations
//
// The test above checks that a referenced *path* exists; it says nothing about
// what is cited INSIDE a file. A citation naming a section that has been deleted
// passes it, and that failure has happened here: the fix-now batch removed
// `skills/executing/SKILL.md`'s `## Never` section while
// `references/review-rubric.md` still cited "(executing §Never)".
//
// Laws are cited by heading name — `HARRY.md **Evidence**` — not by number. The
// laws used to be cited as `§N`, and a renumber escaped that check: if one
// section's content moved to the next number, the old number still resolved, to the wrong law. A name moves with its
// content, and a renamed heading fails here.
//
// Fences are NOT skipped, unlike the path scan above: there is no reason to
// write a law citation that does not resolve, even illustratively.
const LAW_HEADINGS = [
  "Priority",
  "Tiers",
  "Ask first",
  "Secrets",
  "Root cause",
  "Evidence",
  "Clarify first",
  "Code",
  "Talk",
];
// `law` labels in evals/cases.jsonl that name no HARRY.md heading on purpose: a
// rule the review standard or red-green holds, the plugin probes, and two informative cases.
const NON_LAW_LABELS = new Set(["rubric", "red-green", "plugin", "L&C", "grill"]);

test("every HARRY.md citation names a heading HARRY.md actually has", () => {
  const laws = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8");
  const headings = Array.from(laws.matchAll(/^## (.+)$/gm), (m) => (m[1] as string).trim());
  // An EXACT list, not a floor: the citation check is only as sound as this set,
  // and a heading change invalidates citations across many sites, so it should
  // cost one deliberate line here.
  assert.deepEqual(
    headings,
    LAW_HEADINGS,
    "HARRY.md's ## headings changed. Sweep the citations of any renamed or removed " +
      "heading, then update LAW_HEADINGS.",
  );
  const sections = new Set(headings);

  // The corpus needs guarding too: `listMarkdownFiles` returns [] for a directory
  // that does not exist, so renaming `skills/` would silently drop its citations
  // while this test stays green. Asserted per directory, so it says which broke.
  for (const dir of PROSE_DIRS) {
    assert.ok(
      listMarkdownFiles(dir).length > 0,
      `PROSE_DIRS names "${dir}" but it holds no markdown — renamed or moved? Until this ` +
        `is fixed, every citation in it is unchecked and both tests here pass regardless.`,
    );
  }
  for (const file of TOP_LEVEL_FILES) {
    assert.ok(
      existsSync(path.join(repoRoot, file)),
      `TOP_LEVEL_FILES names "${file}" but it is missing — renamed? Both tests here read ` +
        `that list, so its paths AND its citations go unchecked until this is fixed.`,
    );
  }

  const failures: string[] = [];
  // `evals/cases.jsonl`'s `law` field names the law a case measures, and the
  // runner validates it only as a non-empty string. Read unguarded, so a moved
  // file fails loudly instead of dropping every case from the check.
  readFileSync(path.join(repoRoot, "evals/cases.jsonl"), "utf-8")
    .split("\n")
    .forEach((line, idx) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(
          `evals/cases.jsonl:${idx + 1} is not valid JSON: ${(err as Error).message}`,
        );
      }
      const law: unknown = (parsed as { law?: unknown } | null)?.law;
      if (typeof law !== "string" || (!sections.has(law) && !NON_LAW_LABELS.has(law)))
        failures.push(`evals/cases.jsonl:${idx + 1} -> law ${String(law)}`);
    });

  for (const relFile of citeCorpus) {
    const text = readFileSync(path.join(repoRoot, relFile), "utf-8");
    // Matched on the whole text, so a citation wrapped across a line break and the
    // possessive form are checked too.
    for (const m of text.matchAll(/HARRY\.md`?(?:'s)?\s+\*\*([^*]+)\*\*/g)) {
      const name = (m[1] as string).replace(/\s+/g, " ");
      const line = lineOf(text, m.index);
      if (!sections.has(name)) failures.push(`${relFile}:${line} -> HARRY.md **${name}**`);
    }
  }

  assert.deepEqual(failures, [], "citations pointing at a heading HARRY.md does not have");
});

// ---------------------------------------------------------------------------
// Cross-file section citations
//
// The cross-file form is `path` **Name**. A name is a heading's core name — a
// leading `N. `, a trailing ` — …`, then a trailing `(…)` dropped — or the bold
// label opening a top-level numbered item, so a step renumbered or a subtitle
// reworded leaves its citations standing. A name must be unique in its file.
// Two names keep their own form: a law is `HARRY.md **Heading**`, checked above;
// an audit dimension is `dimension **Name**`, resolved below through the same
// resolver against references/audit/SCAN-DIMENSIONS.md's `##` headings only.
// The legacy forms resolve against nothing, so a rename broke them silently;
// they fail here instead, each hit naming the form to use.
const DIMENSION_FORM = "dimension **<SCAN-DIMENSIONS ## core name>**";
const CITE_RE = /`((?:[\w.-]+\/)*[\w.-]+\.md)`\s+\*\*([^*]+)\*\*/g;
const LEGACY_FORMS: [string, RegExp, string[], string?][] = [
  ["See **X** in", /See \*\*[^*]+\*\* in\b/g, ["See **Seams** in"]],
  ["a path, then a quoted name", /\.md`?(?:'s)?,?\s+\\?"[A-Z]/g, ['`references/x.md`, "Seams"']],
  ["a path, then a comma or 's", /\.md`(?:'s|,)\s+\*\*/g, ["`references/x.md`, **Seams**"]],
  ["a name, then a step", /\*\*\s+step \d/g, ["**Steps** step 4"]],
  [
    "an audit dimension by number",
    /\bdimensions? \(?\d/gi,
    ["/audit dimension 10", "dimension (2)", "dimensions 1 and 2", "Dimension 10"],
    DIMENSION_FORM,
  ],
  [
    "a path, then a category number",
    /\.md`?(?:'s)?,?\s+\(?category \d/g,
    ["`references/x.md` category 4"],
  ],
  [
    "a path, then a bare step",
    /(?:\.md`?|`)(?:'s)?,?\s+step \d/g,
    ["`skills/x/SKILL.md`, step 2", "`skills/x` step 4"],
  ],
  [
    "a skill's step with no path",
    /\b(?:brainstorming|executing|finishing)`?(?:'s)?\s+step \d/g,
    ["as executing step 4 does", "`skills/executing` step 4"],
  ],
  [
    "a law named in plain text",
    new RegExp(String.raw`HARRY\.md\`?(?:'s)?,?\s+(?:${LAW_HEADINGS.join("|")})\b`, "g"),
    ["HARRY.md Tiers"],
    "HARRY.md **Heading**",
  ],
  [
    "a skill's step in parentheses",
    /(?<!\/)\b(?:brainstorming|executing|finishing)(?!\/)[^`*]{0,60}?\(step \d\)/g,
    ["the finishing skill's review (step 2)"],
  ],
];
const coreName = (heading: string): string =>
  heading
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+—\s.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

type Name = { name: string; full: string; level?: number };

const namesIn = (text: string): Name[] => {
  const lines = text.split("\n");
  const names: Name[] = [];
  let fence = "";
  for (const line of lines) {
    const run = FENCE_OPEN_RE.exec(line)?.[1];
    if (run && (!fence || run.length >= fence.length)) {
      fence = fence ? "" : run;
      continue;
    }
    if (fence) continue;
    const h = /^(#{2,}) (.+)$/.exec(line);
    if (h) {
      const full = (h[2] as string).trim();
      names.push({ name: coreName(full), full, level: (h[1] as string).length });
      continue;
    }
    const label = /^\d+\. \*\*([^*]+)\*\*/.exec(line);
    if (label) {
      const name = (label[1] as string).replace(/[.:]$/, "").trim();
      names.push({ name, full: name });
    }
  }
  return names;
};

const namesOf = (rel: string): Name[] => namesIn(readFileSync(path.join(repoRoot, rel), "utf-8"));

const resolveCitation = (target: string, name: string, level?: number): string | null => {
  if (!existsSync(path.join(repoRoot, target))) return `${target} is missing`;
  const names = namesOf(target).filter((n) => level === undefined || n.level === level);
  const matches = names.filter((n) => n.name === name);
  if (matches.length > 1)
    return `${target} **${name}** is ambiguous: ${matches.map((n) => `"${n.full}"`).join(", ")}`;
  if (matches.length === 1) return null;
  const full = names.find((n) => n.full === name);
  if (full) return `${target} **${name}**: cite its core name **${full.name}**`;
  return level === undefined
    ? `${target} has no heading or step "${name}"`
    : `${target} has no ${"#".repeat(level)} heading "${name}"`;
};

test("every cross-file citation names a heading or step its file has, once", () => {
  const failures: string[] = [];
  let seen = 0;
  for (const relFile of citeCorpus) {
    const text = readFileSync(path.join(repoRoot, relFile), "utf-8");
    for (const m of text.matchAll(CITE_RE)) {
      seen += 1;
      const name = (m[2] as string).replace(/\s+/g, " ").trim();
      const failure = resolveCitation(m[1] as string, name);
      if (failure) failures.push(`${relFile}:${lineOf(text, m.index)} -> ${failure}`);
    }
  }
  assert.ok(seen > 0, "the citation pattern matched nothing; it is no longer checking anything");
  const fixtures: [string, string, string | null][] = [
    ["skills/executing/SKILL.md", "One fix wave", null],
    [
      "skills/executing/SKILL.md",
      "Check the fixes first",
      'skills/executing/SKILL.md has no heading or step "Check the fixes first"',
    ],
    [
      "skills/brainstorming/SKILL.md",
      "Full Flow (full depth)",
      "skills/brainstorming/SKILL.md **Full Flow (full depth)**: cite its core name **Full Flow**",
    ],
  ];
  assert.deepEqual(
    namesIn(
      "## 2. Top — sub (x)\n1. **Step one.** a\n   1. **Nested.** b\n**Paragraph.** c\n```\n1. **Fenced.** d\n```\n",
    ).map((n) => n.name),
    ["Top", "Step one"],
    "a name now comes from a nested item, a bold paragraph or a fenced line",
  );
  for (const [target, name, expected] of fixtures)
    assert.equal(
      resolveCitation(target, name),
      expected,
      `the resolver misjudges ${target} "${name}"`,
    );
  for (const [target, name] of [
    ["README.md", "Install"],
    ["CLAUDE.md", "Plugin content"],
  ] as const)
    assert.match(
      resolveCitation(target, name) ?? "",
      / is ambiguous: ".+", ".+"/,
      `the resolver no longer fails the ambiguous ${target} "${name}"`,
    );
  assert.deepEqual(failures, [], "citations pointing at a name their file lacks or repeats");
});

const legacyHits = (text: string): string[] =>
  LEGACY_FORMS.flatMap(([label, re, , form = "`path` **Name**"]) =>
    [...text.matchAll(re)].map((m) => `${lineOf(text, m.index)} -> ${label}; cite it as ${form}`),
  );

test("no cross-file citation uses a legacy form", () => {
  for (const [label, re, samples] of LEGACY_FORMS)
    for (const sample of samples)
      assert.equal([...sample.matchAll(re)].length, 1, `the "${label}" rule no longer matches`);
  assert.deepEqual(
    legacyHits("intro\nper dimension 10 and HARRY.md Tiers\nper `references/x.md`, **Seams**"),
    [
      "3 -> a path, then a comma or 's; cite it as `path` **Name**",
      "2 -> an audit dimension by number; cite it as dimension **<SCAN-DIMENSIONS ## core name>**",
      "2 -> a law named in plain text; cite it as HARRY.md **Heading**",
    ],
    "a legacy hit no longer carries its line or the form to use",
  );
  const hits = citeCorpus.flatMap((relFile) =>
    legacyHits(readFileSync(path.join(repoRoot, relFile), "utf-8")).map((h) => `${relFile}:${h}`),
  );
  assert.deepEqual(hits, [], "a legacy citation form; each hit names the form to use");
});

const DIMENSION_CITE_RE = /\bdimensions?\s+\*\*([^*]+)\*\*/gi;

const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";

const dimensionFailures = (text: string): string[] =>
  [...text.matchAll(DIMENSION_CITE_RE)].flatMap((m) => {
    const name = (m[1] as string).replace(/\s+/g, " ").trim();
    const failure = resolveCitation(SCAN_DIMENSIONS, name, 2);
    return failure ? [`${lineOf(text, m.index)} -> ${failure}`] : [];
  });

test("every audit dimension citation names a SCAN-DIMENSIONS ## heading", () => {
  assert.ok(
    namesOf(SCAN_DIMENSIONS).some(
      (n) => n.name === "Choosing dimensions and shaping agents" && n.level === 3,
    ),
    "the ### fixture below lost its heading; point it at a live ### heading",
  );
  assert.deepEqual(
    dimensionFailures(
      "a dimension **Low-value tests**,\nDimension **Low value tests**, dimension\n**Wrapped typo**,\n" +
        "dimension **Choosing dimensions and shaping agents** and\n" +
        "dimension **2. Reusability & hoist candidates (same-intent code that drifted apart)**",
    ),
    [
      '2 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Low value tests"',
      '2 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Wrapped typo"',
      '4 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Choosing dimensions and shaping agents"',
      "5 -> references/audit/SCAN-DIMENSIONS.md **2. Reusability & hoist candidates (same-intent code that drifted apart)**: cite its core name **Reusability & hoist candidates**",
    ],
    "the dimension citation check no longer matches, accepts a wrong or ### name, lost the core-name hint or the line",
  );
  let seen = 0;
  const failures = citeCorpus.flatMap((relFile) => {
    const text = readFileSync(path.join(repoRoot, relFile), "utf-8");
    seen += [...text.matchAll(DIMENSION_CITE_RE)].length;
    return dimensionFailures(text).map((f) => `${relFile}:${f}`);
  });
  assert.ok(seen > 0, "the dimension citation pattern matched nothing");
  assert.deepEqual(failures, [], `cite a dimension as ${DIMENSION_FORM}`);
});

const PATH_THEN_PLAIN_RE = /`((?:[\w.-]+\/)*[\w.-]+\.md)`(?:'s|,)?\s+(?!\*\*)/g;

const plainHeadingCitations = (text: string): { index: number; target: string; name: string }[] =>
  [...text.matchAll(PATH_THEN_PLAIN_RE)].flatMap((m) => {
    const target = m[1] as string;
    if (!existsSync(path.join(repoRoot, target))) return [];
    const rest = text.slice((m.index ?? 0) + m[0].length).toLowerCase();
    const name = namesOf(target)
      .map((n) => n.name)
      .find((n) => rest.startsWith(n.toLowerCase()) && !/^[\w-]/.test(rest.slice(n.length)));
    return name ? [{ index: m.index ?? 0, target, name }] : [];
  });

test("no cross-file citation names a heading in plain text", () => {
  assert.equal(
    plainHeadingCitations("per `references/grilling.md`'s Handoff, then").length,
    1,
    "the plain-text heading check no longer matches",
  );
  const hits = citeCorpus.flatMap((relFile) => {
    const text = readFileSync(path.join(repoRoot, relFile), "utf-8");
    return plainHeadingCitations(text).map(
      (c) => `${relFile}:${lineOf(text, c.index)} -> ${c.target} "${c.name}"`,
    );
  });
  assert.deepEqual(hits, [], "cite a heading as `path` **Heading**, not in plain text");
});

test("every reference is cited by path from a shipped file other than itself", () => {
  const shipped = [...SHIPPED_TOP_LEVEL, ...SHIPPED_PROSE_DIRS.flatMap(listMarkdownFiles)];
  const texts = new Map(
    shipped.map((rel) => [rel, readFileSync(path.join(repoRoot, rel), "utf-8")]),
  );
  const orphans = listMarkdownFiles("references")
    .map((rel) => rel.split(path.sep).join("/"))
    .filter(
      (ref) =>
        ![...texts].some(
          ([rel, text]) => rel.split(path.sep).join("/") !== ref && text.includes(ref),
        ),
    );
  assert.deepEqual(
    orphans,
    [],
    "references no shipped file cites — a reference nothing loads is deleted in effect",
  );
});

test("no tracked file but the changelog cites a law by the retired section-number form", () => {
  // Every tracked file, not a list of kinds: a list missed a file kind four times
  // (test messages, scripts, eval notes, upstream.json). CHANGELOG.md is release
  // history and quotes the numbering of its day.
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" })
    .split("\n")
    .filter((rel) => rel && rel !== "CHANGELOG.md" && existsSync(path.join(repoRoot, rel)));
  assert.ok(tracked.includes("upstream.json"), "the scan lost the tracked files");
  const hits = tracked.flatMap((rel) => {
    const text = readFileSync(path.join(repoRoot, rel), "utf-8");
    if (text.includes("\0")) return [];
    return text
      .split("\n")
      .flatMap((line, idx) => (/§ ?\d/.test(line) ? [`${rel}:${idx + 1}`] : []));
  });
  assert.deepEqual(hits, [], "a section-number law citation; cite the heading name instead");
});

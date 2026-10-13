import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
// This test extracts candidate repo-relative paths from all prose and asserts git tracks each.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const gitFiles = (...args: string[]): string[] =>
  execFileSync("git", ["ls-files", ...args], { cwd: repoRoot, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);
const deletedFiles = new Set(gitFiles("--deleted"));
const trackedFiles = gitFiles().filter((rel) => !deletedFiles.has(rel));
const trackedFileSet = new Set(trackedFiles);
const trackedDirs = new Set(
  trackedFiles.flatMap((rel) =>
    rel
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const trackedKind = (rel: string): "file" | "dir" | "missing" => {
  const norm = path.posix.normalize(rel.split(path.sep).join("/"));
  if (norm === ".") return "dir";
  if (trackedFileSet.has(norm)) return "file";
  return trackedDirs.has(norm) ? "dir" : "missing";
};
const isTracked = (abs: string): boolean => trackedKind(path.relative(repoRoot, abs)) !== "missing";
const resolves = (candidate: string, fileDir: string): boolean =>
  isTracked(path.join(repoRoot, candidate)) || isTracked(path.join(fileDir, candidate));

const TOP_LEVEL_FILES = [...SHIPPED_TOP_LEVEL, ...REPO_TOP_LEVEL];
const PROSE_DIRS = [...INSTRUCTION_DIRS, "evals"];

function listMarkdownFiles(dir: string): string[] {
  return trackedFiles.filter((rel) => rel.startsWith(`${dir}/`) && rel.endsWith(".md"));
}

const proseFiles = [
  ...TOP_LEVEL_FILES.filter((f) => isTracked(path.join(repoRoot, f))),
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

test("every repo-relative path referenced in prose is tracked", () => {
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
        if (!resolves(candidate, fileDir)) {
          failures.push(`${relFile}:${idx + 1} -> ${candidate}`);
        }
      }
    });
  }

  assert.deepEqual(failures, []);
});

test("every path check answers from git-tracked files", () => {
  assert.equal(trackedKind(".git"), "missing");
  assert.equal(trackedKind("./references/grilling.md"), "file");
  assert.equal(trackedKind("references"), "dir");
  assert.equal(trackedKind("."), "dir");
  assert.equal(resolves(".git", repoRoot), false);
  assert.deepEqual(
    readFileSync(fileURLToPath(import.meta.url), "utf-8")
      .split("\n")
      .filter((line) => /\bfrom "(?:node:)?fs(?:\/promises)?";$/.test(line)),
    ['import { readFileSync } from "node:fs";'],
    "a path check reads the disk again; route it through trackedKind",
  );
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
  const tracked = trackedFiles.filter((f) => f.startsWith(".claude/") && f.split("/").length > 2);
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
      isTracked(path.join(repoRoot, file)),
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
    // Matched on the whole text, so a citation wrapped across a line break is checked too.
    for (const m of text.matchAll(LAW_CITE_RE)) {
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
// The cross-file form is `path` **Name**. A name is the core name of a heading or
// of the bold label opening a top-level numbered item — a leading `N. `, a
// trailing ` — …`, then a trailing `(…)` dropped — so a step renumbered or a
// subtitle reworded leaves its citations standing. A name must be unique in its file.
// Two names keep their own form: a law is `HARRY.md **Heading**`, checked above;
// an audit dimension is `dimension **Name**`, resolved below through the same
// resolver against references/audit/SCAN-DIMENSIONS.md's `##` headings only.
// The legacy forms resolve against nothing, so a rename broke them silently;
// they fail here instead, each hit naming the form to use.
const DIMENSION_FORM = "dimension **<SCAN-DIMENSIONS ## core name>**";
const CITE_RE = /`((?:[\w.-]+\/)*[\w.-]+\.md)`\s+\*\*([^*]+)\*\*/dg;
const LAW_CITE_RE = /HARRY\.md`?\s+\*\*([^*]+)\*\*/dg;
const LEGACY_FORMS: [string, RegExp, string[], string?][] = [
  [
    "an audit dimension by number",
    /\bdimensions? \(?\d/gi,
    ["/audit dimension 10", "dimension (2)", "dimensions 1 and 2", "Dimension 10"],
    DIMENSION_FORM,
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
      const full = (label[1] as string).replace(/[.:]$/, "").trim();
      names.push({ name: coreName(full), full });
    }
  }
  return names;
};

const namesOf = (rel: string): Name[] => namesIn(readFileSync(path.join(repoRoot, rel), "utf-8"));

const resolveCitation = (target: string, name: string, level?: number): string | null => {
  if (trackedKind(target) !== "file") return `${target} is missing`;
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
    [".git", "x", ".git is missing"],
    [".local/INDEX.md", "In flight", ".local/INDEX.md is missing"],
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
    ["references/architecture-review.md", "System level", null],
    [
      "references/architecture-review.md",
      "System level (across services)",
      "references/architecture-review.md **System level (across services)**: cite its core name **System level**",
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
    legacyHits("intro\nper dimension 10 and HARRY.md Tiers"),
    [
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

const DIMENSION_CITE_RE = /\bdimensions?\s+\*\*([^*]+)\*\*/dgi;

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

const CONNECTOR_SRC = String.raw`(?:'s|’s)?\s*[,:—]?\s*\(?\s*`;
const PATH_THEN_PLAIN_RE = new RegExp(
  String.raw`\`((?:[\w.-]+\/)*[\w.-]+?)\/?\`${CONNECTOR_SRC}`,
  "g",
);

const citeTarget = (cited: string): string | null => {
  const target = cited.endsWith(".md") ? cited : `${cited}/SKILL.md`;
  return trackedKind(target) === "file" ? target : null;
};

const plainNameCitations = (text: string): { index: number; target: string; name: string }[] =>
  [...text.matchAll(PATH_THEN_PLAIN_RE)].flatMap((m) => {
    const target = citeTarget(m[1] as string);
    if (!target) return [];
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const name = namesOf(target)
      .map((n) => n.name)
      .find((n) => rest.startsWith(n) && !/^[\w-]/.test(rest.slice(n.length)));
    return name ? [{ index: m.index ?? 0, target, name }] : [];
  });

test("no cross-file citation names a heading or step in plain text", () => {
  const fixtures: [string, string[]][] = [
    ["per `references/grilling.md`'s Handoff, then", ["Handoff"]],
    ["per `references/grilling.md`’s Handoff, then", ["Handoff"]],
    ["per `references/grilling.md`: Handoff", ["Handoff"]],
    ["per `references/grilling.md` (Handoff)", ["Handoff"]],
    ["at `skills/executing/SKILL.md` Review, the", ["Review"]],
    ["at `skills/executing` Review, the", ["Review"]],
    ["at `skills/executing/` Review, the", ["Review"]],
    ["per `references/grilling.md` — Handoff", ["Handoff"]],
    ["see `skills/executing/SKILL.md` review step", []],
    ["`references/grilling.md` covers it", []],
    ["`references/grilling.md` Handoffs list", []],
  ];
  for (const [sample, names] of fixtures)
    assert.deepEqual(
      plainNameCitations(sample).map((c) => c.name),
      names,
      `the plain-text name check misjudges: ${sample}`,
    );
  const hits = citeCorpus.flatMap((relFile) => {
    const text = readFileSync(path.join(repoRoot, relFile), "utf-8");
    return plainNameCitations(text).map(
      (c) => `${relFile}:${lineOf(text, c.index)} -> ${c.target} "${c.name}"`,
    );
  });
  assert.deepEqual(hits, [], "cite a heading or step as `path` **Name**, not in plain text");
});

const PATH_TOKEN_RE = /`((?:[\w.-]+\/)*[\w.-]+?)\/?`|(?<![\w`/.-])(HARRY\.md)(?![\w`])/g;
const SENTENCE_END_RE = /\.(?:\s|$)|\n\s*\n/g;
const CONNECTOR_RE = new RegExp(`^${CONNECTOR_SRC}`);
const STEP_NUMBER_RE = new RegExp(String.raw`^${CONNECTOR_SRC}(?:steps?|category) \d`);
const PAREN_STEP_RE = /\(steps? \d/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const QUOTED_OR_BOLD_RE = /\*\*([^*]+)\*\*|"([^"\n]+)"/g;
const LAW_NAMED_BEFORE_RE = new RegExp(String.raw`\bHARRY\.md\`?${CONNECTOR_SRC}$`);
const DIRECTORY_FORM = "`dir/SKILL.md` **Name**";
const STEP_HINT = "cite the step by its label, as `path` **Name**";

const exactCitations = (text: string): Set<number> =>
  new Set(
    [CITE_RE, LAW_CITE_RE, DIMENSION_CITE_RE].flatMap((re) =>
      [...text.matchAll(re)].map((m) => (m.indices?.[m.length - 1]?.[0] ?? 0) - 2),
    ),
  );

type PathMention = {
  cited: string;
  target: string | null;
  advice: string;
  start: number;
  end: number;
  from: number;
  after: string;
};

const pathMentions = (text: string): PathMention[] => {
  const ends = [...text.matchAll(SENTENCE_END_RE)].map((e) => e.index ?? 0);
  return [...text.matchAll(PATH_TOKEN_RE)].flatMap((m) => {
    const cited = (m[1] ?? m[2]) as string;
    const isFile = cited.endsWith(".md");
    if (!isFile && !cited.includes("/")) return [];
    const target = citeTarget(cited);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const kind = trackedKind(cited);
    const advice =
      kind === "missing"
        ? `${cited} does not exist`
        : kind === "dir"
          ? `cite it as ${target ? DIRECTORY_FORM : "`dir/FILE.md` **Name**"}`
          : isFile
            ? `cite it as ${cited === "HARRY.md" ? "HARRY.md **Heading**" : "`path` **Name**"}`
            : `${cited} is not markdown, so it has no section to cite`;
    const from = ends.reduce((last, e) => (e < start ? e + 1 : last), 0);
    const after = text.slice(end, ends.find((e) => e >= end) ?? text.length);
    return [{ cited, target, advice, start, end, from, after }];
  });
};

type Span = { at: number; end: number; name: string; bold: boolean };

const spansOf = (text: string, re: RegExp): Span[] =>
  [...text.matchAll(re)].map((m) => ({
    at: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    name: (m[1] ?? m[2]) as string,
    bold: m[1] !== undefined,
  }));

const boldSpans = (text: string): Span[] => spansOf(text, BOLD_RE);

const hitList = (text: string) => {
  const hits = new Map<number, string>();
  return {
    hit: (index: number, message: string) => {
      if (!hits.has(index)) hits.set(index, `${lineOf(text, index)} -> ${message}`);
    },
    list: () => [...hits.entries()].sort(([a], [b]) => a - b).map(([, message]) => message),
  };
};

const citationAttempts = (text: string): string[] => {
  const exactAt = exactCitations(text);
  const { hit, list } = hitList(text);
  const spans = spansOf(text, QUOTED_OR_BOLD_RE);
  for (const { cited, target, advice, start, end, from, after } of pathMentions(text)) {
    const exact = exactAt.has(end + (/^\s*/.exec(after)?.[0].length ?? 0));
    const lead = end + (CONNECTOR_RE.exec(after)?.[0].length ?? 0);
    const opener = spans.find(
      (s) =>
        (s.bold && s.at === lead && /^\S/.test(s.name)) ||
        (!s.bold && s.at === lead + (text[lead] === "\\" ? 1 : 0) && /^\w/.test(s.name)),
    );
    const adjacent = !exact && opener !== undefined;
    if (adjacent) hit(end, `a name next to ${cited}; ${advice}`);
    if (!target) continue;
    const names = new Set(namesOf(target).flatMap((n) => [n.name, n.full]));
    const afterEnd = end + after.length;
    for (const s of spans) {
      if (!((s.at >= from && s.end <= start) || (s.at >= end && s.end <= afterEnd))) continue;
      if (adjacent && s === opener) continue;
      if (s.bold && exactAt.has(s.at)) continue;
      const name = s.name.replace(/\s+/g, " ").trim();
      if (names.has(name)) hit(s.at, `${cited} "${name}" outside the citation form; ${advice}`);
    }
  }
  return list();
};

const stepAttempts = (text: string): string[] => {
  const { hit, list } = hitList(text);
  for (const { cited, end, after } of pathMentions(text)) {
    if (STEP_NUMBER_RE.test(after))
      hit(end, `a step or category number after ${cited}; ${STEP_HINT}`);
    const paren = PAREN_STEP_RE.exec(after);
    if (paren) hit(end + paren.index, `a step number in the sentence after ${cited}; ${STEP_HINT}`);
  }
  for (const { at, end } of boldSpans(text))
    if (STEP_NUMBER_RE.test(text.slice(end, end + 40)))
      hit(at, `a step or category number after a name; ${STEP_HINT}`);
  return list();
};

const lawAttempts = (text: string, isHarry = false): string[] => {
  if (isHarry) return [];
  const exactAt = exactCitations(text);
  const { hit, list } = hitList(text);
  for (const { at, name } of boldSpans(text)) {
    if (
      LAW_HEADINGS.includes(name.trim()) &&
      !exactAt.has(at) &&
      !LAW_NAMED_BEFORE_RE.test(text.slice(Math.max(0, at - 20), at))
    )
      hit(
        at,
        `**${name}** names a law with no HARRY.md before it; cite it as HARRY.md **Heading**`,
      );
  }
  return list();
};

const scanCorpus = (scan: (text: string, isHarry: boolean) => string[]): string[] =>
  citeCorpus.flatMap((relFile) =>
    scan(readFileSync(path.join(repoRoot, relFile), "utf-8"), relFile === "HARRY.md").map(
      (h) => `${relFile}:${h}`,
    ),
  );

const checkFixtures = (
  scan: (text: string) => string[],
  mustFail: string[],
  mustPass: string[],
) => {
  for (const sample of mustFail) assert.ok(scan(sample).length > 0, `no longer fails: ${sample}`);
  for (const sample of mustPass)
    for (const check of [citationAttempts, stepAttempts, lawAttempts])
      assert.deepEqual(check(sample), [], `now fails ${check.name}: ${sample}`);
};

test("every citation attempt next to a path is in the one form", () => {
  checkFixtures(
    citationAttempts,
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
    ],
  );
  assert.deepEqual(
    citationAttempts(
      "intro\nat `skills/executing` **Steps** and HARRY.md's **Tiers**\nat `references/audit` **Recon**, or `skills/x` **Steps**",
    ),
    [
      "2 -> a name next to skills/executing; cite it as `dir/SKILL.md` **Name**",
      "2 -> a name next to HARRY.md; cite it as HARRY.md **Heading**",
      "3 -> a name next to references/audit; cite it as `dir/FILE.md` **Name**",
      "3 -> a name next to skills/x; skills/x does not exist",
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
    ].flatMap((sample) => citationAttempts(sample)),
    [
      "1 -> a name next to references/grilling.md; cite it as `path` **Name**",
      "1 -> a name next to HARRY.md; cite it as HARRY.md **Heading**",
      "1 -> a name next to skills/executing; cite it as `dir/SKILL.md` **Name**",
      "1 -> a name next to references/audit; cite it as `dir/FILE.md` **Name**",
      "1 -> a name next to scripts/install.mjs; scripts/install.mjs is not markdown, so it has no section to cite",
      "1 -> a name next to references/x.md; references/x.md does not exist",
      "1 -> a name next to .local/INDEX.md; .local/INDEX.md does not exist",
      "1 -> a name next to tests/../.git; tests/../.git does not exist",
      "1 -> a name next to ./references/grilling.md; cite it as `path` **Name**",
    ],
    "a hint no longer follows the kind of path it names",
  );
  assert.deepEqual(
    scanCorpus(citationAttempts),
    [],
    "a citation attempt outside the one form; each hit names the form to use",
  );
});

test("no prose cites a step or category by its number", () => {
  checkFixtures(
    stepAttempts,
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
  assert.deepEqual(scanCorpus(stepAttempts), [], "a step cited by number; cite it by its label");
});

test("every bold law name outside HARRY.md has HARRY.md before it", () => {
  checkFixtures(
    lawAttempts,
    ["the **Tiers** law holds", "run `x` **Tiers** now", 'say "the **Tiers** law holds" here'],
    [
      "per HARRY.md **Tiers** and `references/grilling.md` **Handoff**",
      "per `references/pr-body.md` **Evidence** here",
      "the copy at ~/.claude/harry/HARRY.md, **Code** included",
    ],
  );
  assert.deepEqual(
    lawAttempts("the **Tiers** law holds", true),
    [],
    "HARRY.md now fails its own bold law names",
  );
  assert.deepEqual(scanCorpus(lawAttempts), [], "a bold law name with no HARRY.md before it");
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
  const tracked = trackedFiles.filter((rel) => rel !== "CHANGELOG.md");
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Block,
  CONNECTORS,
  CORE_NAME_STRIPS,
  citationAttempts,
  citeFailures,
  dimensionFailures,
  FORM,
  LAW_HEADINGS,
  lawAttempts,
  lawFailures,
  lawLabelFailures,
  legacyHits,
  type Name,
  namesIn,
  plainNameCitations,
  type Repo,
  readProse,
  resolveCitation,
  stepAttempts,
  strayBold,
} from "./citations.ts";
import {
  CODE_EXEMPTIONS,
  filesUnder,
  MANIFEST_DIRS,
  PROSE_DIRS,
  PROSE_NON_MD_FILES,
  READER_CORPUS,
  REPO_LOCAL_DATA_FILES,
  REPO_LOCAL_DIRS,
  REPO_LOCAL_PROSE_DIRS,
  SHIPPED_DATA_FILES,
  SHIPPED_MARKDOWN,
  SHIPPED_PROSE_DIRS,
  SHIPPED_TOP_LEVEL,
  TOP_LEVEL,
  TRACKED_FILES,
  under,
} from "./prose-dirs.ts";
import { headingSection, outline } from "./section.ts";

// The plugin's real product is ~3,000 lines of markdown that an AI agent follows,
// full of file-path references (references/tier-gates.md, ${CLAUDE_PLUGIN_ROOT}/...,
// scripts/init.mjs). Nothing else verifies those paths are tracked — renames/deletes leave
// dangling references (this exact failure class was found twice in recent reviews).
// This test extracts candidate repo-relative paths from all prose and asserts git tracks each.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const trackedFileSet = new Set(TRACKED_FILES);
const trackedDirs = new Set(
  TRACKED_FILES.flatMap((rel) =>
    rel
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const trackedKind = (rel: string): "file" | "dir" | "untracked" => {
  const norm = path.posix.normalize(rel.split(path.sep).join("/"));
  if (norm === ".") return "dir";
  if (trackedFileSet.has(norm)) return "file";
  return trackedDirs.has(norm) ? "dir" : "untracked";
};
const namesOf = (rel: string): Name[] => namesIn(readFileSync(path.join(repoRoot, rel), "utf-8"));
const repo: Repo = { kind: trackedKind, names: namesOf };
const isTracked = (abs: string): boolean =>
  trackedKind(path.relative(repoRoot, abs)) !== "untracked";
const resolves = (candidate: string, fileDir: string): boolean =>
  isTracked(path.join(repoRoot, candidate)) || isTracked(path.join(fileDir, candidate));

// evals stays out of prose-dirs.ts: REPO_LOCAL_PROSE_DIRS holds only .claude/ subdirs,
// and plain-language's corpus reads every file, where evals/cases.jsonl would trip it.
const evalsMarkdown = (): string[] =>
  filesUnder(
    "evals",
    TRACKED_FILES.filter((rel) => rel.endsWith(".md")),
  );

const proseFiles = (): string[] => [...READER_CORPUS, ...evalsMarkdown()];
const citeCorpus = proseFiles;
const prose = (rel: string): Block[] =>
  readProse(rel, readFileSync(path.join(repoRoot, rel), "utf-8"));

// Three reference shapes:
// 1. `${CLAUDE_PLUGIN_ROOT}/<path>` — path is everything after the prefix. Checked
//    everywhere (fenced or not) — this is how the plugin's own docs express real
//    runtime invocations (e.g. commands/sync.md's `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"`).
// 2. Bare repo-relative mentions of known top-level dirs, with a recognized file
//    extension. Read through readProse, by the reader rule in
//    `.claude/references/skill-authoring.md` **Citations**: a tagged fence is code or
//    data, often fabricated illustration (a skill's `tests/auth/token.test.ts` example,
//    say), not a real cross-reference. A `(?<!\/)` guard also stops a longer real path
//    like `src/commands/fix.ts` from being mis-sliced into the shorter bare candidate
//    `commands/fix.ts`.
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
function isPlaceholder(candidate: string): boolean {
  if (candidate.includes(".local/")) return true;
  if (/[<>*$\\]/.test(candidate)) return true;
  if (candidate.split("/").includes("N")) return true;
  if (candidate.includes("YYYY")) return true;
  return false;
}

const pathCandidates = (rel: string, text: string): [number, string][] =>
  [
    ...outline(text).flatMap((line, idx) =>
      [...line.text.matchAll(PLUGIN_ROOT_RE)].map((m): [number, string] => [idx + 1, m[1] ?? ""]),
    ),
    ...readProse(rel, text).flatMap((block) =>
      [BARE_PATH_RE, CLAUDE_DIR_PATH_RE].flatMap((re) =>
        [...block.text.matchAll(re)].map((m): [number, string] => [
          block.lineAt(m.index ?? 0),
          m[0],
        ]),
      ),
    ),
  ]
    .filter(([, c]) => !isPlaceholder(c))
    .sort(([a], [b]) => a - b);

test("every repo-relative path referenced in prose is tracked", () => {
  assert.deepEqual(
    pathCandidates(
      "x.md",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal variable name, as the skills write it.
      "see skills/a.md\n  ````\nskills/b.md\n```\n${CLAUDE_PLUGIN_ROOT}/c.md\n  ````\nskills/d.md\n\n```sh\nnode skills/e.md ${CLAUDE_PLUGIN_ROOT}/f.md\n```\n\nsee `skills/g.md`\n",
    ),
    [
      [1, "skills/a.md"],
      [3, "skills/b.md"],
      [5, "c.md"],
      [7, "skills/d.md"],
      [10, "f.md"],
      [13, "skills/g.md"],
    ],
    "a path inside a tagged fence is now checked, or one outside it is skipped",
  );
  const indented = "x:\n\n    skills/a.md\n";
  assert.deepEqual(
    [pathCandidates("NOTICE", indented), pathCandidates("x.md", indented)],
    [[[3, "skills/a.md"]], []],
    "pathCandidates reads a file by its name through readProse",
  );
  assert.deepEqual(
    pathCandidates("x.md", "[ u@h.co see skills/a.md"),
    [[1, "skills/a.md"]],
    "a paragraph led by [ and an autolink is not read whole",
  );
  const failures: string[] = [];

  for (const relFile of proseFiles()) {
    const abs = path.join(repoRoot, relFile);
    const fileDir = path.dirname(abs);
    for (const [line, candidate] of pathCandidates(relFile, readFileSync(abs, "utf-8")))
      if (!resolves(candidate, fileDir)) failures.push(`${relFile}:${line} -> ${candidate}`);
  }

  assert.deepEqual(failures, []);
});

test("every path check answers from git-tracked files", () => {
  assert.equal(trackedKind(".git"), "untracked");
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
  const shipped = [...SHIPPED_MARKDOWN, ...SHIPPED_DATA_FILES];
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

// The tracked-path check and every prose scan see a `.claude/` dir only once it is listed,
// so the lists must equal what git tracks there (untracked `worktrees/` drops out).
test("prose-dirs.ts lists every tracked .claude/ subdir", () => {
  const tracked = TRACKED_FILES.filter((f) => f.startsWith(".claude/") && f.split("/").length > 2);
  const dirOf = (f: string) => f.split("/").slice(0, 2).join("/");
  const all = [...new Set(tracked.map(dirOf))].sort();
  const prose = [...new Set(tracked.filter((f) => f.endsWith(".md")).map(dirOf))].sort();
  assert.deepEqual(all, [...REPO_LOCAL_DIRS].sort());
  assert.deepEqual(prose, [...REPO_LOCAL_PROSE_DIRS].sort());
});

const DATA_FILE_DIRS = [...SHIPPED_PROSE_DIRS, ...MANIFEST_DIRS, ...REPO_LOCAL_PROSE_DIRS];
const nonMarkdown = (dirs: string[]): string[] =>
  TRACKED_FILES.filter(
    (f) => under(dirs)(f) && !f.endsWith(".md") && !CODE_EXEMPTIONS.includes(f),
  ).sort();

test("every code exemption is a tracked file under a dir the data-file check reads", () => {
  assert.deepEqual(
    CODE_EXEMPTIONS.filter((f) => !trackedFileSet.has(f) || !under(DATA_FILE_DIRS)(f)),
    [],
    "a code exemption the data-file check never reaches exempts nothing — delete it",
  );
});

test("prose-dirs.ts names every tracked non-markdown file in the shipped prose and manifest dirs", () => {
  assert.deepEqual(
    nonMarkdown([...SHIPPED_PROSE_DIRS, ...MANIFEST_DIRS]),
    [...SHIPPED_DATA_FILES].sort(),
  );
});

test("prose-dirs.ts names every tracked non-markdown file in the repo-local prose dirs", () => {
  assert.deepEqual(
    nonMarkdown(REPO_LOCAL_PROSE_DIRS),
    REPO_LOCAL_DATA_FILES.filter(under(REPO_LOCAL_PROSE_DIRS)).sort(),
  );
});

test("only prose-refs reads the side lists of data files", () => {
  const readers = TRACKED_FILES.filter(
    (f) =>
      f.startsWith("tests/") &&
      !["tests/prose-dirs.ts", "tests/prose-refs.test.ts"].includes(f) &&
      /\b(?:SHIPPED_DATA_FILES|REPO_LOCAL_DATA_FILES)\b/.test(
        readFileSync(path.join(repoRoot, f), "utf-8"),
      ),
  );
  assert.deepEqual(
    readers,
    [],
    "a scan takes READER_CORPUS or PROSE_NON_MD_FILES, not a side list",
  );
});

// ---------------------------------------------------------------------------
// HARRY.md heading citations
//
// The test above checks that a referenced *path* is tracked; it says nothing about
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
// As in every citation check, `tests/citations.ts` reads an untagged fence whole, every
// line of it except a fence nested inside it, and a file that is not markdown as an
// untagged fence body is; it skips a tagged fence, an indented code block or an HTML
// block outside a fence, and a code span holding more than a path.

test("every HARRY.md citation names a heading HARRY.md actually has", () => {
  const laws = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8");
  const headings = outline(laws)
    .filter((l) => l.level === 2)
    .map((l) => l.title);
  // An EXACT list, not a floor: the citation check is only as sound as this set,
  // and a heading change invalidates citations across many sites, so it should
  // cost one deliberate line here.
  assert.deepEqual(
    headings,
    LAW_HEADINGS,
    "HARRY.md's ## headings changed. Sweep the citations of any renamed or removed " +
      "heading, then update LAW_HEADINGS.",
  );

  // The corpus needs guarding too: renaming `skills/` would silently drop its citations
  // while this test stays green. filesUnder throws per directory, so it says which broke.
  for (const dir of PROSE_DIRS) filesUnder(dir);
  for (const file of TOP_LEVEL) {
    assert.ok(
      isTracked(path.join(repoRoot, file)),
      `TOP_LEVEL names "${file}" but it is not tracked — renamed? Both tests here read ` +
        `that list, so its paths AND its citations go unchecked until this is fixed.`,
    );
  }

  // `evals/cases.jsonl`'s `law` field names the law a case measures, and the
  // runner validates it only as a non-empty string. Read unguarded, so a moved
  // file fails loudly instead of dropping every case from the check.
  const labels = lawLabelFailures(readFileSync(path.join(repoRoot, "evals/cases.jsonl"), "utf-8"));
  assert.ok(labels.seen > 0, "evals/cases.jsonl holds no case; the label check reads nothing");
  const failures = labels.failures.map((f) => `evals/cases.jsonl:${f}`);

  let seen = 0;
  for (const relFile of citeCorpus()) {
    const checked = lawFailures(prose(relFile));
    seen += checked.seen;
    failures.push(...checked.failures.map((f) => `${relFile}:${f}`));
  }
  assert.ok(
    seen > 0,
    "the law citation pattern matched nothing; it is no longer checking anything",
  );

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

test("every cross-file citation names a heading or step its file has, once", () => {
  let seen = 0;
  const failures = citeCorpus().flatMap((relFile) => {
    const checked = citeFailures(repo, prose(relFile));
    seen += checked.seen;
    return checked.failures.map((f) => `${relFile}:${f}`);
  });
  assert.ok(seen > 0, "the citation pattern matched nothing; it is no longer checking anything");
  for (const target of [".git", ".local/INDEX.md"])
    assert.equal(
      resolveCitation(repo, target, "x"),
      `${target} is not tracked`,
      `the resolver reads the untracked ${target}`,
    );
  assert.deepEqual(failures, [], "citations pointing at a name their file lacks or repeats");
});

test("no cross-file citation uses a legacy form", () => {
  const hits = citeCorpus().flatMap((relFile) =>
    legacyHits(prose(relFile)).map((h) => `${relFile}:${h}`),
  );
  assert.deepEqual(hits, [], "a legacy citation form; each hit names the form to use");
});

test("every audit dimension citation names a SCAN-DIMENSIONS ## heading", () => {
  let seen = 0;
  const failures = citeCorpus().flatMap((relFile) => {
    const checked = dimensionFailures(repo, prose(relFile));
    seen += checked.seen;
    return checked.failures.map((f) => `${relFile}:${f}`);
  });
  assert.ok(seen > 0, "the dimension citation pattern matched nothing");
  assert.deepEqual(failures, [], `cite a dimension as ${FORM.dimension}`);
});

const scanCorpus = (scan: (blocks: Block[]) => string[]): string[] =>
  citeCorpus().flatMap((relFile) => scan(prose(relFile)).map((h) => `${relFile}:${h}`));

test("no cross-file citation names a heading or step in plain text", () => {
  assert.deepEqual(
    scanCorpus((blocks) => plainNameCitations(repo, blocks)),
    [],
    `cite a heading or step as ${FORM.path}, not in plain text`,
  );
});

test("every citation attempt next to a path is in the one form", () => {
  assert.deepEqual(
    scanCorpus((blocks) => citationAttempts(repo, blocks)),
    [],
    "a citation attempt outside the one form; each hit names the form to use",
  );
});

test("no prose cites a step or category by its number", () => {
  assert.deepEqual(
    scanCorpus((blocks) => stepAttempts(repo, blocks)),
    [],
    "a step cited by number; cite it by its label",
  );
});

test("the Citations section names every connector and core-name strip the check reads", () => {
  const rel = ".claude/references/skill-authoring.md";
  const prose = headingSection(
    readFileSync(path.join(repoRoot, rel), "utf-8"),
    rel,
    "## Citations",
  ).replace(/\s+/g, " ");
  const named = (name: string): boolean =>
    new RegExp(
      String.raw`(?<![\p{L}\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}\p{N}])`,
      "u",
    ).test(prose);
  const missing = [...Object.values(CONNECTORS).flat(), ...CORE_NAME_STRIPS]
    .map((entry) => entry.name)
    .filter((name) => !named(name));
  assert.deepEqual(missing, [], `${rel} Citations must name every entry the check reads`);
});

test("no prose leaves a ** unpaired", () => {
  assert.deepEqual(scanCorpus(strayBold), [], "a ** that renders as asterisks");
});

test("every bold law name has HARRY.md before it", () => {
  assert.deepEqual(scanCorpus(lawAttempts), [], "a bold law name with no HARRY.md before it");
});

test("every reference is cited by path from a shipped file other than itself", () => {
  const shipped = SHIPPED_MARKDOWN;
  const texts = new Map(
    shipped.map((rel) => [rel, readFileSync(path.join(repoRoot, rel), "utf-8")]),
  );
  const orphans = filesUnder("references")
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
  const tracked = TRACKED_FILES.filter((rel) => rel !== "CHANGELOG.md");
  assert.ok(
    [...SHIPPED_TOP_LEVEL, ...PROSE_NON_MD_FILES].every((rel) => tracked.includes(rel)),
    "the scan lost the tracked files",
  );
  const hits = tracked.flatMap((rel) => {
    const text = readFileSync(path.join(repoRoot, rel), "utf-8");
    if (text.includes("\0")) return [];
    return text
      .split("\n")
      .flatMap((line, idx) => (/§ ?\d/.test(line) ? [`${rel}:${idx + 1}`] : []));
  });
  assert.deepEqual(hits, [], "a section-number law citation; cite the heading name instead");
});

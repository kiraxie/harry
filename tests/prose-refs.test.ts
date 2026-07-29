import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The plugin's real product is ~3,000 lines of markdown that an AI agent follows,
// full of file-path references (references/tier-gates.md, ${CLAUDE_PLUGIN_ROOT}/...,
// scripts/init.mjs). Nothing else verifies those paths exist — renames/deletes leave
// dangling references (this exact failure class was found twice in recent reviews).
// This test extracts candidate repo-relative paths from all prose and asserts each exists.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const TOP_LEVEL_FILES = ["HARRY.md", "README.md", "CLAUDE.md"];
const PROSE_DIRS = ["skills", "commands", "codex-skills", "references", "agents", "evals"];

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

// Two reference shapes:
// 1. `${CLAUDE_PLUGIN_ROOT}/<path>` — path is everything after the prefix. Checked
//    everywhere (fenced or not) — this is how the plugin's own docs express real
//    runtime invocations (e.g. commands/sync.md's `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs"`).
// 2. Bare repo-relative mentions of known top-level dirs, with a recognized file
//    extension. Checked only OUTSIDE fenced code blocks — inside fences these are
//    frequently fabricated illustration (e.g. writing-plans/SKILL.md's fictional
//    `tests/auth/token.test.ts` example, or a skill-relative `scripts/start-server.sh`
//    shown as a shell snippet), not real cross-references. A `(?<!\/)` guard also
//    stops a longer real path like `src/commands/fix.ts` from being mis-sliced into
//    the shorter bare candidate `commands/fix.ts`.
const PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g;
const BARE_PATH_RE =
  /(?<!\/)\b(?:references|scripts|dist|tests|skills|commands|codex-skills)\/[\w./-]+\.(?:md|json|cjs|mjs|ts|sh)\b/g;
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

// ---------------------------------------------------------------------------
// §-section citations
//
// The test above checks that a referenced *path* exists; it says nothing about
// what is cited INSIDE a file. A citation naming a section that has been deleted
// passes it, and that failure has happened here: the fix-now batch removed
// `skills/executing/SKILL.md`'s `## Never` section while
// `references/review-rubric.md` still cited "(executing §Never)". A reviewer
// caught it, twice — the re-pointed citation was then aimed at the wrong tier.
//
// SCOPE, measured before building rather than assumed. The item behind this test
// contemplated four citation grammars; three have ZERO instances — bare
// `§<Heading>`, `(<file> — the <name> step)`, and prose-worded "session mode step
// N". Building a parser for grammars with no instances is the guard version of
// speculative abstraction, so this covers the one that exists.
//
// THE INVARIANT THIS RESTS ON — `§N` MEANS HARRY.md, ALWAYS. That was not true
// when this test was first written, and review caught it: `review-rubric.md` said
// "(executing §3)", meaning `skills/executing/SKILL.md`'s step 3, and this test
// waved it through because HARRY.md happens to define a §3. Worse, that file has
// three independent numbering scopes, so the citation resolved three ways — the
// same wrong-step defect a reviewer had already caught once. Two others read the
// same way (`sync-migration.md`'s legacy spec template, `finishing`'s own step 1).
// All three were rewritten to name their target rather than borrow the § form, so
// the invariant is now enforced by the prose rather than assumed by the test. If
// a cross-document `§N` is ever reintroduced, this test will silently bless it —
// that is the cost of the invariant, and the reason it is stated this loudly.
//
// KNOWN CEILINGS, both real:
//  - A RENUMBER escapes. If §5's content became §6 and citations were left alone,
//    `§5` still resolves to a heading, just to the wrong law. Closing it needs
//    citations to name titles instead of numbers — a bigger change to how the
//    laws are written than it is worth.
//  - Fences are NOT skipped, unlike the path scan above, which explains at length
//    why it does skip them. That asymmetry is deliberate: a fabricated *path* in
//    an example is normal, but there is no reason to write a §N that does not
//    resolve, even illustratively. Do not "fix" it to match its sibling.
test("every §N citation names a section HARRY.md actually has", () => {
  const laws = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8");
  const sections = new Set(Array.from(laws.matchAll(/^## §(\d+)\b/gm), (m) => m[1]));
  // An EXACT set, not a floor. A floor answers "did the parse break", but the
  // citation check is only as sound as this set, so a phantom section is just as
  // damaging as a missing one: an illustrative `## §9` inside a fenced block
  // would otherwise become real and legitimize bogus citations. Exact also makes
  // a genuine section change cost one deliberate line here — correct, since it
  // invalidates citations across ~100 sites and someone should look.
  assert.deepEqual(
    [...sections].sort(),
    ["0", "1", "2", "3", "4", "5", "6", "7"],
    `HARRY.md's "## §N" headings are no longer exactly §0-§7. Either the heading format ` +
      `changed (fix the regex above — a parse matching nothing would make this test ` +
      `vacuous), a section was added or removed (sweep its citations, then update this ` +
      `list — it is sorted as STRINGS, so a §10 belongs between "1" and "2"), or a fenced ` +
      `example is being parsed as a real heading.`,
  );

  // The corpus needs guarding too, and this is the likelier vacuity vector of the
  // two: `listMarkdownFiles` returns [] for a directory that does not exist, so
  // renaming `skills/` — an ordinary refactor — silently drops five files and
  // their citations while this test stays green. Changing HARRY.md's heading
  // format, which the assertion above guards, is a far rarer edit.
  //
  // Asserted per directory rather than as a total count. A count is an
  // approximation of the thing that matters and a bad one: the first version of
  // this was `proseFiles.length >= 40` against a corpus of 46, which the
  // five-file `skills/` directory could vanish from without tripping. Naming each
  // directory catches the case exactly and says which one broke.
  for (const dir of PROSE_DIRS) {
    assert.ok(
      listMarkdownFiles(dir).length > 0,
      `PROSE_DIRS names "${dir}" but it holds no markdown — renamed or moved? Until this ` +
        `is fixed, every citation in it is unchecked and both tests here pass regardless.`,
    );
  }
  // Same shape for the top-level files, which are otherwise dropped by a
  // `.filter(existsSync)` in the corpus above — rename README.md and its
  // citations stop being checked without a word. HARRY.md is protected
  // incidentally (read directly below, so a rename throws); the other two are not.
  for (const file of TOP_LEVEL_FILES) {
    assert.ok(
      existsSync(path.join(repoRoot, file)),
      `TOP_LEVEL_FILES names "${file}" but it is missing — renamed? Both tests here read ` +
        `that list, so its paths AND its citations go unchecked until this is fixed.`,
    );
  }

  const failures: string[] = [];
  // `evals/cases.jsonl`'s `law` field is a §N citation that a MACHINE reads, and
  // `scripts/run-evals.mjs` validates it only as a non-empty string, so `law:
  // "§9"` passes there today. Two cases legitimately use a non-§ value, hence the
  // prefix test rather than a blanket one.
  //
  // Read it unguarded, deliberately. An `if (existsSync(...))` here would be a
  // SILENT SKIP — renaming `evals/` would drop all sixteen and leave this green,
  // which is the same vacuity the two assertions above exist to prevent, three
  // lines away and treated the opposite way. (It was written that way first;
  // review caught it.) The file is committed and this is a repo test, so a bare
  // read costs nothing and fails loudly if it moves.
  readFileSync(path.join(repoRoot, "evals/cases.jsonl"), "utf-8")
    .split("\n")
    .forEach((line, idx) => {
      if (!line.trim()) return;
      let parsed: unknown;
      // The try wraps ONLY the parse. Wrapping the property read too would let a
      // line that is valid JSON but not an object (`null`) report "is not valid
      // JSON" — a message asserting the opposite of the truth, which is the
      // defect class this whole test exists to police.
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        // JSON.parse's own position is an offset within THIS line, so its
        // "line 1 column 3" points at the wrong place in a file of many.
        throw new Error(
          `evals/cases.jsonl:${idx + 1} is not valid JSON: ${(err as Error).message}`,
        );
      }
      const law: unknown = (parsed as { law?: unknown } | null)?.law;
      if (typeof law !== "string" || !law.startsWith("§")) return;
      const n = law.slice(1);
      if (!sections.has(n)) failures.push(`evals/cases.jsonl:${idx + 1} -> law ${law}`);
    });

  for (const relFile of proseFiles) {
    readFileSync(path.join(repoRoot, relFile), "utf-8")
      .split("\n")
      .forEach((line, idx) => {
        // `§ 9` with a space reads as a citation to a human; match it so it
        // cannot be a silent skip.
        for (const m of line.matchAll(/§ ?(\d+)/g)) {
          if (!sections.has(m[1])) failures.push(`${relFile}:${idx + 1} -> §${m[1]}`);
        }
      });
  }

  assert.deepEqual(failures, [], "citations pointing at a section HARRY.md does not define");
});

// ---------------------------------------------------------------------------
// `See **Heading** in <reference>` pointers
//
// The third citation form, and the one that has actually been breaking. The
// path check above proves the FILE exists; the §N check proves a law number
// resolves; neither says anything about a heading named inside another file.
// Three consecutive units broke exactly this and were caught by review rather
// than by the suite: a section was hoisted or renamed and the sentence pointing
// at it kept its old name, or introduced bullets that no longer existed.
//
// The doors cite the heading WITHOUT the reference's `(one definition)` suffix
// — `See **The apply steps — baseline snapshot, apply, report**` against
// `## The apply steps — baseline snapshot, apply, report (one definition)` — so
// a trailing parenthetical is stripped before comparing. Nothing else about the
// heading is normalized: an em dash or casing change should fail, because it
// means the door and the reference have stopped agreeing on the section's name.
test("every `See **Heading** in <reference>` names a heading that reference has", () => {
  const headings = new Map<string, Set<string>>();
  const headingsOf = (rel: string): Set<string> => {
    let set = headings.get(rel);
    if (!set) {
      set = new Set(
        Array.from(readFileSync(path.join(repoRoot, rel), "utf-8").matchAll(/^##+ (.+)$/gm), (m) =>
          m[1].replace(/\s*\([^)]*\)\s*$/, "").trim(),
        ),
      );
      headings.set(rel, set);
    }
    return set;
  };

  const failures: string[] = [];
  let pointers = 0;

  for (const relFile of proseFiles) {
    const lines = readFileSync(path.join(repoRoot, relFile), "utf-8").split("\n");
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/See \*\*(.+?)\*\* in\b/g)) {
        pointers++;
        // The path usually sits on the NEXT line (these sentences are wrapped),
        // so look at the remainder of this line and the following one. A
        // pointer with no path at all is a FAILURE, never a skip — that is the
        // shape that would quietly excuse every future rename.
        const window = line.slice(m.index ?? 0) + "\n" + (lines[idx + 1] ?? "");
        const target = window.match(/references\/[\w./-]+\.md/)?.[0];
        if (!target) {
          failures.push(`${relFile}:${idx + 1} -> "${m[1]}" names no reference path`);
          continue;
        }
        if (!existsSync(path.join(repoRoot, target))) {
          failures.push(`${relFile}:${idx + 1} -> ${target} is missing`);
          continue;
        }
        if (!headingsOf(target).has(m[1].trim())) {
          failures.push(`${relFile}:${idx + 1} -> ${target} has no heading "${m[1]}"`);
        }
      }
    });
  }

  // Guards the parse, not the corpus: every pointer above is checked exactly, so
  // this only has to catch the regex matching nothing at all — which would make
  // the whole test vacuous while staying green.
  assert.ok(
    pointers > 0,
    "no `See **X** in` pointers were found anywhere — the regex above has stopped " +
      "matching, and this test now asserts nothing.",
  );
  assert.deepEqual(failures, [], "pointers naming a heading their reference does not have");
});

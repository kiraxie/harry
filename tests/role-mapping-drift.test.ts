import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// harry's role routing (HARRY.md §5) is declared in three independent places that
// must not drift: the resident law prose, the Claude Code agent frontmatter, and
// the Codex role map. Likewise every read-only/mechanical slash command has a Codex
// skill twin, and the reference-doc paths they point at are a cross-boundary contract
// (rename one side and the other dangles). Nothing else enforces either invariant.
// This test is that enforcement. (agents.test.ts already validates each agent file's
// *content*; here we only assert the *set* of roles agrees across the three sources.)

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// The canonical role set — derived ONCE, compared against all three sources below
// (hoist closure, HARRY.md §2: no per-assertion re-listing).
const CANONICAL_ROLES = new Set(["scout", "mech", "writer", "security"]);
const MODEL_ALIASES = ["haiku", "sonnet", "opus"];
const CODEX_MODEL_RE = /gpt-\d+(\.\d+)?-[a-z]+/i;
const CODEX_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// A. Role-set consistency across the three sources
// ---------------------------------------------------------------------------

test("A1 · HARRY.md §5 'Route by role' bullet names exactly the canonical roles, no model ids", () => {
  const bullet = read("HARRY.md")
    .split("\n")
    .find((l) => l.includes("**Route by role"));
  assert.ok(bullet, "HARRY.md: no 'Route by role' bullet found");

  // Extract the COMPLETE routed-role set from the routing clauses: each clause reads
  // "<nature> → `role`", so the role is the backtick token immediately after an arrow.
  // (Other backticked tokens in the bullet — `log`, `model`, `agents/*.md` … — are not
  // preceded by an arrow, so they're excluded.) Assert set equality both directions, so
  // an added clause like "orchestration → `driver`" fails, not just a missing role.
  // Wrapping punctuation is optional in the capture — an unquoted routed role (e.g. a
  // stray "orchestration → driver" clause) or one wrapped in other markup (`→
  // **driver**`, `→ "driver"`, `→ *driver*`, `→ 'driver'`) must still land in the set
  // and fail the equality check below, not silently evade extraction. `\*\*` is listed
  // before `\*` in the alternation (backtracking would recover either way; the order
  // just matches the bold wrapper directly).
  const routedRoles = new Set(
    [...bullet.matchAll(/→\s*(?:`|\*\*|\*|"|')?([\w-]+)(?:`|\*\*|\*|"|')?/g)].map(
      (m) => m[1] as string,
    ),
  );
  assert.deepEqual(
    [...routedRoles].sort(),
    [...CANONICAL_ROLES].sort(),
    "Route-by-role bullet's routed roles must equal the canonical set exactly",
  );

  // No model aliases (haiku/sonnet/opus) and no Codex model ids in this bullet —
  // the roles carry the binding, the bullet must not hard-code a model.
  for (const alias of MODEL_ALIASES) {
    assert.ok(
      !new RegExp(`\\b${alias}\\b`, "i").test(bullet),
      `Route-by-role bullet must not name model alias "${alias}"`,
    );
  }
  assert.ok(
    !CODEX_MODEL_RE.test(bullet),
    "Route-by-role bullet must not name a Codex model id (gpt-<major>[.<minor>]-<name>)",
  );
});

test("A2 · agents/*.md frontmatter name-set equals the canonical role set", () => {
  // Enumerate every agent file (not just the canonical four) so an *added* file like
  // agents/driver.md is caught — a fixed-filename loop would silently ignore it. We
  // assert only the name *set*; agents.test.ts covers each file's model/effort/tools.
  const names = new Set<string>();
  for (const entry of readdirSync(path.join(repoRoot, "agents"))) {
    if (!entry.endsWith(".md")) continue;
    const m = readFileSync(path.join(repoRoot, "agents", entry), "utf-8").match(/^name:\s*(.+)$/m);
    assert.ok(m, `agents/${entry}: no 'name:' in frontmatter`);
    names.add((m[1] as string).trim());
  }
  assert.deepEqual(
    [...names].sort(),
    [...CANONICAL_ROLES].sort(),
    "agents/*.md frontmatter names must equal the canonical role set",
  );
});

test("A3 · references/codex-role-mapping.md table rows equal canonical set with valid model+effort", () => {
  const lines = read("references/codex-role-mapping.md").split("\n");
  // A markdown table row is `| role | nature | model | effort |`; skip the header
  // row and the `|---|---|` separator. Simple `|`-split parse (no md parser).
  const roles = new Set<string>();
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const firstCell = cells[0] ?? "";
    // Separator rows may carry alignment colons (`|:---|:---:|---:|`), not just plain
    // `---` — check every cell, not just the first, so an alignment-colon separator
    // skips cleanly instead of surfacing as a malformed-row / model-shape failure.
    // header / separator (cells.length guard: a degenerate `|`-only line yields [] and
    // a vacuous every() would skip it — let it fall through to the malformed-row assert)
    if (firstCell === "role" || (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))))
      continue;
    assert.ok(
      cells.length >= 4,
      `codex-role-mapping: malformed table row (expected 4 cells, got ${cells.length}): "${line.trim()}"`,
    );
    const [role, , model, effort] = cells as [string, string, string, string];
    // Collect EVERY data row (no canonical-set filter) so an extra `driver` row is
    // caught by the set-equality assert below — and its model/effort validated too.
    roles.add(role);
    const modelId = model.replace(/`/g, "");
    // Shape check only: `gpt-<major>[.<minor>]-<name>`. Typo-level validation against a
    // supported-model-ID set is out of scope — no authoritative model registry exists
    // in-repo, so this mapping file IS the authority for the values (hardcoding the ids
    // here would just relocate the drift, not catch it).
    assert.match(
      modelId,
      /^gpt-\d+(\.\d+)?-[a-z]+$/,
      `codex-role-mapping row "${role}": model must match gpt-<major>[.<minor>]-<name>, got "${modelId}"`,
    );
    assert.ok(
      CODEX_EFFORTS.has(effort),
      `codex-role-mapping row "${role}": effort must be one of ${[...CODEX_EFFORTS]}, got "${effort}"`,
    );
  }
  assert.deepEqual(
    [...roles].sort(),
    [...CANONICAL_ROLES].sort(),
    "codex-role-mapping.md table roles must equal the canonical role set",
  );
});

// ---------------------------------------------------------------------------
// B. Command ↔ codex-skill hard-fact pairs
// ---------------------------------------------------------------------------

// CC command ↔ Codex skill twins. Hand-maintained on purpose — it is a
// declaration of intent, and a list derived from disk would sweep in doors that
// legitimately should not be paired, then get silenced by an allowlist. But a
// hand list needs a cross-check to stay honest, which is the pattern
// `tests/ask.test.ts` already states and follows for its own `ASK_DOORS`; this
// one had none. The cross-check below is that, added when section C started
// deriving from `PAIRS` too: until then a door pair landing on disk without
// being listed here was invisible to the WHOLE suite, content guard included.
const PAIRS = ["ask", "status", "debt", "review", "sync", "audit", "grill", "distill"];

// CC commands with no Codex twin, each an explicit decision rather than an
// oversight. An entry here is a conscious exemption, not a silencer.
const CC_ONLY: Record<string, string> = {
  debate: "its `self` voice is Claude/opus-only by design; no Codex conversion exists",
};

test("B · every command with a Codex twin is declared in PAIRS", () => {
  const commands = readdirSync(path.join(repoRoot, "commands"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  const codexSkills = readdirSync(path.join(repoRoot, "codex-skills"), { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(path.join(repoRoot, "codex-skills", d.name, "SKILL.md")),
    )
    .map((d) => d.name);

  assert.deepEqual(
    commands.filter((n) => codexSkills.includes(n)).sort(),
    [...PAIRS].sort(),
    "a command/skill pair exists on disk but is not in PAIRS (or vice versa) — every " +
      "check in sections B and C iterates PAIRS, so an unlisted pair is guarded by nothing",
  );
  assert.deepEqual(
    commands.filter((n) => !codexSkills.includes(n) && !(n in CC_ONLY)).sort(),
    [],
    "a CC command has no Codex twin and no CC_ONLY entry saying that is deliberate",
  );
});

// Deliberate-divergence allowlist: reference paths permitted to appear on ONE side
// only, per pair. Key → set of `references/...` paths exempt from the equality check.
const REF_ALLOWLIST: Record<string, Set<string>> = {
  // `review --fix`/`--harry-fix` material lives on the CC side; the Codex build drops
  // `--harry-fix` (redundant when the orchestrator already is Codex — see CLAUDE.md),
  // so any fix-only reference path may exist on the CC side without a Codex twin.
  // (Currently the two sides' reference sets happen to match; this guards the policy.)
  review: new Set<string>(),
};

// Collect every `references/...` path a file mentions (via `${CLAUDE_PLUGIN_ROOT}/`
// prefix or bare relative form) — normalized to the `references/...` suffix.
function refPaths(rel: string): Set<string> {
  const out = new Set<string>();
  for (const m of read(rel).matchAll(/references\/[A-Za-z0-9._/-]+/g)) {
    out.add(m[0].replace(/[./]+$/, "")); // trim trailing sentence dot / slash
  }
  return out;
}

// NOTE: on-disk existence of these reference paths is NOT re-checked here —
// prose-refs.test.ts already asserts every `${CLAUDE_PLUGIN_ROOT}/...` and bare
// repo-relative path in commands/ and codex-skills/ resolves on disk. Duplicating
// it would be redundant (HARRY.md §2 DRY). This test only asserts CC↔Codex parity.

for (const name of PAIRS) {
  test(`B · ${name}: CC command and Codex skill reference the same paths (modulo allowlist)`, () => {
    const cmd = `commands/${name}.md`;
    const skill = `codex-skills/${name}/SKILL.md`;
    assert.ok(existsSync(path.join(repoRoot, cmd)), `missing ${cmd}`);
    assert.ok(existsSync(path.join(repoRoot, skill)), `missing ${skill}`);

    const allow = REF_ALLOWLIST[name] ?? new Set<string>();
    const ccRefs = refPaths(cmd);
    const codexRefs = refPaths(skill);

    const onlyCc = [...ccRefs].filter((p) => !codexRefs.has(p) && !allow.has(p));
    const onlyCodex = [...codexRefs].filter((p) => !ccRefs.has(p) && !allow.has(p));

    assert.deepEqual(
      onlyCc,
      [],
      `${cmd} references paths absent from ${skill}: ${onlyCc.join(", ")}`,
    );
    assert.deepEqual(
      onlyCodex,
      [],
      `${skill} references paths absent from ${cmd}: ${onlyCodex.join(", ")}`,
    );
  });
}

// ---------------------------------------------------------------------------
// C. Hoisted content stays hoisted
// ---------------------------------------------------------------------------

// Test B compares the SET of reference paths each side mentions, never their
// content. The archive that produced these hoists recorded a belief that
// hoisting therefore converts B into a real content guard "at zero test cost" —
// true only while the hoist introduces a NEW path on one side. Measured after
// every hoist landed, that property is gone for every pair without exception:
//
//   ask, status                              both sides cite NO reference path
//   debt, review, sync, audit, grill, distill  1 shared path, zero asymmetry
//
// So B passes vacuously against re-inlining on 8 of 8 pairs. It still does what
// its name says — path-set parity, which catches a path added to one side only —
// but the content guard nobody had to write turned out not to exist.
//
// This is that guard, in the cheapest shape that is not an approximation: a door
// may NAME the reference and its headings, but must not carry its prose. Copying
// a paragraph back into one build's door is exactly the drift B cannot see.
//
// CEILINGS, both real:
//  - Line-granular and verbatim after normalization. Indentation, doubled
//    whitespace, CRLF, code fences, HTML-comment wrappers and list/quote prefixes
//    are all survived. What escapes is anything that changes where the LINE
//    BREAKS fall — reflowing to a different width, or joining a paragraph into
//    one line — and re-wording. A plain copy-paste, the actual failure mode, does
//    not.
//  - `ask` and `status` are NOT covered: no shared reference means no hoisted
//    content to protect. For `ask` that is literal — its two doors share zero
//    prose lines. `status` shares two, one of them a real duplicated description
//    sentence; it is left alone because both doors are five prose lines long, so
//    hoisting two of them would be textbook speculative abstraction. Their
//    divergence risk is the opposite shape — content that was never shared (see
//    the `--context` case) — and needs its own answer.
//  - Door↔REFERENCE only, never door↔door. Seven of the eight pairs carry
//    verbatim cross-build duplication today (`grill` and `distill` are 60-70%
//    identical prose); some is by design (the pointer sentences), some is not.
//    That is unhoisted duplication rather than escaped hoisted content, so it is
//    a candidate for a future hoist, not a hole in this guard.
// Declared per pair as a LIST, and checked against the paths actually shared —
// not just against which pairs share something. A pair-granular floor (the first
// version of this) is the same mistake the unit exists to correct: it reads as a
// guard while a second hoist onto an existing pair, or both doors switching to a
// different reference, leaves the new path unguarded and everything green.
// Includes what each pair reaches one level down (see sharedRefs). Two entries
// under audit are not prose — a JSON schema and a CJS validator — and the
// content check below is inert on them by nature. They are listed rather than
// exempted because the equality assertion is what keeps this map honest, and an
// exemption mechanism would be a second place to forget something; both still
// clear the non-vacuity guard (29 and 72 qualifying lines).
const HOISTED: Record<string, string[]> = {
  debt: ["references/debt-audit.md", "references/doc-types.md"],
  review: ["references/review-orchestration.md", "references/review-rubric.md"],
  sync: ["references/sync-migration.md", "references/doc-types.md", "references/debt-audit.md"],
  audit: [
    "references/audit/ORCHESTRATION.md",
    "references/audit/RECON.md",
    "references/audit/DEEP-DIVE.md",
    "references/audit/SCAN-DIMENSIONS.md",
    "references/audit/VALIDATION-AND-REPORTING.md",
    "references/audit/report-schema.json",
    "references/audit/validate-findings.cjs",
  ],
  grill: ["references/grilling.md"],
  distill: ["references/distilling.md", "references/upstream-sync.md"],
};

/**
 * The reference paths a pair's two doors both cite, plus — one level deeper —
 * the references those files themselves cite.
 *
 * The transitive step is not decoration. `/audit`'s doors point at a single hub,
 * `references/audit/ORCHESTRATION.md`, which in turn carries six companions
 * (RECON, DEEP-DIVE, SCAN-DIMENSIONS, VALIDATION-AND-REPORTING, the report
 * schema, the validator). With direct citations only, those six sat outside
 * every guard here: re-inlining five verbatim RECON.md prose lines into BOTH
 * audit doors left the whole suite green. Deriving one level down is what makes
 * a hub-and-spoke reference bundle guardable at all — and it is worth more than
 * the audit case, since it also picks up doc-types.md (via debt and sync),
 * review-rubric.md, and upstream-sync.md, all real prose nobody was guarding.
 *
 * FULL closure, not a fixed depth. A depth limit here would be a magic number
 * standing in for the graph's real shape, and the first version of this used
 * one — bounded at a level with a comment claiming two levels added nothing and
 * the graph was "a tree two deep". All of that was wrong, and review measured
 * it: `commands/sync.md` -> `sync-migration.md` -> `doc-types.md` ->
 * `debt-audit.md` is three deep, `doc-types.md` is reached from both debt and
 * sync so it is not a tree, and two cycles exist TODAY
 * (`doc-types.md` <-> `debt-audit.md`, `distilling.md` <-> `upstream-sync.md`).
 * Under that bound, three verbatim `debt-audit.md` prose lines inlined into both
 * sync doors stayed green — the same hole one level further out. A worklist with
 * a `seen` set is the same size as the bounded loop and has no such edge.
 *
 * Non-file matches are dropped. The regex also matches a bare directory mention
 * (`${CLAUDE_PLUGIN_ROOT}/references/audit/` normalizes to `references/audit`),
 * and it slices false positives out of fenced shell snippets that prose-refs
 * deliberately skips. For real `.md` citations a rename is caught twice over —
 * by prose-refs and by the equality test below — so nothing dangling hides here;
 * for those two other shapes there was never a citation to check.
 */
function sharedRefs(name: string): string[] {
  const cc = refPaths(`commands/${name}.md`);
  const stack = [...refPaths(`codex-skills/${name}/SKILL.md`)].filter((p) => cc.has(p));
  const all = new Set(stack);
  const seen = new Set<string>();
  while (stack.length) {
    const ref = stack.pop() as string;
    // Filter BEFORE the read, not only after: a door may itself name a bare
    // directory (both audit doors point at "the rest of `references/audit/`"),
    // which arrives as a directly-shared path and throws EISDIR on read.
    if (seen.has(ref) || !isReferenceFile(ref)) continue;
    seen.add(ref);
    for (const nested of refPaths(ref)) {
      if (!all.has(nested)) {
        all.add(nested);
        stack.push(nested);
      }
    }
  }
  return [...all].filter(isReferenceFile).sort();
}

function isReferenceFile(rel: string): boolean {
  const abs = path.join(repoRoot, rel);
  return existsSync(abs) && statSync(abs).isFile();
}

// 40 chars: long enough that a shared line is prose rather than a common phrase.
// The evidence for it is the DOWNWARD measurement, since a false negative comes
// from the threshold being too high — measuring 50 and 60 only shows it tolerates
// being raised, which cannot falsify it. At 30 exactly one line appears, generic
// instruction phrasing ("Return the command output verbatim.", 34 chars) whose CC
// twin is already worded differently. So 40 sits just above the noise floor.
const PROSE_LINE_MIN = 40;
// List and quote markers are stripped: a bullet or blockquote prefix is the most
// natural way prose gets moved into these bullet-heavy doors, and without this a
// re-inline as `- <paragraph>` slips through untouched.
const normalizeLine = (l: string): string =>
  l
    .trim()
    .replace(/^(?:[-*>]\s+|\d+\.\s+)+/, "")
    .replace(/\s+/g, " ");
const isProse = (l: string): boolean => l.length >= PROSE_LINE_MIN && !l.startsWith("#");

test("C · the shared reference paths are exactly the ones HOISTED declares", () => {
  // Exact at PATH granularity, both directions. Pair granularity alone lets a
  // pair gain a second hoist, or swap which file it points at, without anything
  // failing — the per-pair loop below would keep guarding the old path.
  const actual = Object.fromEntries(
    PAIRS.map((name) => [name, sharedRefs(name)]).filter(([, refs]) => refs.length > 0),
  );
  assert.deepEqual(
    actual,
    Object.fromEntries(Object.entries(HOISTED).map(([k, v]) => [k, [...v].sort()])),
    "the shared reference paths changed; HOISTED is now guarding the wrong files. " +
      "READ THE DIRECTION BEFORE PASTING THE NEW LIST. A pair that GAINED paths is " +
      "normal — a new reference, or one reachable through an existing one. A pair " +
      "that LOST them usually is not: the likeliest cause is a citation reworded " +
      "out of machine-readable form (a `references/...` path rewritten as a bare " +
      "backticked filename, which this file's regex cannot see). That silently " +
      "unguards every file it used to reach, and accepting the shrunk list here is " +
      "what makes it permanent. Restore the path form instead.",
  );
});

for (const name of Object.keys(HOISTED)) {
  test(`C · ${name}: neither door re-inlines prose from its hoisted reference`, () => {
    // Driven off the DERIVED set, not the literal, so the test above is what
    // keeps them in step rather than this loop silently trusting the map.
    const refs = sharedRefs(name);
    assert.ok(refs.length > 0, `${name}: no shared reference; the test above should have failed`);

    // No existence assertion here: sharedRefs already ends in
    // `.filter(isReferenceFile)`, so this loop cannot see a missing path and an
    // assertion for one could never fire. A rename is caught by prose-refs and
    // by the equality test above, both with better messages than this had.
    for (const ref of refs) {
      const refProse = new Set(read(ref).split("\n").map(normalizeLine).filter(isProse));
      assert.ok(
        refProse.size > 0,
        `${ref} yielded no prose lines — an empty set makes every assertion below vacuous`,
      );

      for (const door of [`commands/${name}.md`, `codex-skills/${name}/SKILL.md`]) {
        const copied = read(door)
          .split("\n")
          .map(normalizeLine)
          .filter(isProse)
          .filter((l) => refProse.has(l));
        assert.deepEqual(
          copied,
          [],
          `${door} carries prose verbatim from ${ref}. Hoisted content must live in one ` +
            `place; test B cannot see this because both doors already cite that path.`,
        );
      }
    }
  });
}

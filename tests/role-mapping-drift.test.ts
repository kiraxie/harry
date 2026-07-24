import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  // Backticks are optional in the capture — an unquoted routed role (e.g. a stray
  // "orchestration → driver" clause) must still land in the set and fail the
  // equality check below, not silently evade extraction.
  const routedRoles = new Set([...bullet.matchAll(/→\s*`?([\w-]+)`?/g)].map((m) => m[1] as string));
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
    "Route-by-role bullet must not name a Codex model id (gpt-5.6-*)",
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
    if (firstCell === "role" || /^-+$/.test(firstCell)) continue; // header / separator
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

// CC command ↔ Codex skill twins. `debate` is intentionally absent (its "self"
// voice is Claude/opus-only by design — no Codex conversion exists), so it is not
// listed here rather than allowlisted.
const PAIRS = ["ask", "status", "result", "debt", "review", "sync", "audit"];

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

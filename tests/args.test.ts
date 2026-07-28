/**
 * The argv layer (`src/lib/args.ts`) — the CLI's only input parser.
 *
 * Two bug classes this file exists to catch, both of which have already
 * happened once and were caught by human review, not by a test:
 *
 *  1. A flag listed in `KNOWN_FLAGS` but forgotten in `BOOLEAN_FLAGS`. It then
 *     swallows the next positional as its value, and every downstream
 *     `flags.x === true` check silently reads false — the run looks fine and
 *     quietly does the wrong thing. The `=== true` source scan below fails for
 *     a NEWLY added flag too, not just today's set — and a second test keeps
 *     every read in a shape that scan can see, since a regex cannot follow
 *     indirection and a hidden consumer is the same bug wearing a disguise.
 *  2. An unrecognized `--flag` being swallowed instead of erroring (the
 *     past-tense note at `src/companion.ts`'s `assertKnownFlags` call site).
 *
 * Everything here was already correct when written, so each test was proven by
 * mutating the code under test and watching it fail before landing.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertKnownFlags,
  BOOLEAN_FLAGS,
  extractTask,
  flagEnum,
  flagNumber,
  flagString,
  KNOWN_FLAGS,
  parseArgs,
} from "../src/lib/args.ts";

const COMPANION_TS = path.resolve(import.meta.dirname, "../src/companion.ts");
const REVIEW_ORCHESTRATION_MD = path.resolve(
  import.meta.dirname,
  "../references/review-orchestration.md",
);

// ---------------------------------------------------------------------------
// parseArgs — the flag matrix
// ---------------------------------------------------------------------------

interface ParseCase {
  name: string;
  argv: string[];
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const PARSE_CASES: ParseCase[] = [
  { name: "empty argv defaults to help", argv: [], command: "help", args: [], flags: {} },
  {
    name: "positionals collect in order",
    argv: ["review", "race", "condition"],
    command: "review",
    args: ["race", "condition"],
    flags: {},
  },
  {
    name: "--key value binds the next token",
    argv: ["review", "--base", "main"],
    command: "review",
    args: [],
    flags: { base: "main" },
  },
  {
    name: "--key=value binds explicitly",
    argv: ["review", "--base=main"],
    command: "review",
    args: [],
    flags: { base: "main" },
  },
  {
    name: "--key=value keeps an embedded '=' in the value",
    argv: ["ask", "--context=a=b"],
    command: "ask",
    args: [],
    flags: { context: "a=b" },
  },
  {
    name: "a value flag with nothing after it becomes true",
    argv: ["review", "--base"],
    command: "review",
    args: [],
    flags: { base: true },
  },
  {
    name: "a value flag followed by another flag becomes true (does not eat the flag)",
    argv: ["review", "--base", "--model", "gpt-5.6"],
    command: "review",
    args: [],
    flags: { base: true, model: "gpt-5.6" },
  },
  {
    name: "a boolean flag never swallows the following positional",
    argv: ["review", "--adversarial", "race", "condition"],
    command: "review",
    args: ["race", "condition"],
    flags: { adversarial: true },
  },
  {
    name: "--boolean=true coerces to true",
    argv: ["review", "--adversarial=true"],
    command: "review",
    args: [],
    flags: { adversarial: true },
  },
  {
    name: "--boolean=1 coerces to true",
    argv: ["review", "--adversarial=1"],
    command: "review",
    args: [],
    flags: { adversarial: true },
  },
  {
    name: "--boolean= (empty value) coerces to true",
    argv: ["review", "--adversarial="],
    command: "review",
    args: [],
    flags: { adversarial: true },
  },
  {
    name: "--boolean=false coerces to false, not the truthy string",
    argv: ["review", "--adversarial=false"],
    command: "review",
    args: [],
    flags: { adversarial: false },
  },
  {
    name: "--boolean=no coerces to false",
    argv: ["review", "--adversarial=no"],
    command: "review",
    args: [],
    flags: { adversarial: false },
  },
  {
    name: "boolean value coercion is case-insensitive",
    argv: ["review", "--adversarial=TRUE"],
    command: "review",
    args: [],
    flags: { adversarial: true },
  },
  {
    name: "flags and positionals interleave freely",
    argv: ["ask", "why", "--model", "gpt-5.6", "not", "--json"],
    command: "ask",
    args: ["why", "not"],
    flags: { model: "gpt-5.6", json: true },
  },
];

for (const c of PARSE_CASES) {
  test(`parseArgs: ${c.name}`, () => {
    assert.deepEqual(parseArgs(c.argv), { command: c.command, args: c.args, flags: c.flags });
  });
}

test("parseArgs rejects a garbage value on a boolean flag instead of binding a truthy string", () => {
  assert.throws(
    () => parseArgs(["review", "--adversarial=maybe"]),
    /Flag --adversarial is boolean and cannot take value "maybe"/,
  );
});

// ---------------------------------------------------------------------------
// The recorded bug class: KNOWN_FLAGS ∌ BOOLEAN_FLAGS
// ---------------------------------------------------------------------------

// Generative over the live set, so a newly added boolean flag is covered the
// moment it is registered.
for (const flag of BOOLEAN_FLAGS) {
  test(`--${flag} is boolean: a following positional does not bind to it`, () => {
    const { args, flags } = parseArgs(["review", `--${flag}`, "positional"]);
    assert.equal(flags[flag], true, `--${flag} bound a value instead of being a boolean`);
    assert.deepEqual(args, ["positional"]);
  });
}

test("every flag consumed as `=== true` is registered in BOOLEAN_FLAGS", () => {
  // The bug class in one assertion: a flag whose consumer compares `=== true`
  // but which is missing from BOOLEAN_FLAGS binds the next positional as a
  // string, so the comparison silently reads false forever. Scanning the
  // dispatcher's source means a NEWLY added flag is caught too.
  const source = fs.readFileSync(COMPANION_TS, "utf-8");
  const consumers = new Set<string>();
  for (const m of source.matchAll(/flags\??(?:\.([A-Za-z_$][\w$]*)|\["([^"]+)"\])\s*===\s*true/g)) {
    consumers.add(m[1] ?? m[2]);
  }

  // Guard against a vacuous pass if the scan pattern ever drifts from the
  // source: both access forms must have matched something.
  assert.ok(
    consumers.has("adversarial"),
    `no dot-form consumer found; scan drifted: ${COMPANION_TS}`,
  );
  assert.ok(
    consumers.has("allow-shell"),
    `no bracket-form consumer found; scan drifted: ${COMPANION_TS}`,
  );

  for (const key of consumers) {
    assert.ok(
      BOOLEAN_FLAGS.has(key),
      `--${key} is read as \`=== true\` but is missing from BOOLEAN_FLAGS: ` +
        "a positional would bind to it and the check would silently read false",
    );
  }
});

// The scan above can only see a literal member read of `flags`. Every form of
// indirection hides a consumer from it, and a hidden consumer IS the bug class:
// destructuring `flags.simplify === true` into `const { simplify: f } = flags;
// … f === true` and dropping "simplify" from BOOLEAN_FLAGS leaves the whole
// suite green while `parseArgs(["review", "--simplify", "race"])` binds
// {"simplify": "race"}. A regex cannot follow indirection and this file is not
// going to grow a parser, so the guard is the SHAPE rather than the symptom:
// keep every read scannable. Optional chaining is not listed — the scan itself
// now tolerates `flags?.x`, so it needs no ban.
//
// WHERE THIS GUARD'S REACH ENDS, DELIBERATELY. The rows below are not a
// closed list of every escape — they are a positive rule (a read has to stay
// in the literal `flags.x` / `flags["x"]` shape the scan above can see) with
// the specific opaque forms that have actually come up banned as examples of
// it. Treat the table as the boundary's evidence, not its full extent.
//
// The clearest known gap is structural rather than missed: a two-argument
// hand-off, `helper(flags, "x")`, is syntactically identical to the blessed
// accessor calls (`flagString(flags, "base")`), and no regex can tell them
// apart without knowing what the callee does — that is the parser boundary
// this rule is drawn against, so the form stays out of reach rather than
// overlooked. The accessors it is indistinguishable from are themselves
// tested here, and a new one would have to imitate their signature; that
// makes it explainable, not safe, which is why the single-argument hand-off
// below — which has no such alibi — is banned outright.
//
// A second gap sits in the scan itself, not in this table: the scan only
// matches `=== true`, so a truthy read like `!!flags.x` never enters its
// view. Pair that with dropping the flag from BOOLEAN_FLAGS and the whole
// suite stays green while the built CLI starts binding the next positional
// argument to it — the exact bug class this file exists to catch, reached
// through the scan's own blind spot instead of an opaque read.
//
// One form that looks like a gap and isn't: a multi-line trailing-comma call,
// `isSimplify(\n  flags,\n)`, dodges the single-argument pattern below as
// written, but `biome check` reformats it back onto one line before this test
// ever runs, where the pattern catches it. Closed by the formatter, not the
// regex — recorded here so it doesn't get re-derived as an opening.
const OPAQUE_FLAG_READS: Array<{ pattern: RegExp; form: string }> = [
  { pattern: /\}\s*=\s*flags\b/, form: "destructuring off `flags` (`const { x } = flags`)" },
  {
    pattern: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*flags\s*[;,]/,
    form: "aliasing `flags` to another binding (`const f = flags;`)",
  },
  { pattern: /flags\??\[(?!")/, form: "a computed `flags[…]` key (`flags[key]`)" },
  {
    pattern: /[A-Za-z_$][\w$]*\(\s*flags\s*\)/,
    form: "handing `flags` whole to a single-argument helper (`isSet(flags)`)",
  },
];

test("companion.ts reads `flags` only in a shape the `=== true` scan can see", () => {
  const source = fs.readFileSync(COMPANION_TS, "utf-8");
  for (const { pattern, form } of OPAQUE_FLAG_READS) {
    const hit = source.match(pattern);
    assert.equal(
      hit,
      null,
      `${form} — found "${hit?.[0]}" — hides a flag consumer from the \`=== true\` scan ` +
        "above, which is the only guard against a flag being read as a boolean without " +
        'being registered in BOOLEAN_FLAGS. Read flags as `flags.x` or `flags["x"]` ' +
        "instead. Passing `flags` whole to the args.ts accessors stays fine — those are " +
        "value readers, not boolean consumers, and are tested directly here. If a new " +
        "helper really is warranted, the scan cannot see inside it: point this test at " +
        "its source too, or read the flag at the call site.",
    );
  }
});

test("every boolean flag is reachable — it appears in some command's allow-list", () => {
  // The inverse mistake: registered as boolean but never allow-listed, so
  // assertKnownFlags rejects it. `help` is exempt (accepted everywhere,
  // handled before dispatch).
  const allowed = new Set(Object.values(KNOWN_FLAGS).flatMap((s) => [...s]));
  for (const flag of BOOLEAN_FLAGS) {
    if (flag === "help") continue;
    assert.ok(allowed.has(flag), `--${flag} is boolean but no command allow-lists it`);
  }
});

// ---------------------------------------------------------------------------
// assertKnownFlags — typos error loudly, per command
// ---------------------------------------------------------------------------

interface KnownFlagCase {
  name: string;
  command: string;
  flags: Record<string, string | boolean>;
  throws?: RegExp;
}

const KNOWN_FLAG_CASES: KnownFlagCase[] = [
  {
    name: "review accepts its own flags",
    command: "review",
    flags: { adversarial: true, base: "main" },
  },
  {
    name: "review rejects a near-miss typo",
    command: "review",
    flags: { adversaria: true },
    throws: /Unknown flag --adversaria for 'review'/,
  },
  {
    name: "review rejects the slash-level --background",
    command: "review",
    flags: { background: true },
    throws: /Unknown flag --background for 'review'/,
  },
  { name: "setup accepts --json", command: "setup", flags: { json: true } },
  {
    name: "setup rejects a flag that belongs to another command",
    command: "setup",
    flags: { model: "gpt-5.6" },
    throws: /Unknown flag --model for 'setup'/,
  },
  { name: "ask accepts its own flags", command: "ask", flags: { task: "why", context: "@-" } },
  {
    name: "ask rejects --fix",
    command: "ask",
    flags: { fix: true },
    throws: /Unknown flag --fix for 'ask'/,
  },
  {
    name: "fix accepts its own flags",
    command: "fix",
    flags: { findings: "/tmp/f.json", "allow-shell": true },
  },
  {
    name: "fix rejects --adversarial",
    command: "fix",
    flags: { adversarial: true },
    throws: /Unknown flag --adversarial for 'fix'/,
  },
  { name: "status accepts --json", command: "status", flags: { json: true } },
  {
    name: "an unknown command has no allow-list and defers to the dispatch switch",
    command: "bogus",
    flags: { whatever: true },
  },
];

for (const c of KNOWN_FLAG_CASES) {
  test(`assertKnownFlags: ${c.name}`, () => {
    if (c.throws) {
      assert.throws(() => assertKnownFlags(c.command, c.flags), c.throws);
    } else {
      assert.doesNotThrow(() => assertKnownFlags(c.command, c.flags));
    }
  });
}

// Generative: a newly added command must accept --help too.
for (const command of Object.keys(KNOWN_FLAGS)) {
  test(`assertKnownFlags: --help is accepted for '${command}'`, () => {
    assert.doesNotThrow(() => assertKnownFlags(command, { help: true }));
  });
}

// ---------------------------------------------------------------------------
// flagEnum
// ---------------------------------------------------------------------------

const SCOPES = ["auto", "working-tree", "branch"] as const;

test("flagEnum returns an allowed value", () => {
  assert.equal(flagEnum({ scope: "branch" }, "scope", SCOPES), "branch");
});

test("flagEnum returns undefined when the flag is absent", () => {
  assert.equal(flagEnum({}, "scope", SCOPES), undefined);
});

test("flagEnum rejects a value outside the allow-list instead of falling back", () => {
  assert.throws(
    () => flagEnum({ scope: "workingtree" }, "scope", SCOPES),
    /Invalid --scope value "workingtree". Expected one of: auto, working-tree, branch./,
  );
});

test("flagEnum rejects a valueless enum flag (`--scope` with nothing after it)", () => {
  assert.throws(
    () => flagEnum({ scope: true }, "scope", SCOPES),
    /Flag --scope requires a value \(one of: auto, working-tree, branch\)./,
  );
});

// ---------------------------------------------------------------------------
// extractTask / flagString / flagNumber
// ---------------------------------------------------------------------------

test("extractTask joins positionals and prefers them over --task", () => {
  assert.equal(extractTask(["why", "not"], { task: "flag value" }), "why not");
});

test("extractTask falls back to --task when there are no positionals", () => {
  assert.equal(extractTask([], { task: "  flag value  " }), "flag value");
});

test("extractTask returns empty string when --task carries no value", () => {
  assert.equal(extractTask([], { task: true }), "");
});

test("extractTask treats whitespace-only positionals as absent", () => {
  assert.equal(extractTask(["  "], { task: "flag value" }), "flag value");
});

test("flagString returns the string value", () => {
  assert.equal(flagString({ base: "main" }, "base"), "main");
});

test("flagString returns undefined for a valueless flag rather than leaking `true`", () => {
  assert.equal(flagString({ base: true }, "base"), undefined);
  assert.equal(flagString({}, "base"), undefined);
});

interface NumberCase {
  name: string;
  value: string | boolean;
  expected: number | undefined;
}

const NUMBER_CASES: NumberCase[] = [
  { name: "a plain integer parses", value: "30000", expected: 30000 },
  { name: "surrounding whitespace is tolerated", value: " 30000 ", expected: 30000 },
  {
    name: "trailing garbage is rejected (parseInt would accept it)",
    value: "30sec",
    expected: undefined,
  },
  {
    name: "zero is rejected so `?? DEFAULT` applies, not a 0ms timer",
    value: "0",
    expected: undefined,
  },
  { name: "a negative value is rejected", value: "-5", expected: undefined },
  { name: "Infinity is rejected", value: "Infinity", expected: undefined },
  { name: "a valueless flag is rejected, not coerced to 1", value: true, expected: undefined },
];

for (const c of NUMBER_CASES) {
  test(`flagNumber: ${c.name}`, () => {
    assert.equal(flagNumber({ timeout: c.value }, "timeout"), c.expected);
  });
}

// ---------------------------------------------------------------------------
// The orchestration-only guards in companion.ts (--full / --harry-fix)
//
// These stay in the dispatcher, so they are exercised through the real CLI —
// which is exactly what references/review-orchestration.md asserts about them.
// ---------------------------------------------------------------------------

function runCli(args: string[]): { status: number | null; stderr: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "harry-args-data-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harry-args-cwd-"));
  const res = spawnSync(process.execPath, [COMPANION_TS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: res.status, stderr: res.stderr };
}

test("the CLI rejects --full (it is a /review orchestrator flag)", () => {
  const res = runCli(["review", "--full"]);
  assert.notEqual(res.status, 0, "expected --full to be rejected");
  assert.match(res.stderr, /--full is handled by the \/review command orchestrator, not the CLI\./);
});

test("the CLI rejects --full=false too — the guard fires on presence, not truth", () => {
  const res = runCli(["review", "--full=false"]);
  assert.notEqual(res.status, 0, "expected --full=false to be rejected");
  assert.match(res.stderr, /--full is handled by the \/review command orchestrator, not the CLI\./);
});

test("a raw --harry-fix throws with the exact message references/review-orchestration.md quotes", () => {
  // Live prose↔code contract: that file tells the orchestrator to strip
  // --harry-fix before invoking the node CLI, and quotes this throw as the
  // consequence of not doing so. Rewording either side alone must fail here.
  const quoted = "--harry-fix is a /review fix-backend selector, not a CLI flag";

  const prose = fs.readFileSync(REVIEW_ORCHESTRATION_MD, "utf-8");
  assert.ok(
    prose.includes(quoted),
    `references/review-orchestration.md no longer quotes the CLI's --harry-fix error: ${quoted}`,
  );

  const res = runCli(["review", "--harry-fix"]);
  assert.notEqual(res.status, 0, "expected --harry-fix to be rejected");
  assert.ok(
    res.stderr.includes(quoted),
    `CLI error drifted from the prose contract. Expected it to contain:\n  ${quoted}\ngot:\n${res.stderr}`,
  );
});

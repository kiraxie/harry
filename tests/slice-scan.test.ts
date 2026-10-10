import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testsDir = fileURLToPath(new URL(".", import.meta.url));
const OWNER = "section.ts";
const SELF = "slice-scan.test.ts";
const LOOKUP = /\b(?:lastIndexOf|indexOf)\(|\.search\(/;

const ALLOWED: { file: string; line: string; why: string }[] = [
  {
    file: "ask.test.ts",
    line: 'return argv[argv.indexOf("-o") + 1];',
    why: "argv lookup",
  },
  {
    file: "review-cli.test.ts",
    line: 'return argv[argv.indexOf("-o") + 1];',
    why: "argv lookup",
  },
  {
    file: "fake-codex-cli.mjs",
    line: 'const oIndex = argv.indexOf("-o");',
    why: "argv lookup",
  },
  {
    file: "fake-claude.ts",
    line: "const i = argv.indexOf(name);",
    why: "argv lookup",
  },
  {
    file: "audit-validator.test.ts",
    line: 'dims[dims.indexOf(dim)] = "duplication";',
    why: "array element edit, not text",
  },
  {
    file: "audit-validator.test.ts",
    line: 'dims.splice(dims.indexOf("low-value-tests"), 1);',
    why: "array element edit, not text",
  },
  {
    file: "redline-drift.test.ts",
    line: 'return line.slice(line.indexOf(":") + 1);',
    why: "single-line slice after a separator",
  },
  {
    file: "architecture-review-contract.test.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal source line, as the test writes it.
    line: ".map((l) => l.slice(2, l.indexOf(` ${arrow} `)));",
    why: "single-line slice; lines are pre-filtered to contain the arrow",
  },
  {
    file: "run-evals.test.ts",
    line: 'const cols = dataRows.map((l) => l.indexOf("candidate"));',
    why: "column alignment within one line; rows are pre-filtered to contain it",
  },
  {
    file: "evals-jail.test.ts",
    line: "const start = lines.indexOf(opener);",
    why: "line-array lookup; a missing opener returns no paths and the caller's asserts fail",
  },
  {
    file: "codex-plugin-root.test.ts",
    line: "text.indexOf(VAR),",
    why: "position equality with a regex match, not two markers",
  },
  {
    file: "codex-plugin-root.test.ts",
    line: "found.index + found[0].indexOf(VAR),",
    why: "position equality with a regex match, not two markers",
  },
  {
    file: "grilling-contract.test.ts",
    line: 'const first = text.slice(0, text.indexOf(optIn)).split("\\n").length;',
    why: "line number of a slice section() already proved present",
  },
  {
    file: "review-writing-laws.test.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal source line, as the test writes it.
    line: "const from = text.indexOf(`- ${label}`);",
    why: "bullet slice, asserted present on the next line; no section shape has three callers",
  },
  {
    file: "review-writing-laws.test.ts",
    line: 'const ends = [text.indexOf(" - ", from + 2), text.indexOf("## ", from)].filter((i) => i !== -1);',
    why: "nearest of several end markers; no section shape has three callers",
  },
  {
    file: "session-writes.test.ts",
    line: '.slice(deepDive.indexOf("```"), deepDive.lastIndexOf("```"))',
    why: "first to last fence; a missing fence empties the slice and the match below fails",
  },
];

const scanned = (): string[] =>
  readdirSync(testsDir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.[cm]?[jt]s$/.test(f) && f !== OWNER && f !== SELF)
    .sort();

const lines = (file: string): string[] =>
  readFileSync(path.join(testsDir, file), "utf-8")
    .split("\n")
    .map((l) => l.trim());

test("every indexOf, lastIndexOf or search in tests/ is on the allowlist", () => {
  const unlisted: string[] = [];
  for (const file of scanned())
    lines(file).forEach((line, i) => {
      if (LOOKUP.test(line) && !ALLOWED.some((a) => a.file === file && a.line === line))
        unlisted.push(`${file}:${i + 1}: ${line}`);
    });
  assert.deepEqual(
    unlisted,
    [],
    `slice or order-check by marker through tests/section.ts (section(), headingSection(), inOrder()), or add an allowlist entry with its reason:\n${unlisted.join("\n")}`,
  );
});

test("every allowlist entry matches exactly one line in its file", () => {
  const files = scanned();
  const off = ALLOWED.map((a) => ({
    a,
    n: files.includes(a.file) ? lines(a.file).filter((l) => l === a.line).length : 0,
  })).filter(({ n }) => n !== 1);
  assert.deepEqual(
    off.map(({ a, n }) => `${a.file}: ${a.line} (matches ${n} lines)`),
    [],
    "remove a stale entry; give a repeated line its own reason or route it through tests/section.ts",
  );
});

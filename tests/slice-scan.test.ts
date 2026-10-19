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

type Literal = {
  kind: "regex" | "string";
  body: string;
  flags: string;
  at: number;
  end: number;
  group: number;
  arg: number;
};

const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/;

const endOf = (src: string, mark: string, from: number): number => {
  const at = src.indexOf(mark, from);
  return at === -1 ? src.length : at;
};

const scan = (
  src: string,
  from: number,
  found: Literal[],
  open: number[],
  commas: Map<number, number>,
  stopAt: number,
): number => {
  let i = from;
  while (i < src.length) {
    const c = src[i] as string;
    const group = open[open.length - 1] ?? -1;
    if (c === "/" && src[i + 1] === "/") i = endOf(src, "\n", i);
    else if (c === "/" && src[i + 1] === "*") i = endOf(src, "*/", i + 2) + 2;
    else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      found.push({
        kind: "string",
        body: src.slice(i + 1, k),
        flags: "",
        at: i,
        end: k + 1,
        group,
        arg: commas.get(group) ?? 0,
      });
      i = k + 1;
    } else if (c === "`") {
      let k = i + 1;
      while (k < src.length && src[k] !== "`") {
        if (src[k] === "\\") k += 2;
        else if (src[k] === "$" && src[k + 1] === "{") {
          open.push(k + 1);
          k = scan(src, k + 2, found, open, commas, open.length);
        } else k += 1;
      }
      found.push({
        kind: "string",
        body: src.slice(i + 1, k),
        flags: "",
        at: i,
        end: k + 1,
        group,
        arg: commas.get(group) ?? 0,
      });
      i = k + 1;
    } else if (c === "/" && REGEX_BEFORE.test(src.slice(Math.max(0, i - 12), i))) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && src[k] !== "\n" && (inClass || src[k] !== "/")) {
        if (src[k] === "\\") k += 1;
        else if (src[k] === "[") inClass = true;
        else if (src[k] === "]") inClass = false;
        k += 1;
      }
      const flags = /^[a-z]*/.exec(src.slice(k + 1))?.[0] ?? "";
      found.push({
        kind: "regex",
        body: src.slice(i + 1, k),
        flags,
        at: i,
        end: k + 1 + flags.length,
        group,
        arg: commas.get(group) ?? 0,
      });
      i = k + 1 + flags.length;
    } else if (c === "(" || c === "[" || c === "{") {
      open.push(i);
      i += 1;
    } else if (c === ",") {
      commas.set(group, (commas.get(group) ?? 0) + 1);
      i += 1;
    } else if (c === ")" || c === "]" || c === "}") {
      open.pop();
      i += 1;
      if (c === "}" && open.length < stopAt) return i;
    } else i += 1;
  }
  return i;
};

const literals = (src: string): Literal[] => {
  const found: Literal[] = [];
  scan(src, 0, found, [], new Map(), 0);
  return found;
};

const JOINS =
  /\(\?(?:[:=]|<[A-Za-z_$][\w$]*>)|[()|]|(?:\\s| |\[[ \\t]+\])(?:[*+?]|\{\d*,?\d*\})|(?<=\\n)[+*]/g;
const FLAGS = /^[dgimsuvy]*$/;

const plainClasses = (source: string): string =>
  source.replace(/\\\\|\\.|\[(?:\\.|[^\]\\])*\]/g, (m) =>
    m === "\\\\"
      ? ""
      : m.startsWith("\\") || /^\[[ \\t]+\]$/.test(m)
        ? m
        : !m.startsWith("[^") && /^\[(?:\\.|[^\\])*?\\n/.test(m)
          ? "\\n"
          : "C",
  );

const anchoredHash = (source: string, flags: string): boolean =>
  (flags.includes("m") ? /(?:\\n|\^)+#/ : /\\n\^*#/).test(plainClasses(source).replace(JOINS, ""));

const skipSpace = (src: string, at: number): number => {
  let j = at;
  while (j > 0 && /\s/.test(src[j - 1] as string)) j -= 1;
  return j;
};

const callBefore = (src: string, at: number): { call: string | undefined; raw: boolean } => {
  let j = skipSpace(src, at);
  const raw = src.slice(Math.max(0, j - 10), j) === "String.raw";
  if (raw) j = skipSpace(src, j - 10);
  return { call: /\b(split|RegExp)\($/.exec(src.slice(Math.max(0, j - 8), j))?.[1], raw };
};

const headingReads = (src: string): { line: number; text: string }[] => {
  const all = literals(src);
  return all.flatMap((lit) => {
    const body = lit.body;
    const { call, raw } = callBefore(src, lit.at);
    const flags = all
      .filter((l) => l.group === lit.group && l.arg === 1 && l.at > lit.at && FLAGS.test(l.body))
      .map((l) => l.body)
      .join("");
    const source = lit.kind === "string" && !raw ? body.replace(/\\\\/g, "\\") : body;
    const reads =
      (lit.kind === "regex" && anchoredHash(body, lit.flags)) ||
      (call === "RegExp" && anchoredHash(source, flags)) ||
      /^(?:\\n)?#+ $/.test(body) ||
      (call === "split" &&
        (lit.kind === "regex"
          ? /^#+(?: |\\s|\{)/.test(body.replace(JOINS, ""))
          : /^(?:\\n)?#+ /.test(body)));
    return reads
      ? [{ line: src.slice(0, lit.at).split("\n").length, text: src.slice(lit.at, lit.end) }]
      : [];
  });
};

const HEADING_READS = [
  'assert.doesNotMatch(before, /\\n### /, "no section before the groups");',
  'const before = raw.split("\\n## Every test", 1)[0] ?? "";',
  "Array.from(laws.matchAll(/^## (.+)$/gm), (m) => m[1]);",
  "raw.split(/\\n(?=## )/);",
  'new RegExp("^## (.+)$", "gm");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'new RegExp(`^## ${h}$`, "m");',
  "[...raw.matchAll(/(?:^|\\n)## (.+)/g)];",
  'const ends = [text.indexOf(" - ", from + 2), text.indexOf("## ", from)];',
  "/^## Major \\/ red line$/gm.test(raw);",
  'text.indexOf("\\n### ");',
  'raw.split("## Output")[1];',
  "[...text.matchAll(/^(#+) (.*)$/gm)];",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const re = new RegExp(\n  `^## ${name}\\\\s*$([\\\\s\\\\S]*?)(?=^#{1,2} )`,\n  "gm",\n);',
  "text.split(/(?:\\n|^)## /);",
  "text.match(/\\n## .*/g);",
  "text.match(/\\n##? /g);",
  "/^\\s*## .*$/gm.test(text);",
  "text.split(/\\n(?=^## )/m);",
  'RegExp("^## (.*)$", "gm");',
  'section(text, rel, start, "\\n## ");',
  "[...t.matchAll(/^(?<h>#+) (.*)$/gm)];",
  "t.split(/\\n(?<h>#+) /);",
  "text.split(/(?=## )/);",
  "raw.split(/(?=#{2} )/);",
  "t.split(/\\n *## /);",
  "t.split(/(?<=\\n)## /);",
  "return /\\n## /.test(t);",
  "/[/]\\n## /.test(t);",
  'const s = "a\\"b"; t.split("\\n## ");',
  'const s = `a\\`b`; t.split("\\n## ");',
  'const a = "unterminated\nt.split("\\n## ");',
  'x = /unterminated\nt.split("## Output");',
  "/^ {0,3}## /m.test(t);",
  "/^[ \\t]*## /m.test(t);",
  "t.split(/\\n+## /);",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const m = `got ${text.split("\\n## ")[1]}`;',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  "const m = `${t.match(/^## (.+)$/gm)}`;",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const m = `${s.replace(/`/g, "")}`; text.split("\\n## ");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  "const t = `${f({ a: 1 }, t.match(/^## (.+)$/gm))}`;",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'new RegExp(`^## ${h.replace("x", "y")}$`, "m");',
  'new RegExp("^## " + name, "gm");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'new RegExp(String.raw`^## ${n}$`, "m");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'new RegExp(\n  String.raw`^## ${n}$`,\n  "m",\n);',
  'new RegExp("^## " + name + "$", "m");',
  "t.split(/(?=##\\s)/);",
  "assert.match(out, /\\n## Focus\\n/);",
  'new RegExp("^## " + n, multi ? "m" : "");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  "const m = `${/\\n## /.test(t)}`;",
  "{ /\\n## /.test(t) }",
  "const r = [/\\n## /, /x/];",
  "text.match(/\\n## .*/gm);",
  `t.split(${" ".repeat(50)}"## Output");`,
  `new RegExp(${" ".repeat(50)}String.raw\`^## x\`, "m");`,
  'new RegExp(String.raw `^## x`, "m");',
  'new RegExp("\\\\n## ");',
  "/\\[x\\]\\n## [A-Z]/.test(t);",
  "/[\\r\\n]## /.test(t);",
  "t.split(/[\\r\\n]+## /);",
];
const NOT_HEADING_READS = [
  'const docs = { "x.md": "## Steps\\n## Review\\n" };',
  'const s = section(plain(X), X, "## Output", "### Assessment");',
  'const [path, fragment] = url.split("#");',
  "headingSection(raw(HARRY), HARRY, /^## Code$/);",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  "const re = new RegExp(`^## ${heading}$`);",
  "if (!/`## Plan`|^## Plan\\b/.test(line)) return;",
  'const isProse = (l: string): boolean => l.length >= PROSE_LINE_MIN && !l.startsWith("#");',
  "const BLOCK_START = /^\\s*(?:$|#|[-*] |\\d+\\. |[a-z]\\. |\\||```|<!--)/;",
  "const STEP2 = /^## \\d+\\. Architecture review/;",
  "// x = /\\n## /;\nconst x = 1;",
  '/* text.split("\\n## ") */',
  'const half = total / 2; const s = "#x\\n## y";',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const t = `a ${b.map((c) => `${c}/`)} d`; const u = "## y";',
  "const parts = url.split(/#/);",
  'new RegExp("^## " + sep + "more");',
  'new RegExp("^## " + name); g("m");',
  'foo(new RegExp("^## " + name), "m");',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'new RegExp(`^## ${x}${"m"}$`);',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const m = `${total / 2}`; const s = "## y";',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, as a test would write it.
  'const t = `${"#".repeat(level)} heading`;',
  "t.split(/^## /);",
  "t.split(/[\\n#]/);",
  "/[^#\\n]+/m.test(t);",
  "/\\\\n## /.test(t);",
  'new RegExp("\\\\\\\\n## ");',
  "new RegExp(String.raw`\\\\n## `);",
  "new RegExp(String.raw `\\\\n## `);",
  'new RegExp("^## " + n + "m", "g");',
  "/[\\\\n]## /.test(t);",
  "/[^\\n]## /.test(t);",
];

test("the heading scan catches each known shape and nothing else", () => {
  assert.deepEqual(
    HEADING_READS.filter((src) => headingReads(src).length === 0),
    [],
    "a known heading read now passes the scan",
  );
  assert.deepEqual(
    NOT_HEADING_READS.filter((src) => headingReads(src).length > 0),
    [],
    "the scan now flags code that reads no heading",
  );
});

const HEADING_ALLOWED: { file: string; text: string; why: string }[] = [
  {
    file: "ask.test.ts",
    text: "/## Background[^\\n]*\\n\\nfrom a file\\n\\n## Prompt\\n\\nq\\n$/",
    why: "the exact prompt ask sends codex, not a markdown document",
  },
  {
    file: "ask.test.ts",
    text: "/## Background[^\\n]*\\n\\nfrom stdin\\n\\n## Prompt/",
    why: "the exact prompt ask sends codex, not a markdown document",
  },
];

const ownReads = (): { file: string; line: number; text: string }[] =>
  scanned().flatMap((file) =>
    headingReads(readFileSync(path.join(testsDir, file), "utf-8")).map((r) => ({ file, ...r })),
  );

test("no test in tests/ reads headings on its own", () => {
  const own = ownReads()
    .filter((r) => !HEADING_ALLOWED.some((a) => a.file === r.file && a.text === r.text))
    .map((r) => `${r.file}:${r.line}: ${r.text}`);
  assert.deepEqual(own, [], `read headings through tests/section.ts outline():\n${own.join("\n")}`);
});

const staleEntries = (
  allowed: { file: string; text: string }[],
  reads: { file: string; text: string }[],
): string[] =>
  allowed
    .filter((a) => reads.filter((r) => r.file === a.file && r.text === a.text).length !== 1)
    .map((a) => `${a.file}: ${a.text}`);

test("every heading-read allowlist entry matches exactly one read", () => {
  const read = { file: "x.test.ts", text: "/\\n## /" };
  assert.deepEqual(
    staleEntries([read], [read, read]),
    ["x.test.ts: /\\n## /"],
    "an entry matching two reads now passes",
  );
  assert.deepEqual(
    staleEntries([read], []),
    ["x.test.ts: /\\n## /"],
    "an entry matching no read now passes",
  );
  assert.deepEqual(
    staleEntries(HEADING_ALLOWED, ownReads()),
    [],
    "remove a stale heading-read entry",
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

// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the literal command lines, as the shipped prose writes them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LINE_END_RE } from "./lines.ts";
import { SHIPPED_MARKDOWN } from "./prose-dirs.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const CALLS = [/companion\.cjs["']?\s+ask\s/, /\bagy\s/];

const isCall = (line: string): boolean => CALLS.some((re) => re.test(line));

// A backslash-newline continues a shell command, so a call split across lines is still one.
const logicalLines = (text: string): string[] =>
  text.replace(/\\\r?\n[ \t]*/g, " ").split(LINE_END_RE);

// Whole lines, not a shell grammar: whether a prompt argument can carry user or model
// text is a reviewer's call, and any quoting or argument order still names the CLI.
const APPROVED: { file: string; line: string; why: string }[] = [
  {
    file: "commands/ask.md",
    line: 'node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "$(cat \'<D>/prompt.md\')" [--reasoning <low|medium|high|xhigh>] [--context @<file>|@-]',
    why: "the user's prompt goes by file, so the shell never parses it",
  },
  {
    file: "commands/debate.md",
    line: '| `gpt` | Bash: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "$(cat \'<D>/prompt.md\')" --reasoning high`, run with `run_in_background: true` (a high-effort `ask` turn — harry sets no timeout of its own on the `codex exec` call it spawns — can run past the 10-min foreground Bash timeout — see below) |',
    why: "the gpt prompt carries the topic and other voices' text, so it goes by file",
  },
  {
    file: "commands/debate.md",
    line: '| `gemini` | Bash: `agy -p "$(cat \'<D>/prompt.md\')" --model "Gemini 3.1 Pro (High)" --print-timeout 20m`, run with `run_in_background: true` (the foreground Bash timeout caps at 10m, below Gemini\'s worst case — see below) |',
    why: "the gemini prompt carries the same text, so it goes by file",
  },
  {
    file: "commands/debate.md",
    line: "`agy -p` answers the same prompt in under half a minute on some runs and in 18+",
    why: "prose naming the CLI; no call",
  },
  {
    file: "commands/rethink.md",
    line: 'node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask --isolated "Design this subsystem from scratch, from the Background alone. You have no access to any codebase: do not read the filesystem or run commands. Give the design (data model, interfaces, mechanisms), then list every assumption you made where the Background was silent." --reasoning high --context @\'<D>/brief.md\'',
    why: "a fixed literal written in the command; the user's brief goes by --context @file",
  },
];

type Hit = { rel: string; n: number; line: string };

const hits: Hit[] = SHIPPED_MARKDOWN.flatMap((rel) =>
  logicalLines(readFileSync(path.join(repoRoot, rel), "utf-8"))
    .map((line, i) => ({ rel, n: i + 1, line: line.trim() }))
    .filter(({ line }) => isCall(line)),
);

test("call detection sees each quoting, argument order and line continuation listed", () => {
  for (const line of [
    'node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "<p>"',
    "node '${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs' ask \"<p>\"",
    'node ${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs ask --reasoning high "<p>"',
    'node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask \\',
    'agy --model X -p "<p>"',
  ])
    assert.ok(isCall(line), line);
  assert.ok(logicalLines('node "/x/companion.cjs" \\\n  ask "<p>"').some(isCall), "continued call");
  for (const line of ['companion.cjs" ask`', 'companion.cjs" ask:*)', "`agy`"])
    assert.ok(!isCall(line), line);
});

test("every ask or agy line in shipped prose is an approved line", () => {
  for (const { rel, n, line } of hits)
    assert.ok(
      APPROVED.some((e) => e.file === rel && e.line === line),
      `pass the prompt by file, or add an APPROVED entry with its reason: ${rel}:${n}: ${line}`,
    );
});

test("every APPROVED entry still matches a line in its file", () => {
  for (const e of APPROVED)
    assert.ok(
      hits.some(({ rel, line }) => rel === e.file && line === e.line),
      `stale APPROVED entry: ${e.file}: ${e.line}`,
    );
});

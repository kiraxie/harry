#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { getStoreDir } from "../../src/lib/git.ts";

const USAGE = "usage: <progress|followup-add|followup-remove> <slug>, the line on stdin";
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const FOLLOW_UPS = "## Follow-ups";
const SECTION = {
  progress: "## Progress",
  "followup-add": FOLLOW_UPS,
  "followup-remove": FOLLOW_UPS,
} as const;

export type Op = keyof typeof SECTION;
export type Plan = { kind: "add" | "remove"; at: number; piece: string };

type Line = { text: string; start: number; heading: boolean };

// A `## …` line inside a code fence is text, not a heading: an item quotes headings in
// its AC and in pasted output.
function scan(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const marker = raw.match(FENCE_RE)?.[1];
    let heading = false;
    if (fence === null) {
      if (marker !== undefined) fence = marker;
      else heading = raw.startsWith("## ");
    } else if (
      marker !== undefined &&
      marker[0] === fence[0] &&
      marker.length >= fence.length &&
      raw.trim() === marker
    ) {
      fence = null;
    }
    lines.push({ text: raw, start, heading });
    start += raw.length + 1;
  }
  return lines;
}

const headingsAt = (lines: Line[], heading: string): number[] =>
  lines.flatMap((l, i) => (l.heading && l.text === heading ? [i] : []));

function section(lines: Line[], heading: string): { head: number; end: number } {
  const found = headingsAt(lines, heading);
  const [head] = found;
  if (head === undefined || found.length !== 1) {
    throw new Error(
      `"${heading}" is there ${found.length} times as a heading outside code fences; edit this item with the Edit tool`,
    );
  }
  const next = lines.findIndex((l, i) => i > head && l.heading);
  return { head, end: next === -1 ? lines.length : next };
}

const lineAt = (lines: Line[], i: number): Line => lines[i] as Line;

function pieceAt(lines: Line[], i: number, line: string, kind: Plan["kind"]): Plan {
  const { text, start } = lineAt(lines, i);
  const last = i === lines.length - 1;
  if (kind === "add") {
    return last
      ? { kind, at: start + text.length, piece: `\n${line}` }
      : { kind, at: start + text.length + 1, piece: `${line}\n` };
  }
  return last
    ? { kind, at: start - 1, piece: `\n${line}` }
    : { kind, at: start, piece: `${line}\n` };
}

export function plan(text: string, op: Op, line: string): Plan {
  const lines = scan(text);
  const heading = SECTION[op];
  if (op === "followup-add" && headingsAt(lines, heading).length === 0) {
    const gap = text === "" || text.endsWith("\n") ? "\n" : "\n\n";
    return { kind: "add", at: text.length, piece: `${gap}${heading}\n${line}\n` };
  }
  const { head, end } = section(lines, heading);
  if (op === "followup-remove") {
    const held = lines.flatMap((l, i) => (i > head && i < end && l.text === line ? [i] : []));
    const [only] = held;
    if (only === undefined || held.length !== 1) {
      throw new Error(`${JSON.stringify(line)} is there ${held.length} times in "${heading}"`);
    }
    return pieceAt(lines, only, line, "remove");
  }
  let lastLine = end - 1;
  while (lastLine > head && lineAt(lines, lastLine).text.trim() === "") lastLine--;
  return pieceAt(lines, lastLine, line, "add");
}

export function apply(text: string, { kind, at, piece }: Plan, line: string): string {
  const refuse = (why: string): never => {
    throw new Error(`exact-difference check failed: ${why}; nothing written`);
  };
  const wholeLine = piece === `${line}\n`;
  const atEnd = piece === `\n${line}`;
  const newSection =
    kind === "add" &&
    [`\n${FOLLOW_UPS}\n${line}\n`, `\n\n${FOLLOW_UPS}\n${line}\n`].includes(piece);
  if (!wholeLine && !atEnd && !newSection) refuse("the change is not the one line");
  const stop = kind === "add" ? at : at + piece.length;
  if (kind === "remove" && text.slice(at, stop) !== piece) refuse("the line is not at the offset");
  if (wholeLine && at !== 0 && text[at - 1] !== "\n") refuse("the offset is inside a line");
  if (!wholeLine && stop !== text.length) refuse("the change is not at the end of the file");
  return kind === "add"
    ? text.slice(0, at) + piece + text.slice(at)
    : text.slice(0, at) + text.slice(stop);
}

function oneLine(input: string): string {
  const line = input.endsWith("\n") ? input.slice(0, -1) : input;
  if (line.trim() === "" || line.includes("\n") || line.startsWith("## ") || FENCE_RE.test(line)) {
    throw new Error("give one line on stdin, not a heading or a code fence");
  }
  return line;
}

function editItem(cwd: string, op: Op, slug: string, line: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug ${JSON.stringify(slug)}`);
  const items = path.join(getStoreDir(cwd), "items");
  const file = path.join(items, `${slug}.md`);
  if (!existsSync(file)) throw new Error(`no item ${slug} in ${items}`);
  // Held from before the read to the rename: an edit that read the old text beside
  // this one would drop this one's line, and a rename never leaves half an item.
  const tmp = `${file}.item-edit.tmp`;
  let fd: number;
  try {
    fd = openSync(tmp, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new Error(
      `${tmp} is there: another edit of this item is running; when none is, delete that file`,
    );
  }
  try {
    try {
      const text = readFileSync(file, "utf8");
      writeFileSync(fd, apply(text, plan(text, op, line), line));
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}

if (import.meta.main) {
  try {
    const [op, slug, ...rest] = process.argv.slice(2);
    if (op === undefined || !Object.hasOwn(SECTION, op) || slug === undefined || rest.length > 0) {
      throw new Error(USAGE);
    }
    const file = editItem(process.cwd(), op as Op, slug, oneLine(readFileSync(0, "utf8")));
    console.log(`${op}: ${file}`);
  } catch (err) {
    process.stderr.write(`item-edit: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

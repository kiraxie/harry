import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { KNOWN_FLAGS } from "../src/lib/args.ts";
import { REPO_TOP_LEVEL } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

/** The metrics flags top-level prose may name; every other one is documented by `--help`. */
const BOUNDARY_FLAGS = new Set(["base", "plan", "audit", "run-tests"]);

test("top-level prose states the metrics boundary and cites `--help` for the flags", () => {
  const runtime = headingSection(read("CLAUDE.md"), "CLAUDE.md", "## Runtime architecture");
  assert.ok(runtime.includes("companion metrics --help"), "CLAUDE.md no longer cites it");
  const detail = [...(KNOWN_FLAGS.metrics ?? [])].filter((f) => !BOUNDARY_FLAGS.has(f));
  assert.ok(detail.length > 0);
  const named = REPO_TOP_LEVEL.flatMap((rel) =>
    detail
      .filter((f) => new RegExp(`--${f}(?![\\w-])`).test(read(rel)))
      .map((f) => `${rel}: --${f}`),
  );
  assert.deepEqual(named, [], "name these flags in `companion metrics --help`, not here");
});

test("`companion metrics --help` names every metrics flag", () => {
  const cli = path.join(repoRoot, "src/companion.ts");
  const help = execFileSync(process.execPath, [cli, "metrics", "--help"], { encoding: "utf8" });
  const missing = [...(KNOWN_FLAGS.metrics ?? [])].filter(
    (f) => !new RegExp(`--${f}(?![\\w-])`).test(help),
  );
  assert.deepEqual(missing, [], "add these flags to printUsage in src/companion.ts");
});

/**
 * Resolves the caller-supplied `--context` value that `review` and `ask` put
 * into their prompt as a Background section: decisions, constraints and intent
 * from the Claude Code session that never made it into a repo file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve `--context` into text. Following the curl/gh convention, an `@`
 * prefix means "read from", everything else is literal:
 *   - `--context "some text"` → the literal string
 *   - `--context @path/to/file.md` → the file's contents (resolved vs cwd)
 *   - `--context @-` → read from stdin
 * Strict: a read failure or an empty source throws, because a model silently
 * missing its facts would answer a different question. (To pass a literal
 * string that starts with `@`, there is no escape today — use `@-` and pipe it,
 * or a file.)
 */
export function resolveExtraContext(cwd: string, context: string | undefined): string | undefined {
  const raw = context;
  if (!raw?.trim()) return undefined;
  if (!raw.startsWith("@")) return raw.trim();

  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text: string;
  try {
    text = readFileSync(ref === "-" ? 0 : resolve(cwd, ref), "utf-8").trim();
  } catch (err) {
    throw new Error(`Could not read --context ${source}: ${(err as Error).message}`);
  }
  if (!text) throw new Error(`--context ${source} is empty.`);
  return text;
}

/**
 * Builds the `systemMessage` append fed into a Codex session.
 *
 * Codex already loads the repository's instruction files (`AGENTS.md`,
 * `CLAUDE.md`) from the working directory on its own, so we do NOT re-inject
 * those. What the delegated session lacks is:
 *   1. the framing — that it is a headless, read-only subtask delegated by
 *      Claude Code's orchestrator; and
 *   2. CC-only context — decisions, constraints, and intent that live in the
 *      Claude Code conversation and never made it into a repo file.
 *
 * Both are appended after codex's own instruction-file loading.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `ask` is the only in-process session left: `review` runs `codex exec review`
// (no system message) and `fix` was removed.
export type SessionKind = "ask";

export interface SystemMessageInput {
  /** Caller-supplied extra context/instructions (already resolved to text). */
  extraContext?: string;
}

const FRAMING: Record<SessionKind, string> = {
  ask: [
    "You are one independent voice being consulted on a question or topic.",
    "Reason carefully and state your own honest conclusion. Use only the context",
    "provided in the prompt — do not explore the filesystem or run tools.",
    "Be concrete and decisive; surface key assumptions and the strongest",
    "counter-argument to your own position.",
  ].join(" "),
};

/**
 * Resolve the caller-supplied `--context` value into text. Following the
 * curl/gh convention, an `@` prefix means "read from", everything else is
 * literal:
 *   - `--context "some text"` → the literal string
 *   - `--context @path/to/file.md` → the file's contents (resolved vs cwd)
 *   - `--context @-` → read from stdin
 * By default a read failure is surfaced via `onWarn` and yields no context
 * rather than aborting the run. With `strict`, a read failure or an empty
 * source throws instead — for a caller where silently dropping the context
 * would change the result (`review`). (To pass a literal string that starts
 * with `@`, there is no escape today — use `@-` and pipe it, or a file.)
 */
export function resolveExtraContext(
  cwd: string,
  opts: { context?: string; onWarn?: (m: string) => void; strict?: boolean },
): string | undefined {
  const raw = opts.context;
  if (!raw?.trim()) return undefined;
  if (!raw.startsWith("@")) return raw.trim();

  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text: string;
  try {
    text = readFileSync(ref === "-" ? 0 : resolve(cwd, ref), "utf-8").trim();
  } catch (err) {
    const message = `Could not read --context ${source}: ${(err as Error).message}`;
    if (opts.strict) throw new Error(message);
    opts.onWarn?.(message);
    return undefined;
  }
  if (!text && opts.strict) throw new Error(`--context ${source} is empty.`);
  return text || undefined;
}

/** Assemble the `systemMessage.content` string for a delegated session. */
export function buildSystemMessage(kind: SessionKind, input: SystemMessageInput = {}): string {
  const sections: string[] = [];
  sections.push(FRAMING[kind]);
  if (input.extraContext?.trim()) {
    sections.push(
      `## Additional context from the orchestrator\nThe following is context from the Claude Code session that delegated this task. Treat it as authoritative intent:\n\n${input.extraContext.trim()}`,
    );
  }
  return sections.join("\n\n");
}

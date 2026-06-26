/**
 * Builds the `systemMessage` append fed into a Copilot session.
 *
 * Copilot already loads the repository's instruction files
 * (`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`) from the
 * working directory on its own, so we do NOT re-inject those. What the
 * delegated session lacks is:
 *   1. the framing — that it is a headless subtask delegated by Claude Code's
 *      orchestrator, with mode-specific guardrails (isolated worktree / real
 *      tree / read-only); and
 *   2. CC-only context — decisions, constraints, and intent that live in the
 *      Claude Code conversation and never made it into a repo file.
 *
 * Both are appended after the SDK-managed system-message sections.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SessionKind = 'implement' | 'fix' | 'review' | 'ask';

export interface SystemMessageInput {
  /** Branch the work happens on (implement worktree). */
  branch?: string;
  /** Caller-supplied extra context/instructions (already resolved to text). */
  extraContext?: string;
}

const FRAMING: Record<SessionKind, string> = {
  implement: [
    "You are executing a self-contained coding subtask delegated by Claude Code's orchestrator. You run headless: there is no interactive user at the keyboard for this session.",
    'Your edits happen in an isolated git worktree, so they cannot disturb the main checkout. Do NOT run `git commit` — the plugin commits your changes for you after you finish.',
    "Follow the repository's existing conventions and patterns (its instruction files are already loaded). Stay tightly scoped to the task; avoid unrelated refactors or formatting churn.",
  ].join('\n'),
  fix: [
    "You are applying code-review findings that a human has already vetted and approved, delegated by Claude Code's orchestrator. You run headless.",
    "Edit the real working tree directly. Make the minimal, correct change for each approved finding; do not refactor unrelated code and do NOT run `git commit` (the plugin manages commits and leaves your edits staged for review).",
    'If a finding cannot be safely applied, skip it and report why rather than forcing a change.',
  ].join('\n'),
  review: [
    "You are performing a code review delegated by Claude Code's orchestrator. You run headless.",
    'This session is read-only: do not attempt to modify files. Report findings; another stage applies any fixes.',
  ].join('\n'),
  ask: [
    'You are one independent voice being consulted on a question or topic.',
    'Reason carefully and state your own honest conclusion. Use only the context',
    'provided in the prompt — do not explore the filesystem or run tools.',
    'Be concrete and decisive; surface key assumptions and the strongest',
    'counter-argument to your own position.',
  ].join(' '),
};

/**
 * Resolve the caller-supplied `--context` value into text. Following the
 * curl/gh convention, an `@` prefix means "read from", everything else is
 * literal:
 *   - `--context "some text"` → the literal string
 *   - `--context @path/to/file.md` → the file's contents (resolved vs cwd)
 *   - `--context @-` → read from stdin
 * A read failure is surfaced via `onWarn` and yields no context rather than
 * aborting the run. (To pass a literal string that starts with `@`, there is
 * no escape today — use `@-` and pipe it, or a file.)
 */
export function resolveExtraContext(
  cwd: string,
  opts: { context?: string; onWarn?: (m: string) => void },
): string | undefined {
  const raw = opts.context;
  if (!raw || !raw.trim()) return undefined;
  if (!raw.startsWith('@')) return raw.trim();

  const ref = raw.slice(1);
  try {
    const source = ref === '-' ? 0 : resolve(cwd, ref);
    const text = readFileSync(source, 'utf-8').trim();
    return text || undefined;
  } catch (err) {
    opts.onWarn?.(
      `Could not read --context ${ref === '-' ? 'from stdin' : `file ${ref}`}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

/** Assemble the `systemMessage.content` string for a delegated session. */
export function buildSystemMessage(kind: SessionKind, input: SystemMessageInput = {}): string {
  const sections: string[] = [];
  let framing = FRAMING[kind];
  if (kind === 'implement' && input.branch) {
    framing = framing.replace('an isolated git worktree', `an isolated git worktree (branch \`${input.branch}\`)`);
  }
  sections.push(framing);
  if (input.extraContext && input.extraContext.trim()) {
    sections.push(`## Additional context from the orchestrator\nThe following is context from the Claude Code session that delegated this task. Treat it as authoritative intent:\n\n${input.extraContext.trim()}`);
  }
  return sections.join('\n\n');
}

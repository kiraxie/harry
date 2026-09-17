/**
 * review command — a thin wrapper over the Codex CLI's `codex exec review`.
 *
 * Resolves what to review (branch vs working tree), builds a prompt naming that
 * target plus harry's review rubric, and runs
 * `codex exec review --ephemeral -c sandbox_mode="read-only" -o <file> -` at the
 * repo root with the prompt on stdin. The review file is printed verbatim.
 *
 * codex writes its whole session transcript to stderr (prompt echo, rubric,
 * every command's output) — hundreds of KB on a real branch — so it goes to a
 * `.log` beside the review file, never to the caller.
 *
 * No fallback anywhere: a missing CLI, a non-zero exit, or an absent/empty
 * output file each fail the command, printing the log's tail (where codex puts
 * its `ERROR:` line) verbatim.
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  countBranchChanges,
  getBranchOrShortSha,
  getMainCheckoutRoot,
  getRepoRoot,
  resolveReviewTarget,
} from "../lib/git.ts";
import type { ReasoningEffort } from "../lib/provider.ts";
import { buildReviewPrompt, loadReviewRubric } from "../lib/review-prompts.ts";
import { ensureDir, resolveStateDir } from "../lib/state.ts";
import { resolveExtraContext } from "../lib/system-message.ts";

export interface ReviewOptions {
  base?: string;
  reasoning?: ReasoningEffort;
  /** Background for the reviewer: literal text, or `@file` / `@-` — see `resolveExtraContext`. */
  context?: string;
  focusText?: string;
}

/** The stderr line naming the review file. The doors tell callers to read that path. */
export const REVIEW_WRITTEN = "Review written to";

/** How much of codex's log a failure prints — enough to carry its closing `ERROR:` line. */
const FAILURE_TAIL_LINES = 40;

/**
 * Where the review lands. The MAIN checkout's `.local/tmp/<branch>/` when that
 * checkout already has a `.local/` (even when run from a linked worktree),
 * otherwise the plugin state dir. A `.local/` is never created here.
 */
function resolveOutputDir(repoRoot: string): string {
  const branch = getBranchOrShortSha(repoRoot);
  const local = join(getMainCheckoutRoot(repoRoot), ".local");
  const dir =
    existsSync(local) && statSync(local).isDirectory()
      ? join(local, "tmp", branch)
      : join(resolveStateDir(repoRoot), "reviews", branch);
  ensureDir(dir);
  return dir;
}

function timestamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * One review file per run: `codex-review-<YYYYMMDD-HHMMSS>[-N].md` plus the
 * matching `.log`, so a re-review never clobbers an earlier round and a failed
 * run can never print an older review. A stem is taken when either file exists;
 * the log is created exclusively (`wx`) to claim the stem against a concurrent run.
 */
export function reserveReviewFiles(
  dir: string,
  now: Date = new Date(),
): { reviewPath: string; logPath: string } {
  const base = `codex-review-${timestamp(now)}`;
  for (let n = 1; ; n++) {
    const stem = join(dir, n === 1 ? base : `${base}-${n}`);
    const reviewPath = `${stem}.md`;
    const logPath = `${stem}.log`;
    if (existsSync(reviewPath)) continue;
    try {
      closeSync(openSync(logPath, "wx"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    return { reviewPath, logPath };
  }
}

/** Print the log's last lines verbatim, then its path, for a failed run. */
function reportLogTail(logPath: string): void {
  const lines = readFileSync(logPath, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const tail = lines.slice(-FAILURE_TAIL_LINES);
  if (tail.length > 0) process.stderr.write(`${tail.join("\n")}\n`);
  process.stderr.write(`Log: ${logPath}\n`);
}

export async function runReview(cwd: string, options: ReviewOptions = {}): Promise<void> {
  const target = resolveReviewTarget(cwd, { base: options.base });
  const repoRoot = getRepoRoot(cwd);

  // Only a branch target can be empty: auto picks working-tree mode only when dirty.
  if (target.mode === "branch" && countBranchChanges(repoRoot, target.baseRef ?? "") === 0) {
    process.stdout.write(`# Review Summary\n\nNo changes to review under ${target.label}.\n`);
    return;
  }

  const prompt = buildReviewPrompt({
    target,
    rubric: loadReviewRubric(),
    // Strict: a reviewer silently missing its facts would review a different question.
    context: resolveExtraContext(cwd, { context: options.context, strict: true }),
    focusText: options.focusText,
  });

  const { reviewPath: outputPath, logPath } = reserveReviewFiles(resolveOutputDir(repoRoot));

  const args = [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPath,
  ];
  if (options.reasoning) args.push("-c", `model_reasoning_effort="${options.reasoning}"`);
  args.push("-");

  process.stderr.write(`Reviewing ${target.label} with codex exec review…\n`);
  // stdout is ignored: codex echoes its final message there, and the review is
  // printed from the -o file instead. stderr (the session transcript) goes to
  // the log; a failure prints its tail.
  const logFd = openSync(logPath, "w");
  let res: ReturnType<typeof spawnSync>;
  try {
    res = spawnSync("codex", args, {
      cwd: repoRoot,
      input: prompt,
      stdio: ["pipe", "ignore", logFd],
    });
  } finally {
    closeSync(logFd);
  }
  if ((res.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    // codex never ran, so the reserved log is empty and nothing names it.
    rmSync(logPath, { force: true });
    throw new Error(
      "The Codex CLI was not found on PATH. Install it and run `codex login`, then retry.",
    );
  }
  if (res.error) throw res.error;
  if (res.status !== 0) {
    reportLogTail(logPath);
    throw new Error(
      `codex exec review failed (${res.status === null ? `signal ${res.signal}` : `exit ${res.status}`}).`,
    );
  }

  const review = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (!review.trim()) {
    reportLogTail(logPath);
    throw new Error(`codex exec review exited 0 but wrote no review to ${outputPath}.`);
  }
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}\nLog: ${logPath}\n`);
}

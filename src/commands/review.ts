/**
 * review command — a thin wrapper over the Codex CLI's `codex exec review`.
 *
 * Resolves what to review (branch vs working tree), builds a prompt naming that
 * target plus harry's review rubric, and runs
 * `codex exec review --ephemeral -c sandbox_mode="read-only" -o <file> -` at the
 * repo root with the prompt on stdin. The review file is printed verbatim.
 *
 * Spawning, the `.log` beside the review file, and the loud no-fallback failure
 * handling live in `src/lib/run-codex.ts`, shared with `ask`.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveExtraContext } from "../lib/context.ts";
import {
  countBranchChanges,
  getBranchOrShortSha,
  getMainCheckoutRoot,
  getRepoRoot,
  resolveReviewTarget,
} from "../lib/git.ts";
import { buildReviewPrompt, loadReviewRubric } from "../lib/review-prompts.ts";
import { type ReasoningEffort, reserveRunFiles, runCodexExec } from "../lib/run-codex.ts";
import { ensureDir, resolveStateDir } from "../lib/state.ts";

export interface ReviewOptions {
  base?: string;
  reasoning?: ReasoningEffort;
  /** Background for the reviewer: literal text, or `@file` / `@-` — see `resolveExtraContext`. */
  context?: string;
  focusText?: string;
}

/** The stderr line naming the review file. The doors tell callers to read that path. */
export const REVIEW_WRITTEN = "Review written to";

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

/** One review file per run: `codex-review-<YYYYMMDD-HHMMSS>[-N].md` plus its `.log`. */
export function reserveReviewFiles(
  dir: string,
  now: Date = new Date(),
): { reviewPath: string; logPath: string } {
  const { outputPath, logPath } = reserveRunFiles(dir, "codex-review", now);
  return { reviewPath: outputPath, logPath };
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
    context: resolveExtraContext(cwd, options.context),
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
  const review = runCodexExec({
    args,
    cwd: repoRoot,
    input: prompt,
    outputPath,
    logPath,
    label: "codex exec review",
    outputNoun: "review",
  });
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}\nLog: ${logPath}\n`);
}

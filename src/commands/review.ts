/**
 * review command — runs one `companion review` mode through the Codex CLI.
 *
 * Works out the mode from its flags and checks them (the modes exclude each
 * other; a re-review or fix check needs `--base` and its handed text), resolves
 * what to review (branch vs working tree), builds the mode's prompt from its record
 * (`MODES` in `src/lib/review-modes.ts`), and runs the one read-only `codex exec`
 * every mode runs (`runCodexExec`), at the repo root with the prompt on stdin.
 * The review file is printed verbatim.
 *
 * Spawning and the loud no-fallback failure handling live in
 * `src/lib/run-codex.ts`; the review file and the `.log` beside it are reserved
 * by `src/lib/run-files.ts`. Both are shared with `ask`.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveTextFlag } from "../lib/context.ts";
import {
  countBranchChanges,
  getBranchOrShortSha,
  getMainCheckoutRoot,
  getRepoRoot,
  resolveReviewTarget,
} from "../lib/git.ts";
import {
  buildReviewPrompt,
  type HandedStandard,
  MODES,
  type ReviewStandard,
  takesHanded,
} from "../lib/review-modes.ts";
import { CODEX_EXEC, type ReasoningEffort, runCodexExec } from "../lib/run-codex.ts";
import { reserveRunFiles } from "../lib/run-files.ts";
import { ensureDir, resolveStateDir } from "../lib/state.ts";

export interface ReviewOptions {
  base?: string;
  reasoning?: ReasoningEffort;
  /** Background for the reviewer: literal text, or `@file` / `@-` — see `resolveTextFlag`. */
  context?: string;
  /**
   * Embed `references/architecture-review.md` instead of the per-diff rubric —
   * finishing's architecture review, run out of session on the Codex build.
   */
  architecture?: boolean;
  rereview?: string;
  fixCheck?: string;
  focusText?: string;
}

type Selected =
  | { standard: Exclude<ReviewStandard, HandedStandard> }
  | { standard: HandedStandard; handed: string };

function resolveStandard(cwd: string, options: ReviewOptions): Selected {
  const handedRaw: Record<HandedStandard, string | undefined> = {
    rereview: options.rereview,
    "fix-check": options.fixCheck,
  };
  const given: Record<Exclude<ReviewStandard, "review">, boolean> = {
    architecture: options.architecture === true,
    rereview: handedRaw.rereview !== undefined,
    "fix-check": handedRaw["fix-check"] !== undefined,
  };
  const chosen = (Object.keys(given) as Array<keyof typeof given>).filter(
    (standard) => given[standard],
  );
  if (chosen.length > 1) {
    const flags = chosen.map((standard) => MODES[standard].flag);
    throw new Error(`${flags.join(" and ")} cannot be combined: each is its own review.`);
  }
  const standard = chosen[0] ?? "review";
  if (!takesHanded(standard)) return { standard };
  const mode = MODES[standard];
  const raw = handedRaw[standard];
  if (options.context === "@-" && raw === "@-") {
    throw new Error(`--context and ${mode.flag} cannot both read stdin (@-): pass one as @file.`);
  }
  if (!options.base) {
    throw new Error(`${mode.flag} requires --base <ref>: ${mode.baseReason}.`);
  }
  return { standard, handed: resolveTextFlag(cwd, mode.flag, raw) ?? "" };
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
  const selected = resolveStandard(cwd, options);
  const mode = MODES[selected.standard];
  const target = resolveReviewTarget(cwd, { base: options.base });
  const repoRoot = getRepoRoot(cwd);

  // Only a branch target can be empty: auto picks working-tree mode only when dirty.
  const empty =
    target.mode === "branch" && countBranchChanges(repoRoot, target.baseRef ?? "") === 0;
  if (empty && mode.onEmpty === "summary") {
    process.stdout.write(`# Review Summary\n\nNo changes to review under ${target.label}.\n`);
    return;
  }

  const prompt = buildReviewPrompt({
    ...selected,
    target,
    // Strict: a reviewer silently missing its facts would review a different question.
    context: resolveTextFlag(cwd, "--context", options.context),
    focusText: options.focusText,
  });
  if (empty && mode.onEmpty === "fail") {
    throw new Error(
      `${mode.flag} has no changes to judge under ${target.label}: commit them first, or check --base.`,
    );
  }

  const { reviewPath: outputPath, logPath } = reserveReviewFiles(resolveOutputDir(repoRoot));

  process.stderr.write(`Reviewing ${target.label} with ${CODEX_EXEC}…\n`);
  const review = await runCodexExec({
    reasoning: options.reasoning,
    cwd: repoRoot,
    input: prompt,
    outputPath,
    logPath,
    outputNoun: "review",
  });
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}\nLog: ${logPath}\n`);
}

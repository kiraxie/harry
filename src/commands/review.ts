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
  context?: string;
  spec?: string;
  architecture?: boolean;
  rereview?: string;
  fixCheck?: string;
  focusText?: string;
}

type Selected =
  | { standard: "review"; spec?: string }
  | { standard: "architecture" }
  | { standard: HandedStandard; handed: string };

function assertOneStdinReader(context: string | undefined, flag: string, raw: string | undefined) {
  if (context === "@-" && raw === "@-") {
    throw new Error(`--context and ${flag} cannot both read stdin (@-): pass one as @file.`);
  }
}

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
  const standard = chosen.at(0) ?? "review";
  if (options.spec !== undefined && standard !== "review") {
    throw new Error(
      `--spec goes with the plain review only: ${MODES[standard].flag} judges no spec.`,
    );
  }
  if (standard === "review") {
    assertOneStdinReader(options.context, "--spec", options.spec);
    return { standard, spec: resolveTextFlag(cwd, "--spec", options.spec) };
  }
  if (!takesHanded(standard)) return { standard };
  const mode = MODES[standard];
  const raw = handedRaw[standard];
  assertOneStdinReader(options.context, mode.flag, raw);
  if (!options.base) {
    throw new Error(`${mode.flag} requires --base <ref>: ${mode.baseReason}.`);
  }
  return { standard, handed: resolveTextFlag(cwd, mode.flag, raw) ?? "" };
}

/** The stderr line naming the review file. The doors tell callers to read that path. */
export const REVIEW_WRITTEN = "Review written to";

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

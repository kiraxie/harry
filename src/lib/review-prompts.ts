/**
 * The prompt `companion review` sends to `codex exec review` on stdin.
 *
 * The Codex CLI rejects a prompt combined with its own target flags
 * (`--base`/`--uncommitted`/`--commit`), so the prompt itself has to name the
 * target: which git command shows the change, and that everything outside it is
 * context only. The review standard is harry's shared rubric, embedded verbatim.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReviewTarget } from "./git.ts";

/**
 * The plugin root: the parent of the directory holding the entry file. That is
 * the repo root both from source (`src/companion.ts`) and from the committed
 * bundle (`dist/companion.cjs`), which is why this reads `process.argv[1]`
 * rather than `import.meta` (empty in the CJS bundle) or `__dirname` (absent in
 * ESM source).
 */
export function pluginRoot(): string {
  return dirname(dirname(realpathSync(process.argv[1])));
}

/** Read `references/review-rubric.md`; a missing rubric is an install defect, never skipped. */
export function loadReviewRubric(root: string = pluginRoot()): string {
  const rubricPath = join(root, "references", "review-rubric.md");
  let text: string;
  try {
    text = readFileSync(rubricPath, "utf8");
  } catch (err) {
    throw new Error(
      `Review rubric not found at ${rubricPath} (${(err as Error).message}). Reinstall the harry plugin.`,
    );
  }
  if (!text.trim()) throw new Error(`Review rubric at ${rubricPath} is empty.`);
  return text.trim();
}

const OUTSIDE_THE_DIFF =
  "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";

function targetSection(target: ReviewTarget): string {
  if (target.mode === "branch") {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    return [
      "# Review target",
      "",
      `Review the changes this branch makes against \`${target.baseRef}\`. Run \`git diff ${target.baseRef}...HEAD\` to see them — that diff is the review target.`,
      "",
      OUTSIDE_THE_DIFF,
    ].join("\n");
  }
  return [
    "# Review target",
    "",
    "Review the uncommitted changes in this working tree — staged, unstaged and untracked. See them with:",
    "",
    "- `git status --short --untracked-files=all` — every changed and untracked path",
    "- `git diff HEAD` — staged and unstaged changes to tracked files",
    "- read each untracked file in full — it has no diff",
    "",
    OUTSIDE_THE_DIFF,
  ].join("\n");
}

export interface ReviewPromptInput {
  target: ReviewTarget;
  rubric: string;
  /** Resolved `--context` text, if any. */
  context?: string;
  focusText?: string;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const sections = [targetSection(input.target), `# Review standard\n\n${input.rubric.trim()}`];
  const context = input.context?.trim();
  if (context) {
    sections.push(`## Background (settled facts from the working session)\n\n${context}`);
  }
  const focus = input.focusText?.trim();
  if (focus) sections.push(`## Focus\n\n${focus}`);
  return `${sections.join("\n\n")}\n`;
}

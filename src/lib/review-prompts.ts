/**
 * The prompt `companion review` sends to `codex exec review` on stdin.
 *
 * The Codex CLI rejects a prompt combined with its own target flags
 * (`--base`/`--uncommitted`/`--commit`), so the prompt itself has to name the
 * target: which git command shows the change, and that everything outside it is
 * context only. The review standard is the references `STANDARD_FILES` lists for the
 * review asked for, each embedded verbatim.
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

/**
 * Which review a prompt asks for: the per-diff code review, or finishing's
 * architecture review. One input decides both the embedded standard and how
 * the target section scopes findings, so the two can never disagree.
 */
export type ReviewStandard = "review" | "architecture";

/** Each standard's reference files under `references/`, embedded in order under their headings. */
const STANDARD_FILES: Record<ReviewStandard, ReadonlyArray<{ file: string; heading: string }>> = {
  review: [
    { file: "review-rubric.md", heading: "Review standard" },
    { file: "red-green.md", heading: "Test standard (`references/red-green.md`)" },
  ],
  architecture: [{ file: "architecture-review.md", heading: "Review standard" }],
};

/** Read a review reference from `references/`; a missing one is an install defect, never skipped. */
function loadReference(file: string): string {
  const refPath = join(pluginRoot(), "references", file);
  let text: string;
  try {
    text = readFileSync(refPath, "utf8");
  } catch (err) {
    throw new Error(
      `Review reference not found at ${refPath} (${(err as Error).message}). Reinstall the harry plugin.`,
    );
  }
  if (!text.trim()) throw new Error(`Review reference at ${refPath} is empty.`);
  return text.trim();
}

const OUTSIDE_THE_DIFF =
  "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";

const OUTSIDE_THE_SHAPES =
  "Code outside those changes is context for judging the shapes this change adds or alters: read it, one level up and through the recent history, as the review standard below asks. Report findings about those shapes only, not unrelated problems elsewhere.";

function targetSection(target: ReviewTarget, standard: ReviewStandard): string {
  const outside = standard === "architecture" ? OUTSIDE_THE_SHAPES : OUTSIDE_THE_DIFF;
  if (target.mode === "branch") {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    return [
      "# Review target",
      "",
      `Review the changes this branch makes against \`${target.baseRef}\`. Run \`git diff ${target.baseRef}...HEAD\` to see them — that diff is the review target.`,
      "",
      outside,
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
    outside,
  ].join("\n");
}

export interface ReviewPromptInput {
  target: ReviewTarget;
  /** The review asked for; `architecture` scopes findings to shapes, not the diff. */
  standard: ReviewStandard;
  /** Resolved `--context` text, if any. */
  context?: string;
  focusText?: string;
}

/** Throws when a reference file the standard embeds is missing or empty. */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const sections = [
    targetSection(input.target, input.standard),
    ...STANDARD_FILES[input.standard].map(
      ({ file, heading }) => `# ${heading}\n\n${loadReference(file)}`,
    ),
  ];
  const context = input.context?.trim();
  if (context) {
    sections.push(`## Background (settled facts from the working session)\n\n${context}`);
  }
  const focus = input.focusText?.trim();
  if (focus) sections.push(`## Focus\n\n${focus}`);
  return `${sections.join("\n\n")}\n`;
}

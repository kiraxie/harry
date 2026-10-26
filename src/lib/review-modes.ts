/**
 * Each `companion review` mode and the prompt it sends codex on stdin.
 *
 * `MODES` holds one record per mode: the flag that asks for it, the references
 * embedded as its standard (each verbatim, or the one section an entry names), its
 * target section, for a re-review or fix check the handed text's heading and the
 * `--base` it needs, and what an empty range does. Every mode runs `codex exec`
 * with its read-only sandbox (`runCodexExec` in `src/lib/run-codex.ts` builds it) —
 * not `codex exec review`, which answers in its own review-comment format and
 * ignores the form a mode asks for.
 *
 * `codex exec` takes no review target, so the prompt itself names it: which git
 * command shows the change, and that everything outside it is context only.
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
 * Which review a prompt asks for: the per-diff code review, finishing's
 * architecture review, or executing's scoped re-review of a fix range and its
 * fix check of proposed fixes. One input picks the mode's whole record, so its
 * parts can never disagree.
 */
export type HandedStandard = "rereview" | "fix-check";
export type ReviewStandard = "review" | "architecture" | HandedStandard;

interface StandardFile {
  file: string;
  heading: string;
  section?: string;
}

const PER_DIFF: ReadonlyArray<StandardFile> = [
  { file: "review-rubric.md", heading: "Review standard" },
  { file: "red-green.md", heading: "Test standard (`references/red-green.md`)" },
];

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

function cutSection(file: string, text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) {
    throw new Error(
      `Review reference ${join(pluginRoot(), "references", file)} has no \`## ${title}\` section. Reinstall the harry plugin.`,
    );
  }
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function embed({ file, heading, section }: StandardFile): string {
  const text = loadReference(file);
  return `# ${heading}\n\n${section ? cutSection(file, text, section) : text}`;
}

const OUTSIDE_THE_DIFF =
  "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";

const OUTSIDE_THE_SHAPES =
  "Code outside those changes is context for judging the shapes this change adds or alters: read it, one level up and through the recent history, as the review standard below asks. Report findings about those shapes only, not unrelated problems elsewhere.";

function reviewTarget(target: ReviewTarget, outside: string): string {
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

function fixCheckTarget(target: ReviewTarget): string {
  if (target.mode !== "branch" || !target.baseRef)
    throw new Error("A fix check requires a branch target.");
  return [
    "# Fix check target",
    "",
    `This is a fix check, not a review. An earlier review of this branch raised the findings handed below, each with a proposed fix that is not built yet. The unit's changes are \`git diff ${target.baseRef}...HEAD\` — run it to see the code the findings point at.`,
    "",
    "Read the whole repo as far as you need to trace the data flow and the system around each fix: callers, producers and copies of the same knowledge, wherever they live. Judge only the handed fixes: one line per handed fix, in the output form of the fix check standard below, under its finding's number — the number the handed text gives the finding (its `1.`, `2.` …), never a number from the handed file's title or name; raise no new findings.",
  ].join("\n");
}

const REREVIEW_MODE = [
  "# Re-review mode",
  "",
  "This is a scoped re-review, not a fresh review. The diff above is the fix range: the fixes made for the open findings handed below, after an earlier review of this branch. Report in the review standard's re-review form, not its fresh form:",
  "",
  "- Under `### Open findings`, one line per handed finding, under its handed number: ADDRESSED or NOT ADDRESSED, with the evidence read. Attempted is not addressed.",
  "- Judge each handed finding at the levels in the Three levels section above: ADDRESSED means the cause is gone, not only this instance.",
  "- Number new issues on from the last number handed, never from 1.",
].join("\n");

interface Mode {
  files: ReadonlyArray<StandardFile>;
  target: (target: ReviewTarget) => string;
  onEmpty: "summary";
}

interface FlaggedMode extends Mode {
  flag: string;
}

interface HandedMode extends Omit<FlaggedMode, "onEmpty"> {
  baseReason: string;
  heading: string;
  modeSection?: string;
  onEmpty: "fail";
}

export const MODES: {
  review: Mode;
  architecture: FlaggedMode;
  rereview: HandedMode;
  "fix-check": HandedMode;
} = {
  review: {
    files: PER_DIFF,
    target: (target) => reviewTarget(target, OUTSIDE_THE_DIFF),
    onEmpty: "summary",
  },
  architecture: {
    flag: "--architecture",
    files: [{ file: "architecture-review.md", heading: "Review standard" }],
    target: (target) => reviewTarget(target, OUTSIDE_THE_SHAPES),
    onEmpty: "summary",
  },
  rereview: {
    flag: "--rereview",
    files: [
      ...PER_DIFF,
      {
        file: "fix-check.md",
        heading: "Fix levels (`references/fix-check.md` **Three levels**)",
        section: "Three levels",
      },
    ],
    target: (target) => reviewTarget(target, OUTSIDE_THE_DIFF),
    baseReason: "the head the review it follows reviewed",
    modeSection: REREVIEW_MODE,
    heading: "Open findings handed to this re-review",
    onEmpty: "fail",
  },
  "fix-check": {
    flag: "--fix-check",
    files: [{ file: "fix-check.md", heading: "Fix check standard (`references/fix-check.md`)" }],
    target: fixCheckTarget,
    baseReason: "the unit's branch point",
    heading: "Fixes handed to this fix check",
    onEmpty: "fail",
  },
};

export function takesHanded(standard: ReviewStandard): standard is HandedStandard {
  return "heading" in MODES[standard];
}

const SPEC_HEADING = "Acceptance criteria handed to this review";

const SPEC_NOTE =
  "Judge Spec compliance per AC against the acceptance criteria below. A probe line beside an AC is its author's report, not a settled fact: check it as the review standard's Spec compliance says.";

export type ReviewPromptInput = {
  target: ReviewTarget;
  /** Resolved `--context` text, if any. */
  context?: string;
  focusText?: string;
} & (
  | { standard: "review"; spec?: string }
  | { standard: "architecture" }
  | { standard: HandedStandard; handed: string }
);

/** Throws when a reference file or section the standard embeds is missing or empty. */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const mode = MODES[input.standard];
  const sections = [mode.target(input.target), ...mode.files.map(embed)];
  if ("handed" in input && "heading" in mode) {
    if (mode.modeSection) sections.push(mode.modeSection);
    const handed = input.handed.trim();
    if (!handed) throw new Error(`A ${input.standard} prompt requires its handed text.`);
    sections.push(`# ${mode.heading}\n\n${handed}`);
  }
  const spec = input.standard === "review" ? input.spec?.trim() : undefined;
  if (spec) sections.push(`# ${SPEC_HEADING}\n\n${SPEC_NOTE}\n\n${spec}`);
  const context = input.context?.trim();
  if (context) {
    sections.push(`## Background (settled facts from the working session)\n\n${context}`);
  }
  const focus = input.focusText?.trim();
  if (focus) sections.push(`## Focus\n\n${focus}`);
  return `${sections.join("\n\n")}\n`;
}

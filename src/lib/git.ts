/**
 * Git helpers for review context collection. Ported from the codex plugin's
 * lib/git.mjs. Read-only — every call is `git diff` / `git log` / `git status`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";

const MAX_UNTRACKED_BYTES = 24 * 1024;
const DEFAULT_INLINE_DIFF_MAX_FILES = 2;
const DEFAULT_INLINE_DIFF_MAX_BYTES = 256 * 1024;

interface CommandResult {
  /** `null` when git never ran (spawn failure) or was killed by a signal —
   * deliberately NOT coerced to 0, which would read as a clean success. */
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
}

// Generous buffer cap for the self-collect path. Real-world diffs almost
// never exceed this; if they do, gitDiffTolerant() returns a placeholder
// instead of throwing so the review can still proceed.
const SELF_COLLECT_BUFFER_BYTES = 64 * 1024 * 1024;

// Why a git call failed, in human-readable form: git's own stderr when it said
// anything, else the exit code — or, when there is no status at all, the fact
// that git never returned one (killed by a signal, or the spawn itself failed).
// `exit null` would read as a real exit code and is never what happened.
function failureReason(result: CommandResult): string {
  if (result.stderr.trim()) return result.stderr.trim();
  return result.status === null ? "killed by a signal or failed to spawn" : `exit ${result.status}`;
}

function gitDiffTolerant(cwd: string, args: string[]): { stdout: string; overflow: boolean } {
  const result = git(cwd, args, SELF_COLLECT_BUFFER_BYTES);
  if (result.error?.code === "ENOBUFS") {
    return { stdout: "", overflow: true };
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${failureReason(result)}`);
  }
  return { stdout: result.stdout, overflow: false };
}

export function truncateUtf8(s: string, maxBytes: number): { text: string; truncated: boolean } {
  // A negative or fractional cap is a caller bug, and propagating one would
  // silently skip the boundary walk below: `subarray(0, -5)` counts from the
  // END, and `buf[2.5]` is `undefined`, which fails the continuation-byte test.
  // Either would reintroduce exactly the defect the walk exists to prevent, so
  // normalize instead. collectReviewContext now normalizes `maxInlineDiffBytes`
  // at its entry, so its two call sites arrive clean; this stays because the
  // function is exported and called directly, including by tests that hand it
  // NaN and Infinity.
  const cap = Math.max(0, Math.trunc(maxBytes));
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= cap) return { text: s, truncated: false };
  // Back off any character the cut lands inside, BEFORE decoding. `cap` is a
  // byte offset with no regard for character boundaries, and decoding an
  // orphaned tail yields U+FFFD — three bytes standing in for the one to three
  // they replaced. When the orphan is one or two bytes that overruns the cap;
  // when it is three (a 4-byte character cut after its third byte) it is
  // three-for-three, so only the glyph is injected. Both are wrong: the input
  // never contained that character. UTF-8 continuation bytes are `10xxxxxx`;
  // walking back off them lands on a character boundary.
  let end = cap;
  while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end--;
  // Then trim back to the nearest line break to avoid cutting mid-line.
  let cut = buf.subarray(0, end).toString("utf8");
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > 0) cut = cut.slice(0, lastNl);
  return { text: cut, truncated: true };
}

function git(cwd: string, args: string[], maxBuffer?: number): CommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: (result.error as NodeJS.ErrnoException) ?? null,
  };
}

function gitChecked(cwd: string, args: string[], maxBuffer?: number): CommandResult {
  const result = git(cwd, args, maxBuffer);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${failureReason(result)}`);
  }
  return result;
}

function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) return false;
  }
  return true;
}

function listUniqueFiles(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

function measureGitOutputBytes(cwd: string, args: string[], maxBytes: number): number {
  const result = git(cwd, args, maxBytes + 1);
  if (result.error && result.error.code === "ENOBUFS") return maxBytes + 1;
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${failureReason(result)}`);
  return Buffer.byteLength(result.stdout, "utf8");
}

// Requires maxBytes >= 0; collectReviewContext normalizes it at the entry.
// The per-set budget `maxBytes - total` therefore cannot go negative: it starts
// at maxBytes, and the `total > maxBytes` return below means a surviving
// iteration always leaves total <= maxBytes. That matters because
// measureGitOutputBytes passes that budget + 1 to spawnSync as maxBuffer, which
// THROWS RangeError below 0 — so a negative cap has to be stopped at the entry,
// not absorbed here.
function measureCombinedGitOutputBytes(cwd: string, argSets: string[][], maxBytes: number): number {
  let total = 0;
  for (const args of argSets) {
    total += measureGitOutputBytes(cwd, args, maxBytes - total);
    if (total > maxBytes) return total;
  }
  return total;
}

// A cap is a caller bug when it is negative or NaN, and the two fail
// differently: a negative byte cap reaches spawnSync as a negative maxBuffer and
// THROWS RangeError, while NaN silently DISABLES the cap it belongs to, because
// every `x > NaN` is false. NaN has to be named explicitly — `Math.max(0,
// Math.trunc(NaN))` is still NaN. (truncateUtf8 uses the bare idiom safely: a
// NaN cap there yields an empty string, not a throw.)
//
// `Math.trunc` is defensive, NOT load-bearing, and the distinction is worth
// keeping straight: Node floors maxBuffer itself, so a fractional byte cap never
// spuriously overflows, and a fractional file cap compares identically to its
// floor. It is here so a cap is integral by the time anything downstream reasons
// about it — the same contract truncateUtf8 states, where a fractional cap IS
// load-bearing (`buf[2.5]` is undefined and defeats the boundary walk).
//
// Infinity is deliberately passed through: spawnSync accepts it, and it is the
// documented way to ask for no limit.
function normalizeCap(value: number | undefined, fallback: number): number {
  const raw = value ?? fallback;
  return Number.isNaN(raw) ? 0 : Math.max(0, Math.trunc(raw));
}

// The inline path emits full untracked file bodies, which appear in no diff and
// so were never counted against maxInlineDiffBytes. Measure them by FORMATTING
// each file rather than by stat: formatUntrackedFile skips directories, binary,
// unreadable, and over-MAX_UNTRACKED_BYTES files, emitting a one-line note in
// their place. A stat-sum would charge a 10 MB untracked binary its full size
// when it actually contributes ~35 bytes. Sharing the formatter means the
// measurement cannot disagree with the emitter about what each file costs. It
// is not exact for the section as a whole: the "\n\n" joins and the section
// framing are unmeasured, two bytes per extra file against a 256 KB budget.
function measureUntrackedInlineBytes(cwd: string, untracked: string[]): number {
  let total = 0;
  for (const file of untracked) {
    total += Buffer.byteLength(formatUntrackedFile(cwd, file), "utf8");
  }
  return total;
}

function buildBranchComparison(
  cwd: string,
  baseRef: string,
): { mergeBase: string; commitRange: string } {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  return { mergeBase, commitRange: `${mergeBase}..HEAD` };
}

export function ensureGitRepository(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error?.code === "ENOENT")
    throw new Error("git is not installed. Install Git and retry.");
  if (result.status !== 0) throw new Error("This command must run inside a Git repository.");
  return result.stdout.trim();
}

export function getRepoRoot(cwd: string): string {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

function detectDefaultBranch(cwd: string): string {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const head = symbolic.stdout.trim();
    if (head.startsWith("refs/remotes/")) return head.replace("refs/remotes/", "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0)
      return candidate;
    if (
      git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0
    )
      return `origin/${candidate}`;
  }
  throw new Error(
    "Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.",
  );
}

function getCurrentBranch(cwd: string): string {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

interface WorkingTreeState {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  isDirty: boolean;
}

function getWorkingTreeState(cwd: string): WorkingTreeState {
  const split = (s: string): string[] => s.trim().split("\n").filter(Boolean);
  const staged = split(gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout);
  const unstaged = split(gitChecked(cwd, ["diff", "--name-only"]).stdout);
  const untracked = split(gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

export type ReviewScope = "auto" | "working-tree" | "branch";

export interface ReviewTarget {
  mode: "working-tree" | "branch";
  label: string;
  baseRef?: string;
  explicit: boolean;
}

export interface ResolveTargetOptions {
  scope?: ReviewScope;
  base?: string;
}

export function resolveReviewTarget(cwd: string, options: ResolveTargetOptions = {}): ReviewTarget {
  ensureGitRepository(cwd);
  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const supported = new Set<ReviewScope>(["auto", "working-tree", "branch"]);

  if (baseRef) {
    return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef, explicit: true };
  }
  if (requestedScope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }
  if (!supported.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`,
    );
  }
  if (requestedScope === "branch") {
    const detected = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detected}`,
      baseRef: detected,
      explicit: true,
    };
  }

  const state = getWorkingTreeState(cwd);
  if (state.isDirty) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }
  const detected = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detected}`,
    baseRef: detected,
    explicit: false,
  };
}

function formatSection(title: string, body: string): string {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}

function formatUntrackedFile(cwd: string, relativePath: string): string {
  const absolute = join(cwd, relativePath);
  if (!existsSync(absolute)) return `### ${relativePath}\n(skipped: missing)`;
  let stat: Stats;
  try {
    stat = statSync(absolute);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable)`;
  }
  if (stat.isDirectory()) return `### ${relativePath}\n(skipped: directory)`;
  if (stat.size > MAX_UNTRACKED_BYTES)
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  let buffer: Buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable)`;
  }
  if (!isProbablyText(buffer)) return `### ${relativePath}\n(skipped: binary file)`;
  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

interface CollectedDetails {
  mode: "working-tree" | "branch";
  summary: string;
  content: string;
  changedFiles: string[];
}

function collectWorkingTreeContext(
  cwd: string,
  state: WorkingTreeState,
  includeDiff: boolean,
  truncatedDiffBytes: number,
): CollectedDetails {
  const status = gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
  const changedFiles = listUniqueFiles(state.staged, state.unstaged, state.untracked);

  let parts: string[];
  if (includeDiff) {
    parts = [
      formatSection("Git Status", status),
      formatSection(
        "Staged Diff",
        gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"])
          .stdout,
      ),
      formatSection(
        "Unstaged Diff",
        gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout,
      ),
      // Inline path: include full untracked file bodies (small diffs only).
      formatSection(
        "Untracked Files",
        state.untracked.map((f) => formatUntrackedFile(cwd, f)).join("\n\n"),
      ),
    ];
  } else {
    // Self-collect path: include a truncated text-only diff so deletions and
    // renames remain visible even though the model is expected to read the
    // surviving files directly via the read tool. Use the tolerant variant
    // so a diff larger than the buffer degrades to a placeholder instead of
    // crashing the review.
    const staged = gitDiffTolerant(cwd, ["diff", "--cached", "--no-ext-diff", "--submodule=short"]);
    const unstaged = gitDiffTolerant(cwd, ["diff", "--no-ext-diff", "--submodule=short"]);
    const overflow = staged.overflow || unstaged.overflow;
    const combined = [staged.stdout, unstaged.stdout].filter(Boolean).join("\n");
    const trimmed = truncateUtf8(combined, truncatedDiffBytes);
    let diffBlock = trimmed.truncated
      ? `${trimmed.text}\n\n... (diff truncated; read individual files for the rest)`
      : trimmed.text;
    if (overflow) {
      diffBlock = `(diff exceeded ${SELF_COLLECT_BUFFER_BYTES} bytes; inline omitted — use the read tool on the changed files listed above)\n\n${diffBlock}`;
    }

    parts = [
      formatSection("Git Status", status),
      formatSection(
        "Staged Diff Stat",
        gitChecked(cwd, ["diff", "--shortstat", "--cached"]).stdout.trim(),
      ),
      formatSection("Unstaged Diff Stat", gitChecked(cwd, ["diff", "--shortstat"]).stdout.trim()),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Truncated Diff", diffBlock),
      formatSection("Untracked Files", state.untracked.join("\n")),
    ];
  }

  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n"),
    changedFiles,
  };
}

function collectBranchContext(
  cwd: string,
  baseRef: string,
  comparison: { mergeBase: string; commitRange: string },
  includeDiff: boolean,
  truncatedDiffBytes: number,
): CollectedDetails {
  const currentBranch = getCurrentBranch(cwd);
  const changedFiles = gitChecked(cwd, ["diff", "--name-only", comparison.commitRange])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const log = gitChecked(cwd, [
    "log",
    "--oneline",
    "--decorate",
    comparison.commitRange,
  ]).stdout.trim();
  const stat = gitChecked(cwd, ["diff", "--stat", comparison.commitRange]).stdout.trim();

  let parts: string[];
  if (includeDiff) {
    parts = [
      formatSection("Commit Log", log),
      formatSection("Diff Stat", stat),
      formatSection(
        "Branch Diff",
        gitChecked(cwd, [
          "diff",
          "--binary",
          "--no-ext-diff",
          "--submodule=diff",
          comparison.commitRange,
        ]).stdout,
      ),
    ];
  } else {
    const branchDiff = gitDiffTolerant(cwd, [
      "diff",
      "--no-ext-diff",
      "--submodule=short",
      comparison.commitRange,
    ]);
    const trimmed = truncateUtf8(branchDiff.stdout, truncatedDiffBytes);
    let diffBlock = trimmed.truncated
      ? `${trimmed.text}\n\n... (diff truncated; read individual files for the rest)`
      : trimmed.text;
    if (branchDiff.overflow) {
      diffBlock = `(diff exceeded ${SELF_COLLECT_BUFFER_BYTES} bytes; inline omitted — use the read tool on the changed files listed above)\n\n${diffBlock}`;
    }
    parts = [
      formatSection("Commit Log", log),
      formatSection("Diff Stat", stat),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Truncated Diff", diffBlock),
    ];
  }

  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: parts.join("\n"),
    changedFiles,
  };
}

export interface ReviewContext {
  cwd: string;
  repoRoot: string;
  branch: string;
  target: ReviewTarget;
  mode: "working-tree" | "branch";
  summary: string;
  content: string;
  changedFiles: string[];
  fileCount: number;
  /** Bytes of staged+unstaged (or branch-range) diff. Untracked file bodies are
   *  NOT in any diff and are reported separately in {@link untrackedBytes}. */
  diffBytes: number;
  /**
   * Bytes the inline path would spend on untracked file bodies, which count
   * against the same budget as `diffBytes`. `null` on all four paths where the
   * measurement never ran: a branch target (no untracked concept), an explicit
   * `includeDiff` (skips the decision), a file count already over its cap, and a
   * diff already over the byte cap — the last two short-circuit before anything
   * is read. `null` is therefore "not measured", which a `0` could not say: 0
   * means measured and genuinely empty.
   */
  untrackedBytes: number | null;
  inputMode: "inline-diff" | "self-collect";
  collectionGuidance: string;
}

export interface CollectContextOptions {
  includeDiff?: boolean;
  maxInlineFiles?: number;
  maxInlineDiffBytes?: number;
  /**
   * If true, the consumer can run shell git commands (full self-collect path).
   * If false (review mode), the self-collect guidance must direct the model to
   * read individual files via the read tool instead of shelling out.
   */
  shellAvailable?: boolean;
}

export function collectReviewContext(
  cwd: string,
  target: ReviewTarget,
  options: CollectContextOptions = {},
): ReviewContext {
  const repoRoot = getRepoRoot(cwd);
  const branch = getCurrentBranch(repoRoot);
  // Normalize both caps HERE, at the one place they enter the module — guarding
  // at each use site would be several chances to miss one, and the byte cap's
  // invalid shapes are load-bearing downstream (see normalizeCap, and the
  // non-negative precondition measureCombinedGitOutputBytes now relies on).
  const maxInlineFiles = normalizeCap(options.maxInlineFiles, DEFAULT_INLINE_DIFF_MAX_FILES);
  const maxInlineDiffBytes = normalizeCap(
    options.maxInlineDiffBytes,
    DEFAULT_INLINE_DIFF_MAX_BYTES,
  );

  // One decision site for both arms. They measure different things — a working
  // tree's staged+unstaged diff vs a branch's merge-base range — but answer to
  // one policy, so a copy per arm is one policy that can silently disagree with
  // itself. Both caps and the explicit override are closed over rather than
  // passed, so no arm can apply a different budget or forget the override; the
  // measurements come in by name because they are all numbers and a positional
  // call could be transposed without a type error.
  //
  // `extraBytes` is a THUNK, not a number, and the checks run in order for that
  // reason: on the working-tree arm forcing it stats and reads untracked files
  // off disk, and /review runs against arbitrary repos where an un-gitignored
  // node_modules makes that set enormous. Doing it before the cheap checks have
  // passed would measure a tree that was never going to inline. Once the file
  // count has passed, the untracked set is at most maxInlineFiles files.
  //
  // It returns the measurement rather than writing it to an outer variable: the
  // caller needs the number, and a predicate with a side effect is a worse way
  // to hand it over than a second field.
  const decideInline = (measured: {
    fileCount: number;
    diffBytes: number;
    extraBytes?: () => number;
  }): { inline: boolean; extraBytes: number | null } => {
    if (options.includeDiff !== undefined) {
      return { inline: options.includeDiff, extraBytes: null };
    }
    if (measured.fileCount > maxInlineFiles) return { inline: false, extraBytes: null };
    if (measured.diffBytes > maxInlineDiffBytes) return { inline: false, extraBytes: null };
    if (!measured.extraBytes) return { inline: true, extraBytes: null };
    const extra = measured.extraBytes();
    return { inline: measured.diffBytes + extra <= maxInlineDiffBytes, extraBytes: extra };
  };

  let details: CollectedDetails;
  let includeDiff: boolean;
  let diffBytes: number;
  let untrackedBytes: number | null;

  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"],
        ["diff", "--binary", "--no-ext-diff", "--submodule=diff"],
      ],
      maxInlineDiffBytes,
    );
    const fileCount = listUniqueFiles(state.staged, state.unstaged, state.untracked).length;
    const decision = decideInline({
      fileCount,
      diffBytes,
      extraBytes: () => measureUntrackedInlineBytes(repoRoot, state.untracked),
    });
    includeDiff = decision.inline;
    untrackedBytes = decision.extraBytes;
    details = collectWorkingTreeContext(repoRoot, state, includeDiff, maxInlineDiffBytes);
  } else {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    const comparison = buildBranchComparison(repoRoot, target.baseRef);
    const fileCount = gitChecked(repoRoot, ["diff", "--name-only", comparison.commitRange])
      .stdout.trim()
      .split("\n")
      .filter(Boolean).length;
    diffBytes = measureGitOutputBytes(
      repoRoot,
      ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange],
      maxInlineDiffBytes,
    );
    // No extraBytes: a branch range has no untracked concept, so untrackedBytes
    // stays null — "not applicable", distinct from a measured zero.
    includeDiff = decideInline({ fileCount, diffBytes }).inline;
    untrackedBytes = null;
    details = collectBranchContext(
      repoRoot,
      target.baseRef,
      comparison,
      includeDiff,
      maxInlineDiffBytes,
    );
  }

  const collectionGuidance = includeDiff
    ? "Use the repository context below as primary evidence."
    : options.shellAvailable
      ? "The repository context below is a lightweight summary. Inspect the target diff yourself with read-only git commands before finalizing findings."
      : 'The repository context below is a lightweight summary because the diff is too large to inline. Shell execution is disabled. Use the read tool to open individual changed files listed under "Changed Files" and ground findings in their actual contents before finalizing.';

  return {
    cwd: repoRoot,
    repoRoot,
    branch,
    target,
    mode: details.mode,
    summary: details.summary,
    content: details.content,
    changedFiles: details.changedFiles,
    fileCount: details.changedFiles.length,
    diffBytes,
    untrackedBytes,
    inputMode: includeDiff ? "inline-diff" : "self-collect",
    collectionGuidance,
  };
}

/**
 * fix command — applies a Claude-Code-approved set of review findings to the
 * CURRENT working tree using a write-enabled Codex session.
 *
 * This is stage 3 of the review→fix pipeline:
 *   1. `review --fix`  — the model emits structured findings (read-only).
 *   2. Claude Code     — judges each finding against its conversation context
 *                        (some flagged "issues" are intentional choices only CC
 *                        knows about) and writes the approved subset to a file.
 *   3. `fix`           — THIS command applies the approved findings.
 *
 * fix edits the real working tree (not an isolated worktree). To keep the fix
 * diff reviewable, it isolates the fix's changes from any pre-existing
 * uncommitted work using `git stash create` — an ephemeral snapshot object that
 * touches neither the working tree nor branch history — then leaves the fix
 * edits staged for the user to inspect and commit.
 *
 * The agent lifecycle (auth, run) is delegated to {@link runAgentSession}; fix
 * only supplies the prompt/options and its single JSON-envelope stdout
 * contract. Best-effort: findings the model could not apply are reported under
 * `skipped` rather than failing the whole run. Defaults to a capable model
 * (gpt-5.6-sol) rather than leaving it to `~/.codex/config.toml` — applying
 * vetted findings is a judgment task, same principle as the implementer/fixer
 * model routing in HARRY.md §5.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractJsonBlock, type Finding, normalizeFindings } from "../lib/findings.ts";
import { ensureGitRepository } from "../lib/git.ts";
import type { ReasoningEffort, RunResult } from "../lib/provider.ts";
import { runAgentSession } from "../lib/run-agent-session.ts";
import { appendLog, generateJobId, jobLogPath, resolveStateDir } from "../lib/state.ts";
import { buildSystemMessage, resolveExtraContext } from "../lib/system-message.ts";
import { makeProgress, startTurnTimeout } from "../lib/turn-runtime.ts";

export interface FixOptions {
  /** Path to the approved-findings JSON (array, or a {findings:[...]} object). */
  findingsPath?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  allowShell?: boolean;
  allowUrl?: boolean;
  writePath?: string;
  /**
   * Extra context appended to the model's system message. Literal text, or
   * `@file` / `@-` (stdin) to read from a source — see `resolveExtraContext`.
   */
  context?: string;
  jobId?: string;
}

// Capable-by-default model: applying vetted findings is a judgment task, same
// principle as the implementer/fixer model routing in HARRY.md §5 — don't let
// it silently inherit whatever ~/.codex/config.toml happens to default to.
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_EFFORT: ReasoningEffort = "high";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function tryGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
  };
}

function gitHead(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

interface FixedEnvelope {
  status: "fixed";
  jobId: string;
  summary: string;
  /** HEAD the fix was applied on top of; the fix diff is reported against this
   * (or an ephemeral `git stash create` snapshot when the tree was dirty). */
  baselineCommit: string;
  /** Whether the working tree was dirty pre-fix — isolated via `git stash
   * create`, i.e. no commit was made. */
  preFixDirty: boolean;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  /** Finding ids the model reported as applied. */
  applied: string[];
  /** Findings the model could not apply, with reasons. */
  skipped: Array<{ id: string; reason: string }>;
  model: string;
}

interface FailedEnvelope {
  status: "failed";
  jobId: string;
  error: string;
  // Report the baseline the fix would have been isolated against, so a run that
  // failed after beforeRun computed it is still traceable. No commit is ever
  // made (isolation is via `git stash create`), so there is no surprise commit
  // to disclose — unlike the prior snapshot-commit design.
  preFixDirty?: boolean;
  baselineCommit?: string;
}

type Envelope = FixedEnvelope | FailedEnvelope;

function emit(env: Envelope): string {
  const json = JSON.stringify(env);
  process.stdout.write(`${json}\n`);
  return json;
}

function loadFindings(path: string): Finding[] {
  const raw = readFileSync(path, "utf-8");
  return normalizeFindings(JSON.parse(raw));
}

function buildFixPrompt(findings: Finding[]): string {
  const blocks = findings
    .map((f, i) => {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      return [
        `### Finding ${i + 1} — id: ${f.id} (${f.severity})`,
        `Location: ${loc}`,
        `Issue: ${f.title}`,
        f.rationale ? `Why: ${f.rationale}` : "",
        f.suggestedFix ? `Suggested fix: ${f.suggestedFix}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    "Apply the following code-review fixes to this repository. Each finding has",
    "already been vetted by a human reviewer — implement the fix for each one.",
    "",
    "Guidelines:",
    "- Make the minimal, correct change for each finding. Do not refactor unrelated code.",
    "- If a finding cannot be safely applied (already fixed, no longer applies, or",
    "  the suggested fix would break something), skip it and explain why.",
    "- Do not commit; just edit the files.",
    "",
    "FINDINGS TO FIX:",
    "",
    blocks,
    "",
    "When done, output ONE fenced ```json block reporting what you did:",
    "```json",
    '{ "applied": ["finding-id", ...], "skipped": [{ "id": "finding-id", "reason": "..." }] }',
    "```",
  ].join("\n");
}

interface ApplyReport {
  applied: string[];
  skipped: Array<{ id: string; reason: string }>;
}

function parseApplyReport(text: string, findings: Finding[]): ApplyReport {
  const parsed = extractJsonBlock(text);
  const ids = new Set(findings.map((f) => f.id));
  const applied: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  if (parsed && typeof parsed === "object") {
    const p = parsed as { applied?: unknown; skipped?: unknown };
    if (Array.isArray(p.applied)) {
      for (const a of p.applied) if (typeof a === "string" && ids.has(a)) applied.push(a);
    }
    if (Array.isArray(p.skipped)) {
      for (const s of p.skipped) {
        if (s && typeof s === "object") {
          const id = (s as { id?: unknown }).id;
          const reason = (s as { reason?: unknown }).reason;
          if (typeof id === "string")
            skipped.push({ id, reason: typeof reason === "string" ? reason : "no reason given" });
        }
      }
    }
  }
  // Anything neither applied nor skipped is treated as not-reported (skipped).
  const accounted = new Set([...applied, ...skipped.map((s) => s.id)]);
  for (const f of findings) {
    if (!accounted.has(f.id)) skipped.push({ id: f.id, reason: "not reported by the model" });
  }
  return { applied, skipped };
}

function computeStagedDiff(
  cwd: string,
  baseline: string,
): { filesModified: string[]; linesAdded: number; linesRemoved: number } {
  // Stage everything so untracked fix files are counted, then diff the index
  // against the baseline commit. Leaves the fix changes staged for the user.
  tryGit(["add", "-A"], cwd);
  const names = tryGit(["diff", "--cached", "--name-only", baseline], cwd);
  const filesModified = names.ok && names.stdout ? names.stdout.split("\n").filter(Boolean) : [];
  let linesAdded = 0;
  let linesRemoved = 0;
  const numstat = tryGit(["diff", "--cached", "--numstat", baseline], cwd);
  if (numstat.ok && numstat.stdout) {
    for (const line of numstat.stdout.split("\n")) {
      const [addStr, delStr] = line.split("\t");
      const add = Number.parseInt(addStr ?? "0", 10);
      const del = Number.parseInt(delStr ?? "0", 10);
      if (Number.isFinite(add)) linesAdded += add;
      if (Number.isFinite(del)) linesRemoved += del;
    }
  }
  return { filesModified, linesAdded, linesRemoved };
}

export async function runFix(cwd: string, options: FixOptions = {}): Promise<void> {
  const progress = makeProgress();
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const requestedModel = options.model ?? DEFAULT_MODEL;
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);

  // 1. Load + validate findings ----------------------------------------------
  if (!options.findingsPath) {
    emit({
      status: "failed",
      jobId,
      error: "Missing --findings <path>; provide the approved findings JSON.",
    });
    process.exit(1);
  }
  const findingsAbs = resolve(cwd, options.findingsPath);
  let findings: Finding[];
  try {
    findings = loadFindings(findingsAbs);
  } catch (err) {
    emit({
      status: "failed",
      jobId,
      error: `Could not read findings file ${findingsAbs}: ${(err as Error).message}`,
    });
    process.exit(1);
  }
  if (findings.length === 0) {
    emit({ status: "failed", jobId, error: "No findings to fix (empty list after parsing)." });
    process.exit(1);
  }
  log(`fix start: model=${requestedModel} findings=${findings.length} source=${findingsAbs}`);

  // 2. Repo --------------------------------------------------------------------
  let repoRoot: string;
  try {
    repoRoot = ensureGitRepository(cwd);
  } catch (err) {
    emit({ status: "failed", jobId, error: `Not a git repository: ${(err as Error).message}` });
    process.exit(1);
  }

  // The pre-fix snapshot is deferred to the `beforeRun` hook below so it runs
  // ONLY after precheckRun passes. `git stash create` never mutates git history,
  // so this is doubly safe. These outer vars are filled by that hook and read by
  // the envelope. `diffBase` is the ref the fix diff is computed against.
  let preFixDirty = false;
  let baselineCommit = "";
  let diffBase = "";
  // Facts to attach to a `failed` envelope, so a run that fails AFTER beforeRun
  // computed the baseline still reports it.
  const snapshotInfo = (): Pick<FailedEnvelope, "preFixDirty" | "baselineCommit"> =>
    baselineCommit ? { baselineCommit, ...(preFixDirty ? { preFixDirty } : {}) } : {};

  // 3. Timeout → abort signal. -----------------------------------------------
  const turn = startTurnTimeout({ timeoutMs, progress, log });

  // Single-envelope guard: a late interrupt must not emit a second stdout line
  // once the terminal envelope has been written. The actual SIGINT/SIGTERM
  // handling (force-stop the live session, then exit 130) is owned by
  // runAgentSession's centralized handler; we only supply `onInterrupt` below to
  // flush this command's terminal `failed` envelope before that exit.
  let envelopeDone = false;
  const onInterrupt = (): void => {
    if (envelopeDone) return;
    envelopeDone = true;
    turn.clear();
    progress("Received interrupt signal; aborting fix session.");
    emit({ status: "failed", jobId, error: "Interrupted by signal" });
  };

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => {
      progress(m);
      log(m);
    },
  });

  // 4. Run the agent session (write-enabled, real working tree). -------------
  progress(`Applying ${findings.length} approved fix(es) (model=${requestedModel})…`);
  let result: RunResult;
  try {
    ({ result } = await runAgentSession({
      cwd: repoRoot,
      run: {
        cwd: repoRoot,
        prompt: buildFixPrompt(findings),
        model: requestedModel,
        reasoning,
        readOnly: false,
        allowShell: options.allowShell ?? false,
        allowUrl: options.allowUrl ?? false,
        systemMessage: buildSystemMessage("fix", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal,
      },
      onInterrupt,
      // Post-precheck / pre-run: snapshot pre-existing changes so the fix diff
      // is isolated. Runs ONLY after precheckRun passes. Uses `git stash create`
      // — an ephemeral snapshot object — so NOTHING (working tree, index, branch
      // history, stash ref) is mutated, unlike the prior baseline-commit design.
      beforeRun: () => {
        baselineCommit = gitHead(repoRoot);
        // fix diffs the applied changes against a baseline; with no commit to
        // diff against (unborn HEAD) the diff would silently report nothing.
        if (!baselineCommit) {
          envelopeDone = true;
          turn.clear();
          emit({
            status: "failed",
            jobId,
            error:
              "fix requires at least one commit to diff against (repository has no commits yet).",
          });
          process.exit(1);
        }

        const dirty = tryGit(["status", "--porcelain"], repoRoot);
        preFixDirty = dirty.ok && dirty.stdout.trim().length > 0;
        if (preFixDirty) {
          // Capture the pre-fix tracked state as an ephemeral commit object
          // WITHOUT removing it from the working tree, then diff the fix against
          // it so the user's pre-existing WIP is excluded from the reported diff.
          const snap = tryGit(["stash", "create"], repoRoot);
          // `git stash create` prints nothing when there is nothing to stash
          // (e.g. only untracked changes) — fall back to HEAD then.
          // DEBT: pre-existing UNTRACKED files are not captured by stash-create,
          // so if the tree had untracked files pre-fix, `git add -A` in
          // computeStagedDiff attributes them to the fix in the reported stats.
          // Stats-only imprecision, never a history mutation; refine with a
          // temp-index snapshot if it ever matters.
          diffBase = snap.ok && snap.stdout.trim() ? snap.stdout.trim() : baselineCommit;
          progress("Isolating the fix diff from your uncommitted changes (no commit made).");
          log(
            `pre-fix dirty; diff base = ${diffBase === baselineCommit ? "HEAD" : "stash-create snapshot"}`,
          );
        } else {
          diffBase = baselineCommit;
        }
      },
      log,
    }));
  } catch (err) {
    turn.clear();
    if (!envelopeDone) {
      envelopeDone = true;
      emit({ status: "failed", jobId, error: (err as Error).message, ...snapshotInfo() });
    }
    process.exit(1);
  }
  turn.clear();

  const success = result.success && !turn.timedOut();
  if (!success) {
    if (!envelopeDone) {
      envelopeDone = true;
      emit({
        status: "failed",
        jobId,
        error: turn.timedOut()
          ? `Timed out after ${timeoutMs}ms`
          : "Fix session did not complete successfully.",
        ...snapshotInfo(),
      });
    }
    // Non-zero: a timed-out / incomplete fix is a failure. Every other failure
    // path in this command exits 1; a shell/orchestrator caller keying on the
    // exit code must not read a failed fix as success.
    process.exit(1);
  }

  // Past the point of no return: claim the single-envelope slot so a late
  // SIGINT/SIGTERM during teardown cannot emit a second (failed) stdout line.
  envelopeDone = true;

  // 5. Diff stats + apply report ---------------------------------------------
  const report = parseApplyReport(result.lastAssistantMessage, findings);
  const diff = computeStagedDiff(repoRoot, diffBase);

  const summary =
    result.summary?.trim() ||
    `Applied ${report.applied.length}/${findings.length} finding(s); ${report.skipped.length} skipped.`;

  const envelope: FixedEnvelope = {
    status: "fixed",
    jobId,
    summary,
    baselineCommit,
    preFixDirty,
    filesModified: diff.filesModified,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
    applied: report.applied,
    skipped: report.skipped,
    model: requestedModel,
  };

  const envelopeJson = emit(envelope);
  if (options.writePath) {
    const outPath = resolve(cwd, options.writePath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${envelopeJson}\n`, "utf-8");
    progress(`Report saved to ${outPath}`);
  }

  progress(
    `Fix done — applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length} (+${diff.linesAdded}/-${diff.linesRemoved})`,
  );
  log(
    `fix done: applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length}`,
  );
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

/**
 * fix command — applies a Claude-Code-approved set of review findings to the
 * CURRENT working tree using a write-enabled agent session (Copilot or Codex).
 *
 * This is stage 3 of the review→fix pipeline:
 *   1. `review --fix`  — the model emits structured findings (read-only).
 *   2. Claude Code     — judges each finding against its conversation context
 *                        (some flagged "issues" are intentional choices only CC
 *                        knows about) and writes the approved subset to a file.
 *   3. `fix`           — THIS command applies the approved findings.
 *
 * Unlike `implement`, fix edits the real working tree (not an isolated
 * worktree). To keep the fix diff reviewable, it first commits any pre-existing
 * uncommitted changes as a baseline snapshot, then leaves the fix edits staged
 * for the user to inspect and commit.
 *
 * The agent lifecycle (provider resolution, auth, run) is delegated to
 * {@link runAgentSession}; fix only supplies the prompt/options, the
 * copilot-only quota gate, the provider-aware default model, and its single
 * JSON-envelope stdout contract. Best-effort: findings the model could not apply
 * are reported under `skipped` rather than failing the whole run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { ReasoningEffort } from '../lib/provider.ts';
import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, summarize, isPremiumModel } from '../lib/quota.js';
import { resolveRepoRoot } from '../lib/worktree.js';
import { extractJsonBlock, normalizeFindings, type Finding } from '../lib/findings.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import { runAgentSession } from '../lib/run-agent-session.ts';
import { makeProgress, startTurnTimeout } from '../lib/turn-runtime.ts';
import type { ProviderId } from '../lib/provider.ts';

export interface FixOptions {
  /** Path to the approved-findings JSON (array, or a {findings:[...]} object). */
  findingsPath?: string;
  provider?: ProviderId;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  minQuota?: number;
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

const DEFAULT_MODEL = 'claude-opus-4.8';
const DEFAULT_EFFORT: ReasoningEffort = 'high';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function tryGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { ok: res.status === 0, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
}

function gitHead(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

interface FixedEnvelope {
  status: 'fixed';
  jobId: string;
  summary: string;
  /** Baseline commit fixes were applied on top of (after pre-fix snapshot). */
  baselineCommit: string;
  /** Whether a pre-fix snapshot commit was created for pre-existing changes. */
  preFixSnapshot: boolean;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  /** Finding ids the model reported as applied. */
  applied: string[];
  /** Findings the model could not apply, with reasons. */
  skipped: Array<{ id: string; reason: string }>;
  premiumRequestCost: number;
  model: string;
  quotaRemaining?: ReturnType<typeof summarize>;
}

interface FailedEnvelope {
  status: 'failed';
  jobId: string;
  error: string;
  // beforeRun may have already committed the user's uncommitted work as a
  // baseline before the run failed — report it so they are not surprised by a
  // `pre-fix snapshot` commit with no machine-readable signal it happened.
  preFixSnapshot?: boolean;
  baselineCommit?: string;
}

interface BlockedEnvelope {
  status: 'blocked';
  reason: string;
  resetAt?: string;
  remaining?: number;
  message: string;
}

type Envelope = FixedEnvelope | FailedEnvelope | BlockedEnvelope;

function emit(env: Envelope): string {
  const json = JSON.stringify(env);
  process.stdout.write(json + '\n');
  return json;
}

function loadFindings(path: string): Finding[] {
  const raw = readFileSync(path, 'utf-8');
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
        f.rationale ? `Why: ${f.rationale}` : '',
        f.suggestedFix ? `Suggested fix: ${f.suggestedFix}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  return [
    'Apply the following code-review fixes to this repository. Each finding has',
    'already been vetted by a human reviewer — implement the fix for each one.',
    '',
    'Guidelines:',
    '- Make the minimal, correct change for each finding. Do not refactor unrelated code.',
    '- If a finding cannot be safely applied (already fixed, no longer applies, or',
    '  the suggested fix would break something), skip it and explain why.',
    '- Do not commit; just edit the files.',
    '',
    'FINDINGS TO FIX:',
    '',
    blocks,
    '',
    'When done, output ONE fenced ```json block reporting what you did:',
    '```json',
    '{ "applied": ["finding-id", ...], "skipped": [{ "id": "finding-id", "reason": "..." }] }',
    '```',
  ].join('\n');
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
  if (parsed && typeof parsed === 'object') {
    const p = parsed as { applied?: unknown; skipped?: unknown };
    if (Array.isArray(p.applied)) {
      for (const a of p.applied) if (typeof a === 'string' && ids.has(a)) applied.push(a);
    }
    if (Array.isArray(p.skipped)) {
      for (const s of p.skipped) {
        if (s && typeof s === 'object') {
          const id = (s as { id?: unknown }).id;
          const reason = (s as { reason?: unknown }).reason;
          if (typeof id === 'string') skipped.push({ id, reason: typeof reason === 'string' ? reason : 'no reason given' });
        }
      }
    }
  }
  // Anything neither applied nor skipped is treated as not-reported (skipped).
  const accounted = new Set([...applied, ...skipped.map((s) => s.id)]);
  for (const f of findings) {
    if (!accounted.has(f.id)) skipped.push({ id: f.id, reason: 'not reported by the model' });
  }
  return { applied, skipped };
}

function computeStagedDiff(cwd: string, baseline: string): { filesModified: string[]; linesAdded: number; linesRemoved: number } {
  // Stage everything so untracked fix files are counted, then diff the index
  // against the baseline commit. Leaves the fix changes staged for the user.
  tryGit(['add', '-A'], cwd);
  const names = tryGit(['diff', '--cached', '--name-only', baseline], cwd);
  const filesModified = names.ok && names.stdout ? names.stdout.split('\n').filter(Boolean) : [];
  let linesAdded = 0;
  let linesRemoved = 0;
  const numstat = tryGit(['diff', '--cached', '--numstat', baseline], cwd);
  if (numstat.ok && numstat.stdout) {
    for (const line of numstat.stdout.split('\n')) {
      const [addStr, delStr] = line.split('\t');
      const add = Number.parseInt(addStr ?? '0', 10);
      const del = Number.parseInt(delStr ?? '0', 10);
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
  const minQuota = options.minQuota ?? 1;
  // The model copilot WOULD use (for the copilot-only quota pre-gate and the
  // envelope metadata). The actual model is filled per-provider by
  // runAgentSession's defaultModelFor.
  const copilotModel = options.model ?? DEFAULT_MODEL;
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);

  // 1. Load + validate findings ----------------------------------------------
  if (!options.findingsPath) {
    emit({ status: 'failed', jobId, error: 'Missing --findings <path>; provide the approved findings JSON.' });
    process.exit(1);
  }
  const findingsAbs = resolve(cwd, options.findingsPath);
  let findings: Finding[];
  try {
    findings = loadFindings(findingsAbs);
  } catch (err) {
    emit({ status: 'failed', jobId, error: `Could not read findings file ${findingsAbs}: ${(err as Error).message}` });
    process.exit(1);
  }
  if (findings.length === 0) {
    emit({ status: 'failed', jobId, error: 'No findings to fix (empty list after parsing).' });
    process.exit(1);
  }
  log(`fix start: model=${copilotModel} findings=${findings.length} source=${findingsAbs}`);

  // 2. Repo --------------------------------------------------------------------
  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot(cwd);
  } catch (err) {
    emit({ status: 'failed', jobId, error: `Not a git repository: ${(err as Error).message}` });
    process.exit(1);
  }

  // The pre-fix snapshot is deferred to the `beforeRun` hook below so it runs
  // ONLY after the quota gate passes — a blocked copilot fix must mutate NO git
  // history. These outer vars are filled by that hook and read by the envelope.
  let preFixSnapshot = false;
  let baselineCommit = '';
  // Snapshot facts to attach to a `failed` envelope, so a run that fails AFTER
  // beforeRun committed the baseline still reports that commit.
  const snapshotInfo = (): Pick<FailedEnvelope, 'preFixSnapshot' | 'baselineCommit'> =>
    preFixSnapshot ? { preFixSnapshot, ...(baselineCommit ? { baselineCommit } : {}) } : {};

  // 3. Timeout → abort signal. -----------------------------------------------
  const turn = startTurnTimeout({ timeoutMs, progress, log });

  // Single-envelope guard: a late interrupt must not emit a second stdout line
  // once the terminal envelope has been written. The actual SIGINT/SIGTERM
  // handling (force-stop the live provider subprocess, then exit 130) is owned by
  // runAgentSession's centralized handler; we only supply `onInterrupt` below to
  // flush this command's terminal `failed` envelope before that exit.
  let envelopeDone = false;
  const onInterrupt = (): void => {
    if (envelopeDone) return;
    envelopeDone = true;
    turn.clear();
    progress('Received interrupt signal; aborting fix session.');
    emit({ status: 'failed', jobId, error: 'Interrupted by signal' });
  };

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  // 4. Run the agent session (write-enabled, real working tree). -------------
  progress(`Applying ${findings.length} approved fix(es) (model=${copilotModel})…`);
  let provider: ProviderId;
  let result;
  try {
    ({ provider, result } = await runAgentSession({
      cwd: repoRoot,
      flags: { provider: options.provider },
      run: {
        cwd: repoRoot,
        prompt: buildFixPrompt(findings),
        model: options.model, // undefined → defaultModelFor fills it per provider
        reasoning,
        readOnly: false,
        allowShell: options.allowShell ?? false,
        allowUrl: options.allowUrl ?? false,
        systemMessage: buildSystemMessage('fix', { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal,
      },
      onInterrupt,
      defaultModelFor: (id) => (id === 'copilot' ? DEFAULT_MODEL : undefined),
      enforceQuota: () => {
        // Copilot-only gate (runAgentSession invokes this only when the provider
        // meters quota). Block early so the user is told to apply fixes directly
        // rather than burning the run. Standard-tier models don't consume the
        // premium pool, so skip the gate for them.
        if (!isPremiumModel(copilotModel)) {
          log(`quota gate skipped: model ${copilotModel} is not premium-metered`);
          return;
        }
        const gate = evaluateGate(readSnapshot(stateDir), { minRemaining: minQuota });
        if (!gate.ok) {
          log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
          envelopeDone = true;
          turn.clear();
          emit({
            status: 'blocked',
            reason: gate.reason,
            resetAt: gate.resetAt,
            remaining: gate.remaining,
            message: `Copilot quota exhausted; apply these fixes directly. Resets at ${gate.resetAt || 'unknown'}.`,
          });
          process.exit(0);
        }
        if ('warning' in gate && gate.warning) progress(gate.warning);
      },
      // Post-gate / pre-run: snapshot pre-existing changes so the fix diff is
      // isolated. Runs ONLY after the quota gate passes, so a blocked copilot
      // fix leaves git history untouched.
      beforeRun: () => {
        // Commit any pre-existing uncommitted changes so the fix diff is isolated.
        const dirty = tryGit(['status', '--porcelain'], repoRoot);
        if (dirty.ok && dirty.stdout.trim()) {
          tryGit(['add', '-A'], repoRoot);
          const c = tryGit(['commit', '-m', 'chore: pre-fix snapshot (copilot fix baseline)'], repoRoot);
          preFixSnapshot = c.ok;
          if (c.ok) {
            progress('Committed pre-existing changes as a baseline snapshot before applying fixes.');
            log('pre-fix snapshot commit created');
          } else {
            log(`pre-fix snapshot commit failed: ${c.stderr}`);
          }
        }
        // If the tree was dirty but the snapshot commit failed, the baseline is
        // contaminated — proceeding would mix the user's pre-existing changes
        // into the reported fix diff. Abort instead.
        if (dirty.ok && dirty.stdout.trim() && !preFixSnapshot) {
          envelopeDone = true;
          turn.clear();
          emit({
            status: 'failed',
            jobId,
            error: 'Could not snapshot your uncommitted changes (git commit failed); aborting so the fix diff is not mixed with pre-existing work. Commit or stash manually, then retry.',
          });
          process.exit(1);
        }

        baselineCommit = gitHead(repoRoot);
        // fix diffs the applied changes against this baseline; with no commit to
        // diff against (unborn HEAD) the diff would silently report nothing.
        if (!baselineCommit) {
          envelopeDone = true;
          turn.clear();
          emit({ status: 'failed', jobId, error: 'fix requires at least one commit to diff against (repository has no commits yet).', ...snapshotInfo() });
          process.exit(1);
        }
      },
      log,
    }));
  } catch (err) {
    turn.clear();
    if (!envelopeDone) {
      envelopeDone = true;
      emit({ status: 'failed', jobId, error: (err as Error).message, ...snapshotInfo() });
    }
    process.exit(1);
  }
  turn.clear();

  const success = result.success && !turn.timedOut();
  if (!success) {
    if (!envelopeDone) {
      envelopeDone = true;
      emit({ status: 'failed', jobId, error: turn.timedOut() ? `Timed out after ${timeoutMs}ms` : 'Fix session did not complete successfully.', ...snapshotInfo() });
    }
    process.exit(0);
  }

  // Past the point of no return: claim the single-envelope slot so a late
  // SIGINT/SIGTERM during teardown cannot emit a second (failed) stdout line.
  envelopeDone = true;

  // 5. Diff stats + apply report ---------------------------------------------
  const report = parseApplyReport(result.lastAssistantMessage, findings);
  const diff = computeStagedDiff(repoRoot, baselineCommit);

  const summary =
    (result.summary && result.summary.trim()) ||
    `Applied ${report.applied.length}/${findings.length} finding(s); ${report.skipped.length} skipped.`;

  const premium = result.usage?.kind === 'copilot' ? result.usage.premiumRequestCost ?? 0 : 0;
  // copilot ran the model it was asked for; codex decides via config, so report
  // the requested model or a neutral 'codex' label.
  const usedModel = provider === 'copilot' ? copilotModel : options.model ?? 'codex';

  const envelope: FixedEnvelope = {
    status: 'fixed',
    jobId,
    summary,
    baselineCommit,
    preFixSnapshot,
    filesModified: diff.filesModified,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
    applied: report.applied,
    skipped: report.skipped,
    premiumRequestCost: premium,
    model: usedModel,
    quotaRemaining: summarize(readSnapshot(stateDir)),
  };

  const envelopeJson = emit(envelope);
  if (options.writePath) {
    const outPath = resolve(cwd, options.writePath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, envelopeJson + '\n', 'utf-8');
    progress(`Report saved to ${outPath}`);
  }

  progress(
    `Fix done — provider=${provider} applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length} (+${diff.linesAdded}/-${diff.linesRemoved})`,
  );
  log(`fix done: provider=${provider} applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length}`);
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

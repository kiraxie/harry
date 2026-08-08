/**
 * ask command — sends an arbitrary prompt to Codex and prints the assistant's
 * markdown verbatim. Read-only: no worktree, no file writes, no shell. The
 * reasoning backend for the `/harry:debate` skill's gpt voice, and a generic
 * single-prompt query command.
 *
 * The whole agent lifecycle (auth, run) is delegated to {@link runAgentSession};
 * `ask` only supplies the prompt/options and the stdout contract (the verbatim
 * model answer, which `/debate` depends on). Defaults to a capable model
 * (gpt-5.6-luna) rather than leaving it to `~/.codex/config.toml` — same
 * principle as `fix`'s model default (HARRY.md §5).
 */

import { MODEL_JUDGMENT } from "../lib/models.ts";
import type { ReasoningEffort, RunResult } from "../lib/provider.ts";
import { runAgentSession } from "../lib/run-agent-session.ts";
import { appendLog, generateJobId, jobLogPath, resolveStateDir } from "../lib/state.ts";
import { buildSystemMessage, resolveExtraContext } from "../lib/system-message.ts";
import {
  formatCodexUsage,
  makeProgress,
  startTurnTimeout,
  withCause,
} from "../lib/turn-runtime.ts";

export interface AskOptions {
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  context?: string;
}

// Model policy (which id, and why it is reachable at all) lives in ../lib/models.ts.
const DEFAULT_MODEL = MODEL_JUDGMENT;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_EFFORT: ReasoningEffort = "high";

export async function runAsk(cwd: string, options: AskOptions): Promise<void> {
  const progress = makeProgress();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const requestedModel = options.model ?? DEFAULT_MODEL;

  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");

  const stateDir = resolveStateDir(cwd);
  const jobId = generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(`ask start: model=${requestedModel} effort=${reasoning} promptChars=${prompt.length}`);

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => {
      progress(m);
      log(m);
    },
  });

  const turn = startTurnTimeout({ timeoutMs, progress, log });

  let result: RunResult;
  try {
    ({ result } = await runAgentSession({
      cwd,
      run: {
        cwd,
        prompt,
        model: requestedModel,
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage("ask", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal,
      },
      log,
    }));
  } catch (err) {
    turn.clear();
    const msg = (err as Error).message;
    process.stderr.write(`Ask failed: ${msg}\n`);
    log(`ask failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    turn.clear();
  }

  const body =
    result.lastAssistantMessage?.trim() ||
    result.summary?.trim() ||
    "_(The model returned an empty answer.)_";

  const success = result.success && !turn.timedOut();
  if (!success) {
    const reason = turn.timedOut()
      ? `Timed out after ${timeoutMs}ms.`
      : withCause("Ask did not complete successfully.", result.error);
    process.stderr.write(`Ask failed: ${reason}\n`);
    // The body may be a PARTIAL answer that reads as a finished one. `ask`'s
    // doors tell consumers to return this stdout verbatim (and /debate folds it
    // into a synthesis), so the failure has to be legible in the stdout itself —
    // a bare body would be presented as the model's real answer.
    process.stdout.write(`# Ask Failed\n\n${reason}\n\n${body}\n`);
    log(`ask failed: ${reason}`);
    // Signal failure to the caller via a non-zero shell exit code. Whatever came
    // back is already on stdout above — a genuinely partial answer on the
    // incomplete-turn path, but only the empty-answer placeholder on the timeout
    // path, where codex/turn.ts's `failure()` returns an empty finalMessage and
    // so discards the partial text. `review` behaves identically.
    throw new Error(reason);
  }

  process.stdout.write(`${body.trim()}\n`);

  if (result.usage) {
    progress(`Ask done — effort=${reasoning} ${formatCodexUsage(result.usage)}`);
    log(
      `ask done: inputTokens=${result.usage.inputTokens ?? "?"} outputTokens=${result.usage.outputTokens ?? "?"}`,
    );
  } else {
    progress(`Ask done — effort=${reasoning}`);
    log("ask done");
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

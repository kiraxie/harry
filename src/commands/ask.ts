/**
 * ask command — sends an arbitrary prompt to Codex and prints the assistant's
 * markdown verbatim. Read-only: no worktree, no file writes, no shell. The
 * reasoning backend for the `/harry:debate` skill's gpt voice, and a generic
 * single-prompt query command.
 *
 * The whole agent lifecycle (auth, run) is delegated to {@link runAgentSession};
 * `ask` only supplies the prompt/options and the stdout contract (the verbatim
 * model answer, which `/debate` depends on). Defaults to a capable model
 * (gpt-5.6-sol) rather than leaving it to `~/.codex/config.toml` — same
 * principle as `fix`'s model default (HARRY.md §5).
 */

import type { ReasoningEffort, RunResult } from "../lib/provider.ts";
import { runAgentSession } from "../lib/run-agent-session.ts";
import { appendLog, generateJobId, jobLogPath, resolveStateDir } from "../lib/state.ts";
import { buildSystemMessage, resolveExtraContext } from "../lib/system-message.ts";
import { formatCodexUsage, makeProgress, startTurnTimeout } from "../lib/turn-runtime.ts";

export interface AskOptions {
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  context?: string;
  jobId?: string;
}

const DEFAULT_MODEL = "gpt-5.6-sol";
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
  const jobId = options.jobId ?? generateJobId();
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
      : "Ask did not complete successfully.";
    process.stdout.write(`${body}\n`);
    log(`ask failed: ${reason}`);
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

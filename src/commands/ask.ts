/**
 * ask command — a thin wrapper over the Codex CLI's `codex exec`: one prompt,
 * read-only, and the answer printed verbatim. The reasoning backend for the
 * `/harry:debate` skill's gpt voice, and a generic single-prompt query command.
 *
 * Runs `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> -`
 * in the invoking cwd with the prompt on stdin. The answer and codex's
 * transcript log land under the plugin state dir (`asks/`), never in a `.local/`.
 *
 * The stdout contract `/debate` depends on: success prints the answer file
 * verbatim; ANY failure prints `# Ask Failed`, a blank line and one reason line,
 * and exits non-zero — a consumer relaying stdout verbatim must never be able
 * to pass a failure off as an answer.
 */

import { join } from "node:path";
import { resolveExtraContext } from "../lib/context.ts";
import {
  CodexRunError,
  lastErrorLine,
  type ReasoningEffort,
  runCodexExec,
} from "../lib/run-codex.ts";
import { pruneRunFiles, reserveRunFiles } from "../lib/run-files.ts";
import { ensureDir, resolveStateDir } from "../lib/state.ts";

export interface AskOptions {
  prompt: string;
  reasoning?: ReasoningEffort;
  /** Background for the model: literal text, or `@file` / `@-` — see `resolveExtraContext`. */
  context?: string;
}

const ASK_FAILED_MARKER = "# Ask Failed";

/** The run-file prefix under `asks/`: `ask-<YYYYMMDD-HHMMSS>[-N].md` and `.log`. */
const ASK_PREFIX = "ask";

/** How long an ask's answer and log are kept before a later ask prunes them. */
const ASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Opens every ask prompt. `codex exec` is an agentic coding harness running in
 * the user's cwd, so without this the model treats a question as a task and
 * wanders the repo; `/debate` needs one independent voice answering from what it
 * was given.
 */
export const ASK_PREAMBLE = [
  "You are one independent voice being consulted on a question.",
  "Answer from this prompt and any Background given below.",
  "Do not explore the working directory or run commands unless the prompt explicitly asks about files in it.",
  "Be concrete and decisive; state your key assumptions and the strongest counter-argument to your own position.",
].join(" ");

function buildAskPrompt(prompt: string, context: string | undefined): string {
  if (!context) return `${ASK_PREAMBLE}\n\n${prompt}\n`;
  return `${ASK_PREAMBLE}\n\n## Background (settled facts from the working session)\n\n${context}\n\n## Prompt\n\n${prompt}\n`;
}

/** The one-line reason a failed ask reports on stdout. */
function failureReason(err: unknown): string {
  const reason =
    err instanceof CodexRunError && err.kind === "exit" && err.logPath
      ? (lastErrorLine(err.logPath) ?? err.message.replace(/\.$/, ""))
      : err instanceof Error
        ? err.message
        : String(err);
  // One line, always: the stdout contract is marker, blank line, reason.
  return reason.replace(/\s+/g, " ").trim();
}

async function ask(cwd: string, options: AskOptions): Promise<void> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");

  // Strict: a model silently missing its facts would answer a different question.
  const context = resolveExtraContext(cwd, options.context);

  // Every run leaves an answer .md and a transcript .log (up to ~1 MB); runs
  // older than a week are pruned first so asks/ does not grow without bound.
  const dir = join(resolveStateDir(cwd), "asks");
  ensureDir(dir);
  pruneRunFiles(dir, ASK_PREFIX, ASK_RETENTION_MS);
  const { outputPath, logPath } = reserveRunFiles(dir, ASK_PREFIX);

  const args = [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "-o",
    outputPath,
  ];
  if (options.reasoning) args.push("-c", `model_reasoning_effort="${options.reasoning}"`);
  args.push("-");

  const answer = await runCodexExec({
    args,
    cwd,
    input: buildAskPrompt(prompt, context),
    outputPath,
    logPath,
    label: "codex exec",
    outputNoun: "answer",
  });
  process.stdout.write(answer);
  process.stderr.write(`Log: ${logPath}\n`);
}

/**
 * Reports its own failures and sets a non-zero exit instead of throwing, so the
 * reason reaches stderr once. `Fatal error:` (companion's top-level handler) stays
 * reserved for argument errors caught before ask runs, as the doors document.
 */
export async function runAsk(cwd: string, options: AskOptions): Promise<void> {
  try {
    await ask(cwd, options);
  } catch (err) {
    const reason = failureReason(err);
    process.stdout.write(`${ASK_FAILED_MARKER}\n\n${reason}\n`);
    process.stderr.write(`Ask failed: ${reason}\n`);
    process.exitCode = 1;
  }
}

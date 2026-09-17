#!/usr/bin/env node

/**
 * companion — CLI entry point for the harry Claude Code plugin; each command
 * is a thin wrapper over the Codex CLI (`codex exec`, `codex exec review`).
 */

import process from "node:process";
import { runAsk } from "./commands/ask.ts";
import { runReview } from "./commands/review.ts";
import { runSetup } from "./commands/setup.ts";
import {
  assertKnownFlags,
  extractTask,
  flagEnum,
  flagRequiredString,
  parseArgs,
} from "./lib/args.ts";
import { REASONING_EFFORTS } from "./lib/run-codex.ts";

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [--base <ref>] [--reasoning <low|medium|high|xhigh>]",
      "                   [--context <text|@file|@->] [focus...]",
      '  companion ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec review`",
      "  ask         Ask a single prompt (read-only) and print the answer",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  // `--help` after a command (e.g. `companion review --help`) must print usage,
  // not launch a real run. Handle it before dispatch, for every command.
  if (flags.help === true) {
    printUsage();
    return;
  }

  // Reject typo'd / unknown flags before dispatch so they never silently change
  // behavior (an unrecognized flag used to be swallowed).
  assertKnownFlags(command, flags);

  switch (command) {
    case "setup": {
      await runSetup({
        json: flags.json === true,
      });
      break;
    }

    case "review": {
      await runReview(process.cwd(), {
        base: flagRequiredString(flags, "base"),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context"),
        focusText: args.join(" "),
      });
      break;
    }

    case "ask": {
      await runAsk(process.cwd(), {
        prompt: extractTask(args, flags),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context"),
      });
      break;
    }

    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(`\nFatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

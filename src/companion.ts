#!/usr/bin/env node

/**
 * companion — CLI entry point for the harry Claude Code plugin; drives the
 * Codex provider behind one neutral command set.
 */

import process from "node:process";
import { runAsk } from "./commands/ask.ts";
import { runReview } from "./commands/review.ts";
import { runSetup } from "./commands/setup.ts";
import { runStatus } from "./commands/status.ts";
import {
  assertKnownFlags,
  extractTask,
  flagEnum,
  flagNumber,
  flagRequiredString,
  flagString,
  parseArgs,
} from "./lib/args.ts";

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [--base <ref>] [--reasoning <low|medium|high|xhigh>]",
      "                   [--context <text|@file|@->] [focus...]",
      '  companion ask "<prompt>" [--model <id>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "  companion status [--json]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec review`",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  status      Show the cached Codex rate-limit snapshot",
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
        reasoning: flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"] as const),
        context: flagRequiredString(flags, "context"),
        focusText: args.join(" "),
      });
      break;
    }

    case "ask": {
      const reasoning = flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"] as const);
      const prompt = extractTask(args, flags); // reuse positional/`--task`/stdin extraction
      await runAsk(process.cwd(), {
        prompt,
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        context: flagString(flags, "context"),
      });
      break;
    }

    case "status":
      await runStatus(process.cwd(), {
        json: flags.json === true,
      });
      break;

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

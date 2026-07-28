#!/usr/bin/env node

/**
 * companion — CLI entry point for the harry Claude Code plugin; drives the
 * Codex provider behind one neutral command set.
 */

import process from "node:process";
import { runAsk } from "./commands/ask.ts";
import { runFix } from "./commands/fix.ts";
import { runReview } from "./commands/review.ts";
import { runSetup } from "./commands/setup.ts";
import { runStatus } from "./commands/status.ts";
import {
  assertKnownFlags,
  extractTask,
  flagEnum,
  flagNumber,
  flagString,
  parseArgs,
} from "./lib/args.ts";
import type { ReviewScope } from "./lib/git.ts";

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [focus...] [--adversarial] [--base <ref>]",
      "                           [--scope auto|working-tree|branch] [--fix]",
      "                           [--model <id>] [--reasoning <low|medium|high|xhigh>]",
      "                           [--context <text|@file|@->]",
      "                           [--timeout <ms>]",
      '  companion ask "<prompt>" [--model <id>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "  companion fix --findings <path> [--model <id>]",
      "                        [--reasoning <low|medium|high|xhigh>]",
      "                        [--context <text|@file|@->]",
      "                        [--timeout <ms>] [--write <path>]",
      "  companion status [--json]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Run a code review (markdown, or JSON findings with --fix)",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  fix         Apply Claude-Code-approved review findings to the working tree",
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
      // --full and --harry-fix are orchestration-only flags handled by the
      // /review slash command: --full fans out the simplify + adversarial reviews
      // alongside the CC code-review and the agent consolidates them; --harry-fix
      // selects the isolated `fix` command as the apply backend. Neither has
      // meaning for a single runReview — letting them through would silently run a
      // plain standard review. Reject on PRESENCE (not just `=== true`) so an
      // explicit `--full=false` cannot slip past, and BEFORE enum validation so a
      // co-occurring flag typo does not mask this targeted guidance. (`node review
      // --fix` — structured findings output — stays valid and is unaffected.)
      if (flags.full !== undefined) {
        throw new Error(
          "--full is handled by the /review command orchestrator, not the CLI. " +
            "Run the simplify/adversarial reviews separately, or use /review --full.",
        );
      }
      if (flags["harry-fix"] !== undefined) {
        throw new Error(
          "--harry-fix is a /review fix-backend selector, not a CLI flag. " +
            "To apply findings, run: fix --findings <path> --reasoning xhigh.",
        );
      }

      // Validate enums so typos error loudly instead of silently falling back.
      const validScopes = ["auto", "working-tree", "branch"] as const;
      const validEfforts = ["low", "medium", "high", "xhigh"] as const;
      const scope = flagEnum<ReviewScope>(flags, "scope", validScopes);
      const reasoning = flagEnum(flags, "reasoning", validEfforts);

      await runReview(process.cwd(), {
        adversarial: flags.adversarial === true,
        simplify: flags.simplify === true,
        scope,
        base: flagString(flags, "base"),
        focusText: args.join(" "),
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        fix: flags.fix === true,
        context: flagString(flags, "context"),
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

    case "fix": {
      const reasoning = flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"] as const);
      await runFix(process.cwd(), {
        findingsPath: flagString(flags, "findings"),
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        allowShell: flags["allow-shell"] === true,
        allowUrl: flags["allow-url"] === true,
        writePath: flagString(flags, "write"),
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

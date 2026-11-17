#!/usr/bin/env node

import process from "node:process";
import { runAsk } from "./commands/ask.ts";
import { runMetrics } from "./commands/metrics.ts";
import { runReview } from "./commands/review.ts";
import { runSetup } from "./commands/setup.ts";
import {
  assertKnownFlags,
  extractTask,
  flagEnum,
  flagPositiveInt,
  flagRequiredString,
  parseArgs,
} from "./lib/args.ts";
import { REASONING_EFFORTS } from "./lib/run-codex.ts";

// Every binary is resolved on a POSIX PATH and spawned without a shell; on
// Windows that fails in confusing ways, so refuse up front instead.
if (process.platform === "win32") {
  console.error("harry's companion supports macOS and Linux only; Windows is not supported.");
  process.exit(1);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [--base <ref>] [--reasoning <low|medium|high|xhigh>]",
      "                   [--context <text|@file|@->] [--spec <text|@file|@->]",
      "                   [--architecture | --rereview <text|@file|@-> | --fix-check <text|@file|@->]",
      "                   [focus...]",
      '  companion ask "<prompt>" [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->] [--isolated]',
      "  companion metrics --base <ref> --out <file> [--only <dir>]",
      "                    [--test-command <cmd>] [--coverage-command <cmd>]",
      "                    [--max-workers <n>] [--max-mutants <n>]",
      "  companion metrics --base <ref> --plan [--only <dir>] [--max-mutants <n>]",
      "  companion metrics --audit --out <dir> [--run-tests]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec`",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  metrics     Run the installed crapper, dryer and mutator; write a facts file",
      "",
      "metrics with --base (a unit's changed files):",
      "  mutator runs only the mutation sites on lines <base>...HEAD added or modified.",
      "  --plan                  Print per group and file the sites on changed lines and the",
      "                          sites mutator executes, the cores and the load averages;",
      "                          with --max-mutants, the sites the cap selects and what",
      "                          mutator executes for them; run no test and write nothing",
      "  --only <dir>            Only the groups at this repo-relative dir ('.' is the root)",
      "  --test-command <cmd>    The command mutator runs for its baseline and every mutant",
      "  --coverage-command <cmd> Replaces the coverage run: a shell command run in the group",
      "                          dir that leaves lcov.info under target/coverage/ or coverage/",
      "                          (both command flags need a single group dir; use --only)",
      "  --max-workers <n>       Passed to mutator: mutants of one file run at once",
      "  --max-mutants <n>       Run the first n changed-line sites by file, then line,",
      "                          finishing the last line; the rest are listed as not run",
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
        spec: flagRequiredString(flags, "spec"),
        architecture: flags.architecture === true,
        rereview: flagRequiredString(flags, "rereview"),
        fixCheck: flagRequiredString(flags, "fix-check"),
        focusText: args.join(" "),
      });
      break;
    }

    case "ask": {
      await runAsk(process.cwd(), {
        prompt: extractTask(args, flags),
        reasoning: flagEnum(flags, "reasoning", REASONING_EFFORTS),
        context: flagRequiredString(flags, "context"),
        isolated: flags.isolated === true,
      });
      break;
    }

    case "metrics": {
      await runMetrics(process.cwd(), {
        base: flagRequiredString(flags, "base"),
        out: flagRequiredString(flags, "out"),
        audit: flags.audit === true,
        runTests: flags["run-tests"] === true,
        plan: flags.plan === true,
        only: flagRequiredString(flags, "only"),
        testCommand: flagRequiredString(flags, "test-command"),
        coverageCommand: flagRequiredString(flags, "coverage-command"),
        maxWorkers: flagPositiveInt(flags, "max-workers"),
        maxMutants: flagPositiveInt(flags, "max-mutants"),
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

#!/usr/bin/env node

/**
 * companion — CLI entry point for the harry Claude Code plugin; drives the
 * Copilot or Codex provider behind one neutral command set.
 */

import process from 'node:process';
import { runSetup } from './commands/setup.js';
import { runReview } from './commands/review.js';
import { runAsk } from './commands/ask.js';
import { runFix } from './commands/fix.js';
import { runStatus } from './commands/status.js';
import { runResult } from './commands/result.js';
import { enqueueBackground, runWorker } from './commands/background.js';
import type { ReviewScope } from './lib/git.js';
import { extractTask } from './lib/args.js';

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  companion setup [--check] [--json] [--provider copilot|codex]',
      '  companion review [focus...] [--adversarial] [--base <ref>]',
      '                           [--scope auto|working-tree|branch] [--fix]',
      '                           [--model <id>] [--reasoning <low|medium|high|xhigh>]',
      '                           [--context <text|@file|@->]',
      '                           [--timeout <ms>] [--min-quota <n>] [--background]',
      '  companion ask "<prompt>" [--model <id>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      '  companion fix --findings <path> [--model <id>]',
      '                        [--reasoning <low|medium|high|xhigh>]',
      '                        [--context <text|@file|@->]',
      '                        [--timeout <ms>] [--min-quota <n>] [--write <path>]',
      '  companion status [job-id] [--all] [--json]',
      '  companion result [job-id] [--json]',
      '',
      'Commands:',
      '  setup       Check provider auth, available models, quota',
      '  review      Run a code review (Copilot or Codex; markdown, or JSON findings with --fix)',
      '  ask         Ask a single prompt (read-only) and print the answer',
      '  fix         Apply Claude-Code-approved review findings to the working tree',
      '  status      Show quota plus background job status',
      '  result      Retrieve a background job\'s output',
    ].join('\n'),
  );
}

interface ParsedArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

// Flags that never take a value. Without this set, a positional like
// `--adversarial race condition` would bind "race" to --adversarial (string,
// not boolean) and silently disable strict `=== true` checks downstream.
const BOOLEAN_FLAGS = new Set<string>([
  'adversarial',
  'all',
  'allow-shell',
  'allow-url',
  'background',
  'check',
  'fix',
  'full',
  'harry-fix',
  'help',
  'simplify',
  'json',
  'no-worktree',
  'wait',
]);

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? 'help';
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      // Support --key=value form for explicit value binding.
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(key)) {
          // Boolean flags must not be assigned a value via `=`. Coerce common
          // truthy spellings (`true`, `1`, `yes`) and reject everything else
          // so a mistake like `--background=foo` errors loudly instead of
          // running with `flags[background] = "foo"` (which fails === true
          // and silently flips behavior).
          const lc = value.toLowerCase();
          if (lc === '' || lc === 'true' || lc === '1' || lc === 'yes') {
            flags[key] = true;
          } else if (lc === 'false' || lc === '0' || lc === 'no') {
            flags[key] = false;
          } else {
            throw new Error(`Flag --${key} is boolean and cannot take value "${value}". Use --${key} or --no-${key}.`);
          }
          continue;
        }
        flags[key] = value;
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function flagNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
  const v = flags[key];
  if (typeof v !== 'string') return undefined;
  // Strict parse: Number() rejects trailing garbage ("30sec" → NaN) that
  // parseInt would silently accept. Reject NaN and non-positive values so a
  // bad `--timeout 0`/`-5` falls back to the default instead of arming a
  // 0ms timer (spurious "Timed out after 0ms") downstream.
  const n = Number(v.trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function flagEnum<T extends string>(
  flags: Record<string, string | boolean>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`Flag --${key} requires a value (one of: ${allowed.join(', ')}).`);
  }
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(`Invalid --${key} value "${v}". Expected one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'setup': {
      const provider = flagEnum(flags, 'provider', ['copilot', 'codex'] as const);
      await runSetup({
        check: flags['check'] === true,
        json: flags['json'] === true,
        provider,
      });
      break;
    }

    case 'review': {
      // --full and --harry-fix are orchestration-only flags handled by the
      // /review slash command: --full fans out the simplify + adversarial reviews
      // alongside the CC code-review and the agent consolidates them; --harry-fix
      // selects the isolated `fix` command as the apply backend. Neither has
      // meaning for a single runReview — letting them through would silently run a
      // plain standard review. Reject on PRESENCE (not just `=== true`) so an
      // explicit `--full=false` cannot slip past, and BEFORE enum validation so a
      // co-occurring flag typo does not mask this targeted guidance. (`node review
      // --fix` — structured findings output — stays valid and is unaffected.)
      if (flags['full'] !== undefined) {
        throw new Error(
          '--full is handled by the /review command orchestrator, not the CLI. ' +
            'Run the simplify/adversarial reviews separately, or use /review --full.',
        );
      }
      if (flags['harry-fix'] !== undefined) {
        throw new Error(
          '--harry-fix is a /review fix-backend selector, not a CLI flag. ' +
            'To apply findings via Copilot, run: fix --findings <path> --model gpt-5.5 --reasoning xhigh.',
        );
      }

      // Validate enums so typos error loudly instead of silently falling back.
      const validScopes = ['auto', 'working-tree', 'branch'] as const;
      const validEfforts = ['low', 'medium', 'high', 'xhigh'] as const;
      const scope = flagEnum<ReviewScope>(flags, 'scope', validScopes);
      const reasoning = flagEnum(flags, 'reasoning', validEfforts);
      const provider = flagEnum(flags, 'provider', ['copilot', 'codex'] as const);

      if (flags['background'] === true) {
        const jobId = enqueueBackground('review', args, flags, process.cwd());
        console.log(JSON.stringify({ status: 'queued', jobId }));
        break;
      }
      await runReview(process.cwd(), {
        adversarial: flags['adversarial'] === true,
        simplify: flags['simplify'] === true,
        scope,
        base: flagString(flags, 'base'),
        focusText: args.join(' '),
        provider,
        model: flagString(flags, 'model'),
        reasoning,
        timeout: flagNumber(flags, 'timeout'),
        minQuota: flagNumber(flags, 'min-quota'),
        fix: flags['fix'] === true,
        context: flagString(flags, 'context'),
      });
      break;
    }

    case 'ask': {
      const reasoning = flagEnum(flags, 'reasoning', ['low', 'medium', 'high', 'xhigh'] as const);
      const provider = flagEnum(flags, 'provider', ['copilot', 'codex'] as const);
      const prompt = extractTask(args, flags); // reuse positional/`--task`/stdin extraction
      await runAsk(process.cwd(), {
        prompt,
        provider,
        model: flagString(flags, 'model'),
        reasoning,
        timeout: flagNumber(flags, 'timeout'),
        minQuota: flagNumber(flags, 'min-quota'),
        context: flagString(flags, 'context'),
      });
      break;
    }

    case 'fix': {
      const reasoning = flagEnum(flags, 'reasoning', ['low', 'medium', 'high', 'xhigh'] as const);
      const provider = flagEnum(flags, 'provider', ['copilot', 'codex'] as const);
      await runFix(process.cwd(), {
        findingsPath: flagString(flags, 'findings'),
        provider,
        model: flagString(flags, 'model'),
        reasoning,
        timeout: flagNumber(flags, 'timeout'),
        minQuota: flagNumber(flags, 'min-quota'),
        allowShell: flags['allow-shell'] === true,
        allowUrl: flags['allow-url'] === true,
        writePath: flagString(flags, 'write'),
        context: flagString(flags, 'context'),
      });
      break;
    }

    case 'status':
      await runStatus(process.cwd(), {
        jobId: args[0],
        all: flags['all'] === true,
        json: flags['json'] === true,
      });
      break;

    case 'result':
      await runResult(process.cwd(), {
        jobId: args[0],
        json: flags['json'] === true,
      });
      break;

    // Internal: background worker entry point.
    case '_worker': {
      const jobId = flagString(flags, 'job-id');
      const workerCwd = flagString(flags, 'cwd') ?? process.cwd();
      if (!jobId) {
        console.error('Worker requires --job-id');
        process.exit(1);
      }
      await runWorker(jobId, workerCwd);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
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
  if (process.env['DEBUG']) console.error(err.stack);
  process.exit(1);
});

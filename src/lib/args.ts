/**
 * Shared CLI argument helpers — the whole argv layer. `src/companion.ts` (the
 * dispatcher) is the only production importer; these live here rather than
 * beside `main()` so they are reachable by tests without executing the CLI.
 */

export interface ParsedArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

// Flags that never take a value. Without this set, a positional like
// `--adversarial race condition` would bind "race" to --adversarial (string,
// not boolean) and silently disable strict `=== true` checks downstream.
export const BOOLEAN_FLAGS = new Set<string>([
  "adversarial",
  "allow-shell",
  "allow-url",
  "fix",
  "full",
  "harry-fix",
  "help",
  "simplify",
  "json",
]);

// Allowed flag keys per command. An unrecognized `--flag` errors loudly instead
// of being silently swallowed (a typo like `--adversaria` must not quietly run a
// plain review). `help` is accepted everywhere and handled before dispatch.
// `full`/`harry-fix` are listed for `review` so their targeted guidance (in
// `companion.ts`) fires instead of a generic "unknown flag".
export const KNOWN_FLAGS: Record<string, ReadonlySet<string>> = {
  setup: new Set(["json"]),
  review: new Set([
    "adversarial",
    "simplify",
    "full",
    "harry-fix",
    "scope",
    "base",
    "model",
    "reasoning",
    "timeout",
    "fix",
    "context",
  ]),
  ask: new Set(["task", "model", "reasoning", "timeout", "context"]),
  fix: new Set([
    "findings",
    "model",
    "reasoning",
    "timeout",
    "allow-shell",
    "allow-url",
    "write",
    "context",
  ]),
  status: new Set(["json"]),
};

/** Throw on any `--flag` not in the command's allow-list (typos error loudly). */
export function assertKnownFlags(command: string, flags: Record<string, string | boolean>): void {
  const allowed = KNOWN_FLAGS[command];
  if (!allowed) return; // help/unknown commands: handled by the switch default.
  for (const key of Object.keys(flags)) {
    if (key === "help") continue;
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag --${key} for '${command}'. Run 'companion help' for usage.`);
    }
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      // Support --key=value form for explicit value binding.
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(key)) {
          // Boolean flags must not be assigned a value via `=`. Coerce common
          // truthy spellings (`true`, `1`, `yes`) and reject everything else
          // so a mistake like `--adversarial=foo` errors loudly instead of
          // running with `flags[adversarial] = "foo"` (which fails === true
          // and silently flips behavior).
          const lc = value.toLowerCase();
          if (lc === "" || lc === "true" || lc === "1" || lc === "yes") {
            flags[key] = true;
          } else if (lc === "false" || lc === "0" || lc === "no") {
            flags[key] = false;
          } else {
            throw new Error(
              `Flag --${key} is boolean and cannot take value "${value}". Use --${key} or --no-${key}.`,
            );
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
      if (next !== undefined && !next.startsWith("--")) {
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

export function flagEnum<T extends string>(
  flags: Record<string, string | boolean>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(`Flag --${key} requires a value (one of: ${allowed.join(", ")}).`);
  }
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(`Invalid --${key} value "${v}". Expected one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

/**
 * Resolve the task / focus string from positional args, falling back to a
 * `--task <…>` flag. Trims so callers can compare against empty string.
 */
export function extractTask(args: string[], flags: Record<string, string | boolean>): string {
  const positional = args.join(" ").trim();
  if (positional) return positional;
  const flag = flags.task;
  return typeof flag === "string" ? flag.trim() : "";
}

/** A `--key <value>` string flag, or undefined when absent/boolean. */
export function flagString(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * A `--key <n>` positive number flag. Strict: `Number()` rejects trailing
 * garbage ("30sec" → NaN) that parseInt would accept, and NaN/zero/negative
 * return undefined so a downstream `?? DEFAULT` applies instead of arming a 0ms
 * timer.
 */
export function flagNumber(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const v = flags[key];
  if (typeof v !== "string") return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

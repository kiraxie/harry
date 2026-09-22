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
// `--json extra` would bind "extra" to --json (string, not boolean) and
// silently disable strict `=== true` checks downstream.
export const BOOLEAN_FLAGS = new Set<string>(["help", "json", "architecture"]);

// Allowed flag keys per command. An unrecognized `--flag` errors loudly instead
// of being silently swallowed — a typo, or a flag `review` no longer takes
// (`--adversarial`, `--scope`, `--model`, …), must not quietly run a plain
// review. `help` is accepted everywhere and handled before dispatch.
export const KNOWN_FLAGS: Record<string, ReadonlySet<string>> = {
  setup: new Set(["json"]),
  review: new Set(["base", "reasoning", "context", "architecture"]),
  ask: new Set(["task", "reasoning", "context"]),
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

/**
 * A `--key <value>` string flag that must carry its value when present:
 * undefined when absent, and an error naming the flag when it was given bare
 * (`--base --reasoning high` parses `base` as `true`) or with an empty or
 * whitespace-only value (`--base "$UNSET"`, `--base=`), rather than silently
 * reading as absent — an absent `--base` reviews a different target.
 */
export function flagRequiredString(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`Flag --${key} requires a value.`);
  if (v.trim() === "") throw new Error(`Flag --${key} requires a value; got an empty one.`);
  return v;
}

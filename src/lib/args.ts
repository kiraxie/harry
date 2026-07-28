/**
 * Shared CLI argument helpers. `src/companion.ts` (the dispatcher) is the only
 * importer.
 */

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

/**
 * Shared CLI argument helpers used by both the foreground dispatcher
 * (`copilot-companion.ts`) and the background worker (`commands/background.ts`).
 */

/**
 * Resolve the task / focus string from positional args, falling back to a
 * `--task <…>` flag. Trims so callers can compare against empty string.
 */
export function extractTask(args: string[], flags: Record<string, string | boolean>): string {
  const positional = args.join(' ').trim();
  if (positional) return positional;
  const flag = flags['task'];
  return typeof flag === 'string' ? flag.trim() : '';
}

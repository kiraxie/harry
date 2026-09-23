/**
 * The one place the companion searches PATH: every binary it runs by name
 * (`codex`, `git`) goes through {@link resolveOnPath}. A binary is resolved to
 * an absolute path first, never left to execvp: execvp resolves an empty PATH
 * entry (`:x`, `x:`, `a::b`) and a relative one (`.`, `bin`) against the cwd,
 * and `review` runs its binaries with cwd = the repository under review — so a
 * repo shipping its own `./git` or `./codex` would run repo-controlled code.
 */

import { accessSync, constants, statSync } from "node:fs";
import { posix } from "node:path";

/** An executable regular file (symlinks followed); any stat/access failure is a miss. */
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first `<PATH entry>/<name>` that is an executable regular file, in PATH
 * order, or null when there is none. Empty and relative entries are skipped.
 * Entries are neither trimmed nor `~`-expanded, as execvp does neither. An
 * unset PATH is no hit (execvp would fall back to a default path; this does
 * not).
 */
export function resolveOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!posix.isAbsolute(dir)) continue;
    const candidate = posix.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/**
 * The ENOENT a spawn reports when {@link resolveOnPath} finds no `name`: the
 * same `code`, so a caller's existing not-found handling needs no new case.
 */
export function notFoundError(syscall: string, name: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ENOENT`), { code: "ENOENT", syscall, path: name });
}

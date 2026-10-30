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

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  // An unset PATH is no hit: execvp would fall back to a default path, this does not.
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

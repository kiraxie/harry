// The one place harry searches PATH, shared by the companion and the install
// scripts: a binary is resolved to an absolute path first, never left to execvp,
// which resolves an empty or relative PATH entry (`.`, `bin`, `a::b`) against the
// cwd — and these run with cwd = the user's repository, so a repo shipping its own
// `./git` would run repo-controlled code.

import { accessSync, constants, statSync } from "node:fs";
import { posix } from "node:path";

/** @param {string} path @returns {boolean} */
export function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} name @param {NodeJS.ProcessEnv} env @returns {string | null} */
export function resolveOnPath(name, env) {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!posix.isAbsolute(dir)) continue;
    const candidate = posix.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

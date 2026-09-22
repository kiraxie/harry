/**
 * The one place the companion searches PATH: the POSIX search every binary it
 * runs by name (`codex`, `git`) goes through, and the Windows PATH x PATHEXT
 * search for `codex` ({@link resolveCodex}). A binary is resolved to an absolute
 * path first, never left to execvp: execvp resolves an empty PATH entry (`:x`,
 * `x:`, `a::b`) and a relative one (`.`, `bin`) against the cwd, and `review`
 * runs its binaries with cwd = the repository under review — so a repo shipping its own `./git` or
 * `./codex` would run repo-controlled code.
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

/** An executable regular file (symlinks followed); any stat/access failure is a miss. */
export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first `<PATH entry>/<name>` that `exists` (default: an executable regular
 * file), in PATH order, or null when there is none. Empty and relative entries
 * are skipped. Entries are neither trimmed nor `~`-expanded, as execvp does
 * neither. An unset PATH is no hit (execvp would fall back to a default path;
 * this does not).
 */
export function resolveOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = isExecutableFile,
): string | null {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!posix.isAbsolute(dir)) continue;
    const candidate = posix.join(dir, name);
    if (exists(candidate)) return candidate;
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

/**
 * What to spawn for a plain POSIX binary such as `git`: its resolved absolute
 * path, or null when PATH holds none. On Windows the bare `name` is returned
 * unchanged, left to Node's own search there.
 *
 * DEBT: on Windows, libuv's search for a bare name checks the cwd before PATH
 * (per libuv's src/win/process.c `search_path`; not verified on a Windows host),
 * the same cwd-planting class this module closes on POSIX; `codex` is
 * already resolved on Windows ({@link resolveCodex}), `git` is not. Upgrade
 * path: generalize resolveCodex's PATH x PATHEXT search to any name, verified
 * on a real Windows host.
 */
export function spawnTarget(
  name: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return platform === "win32" ? name : resolveOnPath(name, env);
}

/** A Windows env lookup: variable names are case-insensitive there (`Path`, `PATH`). */
function winEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * How the companion spawns each PATHEXT extension it can run on Windows:
 * `.com`/`.exe` directly, `.bat`/`.cmd` through cmd.exe. The one source for both
 * {@link resolveCodex}'s filter and run-codex.ts's `codexSpawn`. Anything else
 * PATHEXT lists (`.js`, `.vbs`, `.ps1`, …) needs a script host, so it is never
 * a hit.
 */
const WIN_SPAWN_MODE: Readonly<Record<string, "direct" | "cmd">> = {
  ".com": "direct",
  ".exe": "direct",
  ".bat": "cmd",
  ".cmd": "cmd",
};

/**
 * How to spawn a Windows file — or a bare PATHEXT entry like `.EXE`, which
 * `extname` reads as a dotfile with no extension — or null when it is not
 * spawnable.
 */
export function winSpawnMode(file: string): "direct" | "cmd" | null {
  const ext = /^\.[^.\\/]+$/.test(file) ? file : win32.extname(file);
  return WIN_SPAWN_MODE[ext.toLowerCase()] ?? null;
}

/**
 * The absolute path to spawn for `codex`, or null when PATH holds none. The
 * current directory is never searched, on any platform: `review` runs codex with
 * cwd = the repository under review, so a repo shipping its own `codex` must not
 * be reachable through PATH.
 *
 * Off Windows: {@link resolveOnPath} for `codex` — the first `<PATH entry>/codex`
 * that `exists` (default: an executable regular file), skipping empty and
 * relative entries.
 *
 * On Windows: the first `<PATH entry>\codex<PATHEXT ext>` that exists, in PATH
 * order then PATHEXT order (default `.COM;.EXE;.BAT;.CMD`), skipping empty and
 * relative entries. Only a spawnable
 * extension ({@link winSpawnMode}) counts: a `codex.js` or `codex.ps1`
 * earlier on PATH is skipped and the search goes on.
 */
export function resolveCodex(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = platform === "win32" ? existsSync : isExecutableFile,
): string | null {
  if (platform !== "win32") return resolveOnPath("codex", env, exists);
  const split = (v: string): string[] =>
    v
      .split(";")
      .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
      .filter((s) => s !== "");
  const exts = split(winEnv(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").filter(
    (ext) => winSpawnMode(ext) !== null,
  );
  for (const dir of split(winEnv(env, "PATH") ?? "")) {
    // A relative entry (`.`, `bin`, `C:bin`) joins to a relative path that spawn
    // resolves against the cwd — the repository under review.
    if (!win32.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = win32.join(dir, `codex${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

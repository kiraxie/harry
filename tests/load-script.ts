import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Loads a script whose CLI is guarded (isMain or import.meta.main) with HOME,
 * HARRY_GLOBAL and cwd at a fresh temp dir, so a guard that wrongly fires on import — a
 * guard mutant, in mutator's run — writes there, never into the user's ~/.claude or
 * this checkout. `load` is the test's own `() => import("…")`: the specifier must resolve
 * from the test file, which in mutator's worker overlay is the worker's copy.
 */
export async function loadScript<T>(load: () => Promise<T>): Promise<T> {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-load-script-")));
  const saved = { HOME: process.env.HOME, HARRY_GLOBAL: process.env.HARRY_GLOBAL };
  const cwd = process.cwd();
  process.env.HOME = dir;
  process.env.HARRY_GLOBAL = path.join(dir, ".claude", "CLAUDE.md");
  process.chdir(dir);
  try {
    return await load();
  } finally {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

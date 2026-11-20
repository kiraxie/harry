// Whether the module is the script Node was started with. Node gives a module its real
// path in import.meta.url but keeps argv[1] as typed, so comparing the two as written
// skips the CLI, exiting 0 with no output, whenever the script is started through a
// symlink (a symlinked plugin dir, or mutator's worker overlay). Equal as written is
// enough; only a mismatch resolves real paths.
// Not import.meta.main: install.mjs and init.mjs ship, and /sync runs them on the
// consumer's Node, which has it only from 22.18 on the 22 line and 24.2 on later lines;
// without it the CLI would never run.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @param {string} metaUrl the caller's import.meta.url @returns {boolean} */
export function isMain(metaUrl) {
  const started = process.argv[1];
  if (!started) return false;
  if (metaUrl === pathToFileURL(started).href) return true;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(started);
  } catch (err) {
    // Not the entry point, but say why the check could not tell: a script started
    // through a path it cannot resolve would otherwise skip its CLI in silence.
    process.stderr.write(
      `isMain: cannot resolve ${started}: ${/** @type {Error} */ (err).message}\n`,
    );
    return false;
  }
}

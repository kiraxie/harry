import { realpathSync } from "node:fs";
import { dirname } from "node:path";

/**
 * `process.argv[1]` rather than `import.meta` (empty in the CJS bundle) or
 * `__dirname` (absent in ESM source). The entry file sits one directory below
 * the repo root from source (`src/companion.ts`) and from the committed bundle
 * (`dist/companion.cjs`) alike, so its grandparent is the root in both.
 */
export function pluginRoot(): string {
  return dirname(dirname(realpathSync(process.argv[1])));
}

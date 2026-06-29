/**
 * Constants embedded into the bundled companion.
 *
 * PLUGIN_VERSION is single-sourced from package.json (esbuild inlines the JSON
 * import at bundle time; `node --test` resolves it natively), so the bundle, the
 * npm manifest, and the plugin manifest can no longer drift to different version
 * strings.
 */

import pkg from "../../package.json" with { type: "json" };

export const PLUGIN_VERSION: string = pkg.version;
export const CLIENT_NAME = "harry";

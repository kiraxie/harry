/**
 * Constants embedded into the bundled companion.
 * Kept in a module so esbuild sees them at compile time; there is no JSON
 * import dance to worry about for the CJS output.
 */

export const PLUGIN_VERSION = '0.4.2';
export const CLIENT_NAME = 'copilot-plugin-cc';

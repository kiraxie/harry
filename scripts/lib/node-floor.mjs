// The CLIs load this module alone, before their library, so a Node below the floor
// gets the refusal rather than a SyntaxError from the library; the CLIs' own top-level
// await sets the oldest Node that gets it at 14.8.

export const NODE_FLOOR = 26;

/** @param {string} version process.versions.node @returns {string | undefined} */
export function floorRefusal(version) {
  if (Number(version.split(".")[0]) >= NODE_FLOOR) return undefined;
  return `harry: Node ${NODE_FLOOR} or newer is required; this is Node ${version}.`;
}

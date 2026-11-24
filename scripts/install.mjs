#!/usr/bin/env node
import { floorRefusal } from "./lib/node-floor.mjs";

const refusal = floorRefusal(process.versions.node);
if (refusal) {
  console.error(refusal);
  process.exitCode = 1;
} else {
  const { run } = await import("./lib/install-laws.mjs");
  const { syncTools, toolsDir } = await import("./lib/tools.mjs");
  const args = process.argv.slice(2);
  const remove = args.includes("--remove");
  const r = run({ remove, explore: args.includes("--explore") });
  /** @type {string[]} */
  const lines = [];
  if (r.imported)
    lines.push(`${remove ? "Removed harry import from" : "Wired HARRY.md into"} ${r.path}`);
  if (r.snapshot.changed) lines.push(`Deployed HARRY.md snapshot to ${r.snapshot.path}`);
  if (r.explore?.outcome === "deployed")
    lines.push(`Deployed Explore override to ${r.explore.path}`);
  if (r.explore?.outcome === "removed") lines.push(`Removed Explore override ${r.explore.path}`);
  if (lines.length === 0)
    lines.push(`${remove ? "No harry import to remove in" : "Already up to date:"} ${r.path}`);
  let failed = false;
  if (args.includes("--tools") && !remove) {
    const tools = syncTools();
    for (const t of tools) lines.push(`tool ${t.name}: ${t.outcome} (${t.detail})`);
    lines.push(`Tools dir: ${toolsDir()}`);
    failed = tools.some((t) => t.outcome === "failed");
  }
  console.log(lines.join("\n"));
  if (failed) process.exitCode = 1;
}

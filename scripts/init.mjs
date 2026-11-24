#!/usr/bin/env node
import { floorRefusal } from "./lib/node-floor.mjs";

const refusal = floorRefusal(process.versions.node);
if (refusal) {
  console.error(refusal);
  process.exitCode = 1;
} else {
  const { run, UserError } = await import("./lib/init-ignore.mjs");
  const args = process.argv.slice(2);
  try {
    const remove = args.includes("--remove");
    const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();
    const { path, changed } = run(target, { remove });
    const what = changed
      ? remove
        ? "Removed harry's entries from"
        : "Updated"
      : remove
        ? "No harry entries to remove in"
        : "Already up to date:";
    console.log(`${what} ${path}`);
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    console.error(`harry: ${err.message}`);
    process.exitCode = 1;
  }
}

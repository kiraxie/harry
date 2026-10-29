import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inOrder } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

test("finishing removes the worktree before it deletes the branch", () => {
  inOrder(
    read("skills/finishing/SKILL.md"),
    "skills/finishing/SKILL.md",
    "**Remove the worktree**",
    "**Delete the branch**",
  );
});

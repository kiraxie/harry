import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { floorRefusal, NODE_FLOOR } from "../scripts/lib/node-floor.mjs";
import { headingSection } from "./section.ts";

test("floorRefusal refuses a Node below 26 in one line naming both versions", () => {
  const line = floorRefusal("25.9.0");
  assert.equal(typeof line, "string", "25.9.0 is refused");
  assert.doesNotMatch(line as string, /\n/, "one line");
  assert.match(line as string, /\b26\b/, "names the required major");
  assert.match(line as string, /25\.9\.0/, "names the running version");
});

test("floorRefusal passes Node 26.0.0 and later", () => {
  for (const v of ["26.0.0", "26.3.1", "27.0.0"]) assert.equal(floorRefusal(v), undefined, v);
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

/** Where else the floor is written, each with how its Node major is read. */
const FLOOR_SITES: { site: string; major: () => string | undefined }[] = [
  {
    site: "README.md Prerequisites",
    major: () =>
      headingSection(read("README.md"), "README.md", "## Prerequisites").match(
        /^- Node\.js \*\*>= (\d+)\*\*$/m,
      )?.[1],
  },
  { site: "build.mjs target", major: () => read("build.mjs").match(/\btarget: "node(\d+)"/)?.[1] },
  {
    site: ".github/workflows/ci.yml setup-node",
    major: () => read(".github/workflows/ci.yml").match(/^\s*node-version: (\d+)$/m)?.[1],
  },
  {
    site: "package.json engines.node",
    major: () =>
      JSON.parse(read("package.json")).engines?.node?.match(/^>=(\d+)(?:\.\d+){0,2}$/)?.[1],
  },
];

for (const { site, major } of FLOOR_SITES) {
  test(`${site} names the floor scripts/lib/node-floor.mjs holds`, () => {
    const found = major();
    assert.ok(found, `${site}: no Node floor found`);
    assert.equal(Number(found), NODE_FLOOR);
  });
}

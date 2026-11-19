/**
 * The selection walk (`walkSites`, src/lib/metrics/select.ts) over plain entries,
 * with a recording check standing in for the overlay check; no process is spawned.
 *
 * This table owns the walk's rule combinations — the cap, the line it finishes, the
 * per-file check and what it rejects — so a new walk case is a new row here, never a
 * new CLI test. tests/metrics.test.ts keeps what the table cannot reach: the scan and
 * the sort, the check's wiring and process count, mutator's argv, the facts file and
 * the plan's lines, group-named errors and an interrupt's exit.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Group } from "../src/lib/metrics/groups.ts";
import type { Site } from "../src/lib/metrics/mutator.ts";
import { type Entry, type Walk, walkSites } from "../src/lib/metrics/select.ts";

/** The test's own rejection record: the check's answer for a file it rejects. */
interface Rejected {
  rejected: string;
}

const root: Group = { dir: "", kind: "node", files: ["a.ts", "b.ts", "c.ts"] };
const x: Group = { dir: "packages/x", kind: "node", files: ["src/index.ts"] };
const y: Group = { dir: "packages/y", kind: "node", files: ["src/index.ts"] };
const z: Group = { dir: "packages/z", kind: "node", files: ["src/index.ts"] };
/** A group whose changed files hold no site on a changed line. */
const w: Group = { dir: "packages/w", kind: "node", files: ["src/index.ts"] };

const at = (group: Group, file: string, line: number): Entry => ({
  group,
  at: group.dir === "" ? file : `${group.dir}/${file}`,
  site: { file, line },
});

const s = (file: string, line: number): Site => ({ file, line });

const walk = (w: Partial<Walk<Rejected>>): Walk<Rejected> => ({
  sites: [],
  selected: [],
  unmeasured: [],
  notSelected: [],
  notMeasured: [],
  checked: [],
  ...w,
});

interface Row {
  name: string;
  groups: Group[];
  /** In cap order: repo path, then line. */
  entries: Entry[];
  maxMutants: number | null;
  /** The files the check rejects, as `<group dir>|<group-relative file>`. */
  rejects: string[];
  want: Map<Group, Walk<Rejected>>;
  /** Every check call, as [group dir, file]. */
  calls: [string, string][];
}

const rows: Row[] = [
  {
    name: "no cap: a passing and a rejected file, two sites each, each checked once",
    groups: [root],
    entries: [at(root, "a.ts", 1), at(root, "a.ts", 2), at(root, "b.ts", 1), at(root, "b.ts", 2)],
    maxMutants: null,
    rejects: ["|b.ts"],
    want: new Map([
      [
        root,
        walk({
          sites: [s("a.ts", 1), s("a.ts", 2), s("b.ts", 1), s("b.ts", 2)],
          selected: [s("a.ts", 1), s("a.ts", 2)],
          unmeasured: [s("b.ts", 1), s("b.ts", 2)],
          notMeasured: [{ rejected: "b.ts" }],
          checked: ["a.ts", "b.ts"],
        }),
      ],
    ]),
    calls: [
      ["", "a.ts"],
      ["", "b.ts"],
    ],
  },
  {
    name: "cap 1: a rejected two-site file takes none of it; the next passing file fills it",
    groups: [root],
    entries: [at(root, "a.ts", 1), at(root, "a.ts", 2), at(root, "b.ts", 1), at(root, "b.ts", 2)],
    maxMutants: 1,
    rejects: ["|a.ts"],
    want: new Map([
      [
        root,
        walk({
          sites: [s("a.ts", 1), s("a.ts", 2), s("b.ts", 1), s("b.ts", 2)],
          selected: [s("b.ts", 1)],
          unmeasured: [s("a.ts", 1), s("a.ts", 2)],
          notSelected: [s("b.ts", 2)],
          notMeasured: [{ rejected: "a.ts" }],
          checked: ["a.ts", "b.ts"],
        }),
      ],
    ]),
    calls: [
      ["", "a.ts"],
      ["", "b.ts"],
    ],
  },
  {
    name: "cap 1: the last line is finished whole; a later line and a file at the same line number are not",
    groups: [root],
    entries: [at(root, "a.ts", 1), at(root, "a.ts", 1), at(root, "a.ts", 2), at(root, "b.ts", 1)],
    maxMutants: 1,
    rejects: [],
    want: new Map([
      [
        root,
        walk({
          sites: [s("a.ts", 1), s("a.ts", 1), s("a.ts", 2), s("b.ts", 1)],
          selected: [s("a.ts", 1), s("a.ts", 1)],
          notSelected: [s("a.ts", 2), s("b.ts", 1)],
          checked: ["a.ts"],
        }),
      ],
    ]),
    calls: [["", "a.ts"]],
  },
  {
    name: "cap 2 over three single-site files: the third is never checked",
    groups: [root],
    entries: [at(root, "a.ts", 1), at(root, "b.ts", 1), at(root, "c.ts", 1)],
    maxMutants: 2,
    rejects: [],
    want: new Map([
      [
        root,
        walk({
          sites: [s("a.ts", 1), s("b.ts", 1), s("c.ts", 1)],
          selected: [s("a.ts", 1), s("b.ts", 1)],
          notSelected: [s("c.ts", 1)],
          checked: ["a.ts", "b.ts"],
        }),
      ],
    ]),
    calls: [
      ["", "a.ts"],
      ["", "b.ts"],
    ],
  },
  {
    name: "a cap above the passing sites leaves nothing out",
    groups: [root],
    entries: [at(root, "a.ts", 1), at(root, "a.ts", 2), at(root, "b.ts", 1)],
    maxMutants: 5,
    rejects: ["|b.ts"],
    want: new Map([
      [
        root,
        walk({
          sites: [s("a.ts", 1), s("a.ts", 2), s("b.ts", 1)],
          selected: [s("a.ts", 1), s("a.ts", 2)],
          unmeasured: [s("b.ts", 1)],
          notMeasured: [{ rejected: "b.ts" }],
          checked: ["a.ts", "b.ts"],
        }),
      ],
    ]),
    calls: [
      ["", "a.ts"],
      ["", "b.ts"],
    ],
  },
  {
    name: "groups sharing a group-relative path: checked apart, the cap's last line known by repo path, an entryless group walked empty",
    groups: [w, x, y, z],
    entries: [
      at(x, "src/index.ts", 1),
      at(x, "src/index.ts", 2),
      at(y, "src/index.ts", 1),
      at(y, "src/index.ts", 1),
      at(y, "src/index.ts", 2),
      at(z, "src/index.ts", 1),
    ],
    maxMutants: 1,
    rejects: ["packages/x|src/index.ts"],
    want: new Map([
      [w, walk({})],
      [
        x,
        walk({
          sites: [s("src/index.ts", 1), s("src/index.ts", 2)],
          unmeasured: [s("src/index.ts", 1), s("src/index.ts", 2)],
          notMeasured: [{ rejected: "src/index.ts" }],
          checked: ["src/index.ts"],
        }),
      ],
      [
        y,
        walk({
          sites: [s("src/index.ts", 1), s("src/index.ts", 1), s("src/index.ts", 2)],
          selected: [s("src/index.ts", 1), s("src/index.ts", 1)],
          notSelected: [s("src/index.ts", 2)],
          checked: ["src/index.ts"],
        }),
      ],
      [
        z,
        walk({
          sites: [s("src/index.ts", 1)],
          notSelected: [s("src/index.ts", 1)],
        }),
      ],
    ]),
    calls: [
      ["packages/x", "src/index.ts"],
      ["packages/y", "src/index.ts"],
    ],
  },
];

for (const row of rows) {
  test(`walkSites: ${row.name}`, () => {
    const calls: [string, string][] = [];
    const rejects = new Set(row.rejects);
    const got = walkSites(row.groups, row.entries, row.maxMutants, (group, file) => {
      calls.push([group.dir, file]);
      return rejects.has(`${group.dir}|${file}`) ? { rejected: file } : null;
    });
    assert.deepEqual(got, row.want);
    assert.deepEqual(calls, row.calls);
  });
}

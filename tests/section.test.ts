import assert from "node:assert/strict";
import test from "node:test";
import {
  headingLines,
  headingSection,
  inOrder,
  outline,
  section,
  sectionLines,
} from "./section.ts";

const doc = "# T\n\n## A\none\n\n## B\ntwo\n";

test("section: the text from the start marker up to the end marker", () => {
  assert.equal(section(doc, "doc.md", "## A", "## B"), "## A\none\n\n");
});

test("section: with no end marker it runs to the end of the text", () => {
  assert.equal(section(doc, "doc.md", "## B"), "## B\ntwo\n");
});

test("section: a missing start marker fails instead of returning a wrong slice", () => {
  assert.throws(
    () => section(doc, "doc.md", "## Gone", "## B"),
    /doc\.md no longer contains "## Gone"/,
  );
});

test("section: an end marker found only before the start fails", () => {
  assert.throws(
    () => section(doc, "doc.md", "## B", "## A"),
    /no longer contains "## A" after "## B"/,
  );
});

test("section: a missing end marker fails instead of running to the end", () => {
  assert.throws(
    () => section(doc, "doc.md", "## A", "## Gone"),
    /doc\.md no longer contains "## Gone" after "## A"/,
  );
});

const nested =
  "# T\n\n## A\none\n### A.1\ndeep\n```sh\n# not a heading\n```\n## B\ntwo\n# U\nthree\n";

test("headingSection: runs to the next heading of the same level", () => {
  assert.equal(
    headingSection(nested, "doc.md", "## A"),
    "## A\none\n### A.1\ndeep\n```sh\n# not a heading\n```",
  );
});

test("headingSection: stops at a higher-level heading", () => {
  assert.equal(headingSection(nested, "doc.md", /^## B/), "## B\ntwo");
});

test("headingSection: a deeper heading ends only its own subsection", () => {
  assert.equal(
    headingSection(nested, "doc.md", "### A.1"),
    "### A.1\ndeep\n```sh\n# not a heading\n```",
  );
});

test("headingSection: with no later heading it runs to the end of the text", () => {
  assert.equal(headingSection(nested, "doc.md", "# U"), "# U\nthree\n");
});

test("headingSection: text inside a code fence is never taken for a heading", () => {
  assert.throws(() => headingSection(nested, "doc.md", "# not"), /no longer has a heading "# not"/);
});

test("headingSection: an indented fence hides its headings too", () => {
  assert.equal(
    headingSection("## A\none\n  ```\n## not\n  ```\n## B\n", "doc.md", "## A"),
    "## A\none\n  ```\n## not\n  ```",
  );
});

test("headingSection: a shorter fence line does not close a longer fence", () => {
  assert.equal(
    headingSection("## A\n````md\n```\n## not\n```\n````\n## B\n", "doc.md", "## A"),
    "## A\n````md\n```\n## not\n```\n````",
  );
});

test("outline: each line's fence state and heading level", () => {
  assert.deepEqual(
    outline("# T\n```\n## x\n```\ntext\n### D  \n## \n##\n#tag").map((l) => [
      l.fenced,
      l.level,
      l.title,
    ]),
    [
      [false, 1, "T"],
      [true, 0, ""],
      [true, 0, ""],
      [true, 0, ""],
      [false, 0, ""],
      [false, 3, "D"],
      [false, 0, ""],
      [false, 0, ""],
      [false, 0, ""],
    ],
  );
});

test("headingSection: a fence line with an info string does not close a fence", () => {
  assert.equal(
    headingSection("## A\n```\n```js\n## not\n```  \n## B\n", "doc.md", "## A"),
    "## A\n```\n```js\n## not\n```  ",
  );
});

test("headingSection: a bare ## is not a section boundary", () => {
  assert.equal(
    headingSection("## A\none\n## \ntwo\n## B\n", "doc.md", "## A"),
    "## A\none\n## \ntwo",
  );
});

test("outline: CRLF and CR line ends read like LF", () => {
  const lf = "# T\n```\n## x\n```\ntext\n### D";
  const shape = (text: string) => outline(text).map((l) => [l.fenced, l.level, l.title]);
  assert.deepEqual(shape(lf.replaceAll("\n", "\r\n")), shape(lf));
  assert.deepEqual(shape(lf.replaceAll("\n", "\r")), shape(lf));
});

test("headingSection: CR-only text is sliced, not taken for flattened text", () => {
  assert.equal(headingSection("## A\rone\r## B\r", "doc.md", "## A"), "## A\none");
});

test("outline: a U+2028 inside a line hides no fence or heading", () => {
  assert.deepEqual(
    outline("```js\u2028x\n## not\n```\n## A\u2028b").map((l) => [l.fenced, l.level]),
    [
      [true, 0],
      [true, 0],
      [true, 0],
      [false, 2],
    ],
  );
});

test("headingSection: a missing heading fails instead of returning a wrong slice", () => {
  assert.throws(
    () => headingSection(nested, "doc.md", "## Gone"),
    /doc\.md no longer has a heading "## Gone"/,
  );
});

test("headingSection: flattened text fails instead of reading as one heading line", () => {
  assert.throws(
    () => headingSection(nested.replace(/\s+/g, " "), "doc.md", "## A"),
    /doc\.md has no line breaks/,
  );
});

test("headingSection: a RegExp heading matches only at the start of a line", () => {
  assert.equal(headingSection("# T\n### B\ndeep\n## B\ntwo\n", "doc.md", /## B/), "## B\ntwo\n");
});

test("headingLines: a heading range includes the blank line before the next heading", () => {
  assert.deepEqual(headingLines(doc, "doc.md", "## A"), [3, 5]);
});

test("headingLines: CRLF lines count like LF", () => {
  assert.deepEqual(headingLines(doc.replaceAll("\n", "\r\n"), "doc.md", "## A"), [3, 5]);
});

test("sectionLines: a range ends before an end marker that starts its line", () => {
  assert.deepEqual(sectionLines(doc, "doc.md", "one", "## B"), [4, 4]);
});

test("sectionLines: CRLF lines count like LF", () => {
  assert.deepEqual(sectionLines(doc.replaceAll("\n", "\r\n"), "doc.md", "one", "## B"), [4, 4]);
});

test("headingLines and sectionLines: a lone CR ends a line, as outline() reads it", () => {
  const cr = doc.replaceAll("\n", "\r");
  assert.deepEqual(
    [headingLines(cr, "doc.md", "## A"), sectionLines(cr, "doc.md", "one", "## B")],
    [
      [3, 5],
      [4, 4],
    ],
  );
});

test("inOrder: markers in order pass", () => {
  inOrder(doc, "doc.md", "# T", "## A", "## B");
});

test("inOrder: a missing marker fails and names it", () => {
  assert.throws(
    () => inOrder(doc, "doc.md", "## A", "## Gone"),
    /doc\.md no longer contains "## Gone"/,
  );
});

test("inOrder: two markers at the same index are not in order", () => {
  assert.throws(() => inOrder(doc, "doc.md", "## A", "## A"), /doc\.md has "## A" before "## A"/);
});

test("inOrder: an out-of-order pair fails and names both", () => {
  assert.throws(() => inOrder(doc, "doc.md", "## B", "## A"), /doc\.md has "## A" before "## B"/);
});

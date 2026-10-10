import assert from "node:assert/strict";
import test from "node:test";
import { headingSection, section } from "./section.ts";

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

test("headingSection: a missing heading fails instead of returning a wrong slice", () => {
  assert.throws(
    () => headingSection(nested, "doc.md", "## Gone"),
    /doc\.md no longer has a heading "## Gone"/,
  );
});

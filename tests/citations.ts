import { caseName, parseCasesJsonl } from "../scripts/lib/evals-cases.mts";
import { outline } from "./section.ts";

export type Name = { name: string; full: string; level?: number };

export type Repo = {
  kind: (rel: string) => "file" | "dir" | "untracked";
  names: (rel: string) => Name[];
};

const lineOf = (text: string, index?: number): number => text.slice(0, index).split("\n").length;

export const LAW_HEADINGS = [
  "Priority",
  "Tiers",
  "Ask first",
  "Secrets",
  "Root cause",
  "Evidence",
  "Clarify first",
  "Code",
  "Talk",
];

export const NON_LAW_LABELS = ["rubric", "red-green", "plugin", "L&C", "grill"];

export const FORM = {
  path: "`path` **Name**",
  law: "HARRY.md **Heading**",
  dimension: "dimension **<SCAN-DIMENSIONS ## core name>**",
  skillDir: "`dir/SKILL.md` **Name**",
  dirFile: "`dir/FILE.md` **Name**",
} as const;
const BREAK_SRC = String.raw`(?:\*(?:[ \t]*\*){2,}|-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,})[ \t]*`;
const QUOTE_MARKS = String.raw`(?: {0,3}>[ \t]?)*`;
const ITEM_SRC = String.raw`(?:[*+-]|\d+[.)])[ \t]`;
const PARAGRAPH_SINCE = String.raw`(?:[^\n]|\n(?![ \t]*\n))*\n`;
const PARAGRAPH_END = [
  String.raw`\n(?:[ \t]*>)*[ \t]*(?:\r?\n|$)`,
  String.raw`\n${QUOTE_MARKS} {0,3}(?:(?:[*+-]|1[.)])[ \t]|#{1,6}(?:[ \t]|\r?\n|$)|(?:${BREAK_SRC}|=+[ \t]*|-+[ \t]*)(?:\r?\n|$))`,
  String.raw`\n(?=${QUOTE_MARKS}[ \t]*${ITEM_SRC})(?<=(?:^|\n)${QUOTE_MARKS} {0,3}${ITEM_SRC}${PARAGRAPH_SINCE})`,
  String.raw`\n(?= {0,3}>)(?<!(?:^|\n) {0,3}>${PARAGRAPH_SINCE})`,
].join("|");
const PARAGRAPH = `(?!${PARAGRAPH_END})`;
const BOLD_SRC = String.raw`\*\*(?=[^\s*])((?:${PARAGRAPH}(?:[^*]|\*(?!\*)))+?)(?<=\S)\*\*`;
const QUOTE_SRC = [
  `"((?:${PARAGRAPH}[^"])+)"`,
  `“((?:${PARAGRAPH}[^”])+)”`,
  `‘((?:${PARAGRAPH}[^’])+)’`,
  String.raw`(?<![\p{L}\p{N}])'((?:${PARAGRAPH}[^'])+)'(?![\p{L}\p{N}])`,
].join("|");
const PATH_SRC = String.raw`(?:[\w.-]+\/)*[\w.-]+?`;
const CITE_RE = new RegExp(String.raw`\`(${PATH_SRC}\.md)\`\s+${BOLD_SRC}`, "dg");
const LAW_SRC = String.raw`(?<![\w.-])HARRY\.md\`?`;
const LAW_CITE_RE = new RegExp(String.raw`${LAW_SRC}\s+${BOLD_SRC}`, "dg");

type Connector = { name: string; src: string };

export const CONNECTORS: Record<"possessive" | "mark" | "opener", Connector[]> = {
  possessive: [{ name: "an apostrophe-s", src: "'s|’s" }],
  mark: [
    { name: "a comma", src: "," },
    { name: "a colon", src: ":" },
    { name: "an em dash", src: "—" },
    { name: "an en dash", src: "–" },
    { name: "a hyphen with a space on each side", src: String.raw`(?<=\s)-(?=\s)` },
  ],
  opener: [{ name: "an opening parenthesis", src: String.raw`\(` }],
};

const anyOf = (connectors: Connector[]): string => connectors.map((c) => c.src).join("|");

const CONNECTOR_SRC = [CONNECTORS.possessive, CONNECTORS.mark, CONNECTORS.opener]
  .map((slot) => String.raw`(?:${anyOf(slot)})?\s*`)
  .join("");

type LegacyForm = { label: string; re: RegExp; samples: string[]; form: string };
export const LEGACY_FORMS: LegacyForm[] = [
  {
    label: "an audit dimension by number",
    re: /\bdimensions? \(?\d/gi,
    samples: ["/audit dimension 10", "dimension (2)", "dimensions 1 and 2", "Dimension 10"],
    form: FORM.dimension,
  },
  {
    label: "a skill's step with no path",
    re: /\b(?:brainstorming|executing|finishing)`?(?:'s)?\s+step \d/g,
    samples: ["as executing step 4 does", "`skills/executing` step 4"],
    form: FORM.path,
  },
  {
    label: "a law named in plain text",
    re: new RegExp(String.raw`${LAW_SRC}${CONNECTOR_SRC}(?:${LAW_HEADINGS.join("|")})\b`, "g"),
    samples: ["HARRY.md Tiers", "HARRY.md – Tiers", "~/.claude/harry/HARRY.md Tiers"],
    form: FORM.law,
  },
  {
    label: "a skill's step in parentheses",
    re: /(?<!\/)\b(?:brainstorming|executing|finishing)(?!\/)[^`*]{0,60}?\(step \d\)/g,
    samples: ["the finishing skill's review (step 2)"],
    form: FORM.path,
  },
];
export const CORE_NAME_STRIPS: { name: string; re: RegExp }[] = [
  { name: "a leading `N. `", re: /^\d+\.\s+/ },
  { name: "a trailing ` — …`", re: /\s+—\s.*$/ },
  { name: "a trailing `(…)`", re: /\s*\([^)]*\)\s*$/ },
];

const coreName = (heading: string): string =>
  CORE_NAME_STRIPS.reduce((name, { re }) => name.replace(re, ""), heading).trim();

const cleanName = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const CODE_SPAN_RE = new RegExp(
  String.raw`(?<!\`)(\`+)(?!\`)(?:${PARAGRAPH}[\s\S])+?(?<!\`)\1(?!\`)`,
  "g",
);

const maskFences = (text: string): string => {
  const fenced = outline(text).map((line) => line.fenced);
  return text
    .split(/(\r\n|\r|\n)/)
    .map((part, i) => (i % 2 === 0 && fenced[i / 2] ? " ".repeat(part.length) : part))
    .join("");
};

const maskCode = (text: string): string =>
  maskFences(text).replace(CODE_SPAN_RE, (span) => span.replace(/[*"'“”‘’]/g, "\0"));

const PATH_ONLY_RE = new RegExp(String.raw`^(?:~[\w.-]*\/|\$\w+\/|\/)?${PATH_SRC}\/?$`);

type CodeSpan = { from: number; to: number; path: boolean };

const codeSpans = (prose: string): CodeSpan[] =>
  [...prose.matchAll(CODE_SPAN_RE)].map((s) => {
    const run = (s[1] as string).length;
    const from = s.index ?? 0;
    const inner = s[0].slice(run, -run).replace(/\r\n|\r|\n/g, " ");
    const padded = inner.startsWith(" ") && inner.endsWith(" ") && /[^ ]/.test(inner);
    return {
      from,
      to: from + s[0].length,
      path: PATH_ONLY_RE.test(padded ? inner.slice(1, -1) : inner),
    };
  });

const spanAt = (spans: CodeSpan[], at: number): CodeSpan | undefined =>
  spans.find((s) => at >= s.from && at < s.to);

const lastGroup = (text: string, m: RegExpExecArray): string => {
  const [from, to] = m.indices?.[m.length - 1] ?? [0, 0];
  return text.slice(from, to);
};

const LABEL_RE = new RegExp(String.raw`^\d+\. ${BOLD_SRC}`, "dgm");

export const namesIn = (text: string): Name[] => {
  const headings = outline(text).flatMap(({ fenced, level, title }, i) =>
    !fenced && level >= 2
      ? [{ line: i + 1, name: { name: coreName(title), full: title, level } }]
      : [],
  );
  const labels = [...maskCode(text).matchAll(LABEL_RE)].map((m) => {
    const full = cleanName(lastGroup(text, m)).replace(/[.:]$/, "").trim();
    return { line: lineOf(text, m.index), name: { name: coreName(full), full } };
  });
  return [...headings, ...labels].sort((a, b) => a.line - b.line).map(({ name }) => name);
};

export const resolveName = (
  all: Name[],
  target: string,
  name: string,
  level?: number,
): string | null => {
  const names = all.filter((n) => level === undefined || n.level === level);
  const matches = names.filter((n) => n.name === name);
  if (matches.length > 1)
    return `${target} **${name}** is ambiguous: ${matches.map((n) => `"${n.full}"`).join(", ")}`;
  if (matches.length === 1) return null;
  const full = names.find((n) => n.full === name);
  if (full) return `${target} **${name}**: cite its core name **${full.name}**`;
  return level === undefined
    ? `${target} has no heading or step "${name}"`
    : `${target} has no ${"#".repeat(level)} heading "${name}"`;
};

export const resolveCitation = (
  repo: Repo,
  target: string,
  name: string,
  level?: number,
): string | null =>
  repo.kind(target) === "file"
    ? resolveName(repo.names(target), target, name, level)
    : `${target} is not tracked`;

export const legacyHits = (text: string): string[] => {
  const prose = maskFences(text);
  const spans = codeSpans(prose);
  return LEGACY_FORMS.flatMap(({ label, re, form }) =>
    [...prose.matchAll(re)].flatMap((m) =>
      spanAt(spans, m.index ?? 0)?.path === false
        ? []
        : [`${lineOf(text, m.index)} -> ${label}; cite it as ${form}`],
    ),
  );
};

const DIMENSION_CITE_RE = new RegExp(String.raw`\bdimensions?\s+${BOLD_SRC}`, "dgi");

const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";

type Checked = { seen: number; failures: string[] };

const checkEach = (
  text: string,
  re: RegExp,
  judge: (m: RegExpExecArray, name: string) => string | null,
): Checked => {
  const matches = [...maskCode(text).matchAll(re)];
  return {
    seen: matches.length,
    failures: matches.flatMap((m) => {
      const failure = judge(m, cleanName(lastGroup(text, m)));
      return failure ? [`${lineOf(text, m.index)} -> ${failure}`] : [];
    }),
  };
};

export const citeFailures = (repo: Repo, text: string): Checked =>
  checkEach(text, CITE_RE, (m, name) => resolveCitation(repo, m[1] as string, name));

export const lawFailures = (text: string): Checked =>
  checkEach(text, LAW_CITE_RE, (_, name) =>
    LAW_HEADINGS.includes(name) ? null : `HARRY.md **${name}**`,
  );

export const lawLabelFailures = (jsonl: string): Checked => {
  const { entries, errors } = parseCasesJsonl(jsonl);
  return {
    seen: entries.length + errors.length,
    failures: [
      ...errors,
      ...entries.flatMap(({ record, line }) => {
        const law: unknown = record.law;
        return typeof law === "string" &&
          (LAW_HEADINGS.includes(law) || NON_LAW_LABELS.includes(law))
          ? []
          : [`${caseName(record, line)} -> law ${String(law)}`];
      }),
    ],
  };
};

export const dimensionFailures = (repo: Repo, text: string): Checked =>
  checkEach(text, DIMENSION_CITE_RE, (_, name) => resolveCitation(repo, SCAN_DIMENSIONS, name, 2));

const citeTarget = (repo: Repo, cited: string): string | null => {
  const target = cited.endsWith(".md") ? cited : `${cited}/SKILL.md`;
  return repo.kind(target) === "file" ? target : null;
};

const PATH_TOKEN_RE = new RegExp(
  String.raw`\`(${PATH_SRC})\/?\`|(?<![\w\`/.~$:-])(${PATH_SRC})\/?(?![\w\`/-]|\.\w)`,
  "g",
);
const SENTENCE_END_RE = new RegExp(String.raw`\.(?:\s|$)|${PARAGRAPH_END}`, "g");
const CONNECTOR_RE = new RegExp(`^${CONNECTOR_SRC}`);
const STEP_NUMBER_RE = new RegExp(String.raw`^${CONNECTOR_SRC}(?:steps?|category) \d`);
const PAREN_STEP_RE = /\(steps? \d/;
const BOLD_RE = new RegExp(BOLD_SRC, "g");
const QUOTED_OR_BOLD_RE = new RegExp(`${BOLD_SRC}|${QUOTE_SRC}`, "gu");
const STEP_HINT = `cite the step by its label, as ${FORM.path}`;

const exactCitations = (text: string): Set<number> =>
  new Set(
    [CITE_RE, LAW_CITE_RE, DIMENSION_CITE_RE].flatMap((re) =>
      [...maskCode(text).matchAll(re)].map((m) => (m.indices?.[m.length - 1]?.[0] ?? 0) - 2),
    ),
  );

type PathMention = {
  cited: string;
  target: string | null;
  advice: string;
  start: number;
  end: number;
  from: number;
  after: string;
};

const pathMentions = (repo: Repo, text: string): PathMention[] => {
  const prose = maskFences(text);
  const spans = codeSpans(prose);
  const ends = [...prose.matchAll(SENTENCE_END_RE)].map((e) => e.index ?? 0);
  return [...prose.matchAll(PATH_TOKEN_RE)].flatMap((m) => {
    const span = spanAt(spans, m.index ?? 0);
    if (span && !span.path) return [];
    const cited = (m[1] ?? m[2]) as string;
    const isFile = cited.endsWith(".md");
    if (!isFile && !cited.includes("/")) return [];
    const kind = repo.kind(cited);
    if (m[2] !== undefined && !span && !isFile && kind === "untracked") return [];
    const target = citeTarget(repo, cited);
    const start = span?.from ?? m.index ?? 0;
    const end = span?.to ?? start + m[0].length;
    const advice =
      kind === "untracked"
        ? `${cited} is not tracked`
        : kind === "dir"
          ? `cite it as ${target ? FORM.skillDir : FORM.dirFile}`
          : isFile
            ? `cite it as ${cited === "HARRY.md" ? FORM.law : FORM.path}`
            : `${cited} is not markdown, so it has no section to cite`;
    const from = ends.reduce((last, e) => (e < start ? e + 1 : last), 0);
    const after = text.slice(end, ends.find((e) => e >= end) ?? text.length);
    return [{ cited, target, advice, start, end, from, after }];
  });
};

export const plainNameCitations = (repo: Repo, text: string): string[] =>
  pathMentions(repo, text).flatMap(({ target, start, end }) => {
    if (!target) return [];
    const rest = text.slice(end).replace(CONNECTOR_RE, "");
    const name = repo
      .names(target)
      .map((n) => n.name)
      .find((n) => rest.startsWith(n) && !/^[\w-]/.test(rest.slice(n.length)));
    return name ? [`${lineOf(text, start)} -> ${target} "${name}"`] : [];
  });

type Span = { at: number; end: number; name: string; bold: boolean };

const spansOf = (text: string, re: RegExp): Span[] =>
  [...maskCode(text).matchAll(re)].map((m) => {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const bold = m[1] !== undefined;
    const mark = bold ? 2 : 1;
    return { at, end, name: text.slice(at + mark, end - mark), bold };
  });

const boldSpans = (text: string): Span[] => spansOf(text, BOLD_RE);

const hitList = (text: string) => {
  const hits = new Map<number, string>();
  return {
    hit: (index: number, message: string) => {
      if (!hits.has(index)) hits.set(index, `${lineOf(text, index)} -> ${message}`);
    },
    list: () => [...hits.entries()].sort(([a], [b]) => a - b).map(([, message]) => message),
  };
};

export const citationAttempts = (repo: Repo, text: string): string[] => {
  const exactAt = exactCitations(text);
  const { hit, list } = hitList(text);
  const spans = spansOf(text, QUOTED_OR_BOLD_RE);
  for (const { cited, target, advice, start, end, from, after } of pathMentions(repo, text)) {
    const exact = exactAt.has(end + (/^\s*/.exec(after)?.[0].length ?? 0));
    const lead = end + (CONNECTOR_RE.exec(after)?.[0].length ?? 0);
    const opener = spans.find(
      (s) =>
        (s.bold && s.at === lead) ||
        (!s.bold && s.at === lead + (text[lead] === "\\" ? 1 : 0) && /^\w/.test(s.name)),
    );
    const adjacent = !exact && opener !== undefined;
    if (adjacent) hit(end, `a name next to ${cited}; ${advice}`);
    if (!target) continue;
    const names = new Set(repo.names(target).flatMap((n) => [n.name, n.full]));
    const afterEnd = end + after.length;
    for (const s of spans) {
      if (!((s.at >= from && s.end <= start) || (s.at >= end && s.end <= afterEnd))) continue;
      if (adjacent && s === opener) continue;
      if (s.bold && exactAt.has(s.at)) continue;
      const name = cleanName(s.name);
      if (names.has(name)) hit(s.at, `${cited} "${name}" outside the citation form; ${advice}`);
    }
  }
  return list();
};

export const stepAttempts = (repo: Repo, text: string): string[] => {
  const { hit, list } = hitList(text);
  for (const { cited, end, after } of pathMentions(repo, text)) {
    if (STEP_NUMBER_RE.test(after))
      hit(end, `a step or category number after ${cited}; ${STEP_HINT}`);
    const paren = PAREN_STEP_RE.exec(after);
    if (paren) hit(end + paren.index, `a step number in the sentence after ${cited}; ${STEP_HINT}`);
  }
  for (const { at, end } of boldSpans(text))
    if (STEP_NUMBER_RE.test(text.slice(end, end + 40)))
      hit(at, `a step or category number after a name; ${STEP_HINT}`);
  return list();
};

export const lawAttempts = (text: string): string[] => {
  const exactAt = exactCitations(text);
  const { hit, list } = hitList(text);
  for (const { at, name } of boldSpans(text)) {
    if (LAW_HEADINGS.includes(cleanName(name)) && !exactAt.has(at))
      hit(at, `**${name}** names a law with no HARRY.md before it; cite it as ${FORM.law}`);
  }
  return list();
};

const STRAY_BOLD =
  "a ** that pairs with nothing renders as asterisks; bold opens before a non-space " +
  "and closes after one, in the same paragraph";

const THEMATIC_BREAK_RE = new RegExp(String.raw`^${QUOTE_MARKS} {0,3}${BREAK_SRC}$`, "gm");

export const strayBold = (text: string): string[] => {
  const marks = new Set(boldSpans(text).flatMap(({ at, end }) => [at, end - 2]));
  const prose = maskCode(text).replace(THEMATIC_BREAK_RE, (line) => " ".repeat(line.length));
  return [...prose.matchAll(/\*{2,}/g)].flatMap((run) => {
    const at = run.index ?? 0;
    for (let i = at; i < at + run[0].length - 1; i++) if (marks.has(i)) return [];
    return [`${lineOf(text, at)} -> ${STRAY_BOLD}`];
  });
};

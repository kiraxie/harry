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
const CITE_RE = /`((?:[\w.-]+\/)*[\w.-]+\.md)`\s+\*\*([^*]+)\*\*/dg;
const LAW_CITE_RE = /HARRY\.md`?\s+\*\*([^*]+)\*\*/dg;
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
    re: new RegExp(String.raw`HARRY\.md\`?(?:'s)?,?\s+(?:${LAW_HEADINGS.join("|")})\b`, "g"),
    samples: ["HARRY.md Tiers"],
    form: FORM.law,
  },
  {
    label: "a skill's step in parentheses",
    re: /(?<!\/)\b(?:brainstorming|executing|finishing)(?!\/)[^`*]{0,60}?\(step \d\)/g,
    samples: ["the finishing skill's review (step 2)"],
    form: FORM.path,
  },
];
const coreName = (heading: string): string =>
  heading
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+—\s.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

export const namesIn = (text: string): Name[] => {
  const names: Name[] = [];
  for (const { text: line, fenced, level, title } of outline(text)) {
    if (fenced) continue;
    if (level >= 2) {
      names.push({ name: coreName(title), full: title, level });
      continue;
    }
    const label = /^\d+\. \*\*([^*]+)\*\*/.exec(line);
    if (label) {
      const full = (label[1] as string).replace(/[.:]$/, "").trim();
      names.push({ name: coreName(full), full });
    }
  }
  return names;
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

export const legacyHits = (text: string): string[] =>
  LEGACY_FORMS.flatMap(({ label, re, form }) =>
    [...text.matchAll(re)].map((m) => `${lineOf(text, m.index)} -> ${label}; cite it as ${form}`),
  );

const DIMENSION_CITE_RE = /\bdimensions?\s+\*\*([^*]+)\*\*/dgi;

const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";

const cleanName = (raw: string): string => raw.replace(/\s+/g, " ").trim();

type Checked = { seen: number; failures: string[] };

const checkEach = (
  text: string,
  re: RegExp,
  judge: (m: RegExpExecArray) => string | null,
): Checked => {
  const matches = [...text.matchAll(re)];
  return {
    seen: matches.length,
    failures: matches.flatMap((m) => {
      const failure = judge(m);
      return failure ? [`${lineOf(text, m.index)} -> ${failure}`] : [];
    }),
  };
};

export const citeFailures = (repo: Repo, text: string): Checked =>
  checkEach(text, CITE_RE, (m) => resolveCitation(repo, m[1] as string, cleanName(m[2] as string)));

export const lawFailures = (text: string): Checked =>
  checkEach(text, LAW_CITE_RE, (m) => {
    const name = cleanName(m[1] as string);
    return LAW_HEADINGS.includes(name) ? null : `HARRY.md **${name}**`;
  });

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
  checkEach(text, DIMENSION_CITE_RE, (m) =>
    resolveCitation(repo, SCAN_DIMENSIONS, cleanName(m[1] as string), 2),
  );

const CONNECTOR_SRC = String.raw`(?:'s|’s)?\s*[,:—]?\s*\(?\s*`;
const PATH_THEN_PLAIN_RE = new RegExp(
  String.raw`\`((?:[\w.-]+\/)*[\w.-]+?)\/?\`${CONNECTOR_SRC}`,
  "g",
);

const citeTarget = (repo: Repo, cited: string): string | null => {
  const target = cited.endsWith(".md") ? cited : `${cited}/SKILL.md`;
  return repo.kind(target) === "file" ? target : null;
};

export const plainNameCitations = (repo: Repo, text: string): string[] =>
  [...text.matchAll(PATH_THEN_PLAIN_RE)].flatMap((m) => {
    const target = citeTarget(repo, m[1] as string);
    if (!target) return [];
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const name = repo
      .names(target)
      .map((n) => n.name)
      .find((n) => rest.startsWith(n) && !/^[\w-]/.test(rest.slice(n.length)));
    return name ? [`${lineOf(text, m.index)} -> ${target} "${name}"`] : [];
  });

const PATH_TOKEN_RE = /`((?:[\w.-]+\/)*[\w.-]+?)\/?`|(?<![\w`/.-])(HARRY\.md)(?![\w`])/g;
const SENTENCE_END_RE = /\.(?:\s|$)|\n\s*\n/g;
const CONNECTOR_RE = new RegExp(`^${CONNECTOR_SRC}`);
const STEP_NUMBER_RE = new RegExp(String.raw`^${CONNECTOR_SRC}(?:steps?|category) \d`);
const PAREN_STEP_RE = /\(steps? \d/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const QUOTED_OR_BOLD_RE = /\*\*([^*]+)\*\*|"([^"\n]+)"/g;
const LAW_NAMED_BEFORE_RE = new RegExp(String.raw`\bHARRY\.md\`?${CONNECTOR_SRC}$`);
const STEP_HINT = `cite the step by its label, as ${FORM.path}`;

const exactCitations = (text: string): Set<number> =>
  new Set(
    [CITE_RE, LAW_CITE_RE, DIMENSION_CITE_RE].flatMap((re) =>
      [...text.matchAll(re)].map((m) => (m.indices?.[m.length - 1]?.[0] ?? 0) - 2),
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
  const ends = [...text.matchAll(SENTENCE_END_RE)].map((e) => e.index ?? 0);
  return [...text.matchAll(PATH_TOKEN_RE)].flatMap((m) => {
    const cited = (m[1] ?? m[2]) as string;
    const isFile = cited.endsWith(".md");
    if (!isFile && !cited.includes("/")) return [];
    const target = citeTarget(repo, cited);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const kind = repo.kind(cited);
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

type Span = { at: number; end: number; name: string; bold: boolean };

const spansOf = (text: string, re: RegExp): Span[] =>
  [...text.matchAll(re)].map((m) => ({
    at: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    name: (m[1] ?? m[2]) as string,
    bold: m[1] !== undefined,
  }));

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
        (s.bold && s.at === lead && /^\S/.test(s.name)) ||
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
    if (
      LAW_HEADINGS.includes(cleanName(name)) &&
      !exactAt.has(at) &&
      !LAW_NAMED_BEFORE_RE.test(text.slice(Math.max(0, at - 20), at))
    )
      hit(at, `**${name}** names a law with no HARRY.md before it; cite it as ${FORM.law}`);
  }
  return list();
};

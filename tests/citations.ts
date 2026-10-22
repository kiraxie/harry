import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { caseName, parseCasesJsonl } from "../scripts/lib/evals-cases.mts";

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
const QUOTE_SRC = [
  `"([^"]+)"`,
  `“([^”]+)”`,
  `‘([^’]+)’`,
  String.raw`(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])`,
].join("|");
const PATH_SRC = String.raw`(?:[\w.-]+\/)*[\w.-]+?`;
const CITE_RE = new RegExp(String.raw`\`(${PATH_SRC}\.md)\`\s+`, "g");
const LAW_SRC = String.raw`(?<![\w.-])HARRY\.md\`?`;
const LAW_CITE_RE = new RegExp(String.raw`${LAW_SRC}\s+`, "g");

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

type MdNode = {
  type: string;
  position?: { start: { offset?: number; column: number }; end: { offset?: number } };
  children?: MdNode[];
  value?: string;
  depth?: number;
};

const FRONT_MATTER_RE = /^(---\r?\n)([\s\S]*?\r?\n)---[ \t]*(?=\r?\n|$)/;

const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");

const sources = (text: string): string[] => {
  const front = FRONT_MATTER_RE.exec(text);
  if (!front) return [text];
  const [all, open = "", body = ""] = front;
  return [blank(open) + body, blank(all) + text.slice(all.length)];
};

const parse = (src: string): MdNode =>
  fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

const offset = (node: MdNode, edge: "start" | "end"): number => node.position?.[edge].offset ?? 0;

const walk = (node: MdNode, visit: (node: MdNode) => void): void => {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
};

const contentRange = (node: MdNode): [number, number] | null => {
  const first = node.children?.[0];
  const last = node.children?.at(-1);
  return first && last ? [offset(first, "start"), offset(last, "end")] : null;
};

const PATH_ONLY_RE = new RegExp(String.raw`^(?:~[\w.-]*\/|\$\w+\/|\/)?${PATH_SRC}\/?$`);

type CodeSpan = { from: number; to: number; path: boolean };
type Bold = { at: number; end: number; name: string };
type Block = {
  at: number;
  text: string;
  masked: string;
  code: CodeSpan[];
  bold: Bold[];
  stray: number[];
};

const PROSE_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

const toBlock = (src: string, node: MdNode): Block | null => {
  const range = contentRange(node);
  if (!range) return null;
  const [at, to] = range;
  const text = src
    .slice(at, to)
    .replace(
      /(\r?\n)([ \t>]*)/g,
      (_, nl: string, prefix: string) => nl + " ".repeat(prefix.length),
    );
  const code: CodeSpan[] = [];
  const bold: Bold[] = [];
  const stray: number[] = [];
  walk(node, (n) => {
    const from = offset(n, "start") - at;
    const end = offset(n, "end") - at;
    if (n.type === "inlineCode")
      code.push({ from, to: end, path: PATH_ONLY_RE.test(n.value ?? "") });
    else if (n.type === "strong") bold.push({ at: from, end, name: text.slice(from + 2, end - 2) });
    else if (n.type === "text")
      for (const run of text.slice(from, end).matchAll(/\*{2,}/g))
        stray.push(from + (run.index ?? 0));
  });
  const masked = code.reduce(
    (t, s) =>
      t.slice(0, s.from) + t.slice(s.from, s.to).replace(/[*"'“”‘’]/g, "\0") + t.slice(s.to),
    text,
  );
  return { at, text, masked, code, bold, stray };
};

const blocks = (text: string): Block[] =>
  sources(text).flatMap((src) => {
    const found: Block[] = [];
    const visit = (node: MdNode): void => {
      if (!PROSE_BLOCKS.has(node.type)) for (const child of node.children ?? []) visit(child);
      else {
        const block = toBlock(src, node);
        if (block) found.push(block);
      }
    };
    visit(parse(src));
    return found;
  });

const spanAt = (spans: CodeSpan[], at: number): CodeSpan | undefined =>
  spans.find((s) => at >= s.from && at < s.to);

const labelOf = (src: string, item: MdNode): string | null => {
  const [first] = item.children ?? [];
  const [lead] = first?.type === "paragraph" ? (first.children ?? []) : [];
  if (item.position?.start.column !== 1 || !/^\d+\. /.test(src.slice(offset(item, "start"))))
    return null;
  if (lead?.type !== "strong") return null;
  return cleanName(src.slice(offset(lead, "start") + 2, offset(lead, "end") - 2))
    .replace(/[.:]$/, "")
    .trim();
};

export const namesIn = (text: string): Name[] => {
  const found: { at: number; name: Name }[] = [];
  for (const src of sources(text))
    walk(parse(src), (node) => {
      const range = contentRange(node);
      if (node.type === "heading" && range && (node.depth ?? 0) >= 2) {
        const full = cleanName(src.slice(...range));
        found.push({ at: range[0], name: { name: coreName(full), full, level: node.depth } });
      }
      const full = node.type === "listItem" ? labelOf(src, node) : null;
      if (full) found.push({ at: offset(node, "start"), name: { name: coreName(full), full } });
    });
  return found.sort((a, b) => a.at - b.at).map(({ name }) => name);
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
  const all = blocks(text);
  return LEGACY_FORMS.flatMap(({ label, re, form }) =>
    all.flatMap((b) =>
      [...b.text.matchAll(re)].flatMap((m) =>
        spanAt(b.code, m.index ?? 0)?.path === false
          ? []
          : [`${lineOf(text, b.at + (m.index ?? 0))} -> ${label}; cite it as ${form}`],
      ),
    ),
  );
};

const DIMENSION_CITE_RE = /\bdimensions?\s+/gi;

const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";

type Checked = { seen: number; failures: string[] };

type Lead = { at: number; m: RegExpExecArray; bold: Bold };

const leads = (b: Block, re: RegExp): Lead[] =>
  [...b.masked.matchAll(re)].flatMap((m) => {
    const bold = b.bold.find((s) => s.at === (m.index ?? 0) + m[0].length);
    return bold ? [{ at: b.at + (m.index ?? 0), m, bold }] : [];
  });

const checkEach = (
  text: string,
  re: RegExp,
  judge: (m: RegExpExecArray, name: string) => string | null,
): Checked => {
  const found = blocks(text).flatMap((b) => leads(b, re));
  return {
    seen: found.length,
    failures: found.flatMap(({ at, m, bold }) => {
      const failure = judge(m, cleanName(bold.name));
      return failure ? [`${lineOf(text, at)} -> ${failure}`] : [];
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
const SENTENCE_END_RE = /\.(?:\s|$)/g;
const CONNECTOR_RE = new RegExp(`^${CONNECTOR_SRC}`);
const STEP_NUMBER_RE = new RegExp(String.raw`^${CONNECTOR_SRC}(?:steps?|category) \d`);
const PAREN_STEP_RE = /\(steps? \d/;
const QUOTE_RE = new RegExp(QUOTE_SRC, "gu");
const STEP_HINT = `cite the step by its label, as ${FORM.path}`;

const exactCitations = (b: Block): Set<number> =>
  new Set(
    [CITE_RE, LAW_CITE_RE, DIMENSION_CITE_RE].flatMap((re) => leads(b, re).map((l) => l.bold.at)),
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

const pathMentions = (repo: Repo, b: Block): PathMention[] => {
  const ends = [...b.text.matchAll(SENTENCE_END_RE)].map((e) => e.index ?? 0);
  return [...b.text.matchAll(PATH_TOKEN_RE)].flatMap((m) => {
    const span = spanAt(b.code, m.index ?? 0);
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
    const after = b.text.slice(end, ends.find((e) => e >= end) ?? b.text.length);
    return [{ cited, target, advice, start, end, from, after }];
  });
};

export const plainNameCitations = (repo: Repo, text: string): string[] =>
  blocks(text).flatMap((b) =>
    pathMentions(repo, b).flatMap(({ target, start, end }) => {
      if (!target) return [];
      const rest = b.text.slice(end).replace(CONNECTOR_RE, "");
      const name = repo
        .names(target)
        .map((n) => n.name)
        .find((n) => rest.startsWith(n) && !/^[\w-]/.test(rest.slice(n.length)));
      return name ? [`${lineOf(text, b.at + start)} -> ${target} "${name}"`] : [];
    }),
  );

type Span = { at: number; end: number; name: string; bold: boolean };

const quotedOrBold = (b: Block): Span[] => {
  const spans: Span[] = [];
  for (let from = 0; ; ) {
    QUOTE_RE.lastIndex = from;
    const quote = QUOTE_RE.exec(b.masked);
    const bold = b.bold.find((s) => s.at >= from);
    if (bold && (!quote || bold.at <= quote.index)) {
      spans.push({ ...bold, bold: true });
      from = bold.end;
    } else if (quote) {
      const end = quote.index + quote[0].length;
      spans.push({
        at: quote.index,
        end,
        name: b.text.slice(quote.index + 1, end - 1),
        bold: false,
      });
      from = end;
    } else return spans;
  }
};

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
  const { hit, list } = hitList(text);
  for (const b of blocks(text)) {
    const exactAt = exactCitations(b);
    const spans = quotedOrBold(b);
    for (const { cited, target, advice, start, end, from, after } of pathMentions(repo, b)) {
      const exact = exactAt.has(end + (/^\s*/.exec(after)?.[0].length ?? 0));
      const lead = end + (CONNECTOR_RE.exec(after)?.[0].length ?? 0);
      const opener = spans.find(
        (s) =>
          (s.bold && s.at === lead) ||
          (!s.bold && s.at === lead + (b.text[lead] === "\\" ? 1 : 0) && /^\w/.test(s.name)),
      );
      const adjacent = !exact && opener !== undefined;
      if (adjacent) hit(b.at + end, `a name next to ${cited}; ${advice}`);
      if (!target) continue;
      const names = new Set(repo.names(target).flatMap((n) => [n.name, n.full]));
      const afterEnd = end + after.length;
      for (const s of spans) {
        if (!((s.at >= from && s.end <= start) || (s.at >= end && s.end <= afterEnd))) continue;
        if (adjacent && s === opener) continue;
        if (s.bold && exactAt.has(s.at)) continue;
        const name = cleanName(s.name);
        if (names.has(name))
          hit(b.at + s.at, `${cited} "${name}" outside the citation form; ${advice}`);
      }
    }
  }
  return list();
};

export const stepAttempts = (repo: Repo, text: string): string[] => {
  const { hit, list } = hitList(text);
  for (const b of blocks(text)) {
    for (const { cited, end, after } of pathMentions(repo, b)) {
      if (STEP_NUMBER_RE.test(after))
        hit(b.at + end, `a step or category number after ${cited}; ${STEP_HINT}`);
      const paren = PAREN_STEP_RE.exec(after);
      if (paren)
        hit(b.at + end + paren.index, `a step number in the sentence after ${cited}; ${STEP_HINT}`);
    }
    for (const { at, end } of b.bold)
      if (STEP_NUMBER_RE.test(b.text.slice(end, end + 40)))
        hit(b.at + at, `a step or category number after a name; ${STEP_HINT}`);
  }
  return list();
};

export const lawAttempts = (text: string): string[] => {
  const { hit, list } = hitList(text);
  for (const b of blocks(text)) {
    const exactAt = exactCitations(b);
    for (const { at, name } of b.bold)
      if (LAW_HEADINGS.includes(cleanName(name)) && !exactAt.has(at))
        hit(
          b.at + at,
          `**${name}** names a law with no HARRY.md before it; cite it as ${FORM.law}`,
        );
  }
  return list();
};

const STRAY_BOLD =
  "a ** that pairs with nothing renders as asterisks; bold opens before a non-space " +
  "and closes after one, in the same paragraph";

export const strayBold = (text: string): string[] =>
  blocks(text).flatMap((b) => b.stray.map((at) => `${lineOf(text, b.at + at)} -> ${STRAY_BOLD}`));

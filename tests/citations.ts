import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { caseName, parseCasesJsonl } from "../scripts/lib/evals-cases.mts";
import { lineAt } from "./lines.ts";

export type Name = { name: string; full: string; level?: number; bullets?: string[] };

export type Repo = {
  kind: (rel: string) => "file" | "dir" | "untracked";
  names: (rel: string) => Name[];
};

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
  bullet: '"Bullet" bullet of `path` **Name**',
} as const;
const QUOTE_SRC = [
  `"([^"]+)"`,
  `“([^”]+)”`,
  `‘([^’]+)’`,
  String.raw`(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])`,
].join("|");
const PATH_SRC = String.raw`(?:[\w.-]+\/)*[\w.-]+?`;
const LAW_SRC = String.raw`(?<![\w.-])HARRY\.md\`?`;
const CITE_FORMS: Record<"path" | "law" | "dimension" | "bullet", { re: RegExp; quoted: boolean }> =
  {
    path: { re: new RegExp(String.raw`\`(${PATH_SRC}\.md)\`\s+`, "g"), quoted: false },
    law: { re: new RegExp(String.raw`${LAW_SRC}\s+`, "g"), quoted: false },
    dimension: { re: /\bdimensions?\s+/gi, quoted: false },
    bullet: {
      re: new RegExp(`(?:${QUOTE_SRC})\\s+bullet\\s+of\\s+\`(?<path>${PATH_SRC}\\.md)\`\\s+`, "gu"),
      quoted: true,
    },
  };

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
  lang?: string | null;
  meta?: string | null;
  ordered?: boolean | null;
};

const FRONT_MATTER_RE = /^(---\r?\n)([\s\S]*?\r?\n)---[ \t]*(?=\r?\n|$)/;

const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");

const sources = (text: string): string[] => {
  const front = FRONT_MATTER_RE.exec(text);
  if (!front) return [text];
  const [all, open = "", body = ""] = front;
  return [blank(open) + body, blank(all) + text.slice(all.length)];
};

const FENCE_BODY = { disable: { null: ["codeIndented", "definition", "htmlFlow", "htmlText"] } };

// gfm's autolink transform splits a [-led text node into unpositioned nodes; no scan reads a link.
const GFM_MDAST = gfmFromMarkdown().map((extension) =>
  extension.enter?.literalAutolink ? { ...extension, transforms: [] } : extension,
);

const parse = (src: string, body = false): MdNode =>
  fromMarkdown(src, {
    extensions: body ? [gfm(), FENCE_BODY] : [gfm()],
    mdastExtensions: GFM_MDAST,
  });

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

export type CodeSpan = { from: number; to: number; value: string; path: boolean };
type Bold = { at: number; end: number; name: string };
export type Block = {
  lineAt: (i: number) => number;
  text: string;
  prose: string;
  code: CodeSpan[];
  bold: Bold[];
  stray: number[];
  fenced: boolean;
};
type Parsed = Omit<Block, "lineAt" | "fenced"> & { at: number };

const PROSE_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

const toBlock = (src: string, node: MdNode): Parsed | null => {
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
      code.push({ from, to: end, value: n.value ?? "", path: PATH_ONLY_RE.test(n.value ?? "") });
    else if (n.type === "strong") bold.push({ at: from, end, name: text.slice(from + 2, end - 2) });
    else if (n.type === "text")
      for (const run of text.slice(from, end).matchAll(/\*{2,}/g))
        stray.push(from + (run.index ?? 0));
  });
  const prose = code.reduce(
    (t, s) => t.slice(0, s.from) + blank(t.slice(s.from, s.to)) + t.slice(s.to),
    text,
  );
  return { at, text, prose, code, bold, stray };
};

const masked = (b: Block): string =>
  b.code.reduce(
    (t, s) =>
      t.slice(0, s.from) + t.slice(s.from, s.to).replace(/[*"'“”‘’]/g, "\0") + t.slice(s.to),
    b.text,
  );

const parsed = (text: string, body: boolean): Parsed[] =>
  (body ? [text] : sources(text)).flatMap((src) => {
    const found: Parsed[] = [];
    const visit = (node: MdNode): void => {
      if (!PROSE_BLOCKS.has(node.type)) for (const child of node.children ?? []) visit(child);
      else {
        const block = toBlock(src, node);
        if (block) found.push(block);
      }
    };
    visit(parse(src, body));
    return found;
  });

export type Fence = { info: string; text: string; line: number };

const FENCE_OPEN_RE = /^(?:`{3,}|~{3,})/;

export const fences = (text: string): Fence[] => {
  const src = sources(text).at(-1) ?? text;
  const found: Fence[] = [];
  walk(parse(src), (node) => {
    const at = offset(node, "start");
    if (node.type !== "code" || !FENCE_OPEN_RE.test(src.slice(at))) return;
    const info = [node.lang, node.meta].filter(Boolean).join(" ");
    found.push({ info, text: node.value ?? "", line: lineAt(src, at) + 1 });
  });
  return found;
};

export const untaggedFences = (text: string): Fence[] =>
  fences(text).filter((fence) => !fence.info);

export const fenceBlocks = (fence: Fence): Block[] =>
  parsed(fence.text, true).map(({ at, ...b }) => ({
    ...b,
    fenced: true,
    lineAt: (i) => fence.line + lineAt(fence.text, at + i) - 1,
  }));

const proseBlocks = (text: string): Block[] =>
  [
    ...parsed(text, false).map(({ at, ...b }) => ({
      ...b,
      fenced: false,
      lineAt: (i: number) => lineAt(text, at + i),
    })),
    ...untaggedFences(text).flatMap(fenceBlocks),
  ].sort((a, b) => a.lineAt(0) - b.lineAt(0));

export const readProse = (rel: string, text: string): Block[] =>
  rel.endsWith(".md")
    ? proseBlocks(text)
    : fenceBlocks({ info: "", text, line: 1 }).map((b) => ({ ...b, fenced: false }));

const spanAt = (spans: CodeSpan[], at: number): CodeSpan | undefined =>
  spans.find((s) => at >= s.from && at < s.to);

export const TRAILING_MARK: { name: string; re: RegExp } = {
  name: "a trailing `.` or `:`",
  re: /[.:]$/,
};

const leadLabel = (src: string, item: MdNode): string | null => {
  const [first] = item.children ?? [];
  const [lead] = first?.type === "paragraph" ? (first.children ?? []) : [];
  if (lead?.type !== "strong") return null;
  return cleanName(src.slice(offset(lead, "start") + 2, offset(lead, "end") - 2))
    .replace(TRAILING_MARK.re, "")
    .trim();
};

const labelOf = (src: string, item: MdNode): string | null =>
  item.position?.start.column === 1 && /^\d+\. /.test(src.slice(offset(item, "start")))
    ? leadLabel(src, item)
    : null;

const sectionBullets = (src: string, root: MdNode): Map<MdNode, string[]> => {
  const bullets = new Map<MdNode, string[]>();
  let open: { depth: number; labels: string[] }[] = [];
  for (const node of root.children ?? []) {
    if (node.type === "heading") {
      const depth = node.depth ?? 0;
      const labels: string[] = [];
      open = [...open.filter((h) => h.depth < depth), { depth, labels }];
      bullets.set(node, labels);
    } else if (node.type === "list" && !node.ordered) {
      const found = (node.children ?? []).flatMap((item) => leadLabel(src, item) ?? []);
      for (const h of open) h.labels.push(...found);
    }
  }
  return bullets;
};

export const namesIn = (text: string): Name[] => {
  const found: { at: number; name: Name }[] = [];
  for (const src of sources(text)) {
    const root = parse(src);
    const bullets = sectionBullets(src, root);
    walk(root, (node) => {
      const range = contentRange(node);
      if (node.type === "heading" && range && (node.depth ?? 0) >= 2) {
        const full = cleanName(src.slice(...range));
        found.push({
          at: range[0],
          name: { name: coreName(full), full, level: node.depth, bullets: bullets.get(node) ?? [] },
        });
      }
      const full = node.type === "listItem" ? labelOf(src, node) : null;
      if (full) found.push({ at: offset(node, "start"), name: { name: coreName(full), full } });
    });
  }
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

export const resolveBullet = (
  repo: Repo,
  target: string,
  section: string,
  bullet: string,
): string | null => {
  const failure = resolveCitation(repo, target, section);
  if (failure) return failure;
  const heading = repo.names(target).find((n) => n.name === section);
  if (heading?.level === undefined)
    return `${target} **${section}** is a step, not a section; a bullet is cited from its heading`;
  const labels = heading.bullets ?? [];
  const matches = labels.filter((label) => label === bullet).length;
  if (matches === 1) return null;
  const cited = `"${bullet}" bullet of ${target} **${section}**`;
  if (matches > 1) return `${cited} is ambiguous: ${matches} bullets carry that label`;
  const bare = bullet.replace(TRAILING_MARK.re, "");
  if (bare !== bullet && labels.filter((label) => label === bare).length === 1)
    return `${cited}: drop the trailing "${bullet.at(-1)}"`;
  const longer = labels.filter((label) => label.startsWith(bullet));
  return longer.length === 1
    ? `${cited}: cite its whole bold label "${longer[0]}"`
    : `${cited} names no top-level bold-labelled bullet of that section`;
};

export const legacyHits = (blocks: Block[]): string[] =>
  LEGACY_FORMS.flatMap(({ label, re, form }) =>
    blocks.flatMap((b) =>
      [...b.text.matchAll(re)].flatMap((m) =>
        spanAt(b.code, m.index ?? 0)?.path === false
          ? []
          : [`${b.lineAt(m.index ?? 0)} -> ${label}; cite it as ${form}`],
      ),
    ),
  );

export const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";

type Checked = { seen: number; failures: string[] };

type Lead = { at: number; m: RegExpExecArray; bold: Bold };

const leads = (b: Block, re: RegExp): Lead[] =>
  [...masked(b).matchAll(re)].flatMap((m) => {
    const bold = b.bold.find((s) => s.at === (m.index ?? 0) + m[0].length);
    return bold ? [{ at: m.index ?? 0, m, bold }] : [];
  });

const checkEach = (
  blocks: Block[],
  re: RegExp,
  judge: (m: RegExpExecArray, name: string) => string | null,
): Checked => {
  const found = blocks.flatMap((b) => leads(b, re).map((lead) => ({ b, ...lead })));
  return {
    seen: found.length,
    failures: found.flatMap(({ b, at, m, bold }) => {
      const failure = judge(m, cleanName(bold.name));
      return failure ? [`${b.lineAt(at)} -> ${failure}`] : [];
    }),
  };
};

export const citeFailures = (repo: Repo, blocks: Block[]): Checked =>
  checkEach(blocks, CITE_FORMS.path.re, (m, name) => resolveCitation(repo, m[1] as string, name));

export const bulletFailures = (repo: Repo, blocks: Block[]): Checked =>
  checkEach(blocks, CITE_FORMS.bullet.re, (m, section) =>
    resolveBullet(
      repo,
      m.groups?.path as string,
      section,
      cleanName(m.slice(1).find(Boolean) ?? ""),
    ),
  );

export const lawFailures = (blocks: Block[]): Checked =>
  checkEach(blocks, CITE_FORMS.law.re, (_, name) =>
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

const dimensionFailure = (repo: Repo, name: string): string | null =>
  resolveCitation(repo, SCAN_DIMENSIONS, name, 2);

export const dimensionFailures = (repo: Repo, blocks: Block[]): Checked =>
  checkEach(blocks, CITE_FORMS.dimension.re, (_, name) => dimensionFailure(repo, name));

export const blockDimensionFailures = (repo: Repo, b: Block): { line: number; failure: string }[] =>
  leads(b, CITE_FORMS.dimension.re).flatMap(({ at, bold }) => {
    const failure = dimensionFailure(repo, cleanName(bold.name));
    return failure ? [{ line: b.lineAt(at), failure }] : [];
  });

export const cites = (b: Block): { path: string; name: string }[] =>
  leads(b, CITE_FORMS.path.re).map(({ m, bold }) => ({
    path: m[1] as string,
    name: cleanName(bold.name),
  }));

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
    Object.values(CITE_FORMS).flatMap(({ re, quoted }) =>
      leads(b, re).flatMap((l) => (quoted ? [l.at, l.bold.at] : [l.bold.at])),
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

export const plainNameCitations = (repo: Repo, blocks: Block[]): string[] =>
  blocks.flatMap((b) =>
    pathMentions(repo, b).flatMap(({ target, start, end }) => {
      if (!target) return [];
      const rest = b.text.slice(end).replace(CONNECTOR_RE, "");
      const name = repo
        .names(target)
        .map((n) => n.name)
        .find((n) => rest.startsWith(n) && !/^[\w-]/.test(rest.slice(n.length)));
      return name ? [`${b.lineAt(start)} -> ${target} "${name}"`] : [];
    }),
  );

type Span = { at: number; end: number; name: string; bold: boolean };

const quotedOrBold = (b: Block): Span[] => {
  const spans: Span[] = [];
  const text = masked(b);
  for (let from = 0; ; ) {
    QUOTE_RE.lastIndex = from;
    const quote = QUOTE_RE.exec(text);
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

type Hit = { line: number; n: number; i: number; message: string };

const hitList = () => {
  const hits = new Map<string, Hit>();
  return {
    hitIn: (b: Block, n: number) => (i: number, message: string) => {
      const key = `${n}:${i}`;
      if (!hits.has(key)) hits.set(key, { line: b.lineAt(i), n, i, message });
    },
    list: () =>
      [...hits.values()]
        .sort((x, y) => x.n - y.n || x.i - y.i)
        .map(({ line, message }) => `${line} -> ${message}`),
  };
};

export const citationAttempts = (repo: Repo, blocks: Block[]): string[] => {
  const { hitIn, list } = hitList();
  for (const [n, b] of blocks.entries()) {
    const hit = hitIn(b, n);
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
      const known = target ? repo.names(target) : [];
      const names = new Set(known.flatMap((n) => [n.name, n.full]));
      const bullets = new Set(known.flatMap((n) => n.bullets ?? []));
      const formHint = (s: Span): string | null => {
        const name = cleanName(s.name);
        const asBullet = !s.bold && bullets.has(name);
        if (names.has(name))
          return asBullet
            ? `${advice} for the heading or step, or as ${FORM.bullet} for the bullet`
            : advice;
        return asBullet ? `cite it as ${FORM.bullet}` : null;
      };
      const adjacent = !exact && opener !== undefined;
      if (adjacent) hit(end, `a name next to ${cited}; ${formHint(opener) ?? advice}`);
      if (!target) continue;
      const afterEnd = end + after.length;
      for (const s of spans) {
        if (!((s.at >= from && s.end <= start) || (s.at >= end && s.end <= afterEnd))) continue;
        if (adjacent && s === opener) continue;
        if (exactAt.has(s.at)) continue;
        const hint = formHint(s);
        if (hint) hit(s.at, `${cited} "${cleanName(s.name)}" outside the citation form; ${hint}`);
      }
    }
  }
  return list();
};

export const stepAttempts = (repo: Repo, blocks: Block[]): string[] => {
  const { hitIn, list } = hitList();
  for (const [n, b] of blocks.entries()) {
    const hit = hitIn(b, n);
    for (const { cited, end, after } of pathMentions(repo, b)) {
      if (STEP_NUMBER_RE.test(after))
        hit(end, `a step or category number after ${cited}; ${STEP_HINT}`);
      const paren = PAREN_STEP_RE.exec(after);
      if (paren)
        hit(end + paren.index, `a step number in the sentence after ${cited}; ${STEP_HINT}`);
    }
    for (const { at, end } of b.bold)
      if (STEP_NUMBER_RE.test(b.text.slice(end, end + 40)))
        hit(at, `a step or category number after a name; ${STEP_HINT}`);
  }
  return list();
};

export const lawAttempts = (blocks: Block[]): string[] => {
  const { hitIn, list } = hitList();
  for (const [n, b] of blocks.entries()) {
    const hit = hitIn(b, n);
    const exactAt = exactCitations(b);
    for (const { at, name } of b.bold)
      if (LAW_HEADINGS.includes(cleanName(name)) && !exactAt.has(at))
        hit(at, `**${name}** names a law with no HARRY.md before it; cite it as ${FORM.law}`);
  }
  return list();
};

const STRAY_BOLD =
  "a ** that pairs with nothing renders as asterisks; bold opens before a non-space " +
  "and closes after one, in the same paragraph";

export const strayBold = (blocks: Block[]): string[] =>
  blocks.flatMap((b) => b.stray.map((at) => `${b.lineAt(at)} -> ${STRAY_BOLD}`));

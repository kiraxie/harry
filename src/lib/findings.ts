/**
 * Shared types + helpers for the review→fix pipeline.
 *
 * `review --fix` asks the reviewer model to emit a structured findings list
 * (alongside its markdown). Claude Code judges each finding against its own
 * conversation context, drops false positives (intentional choices it knows
 * about), and hands the approved subset to the `fix` command, which applies
 * them in a write-enabled session.
 */

export type FindingSeverity = 'blocker' | 'major' | 'minor';

export interface Finding {
  /** Stable kebab-case id so CC and fix can reference the same finding. */
  id: string;
  file: string;
  /** Line or range like "42" or "42-50". Optional — some findings are file-wide. */
  line?: string;
  severity: FindingSeverity;
  /** One-sentence statement of the problem. */
  title: string;
  /** Why it is a defect — the reviewer's reasoning. */
  rationale: string;
  /** Concrete change the reviewer recommends. */
  suggestedFix: string;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['blocker', 'major', 'minor']);

/**
 * Extract the last fenced ```json block from free-form model output and parse
 * it. Models interleave reasoning and markdown, so we take the LAST block (the
 * structured payload we asked for at the end). Falls back to a bare top-level
 * array/object scan if no fence is present. Returns null on any failure.
 */
export function extractJsonBlock(text: string): unknown {
  // Collect fenced ```json blocks. `\s*` (not `\s*\n`) so a single-line fence
  // like ```json {...}``` is matched too. Try the LAST fence first — that is
  // the structured payload we ask the model to emit at the very end.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fenced: string[] = [];
  for (const m of text.matchAll(fenceRe)) {
    if (m[1] && m[1].trim()) fenced.push(m[1]);
  }
  const candidates = fenced.reverse();
  // Fallback for un-fenced payloads: the last top-level array AND object span
  // (object covers the apply-report `{applied,skipped}` shape and `{findings}`).
  const lastSpan = (open: string, close: string): string | undefined => {
    const start = text.lastIndexOf(open);
    const end = text.lastIndexOf(close);
    return start !== -1 && end > start ? text.slice(start, end + 1) : undefined;
  };
  // Try the longest (outermost) span first: for an apply-report object the
  // `{…}` span encloses inner `[…]` arrays, so length-desc avoids grabbing a
  // trailing inner `[]` and parsing it as the whole payload.
  const spans = [lastSpan('[', ']'), lastSpan('{', '}')]
    .filter((s): s is string => !!s)
    .sort((a, b) => b.length - a.length);
  candidates.push(...spans);
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Coerce loosely-typed parsed JSON into a validated Finding[]. Drops entries
 * missing the required fields rather than throwing, so a partially malformed
 * payload still yields the usable findings.
 */
export function normalizeFindings(parsed: unknown): Finding[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)
      ? (parsed as { findings: unknown[] }).findings
      : [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const file = typeof r['file'] === 'string' ? r['file'] : '';
    const title = typeof r['title'] === 'string' ? r['title'] : '';
    if (!file || !title) continue;
    const sev = typeof r['severity'] === 'string' && VALID_SEVERITIES.has(r['severity'])
      ? (r['severity'] as FindingSeverity)
      : 'major';
    // Ensure ids are unique — a model-supplied id can collide with a generated
    // `finding-N`, and duplicate ids break per-finding approval/accounting.
    let id = typeof r['id'] === 'string' && r['id'].trim() ? r['id'].trim() : `finding-${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    out.push({
      id,
      file,
      line: typeof r['line'] === 'string' ? r['line'] : typeof r['line'] === 'number' ? String(r['line']) : undefined,
      severity: sev,
      title,
      rationale: typeof r['rationale'] === 'string' ? r['rationale'] : '',
      suggestedFix: typeof r['suggestedFix'] === 'string' ? r['suggestedFix'] : '',
    });
  }
  return out;
}

/** Instruction appended to the review prompt in `--fix` mode. */
export const FINDINGS_OUTPUT_INSTRUCTION = `
<structured_findings>
This review feeds an automated fix pipeline. After your markdown review, output
ONE fenced code block tagged \`json\` containing an array of the material
findings (and ONLY material findings — omit notes, praise, and style nits):

\`\`\`json
[
  {
    "id": "kebab-case-stable-id",
    "file": "relative/path.ts",
    "line": "42-50",
    "severity": "blocker | major | minor",
    "title": "one-sentence statement of the defect",
    "rationale": "why this is a real defect",
    "suggestedFix": "concrete change to make"
  }
]
\`\`\`

Rules:
- If there are no material findings, output an empty array: \`[]\`.
- "line" is optional; omit it for file-wide findings.
- Keep ids stable and descriptive — they are how a human approves each fix.
</structured_findings>
`;

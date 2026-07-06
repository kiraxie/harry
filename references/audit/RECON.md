# Round 1: Recon & Substrate

Two products come out of this round, and every later round depends on both:

1. **`substrate/`** — factual output from deterministic tools. Facts nobody can argue with: what's unused, what's cyclic, what's duplicated, what changes most.
2. **`intended-architecture.md`** — the codebase's *own* stated intent, which becomes the baseline the audit measures against (the analogue of a security audit's "comparable baseline").

Do the deterministic substrate first — it makes the intent extraction and all later hunting cite facts instead of impressions.

## Step 1a — Detect languages and pick adapters

Detect which languages are present (by file extension and manifest files: `package.json`/`tsconfig.json` → TS/JS, `go.mod` → Go, `pyproject.toml`/`requirements.txt`/`setup.py` → Python). Run only the adapters for languages that are actually present. Many repos are polyglot — run several.

Tools are pulled on-demand (npx / go run / uvx) so the audit **adds nothing to the target's manifests**. If a tool can't be fetched (offline, missing runtime), note the gap in the substrate and fall back to an LLM `research` agent for that signal — but prefer the tool: it is ground truth and the LLM is not.

### Tool matrix

| Signal | TS / JS | Go | Python | Language-agnostic |
|---|---|---|---|---|
| Dead code / unused exports | `npx knip` or `npx ts-prune` | `go run golang.org/x/tools/cmd/deadcode@latest ./...` | `uvx vulture .` | — |
| Circular deps | `npx madge --circular --extensions ts,tsx,js .` or `npx dpdm` | `go mod graph` + inspection | `uvx pydeps --show-cycles` / `import-linter` | — |
| Duplication (token) | `npx jscpd --absolute` | `dupl` | `npx jscpd --absolute` | **jscpd is multi-language.** Always pass `--absolute` when scanning multiple package roots at once — relative paths become ambiguous across roots and make the report's file identities unreliable. |
| Complexity / long funcs | (from oxlint/eslint) | `gocyclo` | `uvx radon cc -s .` | `npx scc` / `tokei` (size, LOC) |
| Architecture-rule violations | — | — | — | **`semgrep --config <rules>`** (multi-language; encode rules like "raw SQL string inside a route handler", "business layer imports framework") |
| Change hotspots | — | — | — | **`git log --format= --name-only --since=<window> \| sort \| uniq -c \| sort -rn`** (churn) |

`madge --circular` has no built-in exclude flag and will report every cycle inside generated code (ORM clients, compiled `dist/` output) alongside real ones — on a codebase with a generated Prisma/protobuf/etc. client this can be 90%+ noise. Filter the raw output for `generated/`, `dist/`, `build/` path segments before treating the cycle count as a fact (keep the raw output too — note the filtering in `substrate/README.md`). Also note in the README whether path aliases (`@app/*`-style tsconfig paths) were passed to madge — without them, cross-package cycles via aliased imports are invisible and only relative-import cycles are caught.

`semgrep` is the strongest cross-language lever for the *pattern-fit* dimension: it turns "should this have used a Repository?" into a concrete rule you can run over TS, Go, and Python uniformly. Where the target has stated architecture rules (see Step 2), translate the most important ones into semgrep rules and run them — a rule hit is a fact, not an opinion.

### Churn is for ranking, not filtering

Run churn over the whole codebase. Do **not** use it to decide what to audit (the audit covers the whole scope). Use it to rank finding severity later: a problem in a high-churn file is HIGH; the same problem in cold code is LOW (see SKILL.md Principle 3). Save the ranked churn table to `substrate/churn.txt`.

### How to run this step

Launch the adapters in parallel (they're independent). Write each tool's raw output under `substrate/` with a self-describing name (`dead-code.txt`, `cycles.txt`, `duplication.json`, `complexity.txt`, `churn.txt`, `semgrep.json`, `hoist-candidates.json` — see Step 1b below). Then write `substrate/README.md`: one line per file saying what tool produced it, what flags, and — importantly — what it *missed* (e.g. "jscpd finds token-level clones only; semantic/drifted duplication is a separate signal — see hoist-candidates.json"). Silent gaps read as "we covered everything" when we didn't.

## Step 1b — Hoist-candidate funnel: Stage A (deterministic candidate generation)

Same-intent code that drifted apart evades token clone detectors *because* it drifted — a distinct signal from the token-level duplication tool above, and it belongs in the substrate for the same reason: this stage only gathers facts, it doesn't judge them. Pure LLM comparison of every module against every other is O(n²) and unaffordable, so generate candidates deterministically here in Round 1 (high recall, cheap). Round 2's dimension hunters don't adjudicate these — a dedicated Stage B step does, once Round 2 starts (see DEEP-DIVE.md "Hoist-candidate funnel — Stage B").

Take the **union** of these three signals. They're cheap and over-generate on purpose — noise here only costs one wasted Stage-B comparison later; a miss is the only real loss. Assign this to a `research` agent (or a script) that produces a candidate list, each entry a pair/cluster of locations plus which signal(s) fired. The agent **returns** the candidate list as its final output rather than writing it itself — you write it to `substrate/hoist-candidates.json` when it returns.

1. **Cross-boundary symbol/filename fuzzy match.** Collect exported symbol names and filenames per workspace; find names that are equal or fuzzy-close **across** workspace/package boundaries (`nova/core/utils/tenant-client.ts` ↔ `shared/src/getTenantPrisma`). Cross-boundary is the key filter — matches *within* one package are usually fine. This directly implements "extract cross-boundary on first occurrence."

2. **Shared external-dependency fingerprint.** For each module, take the set of external (third-party / infra) imports as a fingerprint. Two modules in different workspaces with a strongly overlapping fingerprint (both import the same cloud-storage SDK + pool library) likely serve the same infrastructure purpose — a classic "product module re-implements shared infra" case.

3. **Git provenance.** Use history to find files merged in from another repo (`git log --follow`, merge commits that imported a tree) and mine **prior hoist PRs** (search merged PR titles/commits for hoist/extract/shared/consolidate). Prior hoists tell you what *kind* of thing this team extracts — and the still-un-hoisted siblings of past hoists are prime candidates.

Write the candidate list to `substrate/hoist-candidates.json`. Note explicitly in `substrate/README.md` what Stage A **cannot** catch in v1: code that drifted so far it shares neither names nor dependencies. That gap is the documented future-work item (see README.md → intent-fingerprint / embedding).

## Step 2 — Extract the intended architecture

Launch **`research` agents in parallel** to map what this codebase *intends* to be. The intent baseline comes, in priority order, from: (a) explicit project docs, (b) the dominant pattern the code actually follows, (c) the user. Capture whichever exist.

**Agent 2a — stated intent (docs & configs)**
```
Explore <path>. Find and read every source of stated architectural intent:
1. Architecture / design docs, README architecture sections, ADRs, CONTRIBUTING, and any
   agent-instruction files (CLAUDE.md, AGENTS.md, .cursor rules, etc.).
2. Explicitly stated: layering rules, dependency boundaries (what may import what),
   naming/coding conventions, chosen patterns (Repository, DI, etc.), designated shared
   packages / where cross-cutting code is supposed to live.
3. Lint/formatter/tsconfig/module-boundary configs that ENCODE intent (eslint boundaries
   plugin, import-linter contracts, nx/turbo project graph, path aliases).
Return each rule verbatim with its source file. If a repo states almost no intent, say so —
we'll fall back to observed dominant patterns.
```

**Agent 2b — observed structure & conventions (ground truth of what the code actually does)**
```
Explore <path>. Describe the ACTUAL structure, independent of what docs claim:
1. Top-level layout and what each workspace/package/module is responsible for.
2. The dominant patterns in practice (how is data access done? how are routes/handlers
   structured? how is DI/config/error-handling done?) — cite representative files.
3. Framework idioms in use that a generic reviewer might mistake for smells (e.g. a
   framework's required default-export for plugins, a language's import-extension convention,
   a DI container's registration style). List them explicitly so later agents DON'T flag them.
4. The module/dependency boundaries as they really are; note where docs (2a) and reality diverge.
Return specific file paths as anchors.
```

For a large or multi-subsystem target, add more `research` agents to map individual subsystems in depth before proceeding — the quality of Round 2 depends entirely on this.

## Step 3 — Synthesize `intended-architecture.md`

Merge both agents into a 1–3 page document with these sections. This file is fed into every Round 2 agent prompt (inline or by path — see DEEP-DIVE.md), so keep it tight and factual:

- **What this codebase is** — type, languages, subsystems, deployment shape.
- **Stated rules** — layering, dependency boundaries, chosen patterns, designated shared locations (from 2a). Quote them.
- **Observed dominant patterns** — how things are actually done (from 2b), with anchor files.
- **Framework idioms — DO NOT flag** — the explicit allow-list of things that look odd but are correct.
- **Doc-vs-reality gaps** — where stated intent and actual code already disagree (these are Round 2 hunting leads, often the richest ones).
- **Designated shared destinations** — where hoisted/shared code is supposed to go (feeds the hoist funnel's remediation targets).
- **Substrate summary** — the headline numbers from Step 1 (N unused exports, N cycles, top-churn files) so Round 2 agents start from facts.

If prior runs exist (see SKILL.md), fold a one-paragraph summary of what they already found into this file so Round 2 agents don't re-plow it.

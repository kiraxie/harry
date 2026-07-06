# Round 2: Deep-dive hunt

Launch **multiple `general` agents in parallel** (in one message, so they run concurrently). `general`, not `research`: a hunter that finds a deep thread — a coupling problem that needs the whole import graph traced — can spawn its own `research` sub-agent instead of blowing its context.

## How many agents, and how to split

Decide from `intended-architecture.md`. Split by **workspace × dimension** (see SCAN-DIMENSIONS.md). A small library might need 3–4 agents; a large multi-subsystem monorepo 8–12+. Each agent owns a scope (one package/subsystem) and one or two dimensions, so it goes deep. More focused agents beat fewer broad ones that run out of context.

Every Round 2 agent prompt MUST establish, either by pasting the content inline or by giving the file path and instructing the agent to Read it as its first action (cheaper for large files — pick whichever keeps the prompt lean; a path-plus-"read this first" instruction costs far less than re-pasting a multi-KB document into every one of 8+ agent prompts and the agent gets the same information):

1. **`intended-architecture.md`** — including its "framework idioms — DO NOT flag" list.
2. The **substrate facts** relevant to the agent's scope (the dead-code lines for its package, the cycles it's in, its duplication hits, its churn rank) — these are usually short enough to paste inline.
3. The agent's **scope and dimension(s)**, with the dimension's *bar* from SCAN-DIMENSIONS.md.
4. The **hunting methodology** below.
5. The **finding contract** below.

## Hunting methodology — include in every agent prompt

```
You are auditing STRUCTURE and DESIGN, not correctness of individual lines. Read across
files. Follow how a change would propagate, not just what a function returns.

Your job is to find structural problems that carry a CONCRETE COST. Before you write down
any finding, you must be able to name one of:
  (a) a specific future change this structure makes expensive or dangerous, or
  (b) a bug it has already caused.
If you can't name either, it's a taste opinion — discard it. "This could be cleaner",
"violates SRP", "should use pattern X" are NOT findings on their own.

Two hard rules that will get findings rejected in the next round if you break them:

1. A MISSING ABSTRACTION IS NOT A FINDING unless it fails the drift test:
   "if these copies / call sites silently diverge, is that a BUG or NORMAL evolution?"
   - Bug if they diverge  -> real finding.
   - Normal to diverge     -> incidental; leave it. Three similar lines beat a premature
     abstraction. Do NOT recommend introducing a Strategy/Factory/Repository/interface for
     a single call site or for code that is fine to evolve independently. Adding indirection
     where it isn't earned is itself the defect.

2. FRAMEWORK IDIOMS ARE NOT SMELLS. The DO-NOT-FLAG list in the architecture summary is
   authoritative. If something looks odd, check that list and the dominant-patterns section
   before assuming it's wrong.

How to hunt structure:

- MEASURE, DON'T GUESS. When you claim "duplicated", show the N sites. When you claim
  "god object", count the responsibilities / methods / imports. When you claim "hot",
  cite the churn rank. Findings are made of facts from the substrate plus code you read.

- READ BOTH ENDS OF A DEPENDENCY. A layering violation isn't real until you've read the
  importer AND the imported and confirmed the direction is actually wrong per the stated
  boundaries — not just that the import looks upward.

- FOLLOW A REALISTIC CHANGE. Pick a plausible future change ("add a new document type",
  "swap the storage backend", "change the fee rule") and trace what it would force you to
  touch. Structure problems reveal themselves as changes that fan out absurdly.

- COMPARE AGAINST INTENT, NOT AGAINST A TEXTBOOK. The baseline is THIS codebase's stated
  and dominant patterns. A deviation from its own norm is a lead; a deviation from your
  personal preference is not.

- PREFER THE DOC-VS-REALITY GAPS. Where the architecture summary flagged that stated intent
  and actual code disagree, that's often where the real debt is.

YOU CAN SPAWN SUB-AGENTS. To understand a subsystem deeply enough to judge a finding, launch
a research sub-agent rather than holding everything in context.

YOUR SCOPE IS A FOCUS, NOT A FENCE. If while auditing coupling you spot a swallowed error or
a dead export, report it. Don't drop a real problem because it's "not your dimension."
```

## Finding contract — include in every agent prompt

```
Return ONLY findings that clear the cost bar. For each, provide:
- title: concise, specific.
- dimension: which scan dimension.
- concrete_cost: the named future change made expensive/dangerous, OR the bug already caused.
  This is mandatory. No concrete_cost -> no finding.
- evidence: the objective facts — file:line for each site, counts, cycle members, churn rank,
  the substrate tool line if applicable. At least one; for duplication/hoist, at least the
  two (or more) sites.
- drift_test (for reuse/duplication/hoist findings): "bug if they diverge" or "normal to
  diverge", with one sentence why. If "normal", you should not be reporting it.
- remediation: the smallest change that removes the cost. For hoist findings, name the
  canonical version and the designated shared destination. Do NOT propose new abstraction
  beyond what the cost justifies.
- severity: blast_radius (how much code/how many call sites) and change_likelihood (churn),
  then overall HIGH/MODERATE/LOW per those two axes.
- confidence + why (note anything you couldn't fully trace).

If your scope is genuinely clean, say so — "no structural findings clearing the cost bar in
<scope>". An honest clean scope is a valid result and builds trust in the findings you do raise.
```

---

## Hoist-candidate funnel (dimension 2) — Stage B: adjudicate

Same-intent code that drifted apart evades token clone detectors *because* it drifted. Pure LLM comparison of every module against every other is O(n²) and unaffordable, so Round 1 already generated candidates deterministically (Stage A — high recall, cheap; see RECON.md "Step 1b") and wrote them to `substrate/hoist-candidates.json`. This is the same shape as the main hunt→validate flow, applied to reuse: Stage A over-generates on purpose, Stage B below reads the real code and adjudicates precisely.

### Stage B — adjudicate each candidate with an agent that reads both sides

Read `substrate/hoist-candidates.json` before launching Stage B agents.

Batch candidates by affinity into a handful of agents (2-4 clusters each) rather than one agent per candidate — clusters that share a theme (e.g. "several product-workspace re-implementations of a platform capability", "several SSOT-merge parallel-infra pairs") benefit from one agent building context across them, and it's cheaper than N singleton agents. Within each batch prompt, name the **specific over-engineering trap that batch is prone to** — e.g. a batch of "assembly/bootstrap" candidates should be told upfront to default to REJECT unless a cross-app ordering invariant is demonstrated (assembly code differing per-app is usually healthy, not drift); a batch of "pure algorithm duplicated with different tuning constants" should be told to check whether the two sides need to agree before assuming they should. This pre-calibration catches over-engineering paths before the agent invests in reading code down that path, not just after.

For each candidate cluster, the agent reads the actual implementations and decides:

```
Two (or more) code locations were flagged as possibly serving the same purpose:
<locations + which signal fired>

Read the real implementation at each. Decide:
1. SAME INTENT? Do these actually do the same job, or did the signal misfire (same name,
   different purpose)? If misfire -> REJECT (coincidental).
2. DRIFT TEST: if these implementations silently diverge further, is that a BUG (they must
   stay in lockstep because they encode one shared truth/contract) or NORMAL (they legitimately
   serve their own contexts)? If NORMAL -> REJECT: this is not a hoist candidate, independent
   evolution is correct here.
3. If SAME INTENT and divergence-would-be-a-bug -> CONFIRM. Report:
   - the drift delta: how they ALREADY differ (this is the risk, and it's the spec for the fix)
   - the canonical version (which one should win, and why)
   - the designated shared destination (from the architecture summary's shared locations)
   - concrete_cost: what the current drift will cause (e.g. "a fix applied to one and not the
     other silently reintroduces the bug in the second call path")
Return CONFIRM (with the above) or REJECT (with which test failed).
```

Confirmed hoist candidates flow into the same finding set (dimension 2) and through Rounds 3–6 like any other finding. Their `evidence` is the set of drifted locations; their `remediation` is "hoist canonical version to <destination>, reconcile the drift delta."

// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc (broker transport removed; ported to TypeScript;
// token_count/rate-limits handling and an anti-hang turn timeout added).
// See NOTICE.

/**
 * High-level "run one turn" API on top of {@link CodexAppServerClient}.
 *
 * Starts a thread, sends a turn, streams notifications through a ported capture
 * state machine (captureTurn/applyTurnNotification/recordItem), and collects the
 * final assistant message, reasoning summary, and token-usage / rate-limit
 * snapshot. The `token_count` notification handling is new (the upstream
 * reference lacks it).
 */

import { CodexAppServerClient, DEFAULT_CONNECT_TIMEOUT_MS } from "./app-server.ts";
import type { AppServerNotification, ThreadItem } from "./protocol.ts";
import type { CodexRateLimits } from "../provider.ts";

/** A turn must never hang the host process. */
const DEFAULT_TURN_TIMEOUT_MS = 15 * 60 * 1000;

// DEFAULT_CONNECT_TIMEOUT_MS is the canonical connect()/initialize() ceiling and
// lives in app-server.ts (its owner); imported here so the turn and auth/probe
// paths share one value rather than drifting copies.

export interface CodexTurnOpts {
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  readOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  onItem?: (ev: CodexTurnEvent) => void;
  /** Hard ceiling on a single turn. Defaults to {@link DEFAULT_TURN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Ceiling on connect()/initialize(). Defaults to the lesser of
   *  {@link DEFAULT_CONNECT_TIMEOUT_MS} and {@link timeoutMs}. */
  connectTimeoutMs?: number;
}

export type CodexTurnEvent =
  | { kind: "assistant"; text: string; final: boolean }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; label: string }
  | {
      kind: "usage";
      inputTokens?: number;
      outputTokens?: number;
      rateLimits?: CodexRateLimits;
    }
  | { kind: "error"; message: string };

export interface CodexTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  rateLimits?: CodexRateLimits;
}

export interface CodexTurnResult {
  success: boolean;
  finalMessage: string;
  reasoningSummary: string[];
  error?: string;
  stderr: string;
  usage?: CodexTurnUsage;
}

// --- ported helpers ---------------------------------------------------------

function buildTurnInput(prompt: string): ThreadItem[] {
  return [{ type: "text", text: prompt, text_elements: [] }];
}

function shorten(text: unknown, limit = 96): string {
  const normalized = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}

function extractThreadId(message: AppServerNotification): string | null {
  return message?.params?.threadId ?? null;
}

function extractTurnId(message: AppServerNotification): string | null {
  if (message?.params?.turnId) {
    return message.params.turnId;
  }
  if (message?.params?.turn?.id) {
    return message.params.turn.id;
  }
  return null;
}

function normalizeReasoningText(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReasoningSections(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReasoningSections(entry));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") {
      return extractReasoningSections(obj.text);
    }
    if ("summary" in obj) {
      return extractReasoningSections(obj.summary);
    }
    if ("content" in obj) {
      return extractReasoningSections(obj.content);
    }
    if ("parts" in obj) {
      return extractReasoningSections(obj.parts);
    }
  }
  return [];
}

function mergeReasoningSections(existing: string[], next: string[]): string[] {
  const merged: string[] = [];
  for (const section of [...existing, ...next]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a `token_count` notification into a usage snapshot. Tolerates missing
 * `rate_limits` / `last_token_usage` (null in older codex or non-app-server
 * transports) and never throws.
 */
function parseTokenCount(params: any): CodexTurnUsage {
  const usage: CodexTurnUsage = {};

  const lastUsage = params?.last_token_usage;
  if (lastUsage && typeof lastUsage === "object") {
    usage.inputTokens = toFiniteNumber(lastUsage.input_tokens);
    usage.outputTokens = toFiniteNumber(lastUsage.output_tokens);
  }

  const rateLimits = params?.rate_limits;
  if (rateLimits && typeof rateLimits === "object") {
    const parsed: CodexRateLimits = {};
    const primary = toFiniteNumber(rateLimits.primary?.used_percent);
    if (primary !== undefined) {
      parsed.primaryUsedPercent = primary;
    }
    const secondary = toFiniteNumber(rateLimits.secondary?.used_percent);
    if (secondary !== undefined) {
      parsed.secondaryUsedPercent = secondary;
    }
    if (typeof rateLimits.plan_type === "string") {
      parsed.planType = rateLimits.plan_type;
    }
    if (typeof rateLimits.resets_at === "string") {
      parsed.resetsAt = rateLimits.resets_at;
    }
    if (Object.keys(parsed).length > 0) {
      usage.rateLimits = parsed;
    }
  }

  return usage;
}

/**
 * Field-wise fold of rate-limit snapshots. `parseTokenCount` emits a rateLimits
 * object whenever any single sub-field is present, so a later partial snapshot
 * (e.g. only primaryUsedPercent) must NOT wholesale-replace the prior object and
 * drop previously-seen secondary/planType/resetsAt — merge each sub-field with
 * the new value winning when present.
 */
function foldRateLimits(
  prev: CodexRateLimits | undefined,
  next: CodexRateLimits | undefined
): CodexRateLimits | undefined {
  if (!prev) {
    return next;
  }
  if (!next) {
    return prev;
  }
  return {
    primaryUsedPercent: next.primaryUsedPercent ?? prev.primaryUsedPercent,
    secondaryUsedPercent: next.secondaryUsedPercent ?? prev.secondaryUsedPercent,
    planType: next.planType ?? prev.planType,
    resetsAt: next.resetsAt ?? prev.resetsAt
  };
}

interface TurnCaptureState {
  threadId: string;
  threadIds: Set<string>;
  threadTurnIds: Map<string, string | null>;
  turnId: string | null;
  turnStarted: boolean;
  bufferedNotifications: AppServerNotification[];
  completion: Promise<void>;
  resolveCompletion: () => void;
  finalTurn: { id?: string; status?: string } | null;
  completed: boolean;
  finalAnswerSeen: boolean;
  pendingCollaborations: Set<string>;
  activeSubagentTurns: Set<string>;
  completionTimer: ReturnType<typeof setTimeout> | null;
  lastAgentMessage: string;
  reasoningSummary: string[];
  error: { message?: string } | null;
  usage: CodexTurnUsage | null;
  onItem?: (ev: CodexTurnEvent) => void;
}

function createTurnCaptureState(
  threadId: string,
  onItem?: (ev: CodexTurnEvent) => void
): TurnCaptureState {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  return {
    threadId,
    threadIds: new Set([threadId]),
    threadTurnIds: new Map(),
    turnId: null,
    turnStarted: false,
    bufferedNotifications: [],
    completion,
    resolveCompletion,
    finalTurn: null,
    completed: false,
    finalAnswerSeen: false,
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
    lastAgentMessage: "",
    reasoningSummary: [],
    error: null,
    usage: null,
    onItem
  };
}

function registerThread(state: TurnCaptureState, threadId: string | null | undefined): void {
  if (threadId) {
    state.threadIds.add(threadId);
  }
}

function belongsToTurn(state: TurnCaptureState, message: AppServerNotification): boolean {
  const messageThreadId = extractThreadId(message);
  if (!messageThreadId || !state.threadIds.has(messageThreadId)) {
    return false;
  }
  const trackedTurnId = state.threadTurnIds.get(messageThreadId) ?? null;
  const messageTurnId = extractTurnId(message);
  return trackedTurnId === null || messageTurnId === null || messageTurnId === trackedTurnId;
}

/**
 * Decide whether a notification should be applied to this turn's capture state.
 *
 * `thread/started` is always applied (it registers sub-agent threads). `token_count`
 * and top-level `error` are account/connection-scoped — rate limits are an account
 * property and real codex may omit `threadId` on them — so they are exempt from the
 * thread-membership gate. Everything else is item-scoped and must belong to a tracked
 * thread/turn.
 */
function shouldApplyNotification(state: TurnCaptureState, message: AppServerNotification): boolean {
  if (message.method === "thread/started") {
    return true;
  }
  if (message.method === "token_count" || message.method === "error") {
    return true;
  }
  return belongsToTurn(state, message);
}

function clearCompletionTimer(state: TurnCaptureState): void {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
}

function completeTurn(
  state: TurnCaptureState,
  turn: { id?: string; status?: string } | null = null
): void {
  if (state.completed) {
    return;
  }
  clearCompletionTimer(state);
  state.completed = true;
  if (turn) {
    state.finalTurn = turn;
    if (!state.turnId && turn.id) {
      state.turnId = turn.id;
    }
  } else if (!state.finalTurn) {
    state.finalTurn = { id: state.turnId ?? "inferred-turn", status: "completed" };
  }
  state.resolveCompletion();
}

function scheduleInferredCompletion(state: TurnCaptureState): void {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
    return;
  }
  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
    return;
  }
  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
      return;
    }
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
      return;
    }
    completeTurn(state, null);
  }, 250);
  state.completionTimer.unref?.();
}

function toolLabel(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return `Running command: ${shorten(item.command)}`;
    case "fileChange":
      return `Applying ${item.changes?.length ?? 0} file change(s).`;
    case "mcpToolCall":
      return `Calling ${item.server}/${item.tool}.`;
    case "dynamicToolCall":
      return `Running tool: ${item.tool}.`;
    case "webSearch":
      return `Searching: ${shorten(item.query)}`;
    default:
      return null;
  }
}

function recordItem(
  state: TurnCaptureState,
  item: ThreadItem,
  lifecycle: "started" | "completed",
  threadId: string | null = null
): void {
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }

  if (item.type === "agentMessage") {
    if (item.text && (!threadId || threadId === state.threadId)) {
      state.lastAgentMessage = item.text;
      const final = lifecycle === "completed" && item.phase === "final_answer";
      if (final) {
        state.finalAnswerSeen = true;
        scheduleInferredCompletion(state);
      }
      if (lifecycle === "completed") {
        state.onItem?.({ kind: "assistant", text: item.text, final });
      }
    }
    return;
  }

  if (item.type === "reasoning" && lifecycle === "completed") {
    const nextSections = extractReasoningSections(item.summary);
    state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, nextSections);
    for (const section of nextSections) {
      state.onItem?.({ kind: "reasoning", text: section });
    }
    return;
  }

  if (lifecycle === "started") {
    const label = toolLabel(item);
    if (label) {
      state.onItem?.({ kind: "tool", label });
    }
  }
}

function applyTurnNotification(state: TurnCaptureState, message: AppServerNotification): void {
  switch (message.method) {
    case "thread/started":
      registerThread(state, message.params?.thread?.id);
      break;
    case "turn/started":
      registerThread(state, message.params?.threadId);
      state.threadTurnIds.set(message.params?.threadId, message.params?.turn?.id ?? null);
      if ((message.params?.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.add(message.params?.threadId);
      }
      break;
    case "item/started": {
      const item = message.params?.item;
      if (item) {
        recordItem(state, item, "started", message.params?.threadId ?? null);
      }
      break;
    }
    case "item/completed": {
      const item = message.params?.item;
      if (item) {
        recordItem(state, item, "completed", message.params?.threadId ?? null);
      }
      break;
    }
    case "token_count": {
      // FOLD field-wise rather than replace: real codex emits multiple
      // token_count notifications per multi-step turn and `rate_limits` is often
      // null/absent on later snapshots — a full replace would WIPE the
      // previously-captured rate limits. Keep prior values when the new snapshot
      // lacks a field.
      const next = parseTokenCount(message.params);
      const prev = state.usage ?? {};
      const folded: CodexTurnUsage = {
        inputTokens: next.inputTokens ?? prev.inputTokens,
        outputTokens: next.outputTokens ?? prev.outputTokens,
        rateLimits: foldRateLimits(prev.rateLimits, next.rateLimits)
      };
      const hasContent =
        folded.inputTokens !== undefined ||
        folded.outputTokens !== undefined ||
        folded.rateLimits !== undefined;
      if (hasContent) {
        state.usage = folded;
        // Don't emit an empty usage event when a snapshot carries neither
        // rate_limits nor last_token_usage.
        state.onItem?.({ kind: "usage", ...folded });
      }
      break;
    }
    case "error":
      state.error = message.params?.error ?? { message: "Unknown codex error." };
      state.onItem?.({
        kind: "error",
        message: state.error?.message ?? "Unknown codex error."
      });
      break;
    case "turn/completed":
      if ((message.params?.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.delete(message.params?.threadId);
        scheduleInferredCompletion(state);
        break;
      }
      completeTurn(state, message.params?.turn ?? null);
      break;
    default:
      break;
  }
}

// --- public API -------------------------------------------------------------

export async function runCodexTurn(opts: CodexTurnOpts): Promise<CodexTurnResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const connectTimeoutMs =
    opts.connectTimeoutMs ?? Math.min(DEFAULT_CONNECT_TIMEOUT_MS, timeoutMs);

  // connect() awaits initialize() OUTSIDE the per-turn timeout race below, so it
  // gets its own ceiling at the source (app-server connectTimeoutMs): on expiry
  // the spawned child is torn down and connect() rejects rather than hanging.
  let client: CodexAppServerClient;
  try {
    client = await CodexAppServerClient.connect(opts.cwd, {
      env: opts.env,
      disableBroker: true,
      connectTimeoutMs
    });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    return {
      success: false,
      finalMessage: "",
      reasoningSummary: [],
      error: message,
      stderr: ""
    };
  }

  // DEBT: an in-turn request() (thread/start, turn/start, completion await) can
  // still stall forever if the codex child dies without a close() — the client's
  // `closed` flag stays false and the pending promise is never rejected. The
  // connect/initialize gap is now closed at the source (connectTimeoutMs above);
  // the remaining in-turn stalls are guarded by this turn-level Promise.race. On
  // fire we close() the client, which drains pending requests and the completion
  // promise via handleExit().
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });

  let state: TurnCaptureState | null = null;

  try {
    const started = await Promise.race([
      client.request<{ thread: { id: string } }>("thread/start", {
        cwd: opts.cwd,
        model: opts.model ?? null,
        approvalPolicy: "never",
        sandbox: opts.readOnly ? "read-only" : "workspace-write",
        ephemeral: opts.readOnly ?? false
      }),
      timeout.then(() => null)
    ]);

    if (timedOut || !started) {
      return failure(client, "Codex turn timed out before the thread started.");
    }

    const threadId = started.thread.id;
    state = createTurnCaptureState(threadId, opts.onItem);
    const capture = state;

    client.setNotificationHandler((message) => {
      // Buffer only until the turn/start phase completes. Gating on `turnId`
      // would buffer FOREVER when turn/start never echoes a turn id (null is a
      // tolerated value) — including the terminal turn/completed — hanging the
      // whole turn. Once the turn has started, `belongsToTurn` handles a null
      // turn id permissively.
      if (!capture.turnStarted) {
        capture.bufferedNotifications.push(message);
        return;
      }
      if (shouldApplyNotification(capture, message)) {
        applyTurnNotification(capture, message);
      }
    });

    const turnStartParams: Record<string, unknown> = {
      threadId,
      input: buildTurnInput(opts.prompt)
    };
    if (opts.model) {
      turnStartParams.model = opts.model;
    }
    if (opts.effort) {
      turnStartParams.effort = opts.effort;
    }

    const turnResponse = await Promise.race([
      client.request<{ turn?: { id?: string; status?: string } }>("turn/start", turnStartParams),
      timeout.then(() => null)
    ]);

    if (timedOut || !turnResponse) {
      return failure(client, "Codex turn timed out before the turn started.");
    }

    capture.turnId = turnResponse.turn?.id ?? null;
    if (capture.turnId) {
      capture.threadTurnIds.set(threadId, capture.turnId);
    }

    // Drain notifications that arrived before the turn id was known, then let
    // the live handler process the rest. Both paths run synchronously here (no
    // await between), so no notification can slip in unbuffered-but-undrained.
    for (const message of capture.bufferedNotifications) {
      if (shouldApplyNotification(capture, message)) {
        applyTurnNotification(capture, message);
      }
    }
    capture.bufferedNotifications.length = 0;
    capture.turnStarted = true;

    if (turnResponse.turn?.status && turnResponse.turn.status !== "inProgress") {
      completeTurn(capture, turnResponse.turn);
    }

    await Promise.race([capture.completion, timeout]);

    if (timedOut && !capture.completed) {
      return failure(client, "Codex turn timed out while awaiting completion.");
    }

    return buildResult(capture, client.stderr);
  } catch (error) {
    const stderr = client.stderr;
    const message = (error as Error)?.message ?? String(error);
    return {
      success: false,
      finalMessage: state?.lastAgentMessage ?? "",
      reasoningSummary: state?.reasoningSummary ?? [],
      error: stderr ? `${message}\n${stderr}` : message,
      stderr,
      usage: state?.usage ?? undefined
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (state) {
      clearCompletionTimer(state);
    }
    await client.close();
  }
}

function buildResult(state: TurnCaptureState, stderr: string): CodexTurnResult {
  const success =
    !state.error && (state.finalTurn?.status === "completed" || state.completed);
  const result: CodexTurnResult = {
    success,
    finalMessage: state.lastAgentMessage,
    reasoningSummary: state.reasoningSummary,
    stderr
  };
  if (state.error?.message) {
    result.error = state.error.message;
  }
  if (state.usage) {
    result.usage = state.usage;
  }
  return result;
}

function failure(client: CodexAppServerClient, reason: string): CodexTurnResult {
  const stderr = client.stderr;
  return {
    success: false,
    finalMessage: "",
    reasoningSummary: [],
    error: stderr ? `${reason}\n${stderr}` : reason,
    stderr
  };
}

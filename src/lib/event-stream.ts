/**
 * Wires Copilot session event listeners to:
 *   - stderr progress log + job log file
 *   - quota cache (on every `assistant.usage`)
 *   - a completion signal resolving on `session.task_complete` or timeout
 *   - a shutdown-capture promise resolving on `session.shutdown`
 *
 * The caller (CopilotProvider, via the event stream) awaits these promises to
 * drive the session lifecycle, then assembles the final stdout envelope.
 */

import type { CopilotSession, SessionEvent } from '@github/copilot-sdk';

import type { ProviderEvent } from './provider.ts';

export interface AttachOptions {
  session: CopilotSession;
  stateDir: string;
  /** Job log writer — called for every significant event. */
  appendLog: (message: string) => void;
  /** Stderr progress writer for foreground runs; no-op for background jobs. */
  progress: (message: string) => void;
  /**
   * Optional neutral-event sink. When provided, each handled SDK event is also
   * mapped to a provider-agnostic {@link ProviderEvent} and pushed here. Purely
   * additive: the completion/shutdown promises and all logging are unchanged,
   * so callers that omit `emit` keep their exact current behavior.
   */
  emit?: (ev: ProviderEvent) => void;
}

export interface AttachedStream {
  /** Last `assistant.message` content seen. Fallback summary if task_complete.summary is empty. */
  getLastAssistantMessage: () => string | undefined;
  /**
   * Resolves when the session finishes processing the prompt.
   *
   * Primary signal: `session.idle` — Copilot emits this after the agent has
   * finished all tool calls for a given prompt. Despite the name, it is a
   * prompt-level (not turn-level) completion indicator; `sendAndWait` uses
   * it internally for the same purpose.
   *
   * Bonus signal: `session.task_complete` — carries a structured `summary`
   * from the agent. If it fires before or at the same time as `idle`, its
   * summary is captured. Not all agent tasks emit this event.
   *
   * Rejects on `session.error`.
   */
  completion: Promise<TaskCompletion>;
  /** Resolves when `session.shutdown` fires (may happen only after disconnect). */
  shutdown: Promise<SessionShutdown>;
  /** Detach all listeners. */
  dispose: () => void;
}

export interface TaskCompletion {
  summary?: string;
  success?: boolean;
}

export interface SessionShutdown {
  shutdownType: 'routine' | 'error';
  errorReason?: string;
  /**
   * Total premium-request cost for the session, summed from the shutdown
   * event's per-model metrics. May be fractional (per-model multipliers).
   * A fallback for `usage.getMetrics().totalPremiumRequestCost`.
   */
  premiumRequestCost: number;
  codeChanges: {
    linesAdded: number;
    linesRemoved: number;
    filesModified: string[];
  };
  currentModel?: string;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function attachStream(opts: AttachOptions): AttachedStream {
  const { session, stateDir, appendLog, progress } = opts;
  const emit = opts.emit ?? ((): void => {});

  let lastAssistantMessage: string | undefined;
  let taskCompleteSummary: string | undefined;
  let taskCompleteSuccess: boolean | undefined;
  let completed = false;

  let resolveCompletion!: (value: TaskCompletion) => void;
  let rejectCompletion!: (err: Error) => void;
  const completion = new Promise<TaskCompletion>((res, rej) => {
    resolveCompletion = res;
    rejectCompletion = rej;
  });

  let resolveShutdown!: (value: SessionShutdown) => void;
  const shutdown = new Promise<SessionShutdown>((res) => {
    resolveShutdown = res;
  });

  const unsubscribers: Array<() => void> = [];

  const handler = (event: SessionEvent): void => {
    switch (event.type) {
      case 'assistant.message': {
        const content = event.data.content ?? '';
        if (content) {
          lastAssistantMessage = content;
          progress(`[assistant] ${truncate(content, 160)}`);
          appendLog(`assistant.message: ${truncate(content, 400)}`);
          emit({ type: 'assistant_message', content });
        }
        break;
      }

      case 'assistant.usage': {
        // As of SDK 1.0 this event no longer carries quota snapshots — quota is
        // fetched actively via `account.getQuota`. It now reports a per-call
        // `cost` (the model's premium-request multiplier) which we surface for
        // visibility into the new billing model.
        const reqId = event.data.providerCallId ?? event.data.apiCallId;
        const cost = event.data.cost;
        appendLog(
          `assistant.usage model=${event.data.model}${cost !== undefined ? ` cost=${cost}` : ''}${reqId ? ` request=${reqId}` : ''}`,
        );
        if (cost !== undefined && cost > 0) {
          progress(`[usage] ${event.data.model} +${cost} premium cost`);
        }
        emit({ type: 'usage', copilot: { cost } });
        break;
      }

      case 'session.task_complete': {
        // Capture structured summary if the agent provides one. Not all
        // tasks emit this event, so we do NOT use it as the completion signal.
        taskCompleteSummary = event.data.summary;
        taskCompleteSuccess = event.data.success;
        appendLog(`session.task_complete success=${event.data.success ?? 'unknown'}`);
        progress(`[task_complete] ${event.data.success === false ? 'failed' : 'ok'}`);
        emit({ type: 'task_complete', summary: taskCompleteSummary, success: taskCompleteSuccess });
        break;
      }

      case 'session.idle': {
        // Primary completion signal: the session has finished processing the
        // prompt and is ready for the next one. Resolve the completion promise
        // with whatever summary we have (from task_complete or last assistant
        // message).
        if (!completed) {
          completed = true;
          appendLog('session.idle — resolving as completion');
          progress('[idle] session finished processing');
          resolveCompletion({
            summary: taskCompleteSummary,
            success: taskCompleteSuccess,
          });
        }
        emit({ type: 'idle' });
        break;
      }

      case 'session.shutdown': {
        const d = event.data;
        // Sum per-model request cost (SDK 1.0 dropped the flat
        // `totalPremiumRequests` integer in favour of multiplier-based cost).
        let premiumRequestCost = 0;
        for (const m of Object.values(d.modelMetrics ?? {})) {
          premiumRequestCost += m?.requests?.cost ?? 0;
        }
        appendLog(
          `session.shutdown type=${d.shutdownType} premiumCost=${premiumRequestCost} files=${d.codeChanges.filesModified.length} +${d.codeChanges.linesAdded}/-${d.codeChanges.linesRemoved}`,
        );
        resolveShutdown({
          shutdownType: d.shutdownType,
          errorReason: d.errorReason,
          premiumRequestCost,
          codeChanges: {
            linesAdded: d.codeChanges.linesAdded,
            linesRemoved: d.codeChanges.linesRemoved,
            filesModified: [...d.codeChanges.filesModified],
          },
          currentModel: d.currentModel,
        });
        emit({
          type: 'shutdown',
          codeChanges: {
            linesAdded: d.codeChanges.linesAdded,
            linesRemoved: d.codeChanges.linesRemoved,
            filesModified: [...d.codeChanges.filesModified],
          },
        });
        break;
      }

      case 'session.error': {
        const msg = event.data.message ?? 'unknown session error';
        appendLog(`session.error: ${msg}`);
        progress(`[error] ${msg}`);
        if (!completed) {
          completed = true;
          rejectCompletion(new Error(msg));
        }
        emit({ type: 'error', message: msg });
        break;
      }

      case 'session.warning': {
        const msg = event.data.message ?? '';
        if (msg) {
          appendLog(`session.warning: ${msg}`);
          progress(`[warning] ${truncate(msg, 160)}`);
        }
        break;
      }

      case 'session.info': {
        const msg = event.data.message ?? '';
        if (msg) {
          appendLog(`session.info: ${truncate(msg, 200)}`);
        }
        break;
      }

      case 'session.compaction_start': {
        appendLog('session.compaction_start');
        progress('[compaction] started');
        break;
      }

      case 'session.compaction_complete': {
        appendLog('session.compaction_complete');
        progress('[compaction] complete');
        break;
      }

      case 'tool.execution_start': {
        const toolName = (event.data as { toolName?: string }).toolName ?? 'unknown';
        appendLog(`tool.execution_start ${toolName}`);
        progress(`[tool] ${toolName} …`);
        emit({ type: 'tool_start', name: toolName });
        break;
      }

      case 'tool.execution_complete': {
        const toolName = (event.data as { toolName?: string }).toolName ?? 'unknown';
        appendLog(`tool.execution_complete ${toolName}`);
        break;
      }

      case 'subagent.started': {
        const name = (event.data as { agentName?: string; name?: string }).agentName ?? (event.data as { name?: string }).name ?? 'subagent';
        appendLog(`subagent.started ${name}`);
        progress(`[subagent:${name}] started`);
        break;
      }

      case 'subagent.completed': {
        const name = (event.data as { agentName?: string; name?: string }).agentName ?? (event.data as { name?: string }).name ?? 'subagent';
        appendLog(`subagent.completed ${name}`);
        break;
      }

      case 'subagent.failed': {
        const name = (event.data as { agentName?: string; name?: string }).agentName ?? (event.data as { name?: string }).name ?? 'subagent';
        appendLog(`subagent.failed ${name}`);
        progress(`[subagent:${name}] failed`);
        break;
      }

      case 'permission.requested': {
        const req = event.data.permissionRequest;
        const kind = req.kind;
        let detail: string | undefined;
        if (kind === 'shell') {
          detail = (req as { fullCommandText?: string }).fullCommandText;
          appendLog(`permission.requested shell: ${detail ?? ''}`);
        } else if (kind === 'write') {
          detail = (req as { fileName?: string }).fileName;
          appendLog(`permission.requested write: ${detail ?? ''}`);
        } else if (kind === 'read') {
          detail = (req as { path?: string }).path;
          appendLog(`permission.requested read: ${detail ?? ''}`);
        } else if (kind === 'url') {
          detail = (req as { url?: string }).url;
          appendLog(`permission.requested url: ${detail ?? ''}`);
        } else {
          appendLog(`permission.requested ${kind}`);
        }
        emit({ type: 'permission_request', kind, detail });
        break;
      }

      default:
        // Ignore other events (turn_start, streaming_delta, message_delta, etc.)
        break;
    }
  };

  const unsub = session.on(handler);
  unsubscribers.push(unsub);

  return {
    getLastAssistantMessage: () => lastAssistantMessage,
    completion,
    shutdown,
    dispose: () => {
      for (const u of unsubscribers) u();
    },
  };
}

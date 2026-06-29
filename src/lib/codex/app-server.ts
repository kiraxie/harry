// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc (broker transport removed; ported to TypeScript).
// See NOTICE.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import process from "node:process";
import readline from "node:readline";

import { PLUGIN_VERSION } from "../version.ts";
import { terminateProcessTree } from "./process.ts";
import type {
  AppServerNotification,
  AppServerNotificationHandler,
  ClientInfo,
  CodexConnectOpts,
  InitializeCapabilities,
  ProtocolError
} from "./protocol.ts";

/**
 * Default ceiling for the connect/initialize handshake. Canonical home for the
 * transport layer; callers (auth probe, turn path) reuse this so a spawned
 * `codex app-server` that blocks before answering `initialize` can never hang
 * the caller forever.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 60 * 1000;

/**
 * Grace period after SIGTERM before escalating to SIGKILL on close(), and the
 * absolute ceiling on how long close() will wait for the child to exit. These
 * guarantee close() always resolves even if the child ignores SIGTERM or a
 * grandchild leaks past the parent.
 */
const CLOSE_SIGTERM_DELAY_MS = 50;
const CLOSE_SIGKILL_GRACE_MS = 500;
const CLOSE_EXIT_WAIT_MS = 3000;

const DEFAULT_CLIENT_INFO: ClientInfo = {
  title: "harry",
  name: "harry",
  version: PLUGIN_VERSION
};

const DEFAULT_CAPABILITIES: InitializeCapabilities = {
  experimentalApi: false,
  requestAttestation: false,
  optOutNotificationMethods: [
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/textDelta"
  ]
};

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
  method: string;
}

function buildJsonRpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return data === undefined ? { code, message } : { code, message, data };
}

function createProtocolError(message: string, data?: unknown): ProtocolError {
  const error = new Error(message) as ProtocolError;
  error.data = data;
  if (data && typeof data === "object" && (data as { code?: number }).code !== undefined) {
    error.rpcCode = (data as { code?: number }).code;
  }
  return error;
}

/**
 * Low-level JSON-RPC client over a spawned `codex app-server` process.
 *
 * Speaks newline-delimited JSON (JSONL) over stdio. v1 is direct-only: the
 * broker transport from the upstream reference was removed.
 */
export class CodexAppServerClient {
  private readonly cwd: string;
  private readonly options: CodexConnectOpts;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stderrBuffer = "";
  private closed = false;
  private exitResolved = false;
  private exitError: Error | null = null;
  private notificationHandler: AppServerNotificationHandler | null = null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readline: readline.Interface | null = null;

  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;

  private constructor(cwd: string, options: CodexConnectOpts) {
    this.cwd = cwd;
    this.options = options;
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  static async connect(
    cwd: string,
    opts: CodexConnectOpts & { connectTimeoutMs?: number } = {}
  ): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(cwd, opts);
    await client.initialize(opts.connectTimeoutMs);
    return client;
  }

  setNotificationHandler(handler: AppServerNotificationHandler): void {
    this.notificationHandler = handler;
  }

  get stderr(): string {
    return this.stderrBuffer;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      // Reject rather than throw synchronously: a Promise-returning API must
      // surface failures through the promise chain so `.catch(...)` and a bare
      // `Promise.race([request(...), ...])` (no enclosing try) still see it.
      return Promise.reject(new Error("codex app-server client is closed."));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.sendMessage({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (this.closed) {
      return;
    }
    this.sendMessage({ method, params });
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: any;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.handleExit(
        createProtocolError(
          `Failed to parse codex app-server JSONL: ${(error as Error).message}`,
          { line }
        )
      );
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          createProtocolError(
            message.error.message ?? `codex app-server ${pending.method} failed.`,
            message.error
          )
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(message as AppServerNotification);
    }
  }

  private handleServerRequest(message: { id: number; method: string }): void {
    // PRECONDITION: this blanket -32601 rejection is only safe because v1 runs
    // every turn under `approvalPolicy:"never"` + a read-only sandbox, so codex
    // never legitimately needs a client→server approval. The moment a codex
    // write path is enabled, the server will send `applyPatchApproval` /
    // `execCommandApproval` requests; hard-rejecting those stalls the turn.
    // Enabling writes REQUIRES handling (auto-approving) those methods here
    // instead of returning "Unsupported".
    this.sendMessage({
      id: message.id,
      error: buildJsonRpcError(-32601, `Unsupported server request: ${message.method}`)
    });
  }

  private handleExit(error?: Error | null): void {
    if (this.exitResolved) {
      return;
    }

    this.exitResolved = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("codex app-server connection closed."));
    }
    this.pending.clear();
    this.resolveExit();
  }

  private async initialize(connectTimeoutMs?: number): Promise<void> {
    this.proc = spawn("codex", ["app-server"], {
      cwd: this.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? process.env.SHELL || true : false,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });

    this.proc.on("error", (error) => {
      this.handleExit(error);
    });

    this.proc.on("exit", (code, signal) => {
      const stderr = this.stderrBuffer.trim();
      const detail =
        code === 0
          ? null
          : createProtocolError(
              `codex app-server exited unexpectedly (${
                signal ? `signal ${signal}` : `exit ${code}`
              }).${stderr ? `\n${stderr}` : ""}`
            );
      this.handleExit(detail);
    });

    this.readline = readline.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    const initRequest = this.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
    });

    if (connectTimeoutMs !== undefined && connectTimeoutMs > 0) {
      // Anti-hang at the SOURCE: if the spawned child never answers `initialize`
      // (e.g. blocked on an interactive/auth prompt), reject AND tear down the
      // child so no process leaks. Without this, connect() could hang forever.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const stderr = this.stderrBuffer.trim();
          reject(
            createProtocolError(
              `codex app-server did not answer initialize within ${connectTimeoutMs}ms.${
                stderr ? `\n${stderr}` : ""
              }`
            )
          );
        }, connectTimeoutMs);
        timer.unref?.();
      });
      // Prevent an unhandled rejection if the timeout wins the race: the pending
      // initialize request is rejected later by handleExit() during close().
      initRequest.catch(() => {});
      try {
        await Promise.race([initRequest, timeout]);
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }
        await this.close();
        throw error;
      }
      if (timer) {
        clearTimeout(timer);
      }
    } else {
      await initRequest;
    }

    this.notify("initialized", {});
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.waitForExit();
      return;
    }

    this.closed = true;

    if (this.readline) {
      this.readline.close();
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      const proc = this.proc;
      const termTimer = setTimeout(() => {
        if (proc.killed || proc.exitCode !== null) {
          return;
        }
        // On Windows with shell: true, the direct child is cmd.exe.
        // Use terminateProcessTree to kill the entire tree including
        // the grandchild node process.
        if (process.platform === "win32") {
          try {
            if (proc.pid !== undefined) {
              terminateProcessTree(proc.pid);
            }
          } catch {
            // Best-effort cleanup inside an unref'd timer — swallow errors
            // to avoid crashing the host process during shutdown.
          }
          return;
        }
        proc.kill("SIGTERM");
        // Escalate: a child that ignores SIGTERM (or refuses a graceful
        // shutdown) must still be reaped, otherwise 'exit' never fires and
        // exitPromise never resolves — hanging close().
        const killTimer = setTimeout(() => {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, CLOSE_SIGKILL_GRACE_MS);
        killTimer.unref?.();
      }, CLOSE_SIGTERM_DELAY_MS);
      termTimer.unref?.();
    }

    await this.waitForExit();
  }

  /**
   * Wait for the child to exit, but never longer than CLOSE_EXIT_WAIT_MS. Even
   * with SIGKILL escalation a grandchild can keep stdio open or 'exit' can be
   * delayed; this bound guarantees close() always resolves so a caller's
   * `await client.close()` in a finally block can't hang the host.
   */
  private async waitForExit(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CLOSE_EXIT_WAIT_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([this.exitPromise, bound]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private sendMessage(message: unknown): void {
    const line = `${JSON.stringify(message)}\n`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error("codex app-server stdin is not available.");
    }
    stdin.write(line);
  }
}

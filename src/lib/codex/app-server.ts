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

  static async connect(cwd: string, opts: CodexConnectOpts = {}): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(cwd, opts);
    await client.initialize();
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
      throw new Error("codex app-server client is closed.");
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

  private async initialize(): Promise<void> {
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

    await this.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
    });
    this.notify("initialized", {});
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    if (this.readline) {
      this.readline.close();
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      const proc = this.proc;
      setTimeout(() => {
        if (proc && !proc.killed && proc.exitCode === null) {
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
          } else {
            proc.kill("SIGTERM");
          }
        }
      }, 50).unref?.();
    }

    await this.exitPromise;
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

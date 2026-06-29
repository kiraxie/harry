// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc (broker transport removed; ported to TypeScript).
// See NOTICE.

/** A JSON-RPC notification (no id) emitted by the codex app-server. */
export interface AppServerNotification {
  method: string;
  params: any;
}

/** Handler invoked for every server-sent notification. */
export type AppServerNotificationHandler = (notification: AppServerNotification) => void;

/** Identifies this client to the codex app-server during `initialize`. */
export interface ClientInfo {
  title: string;
  name: string;
  version: string;
}

/** Capabilities advertised to the codex app-server during `initialize`. */
export interface InitializeCapabilities {
  experimentalApi: boolean;
  requestAttestation: boolean;
  optOutNotificationMethods: string[];
}

/** Options accepted by {@link CodexAppServerClient.connect}. */
export interface CodexConnectOpts {
  env?: NodeJS.ProcessEnv;
  /** v1 is direct-only; the broker transport was removed. */
  disableBroker?: true;
  clientInfo?: ClientInfo;
  capabilities?: InitializeCapabilities;
}

/** A single item within a thread turn. */
export type ThreadItem = { type: string; [k: string]: any };

/** A JSON-RPC error surfaced as a thrown Error with extra metadata. */
export type ProtocolError = Error & { data?: unknown; rpcCode?: number };

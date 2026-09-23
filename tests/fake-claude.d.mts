export interface FakeClaudeCall {
  prompt?: string;
  model?: string;
  allowedTools?: string;
  permissionMode?: string;
  configDir: string | null;
  cwd: string;
  cwdHasClaudeMd: boolean;
  hasClaudeMd: boolean;
  lawsPresent: boolean;
  hasCredentials: boolean;
  apiKey: string | null;
  oauthToken: string | null;
  evalsApiKeyForwarded: boolean;
  evalsOauthForwarded: boolean;
  envKeys: string[];
}

export interface FakeClaudeSettings {
  failOnNth?: number[];
  failReply?: string;
  script?: string;
  fail?: boolean;
  isError?: boolean;
  stderr?: string;
  callsInConfigDir?: boolean;
}

export function installFakeClaude(
  binDir: string,
  reply?: string,
  settings?: FakeClaudeSettings,
): { scriptPath: string; callsPath: string };

export function readCalls(binDir: string): FakeClaudeCall[];

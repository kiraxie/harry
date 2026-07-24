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
}

export function installFakeClaude(
  binDir: string,
  reply?: string,
): { scriptPath: string; callsPath: string };

export function readCalls(binDir: string): FakeClaudeCall[];

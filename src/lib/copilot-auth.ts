/**
 * Authentication status check using the Copilot SDK's built-in `getAuthStatus`.
 *
 * The SDK supports `gh-cli`, `env`, `user` (OAuth), `hmac`, `api-key`, and
 * `token` auth types. For this plugin we treat `gh-cli` and `env` (via
 * GH_TOKEN / GITHUB_TOKEN / COPILOT_GITHUB_TOKEN) as the happy path.
 */

import type { CopilotClient } from '@github/copilot-sdk';
import type { GetAuthStatusResponse } from '@github/copilot-sdk';

export interface AuthSummary {
  ok: boolean;
  authType?: GetAuthStatusResponse['authType'];
  login?: string;
  host?: string;
  message: string;
}

export async function checkAuth(client: CopilotClient): Promise<AuthSummary> {
  let status: GetAuthStatusResponse;
  try {
    status = await client.getAuthStatus();
  } catch (err) {
    return {
      ok: false,
      message: `Failed to query auth status: ${(err as Error).message}`,
    };
  }

  if (!status.isAuthenticated) {
    return {
      ok: false,
      authType: status.authType,
      host: status.host,
      message: status.statusMessage ?? 'Not authenticated. Run `gh auth login` or set GH_TOKEN / COPILOT_GITHUB_TOKEN.',
    };
  }

  return {
    ok: true,
    authType: status.authType,
    login: status.login,
    host: status.host,
    message: status.statusMessage ?? `Authenticated via ${status.authType ?? 'unknown method'}`,
  };
}

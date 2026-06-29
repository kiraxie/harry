/**
 * setup command — auth + model availability + quota + worktree housekeeping.
 */

import { CopilotClient } from '@github/copilot-sdk';
import type { ModelInfo } from '@github/copilot-sdk';

import { checkAuth } from '../lib/copilot-auth.js';
import { readSnapshot, summarize, renderQuotaBar, fetchQuota } from '../lib/quota.js';
import { pruneOrphans } from '../lib/worktree.js';
import { resolveStateDir } from '../lib/state.js';
import { CLIENT_NAME, PLUGIN_VERSION } from '../lib/version.js';

const DEFAULT_MODEL = 'claude-opus-4.8';

export interface SetupOptions {
  check?: boolean;
  json?: boolean;
  cwd?: string;
}

interface SetupReport {
  status: 'ok' | 'error';
  authType?: string;
  login?: string;
  host?: string;
  defaultModel: string;
  defaultModelAvailable: boolean;
  models: string[];
  claudeModels: string[];
  quota?: ReturnType<typeof summarize>;
  message?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const stateDir = resolveStateDir(cwd);
  const isCheck = options.check === true;

  const client = new CopilotClient({ workingDirectory: cwd });

  try {
    await client.start();
  } catch (err) {
    const msg = `Failed to start Copilot CLI: ${(err as Error).message}`;
    if (isCheck) {
      console.error(`[copilot] ${msg} — run \`gh auth login\` and ensure @github/copilot is installed.`);
      return;
    }
    emit(options, {
      status: 'error',
      defaultModel: DEFAULT_MODEL,
      defaultModelAvailable: false,
      models: [],
      claudeModels: [],
      message: msg,
    });
    return;
  }

  const auth = await checkAuth(client);
  if (!auth.ok) {
    await client.stop().catch(() => { /* ignore */ });
    if (isCheck) {
      console.error(`[copilot] ${auth.message}`);
      return;
    }
    emit(options, {
      status: 'error',
      authType: auth.authType,
      defaultModel: DEFAULT_MODEL,
      defaultModelAvailable: false,
      models: [],
      claudeModels: [],
      message: auth.message,
    });
    return;
  }

  let models: ModelInfo[] = [];
  try {
    models = await client.listModels();
  } catch (err) {
    // Non-fatal — we still report auth success.
    if (!isCheck) console.error(`[copilot] listModels failed: ${(err as Error).message}`);
  }

  const modelIds = models.map((m) => m.id);
  const claudeModels = modelIds.filter((id) => id.toLowerCase().includes('claude'));
  const defaultAvailable = modelIds.includes(DEFAULT_MODEL);

  const pruneReport = pruneOrphans(cwd);

  // Actively refresh the quota snapshot while the client is live — the SDK no
  // longer pushes quota via events, so this is how `setup` shows real numbers.
  await fetchQuota(client, stateDir).catch(() => null);

  await client.stop().catch(() => { /* ignore */ });

  if (isCheck) {
    // SessionStart hook — silent success.
    return;
  }

  const report: SetupReport = {
    status: 'ok',
    authType: auth.authType,
    login: auth.login,
    host: auth.host,
    defaultModel: DEFAULT_MODEL,
    defaultModelAvailable: defaultAvailable,
    models: modelIds,
    claudeModels,
    quota: summarize(readSnapshot(stateDir)),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push(`## Copilot Plugin Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push('');
  lines.push(`**Status:** Authenticated (${auth.authType}${auth.login ? ` as ${auth.login}` : ''})`);
  if (auth.host) lines.push(`**Host:** ${auth.host}`);
  lines.push(`**Default model:** \`${DEFAULT_MODEL}\` ${defaultAvailable ? '(available)' : '(NOT listed — pass --model to override)'}`);
  if (modelIds.length > 0) {
    lines.push('');
    lines.push('### Available models');
    for (const m of modelIds) lines.push(`- \`${m}\``);
  }
  if (!defaultAvailable && claudeModels.length > 0) {
    lines.push('');
    lines.push('### Claude models detected');
    for (const m of claudeModels) lines.push(`- \`${m}\``);
  }
  lines.push('');
  lines.push('### Quota');
  const haveSnapshot = !!(report.quota && (report.quota.premium !== undefined || report.quota.unlimited));
  lines.push(...renderQuotaBar(report.quota ?? { pools: [], allUnlimited: false }, haveSnapshot));
  lines.push('');
  lines.push('### Housekeeping');
  lines.push(`- Worktrees pruned: ${pruneReport.worktreesPruned ? 'yes' : 'skipped (not a git repo or prune failed)'}`);
  lines.push(`- Merged copilot/* branches removed: ${pruneReport.branchesRemoved}`);
  lines.push('');
  lines.push('### Next steps');
  lines.push('- `/copilot:ask "<prompt>"` to ask a frontier model a single question');
  lines.push('- `/copilot:status` to see quota + running jobs');
  lines.push('- `/copilot:debate "<topic>"` for a three-model debate (needs the `agy` CLI for the Gemini voice)');

  console.log(lines.join('\n'));
}

function emit(options: SetupOptions, report: SetupReport): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push(`## Copilot Plugin Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push('');
  lines.push(`**Status:** ${report.status === 'ok' ? 'Authenticated' : 'Not authenticated'}`);
  if (report.message) lines.push(`**Message:** ${report.message}`);
  console.log(lines.join('\n'));
}

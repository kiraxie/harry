/**
 * Selective permission handler for the Copilot session.
 *
 * The plugin must be safe enough to be invoked proactively by Claude Code's
 * orchestrator, which means `approveAll` is not acceptable (shell execution
 * inside a worktree still runs with the user's privileges). We approve the
 * low-risk categories automatically and gate shell/url behind explicit flags.
 *
 * All requests — whether approved or denied — are logged so the reviewer can
 * see exactly what the agent tried to do.
 */

import type { PermissionHandler, PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export interface PermissionOptions {
  /** If true, permit Copilot to execute shell commands. */
  allowShell: boolean;
  /** If true, permit Copilot to fetch URLs. */
  allowUrl: boolean;
  /** Worktree path — write permissions are only auto-approved inside this directory. */
  worktreePath: string;
  /** Hook for logging every permission decision. */
  appendLog: (message: string) => void;
  /**
   * Hard read-only mode. When true, every write request is denied regardless
   * of path. Used by the review command (no worktree, no edits expected).
   */
  readOnly?: boolean;
  /**
   * Isolated reasoning mode. When true, the session may not touch the
   * filesystem or call tools at all: read and MCP requests are denied outright
   * (writes/shell/url/custom-tool are already denied by the read-only and
   * default-deny paths). Used by the `ask` command so the debate feature's
   * "no backend touches the filesystem" guarantee is enforced, not just
   * promised in prompt text.
   */
  isolated?: boolean;
}

// SDK 1.0 expects *action* kinds from a permission handler. `approve-once` is
// what the SDK's own `approveAll` returns; `reject` carries optional feedback.
// (The `approved` / `denied-interactively-by-user` kinds also exist in the
// union but represent server-side decision *records*, not valid handler
// responses — returning them yields "unexpected user permission response".)
function approved(): PermissionRequestResult {
  return { kind: 'approve-once' };
}

function denied(feedback: string): PermissionRequestResult {
  return { kind: 'reject', feedback };
}

function canonicalize(p: string): string {
  // Canonicalize via realpath so symlinks cannot smuggle a path past a
  // lexical containment check. For paths that do not exist yet (e.g. a
  // pending write target), canonicalize the closest existing ancestor and
  // append the unresolved tail — that is enough to defeat symlink escape
  // because the unresolved suffix cannot itself be a symlink yet.
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    if (parent === p) return resolve(p);
    return resolve(canonicalize(parent), p.slice(parent.length).replace(/^[\\/]+/, ''));
  }
}

function isPathInside(child: string, parent: string): boolean {
  const c = canonicalize(resolve(child));
  const p = canonicalize(resolve(parent));
  if (c === p) return true;
  // Use path.relative so the check is separator- and drive-letter-aware on
  // Windows (where canonical paths look like C:\repo\file and a hard-coded
  // "/" prefix check would always fail).
  const rel = relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function makePermissionHandler(opts: PermissionOptions): PermissionHandler {
  return (request: PermissionRequest): PermissionRequestResult => {
    const kind = request.kind;

    switch (kind) {
      case 'read': {
        const path = (request as { path?: string }).path ?? '';
        if (opts.isolated) {
          opts.appendLog(`permission.read DENIED (isolated mode): ${path}`);
          return denied('This Copilot session is isolated (reasoning only); filesystem reads are not permitted.');
        }
        if (opts.readOnly) {
          // In review mode, restrict reads to the working tree to prevent
          // prompt-injection-driven exfiltration of files outside the repo
          // (e.g. ~/.ssh, ~/.aws). Allow relative paths and any absolute path
          // inside worktreePath; deny everything else.
          if (!path) {
            opts.appendLog('permission.read DENIED (read-only mode): empty path');
            return denied('Permission request missing path.');
          }
          const absolute = path.startsWith('/') ? path : resolve(opts.worktreePath, path);
          if (!isPathInside(absolute, opts.worktreePath)) {
            opts.appendLog(`permission.read DENIED (outside worktree): ${absolute}`);
            return denied(`Reads outside the review target (${opts.worktreePath}) are not permitted.`);
          }
        }
        opts.appendLog(`permission.read approved: ${path}`);
        return approved();
      }

      case 'write': {
        const fileName = (request as { fileName?: string }).fileName ?? '';
        if (opts.readOnly) {
          opts.appendLog(`permission.write DENIED (read-only mode): ${fileName}`);
          return denied('This Copilot session is read-only (review mode). File writes are not permitted.');
        }
        if (!fileName) {
          opts.appendLog('permission.write denied: no fileName provided');
          return denied('Permission request missing fileName.');
        }
        const absolute = fileName.startsWith('/') ? fileName : resolve(opts.worktreePath, fileName);
        if (isPathInside(absolute, opts.worktreePath)) {
          opts.appendLog(`permission.write approved: ${fileName}`);
          return approved();
        }
        opts.appendLog(`permission.write denied (outside worktree): ${absolute}`);
        return denied(`Writes outside the worktree (${opts.worktreePath}) are not permitted by the Claude Code Copilot plugin.`);
      }

      case 'mcp': {
        const { serverName, toolName, readOnly } = request as {
          serverName?: string;
          toolName?: string;
          readOnly?: boolean;
        };
        if (opts.isolated) {
          opts.appendLog(`permission.mcp DENIED (isolated mode): ${serverName}/${toolName}`);
          return denied(`This Copilot session is isolated (reasoning only); MCP tool ${serverName}/${toolName} is not permitted.`);
        }
        if (opts.readOnly && readOnly !== true) {
          // In review mode we only auto-approve MCP calls the SDK explicitly
          // marks read-only; anything else is a potential side-effect path.
          opts.appendLog(`permission.mcp DENIED (read-only mode): ${serverName}/${toolName} (readOnly=${readOnly ?? 'unknown'})`);
          return denied(`MCP tool ${serverName}/${toolName} is not marked read-only; not permitted in this Copilot review session.`);
        }
        opts.appendLog(`permission.mcp approved: ${serverName}/${toolName} (readOnly=${readOnly ?? false})`);
        return approved();
      }

      case 'shell': {
        const { fullCommandText, intention } = request as {
          fullCommandText?: string;
          intention?: string;
        };
        const preview = (fullCommandText ?? '').slice(0, 160);
        if (opts.allowShell) {
          opts.appendLog(`permission.shell approved: ${preview}${intention ? ` — ${intention}` : ''}`);
          return approved();
        }
        opts.appendLog(`permission.shell DENIED: ${preview}${intention ? ` — ${intention}` : ''}`);
        return denied('Shell execution is disabled for this Copilot session. Re-run the implement command with --allow-shell if you want to permit shell commands.');
      }

      case 'url': {
        const { url } = request as { url?: string };
        if (opts.allowUrl) {
          opts.appendLog(`permission.url approved: ${url}`);
          return approved();
        }
        opts.appendLog(`permission.url DENIED: ${url}`);
        return denied('URL fetching is disabled for this Copilot session. Re-run with --allow-url to permit it.');
      }

      case 'custom-tool': {
        const { toolName } = request as { toolName?: string };
        opts.appendLog(`permission.custom-tool DENIED: ${toolName}`);
        return denied(`Custom tool ${toolName} requires explicit user approval; not permitted in automated Copilot sessions.`);
      }

      default: {
        opts.appendLog(`permission.${kind} DENIED (unknown kind, conservative default)`);
        return denied(`Permission kind "${kind}" is not auto-approved by the Claude Code Copilot plugin.`);
      }
    }
  };
}

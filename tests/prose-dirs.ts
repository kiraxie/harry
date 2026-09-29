// The one list of prose top-level files and markdown directories, split by whether a
// plugin build loads them. Every prose scan derives its corpus from here, so a file or
// directory added or moved is seen by all of them or by none.
export const SHIPPED_TOP_LEVEL = ["HARRY.md"];
export const REPO_TOP_LEVEL = ["README.md", "CLAUDE.md"];
export const SHIPPED_PROSE_DIRS = ["skills", "commands", "codex-skills", "references", "agents"];
export const REPO_LOCAL_PROSE_DIRS = [".claude/commands", ".claude/references"];
export const REPO_LOCAL_DIRS = [...REPO_LOCAL_PROSE_DIRS, ".claude/scripts"];
export const PROSE_DIRS = [...SHIPPED_PROSE_DIRS, ...REPO_LOCAL_PROSE_DIRS];

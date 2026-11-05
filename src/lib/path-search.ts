export { isExecutableFile, resolveOnPath } from "../../scripts/lib/path-search.mjs";

/**
 * The ENOENT a spawn reports when {@link resolveOnPath} finds no `name`: the
 * same `code`, so a caller's existing not-found handling needs no new case.
 */
export function notFoundError(syscall: string, name: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ENOENT`), { code: "ENOENT", syscall, path: name });
}

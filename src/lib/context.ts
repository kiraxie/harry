import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function resolveTextFlag(
  cwd: string,
  flag: string,
  raw: string | undefined,
): string | undefined {
  if (!raw?.trim()) return undefined;
  if (!raw.startsWith("@")) return raw.trim();

  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text: string;
  try {
    text = readFileSync(ref === "-" ? 0 : resolve(cwd, ref), "utf-8").trim();
  } catch (err) {
    throw new Error(`Could not read ${flag} ${source}: ${(err as Error).message}`);
  }
  if (!text) throw new Error(`${flag} ${source} is empty.`);
  return text;
}

#!/usr/bin/env node

import os from "node:os";
import path from "node:path";

export function withoutWrapperDir(pathValue: string, home: string): string {
  const wrapper = path.join(home, ".claude", "hooks", "bin");
  return pathValue
    .split(path.delimiter)
    .filter((dir) => dir === "" || path.resolve(dir) !== wrapper)
    .join(path.delimiter);
}

if (import.meta.main) {
  process.stdout.write(withoutWrapperDir(process.env.PATH ?? "", os.homedir()));
}

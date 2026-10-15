import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "apps/vs-wiki/site/_data/generated";

export function writeGenerated(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

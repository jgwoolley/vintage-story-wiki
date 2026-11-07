// Where vsdev itself is, for files that ship with it (dist/page.js, dist/blockColors.json). Found by walking up from this module
// to the folder with our package.json, so it is the same whether this runs from src/ under tsx or bundled as dist/cli.js (a global install).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findAppDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === "@nf3t/vsdev") return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("vsdev: can't find its own package.json");
    dir = parent;
  }
}

export const appDir = findAppDir();

/** The directory relative paths are resolved against: where `npm run` was started (INIT_CWD), else the process's own. */
export const userCwd = (): string => process.env.INIT_CWD ?? process.cwd();

/**
 * A file that ships with vsdev: `dist/<built>` in a build or global install (esbuild.mjs copies it there), else `<source>` under the
 * package when running from source with tsx before a build.
 */
export function assetPath(built: string, source: string): string {
  const fromDist = path.join(appDir, "dist", built);
  return existsSync(fromDist) ? fromDist : path.join(appDir, source);
}

// Keeps a project's own copy of vs-manifest.schema.json current. A vs-manifest.json says `"$schema": "./vs-manifest.schema.json"` so
// editors validate and complete it, and that file is a copy of the one vsdev ships (dist/vs-manifest.schema.json); every command
// refreshes the copy in the folder it is run from, if there is one, so a new vsdev's new manifest keys show up without a manual copy.
// `--no-schema-update` (main.ts strips it) turns it off. It never creates the file, and only touches one that is our schema (same `$id`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appDir } from "./paths.js";

export const SCHEMA_FILE = "vs-manifest.schema.json";
/** The flag that turns the refresh off, accepted anywhere on the command line. */
export const NO_SCHEMA_UPDATE = "--no-schema-update";

/** The one source of the schema, in the checkout (src/ isn't published); esbuild.mjs copies it to dist/ for a global install. */
export const SOURCE_SCHEMA = path.join(appDir, "src", SCHEMA_FILE);

/** The schema vsdev ships: the source file when running from the checkout (never older than a built copy), else dist/. */
export const bundledManifestSchema = (): string => (existsSync(SOURCE_SCHEMA) ? SOURCE_SCHEMA : path.join(appDir, "dist", SCHEMA_FILE));

export type SchemaUpdate = "updated" | "current" | "absent" | "skipped";

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/**
 * Overwrites `<cwd>/vs-manifest.schema.json` with the bundled schema when its content differs.
 * - "absent": there is no such file (nothing is created);
 * - "skipped": the file is not ours (unreadable, or another `$id`), or there is no bundled schema to copy;
 * - "current": same content (formatting aside); "updated": rewritten.
 * Throws when the file can't be written (the caller warns).
 */
export function updateManifestSchema(cwd: string, bundled = bundledManifestSchema()): SchemaUpdate {
  const target = path.join(cwd, SCHEMA_FILE);
  if (!existsSync(target)) return "absent";
  if (!existsSync(bundled)) return "skipped";
  const mine = readJson(target) as { $id?: unknown } | undefined;
  const ours = readJson(bundled) as { $id?: unknown } | undefined;
  if (!mine || !ours || typeof ours.$id !== "string" || mine.$id !== ours.$id) return "skipped";
  if (JSON.stringify(mine) === JSON.stringify(ours)) return "current";
  writeFileSync(target, readFileSync(bundled, "utf8"));
  return "updated";
}

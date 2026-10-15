import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SchematicInfo } from "./types.js";
import type { SchematicFile } from "./schematicHeader.js";

/** Where the gzip copies are written; Eleventy copies this folder to `assets/schematics/world/` (see eleventy.config.js). */
export const COMPRESSED_SCHEMATICS_DIR = "apps/vs-wiki/site/_data/generated/schematicFiles";

/** Where the compressed schematics are served from, relative to the site root (matches the passthrough copy in eleventy.config.js). */
export const SCHEMATIC_ASSET_BASE = "assets/schematics/world/";

/** Path of a schematic's served file under `assets/schematics/world/`, e.g. "survival/story/devastation/small/small-12.json.gz". */
export function schematicAssetPath(domain: string, relPath: string): string {
  return `${domain}/${relPath}.json.gz`;
}

/**
 * Writes a gzip copy of every schematic so the browser viewer can fetch and decompress it
 * (`DecompressionStream`) -- raw, they total ~270 MB; gzipped ~50 MB. Pure Node `zlib`. A copy that
 * is already newer than its source is reused, so repeat ingests cost nothing. Records `gzBytes` on
 * each schematic and returns the totals.
 */
export function writeCompressedSchematics(
  schematics: SchematicInfo[],
  schematicsByDomain: Map<string, SchematicFile[]>,
  outDir = COMPRESSED_SCHEMATICS_DIR
): { rawBytes: number; gzBytes: number; written: number; reused: number } {
  const sourceById = new Map<string, SchematicFile>();
  for (const [domain, files] of schematicsByDomain) {
    for (const f of files) {
      const id = `${domain}:worldgen/schematics/${f.relPath}.json`;
      if (!sourceById.has(id)) sourceById.set(id, f);
    }
  }
  let rawBytes = 0, gzBytes = 0, written = 0, reused = 0;
  for (const schematic of schematics) {
    const source = sourceById.get(schematic.id);
    if (!source) continue;
    const out = join(outDir, schematicAssetPath(schematic.domain, schematic.relPath));
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(source.fullPath).mtimeMs) {
      reused++;
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, gzipSync(readFileSync(source.fullPath), { level: 6 }));
      written++;
    }
    schematic.gzBytes = statSync(out).size;
    rawBytes += schematic.fileBytes;
    gzBytes += schematic.gzBytes;
  }
  return { rawBytes, gzBytes, written, reused };
}

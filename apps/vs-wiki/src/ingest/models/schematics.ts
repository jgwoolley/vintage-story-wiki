import { statSync } from "node:fs";
import type { SchematicInfo } from "../types.js";
import { readSchematicMeta, type SchematicFile } from "../schematicHeader.js";
import { SCHEMATIC_ASSET_BASE, schematicAssetPath } from "../schematicFiles.js";

/** The id every schematic cross-reference uses: `<domain>:worldgen/schematics/<relPath>.json`. */
export function schematicId(domain: string, relPath: string): string {
  return `${domain}:worldgen/schematics/${relPath}.json`;
}

/**
 * One `SchematicInfo` per schematic file, each file read once (header + block/item code
 * dictionaries only; the voxel data stays unparsed). Two files can share an id when two sources
 * ship the same domain and path -- the first wins, as asset loading already does elsewhere, and the
 * duplicates are returned so the caller can warn about them.
 */
export function extractSchematics(
  schematicsByDomain: Map<string, SchematicFile[]>
): { schematics: SchematicInfo[]; duplicateIds: string[] } {
  const byId = new Map<string, SchematicInfo>();
  const duplicateIds: string[] = [];
  for (const [domain, files] of schematicsByDomain) {
    for (const file of files) {
      const id = schematicId(domain, file.relPath);
      if (byId.has(id)) {
        duplicateIds.push(id);
        continue;
      }
      const meta = readSchematicMeta(file.fullPath);
      byId.set(id, {
        id,
        domain,
        sourceMod: file.sourceMod,
        relPath: file.relPath,
        name: file.relPath.slice(file.relPath.lastIndexOf("/") + 1),
        pagePath: `${domain}/${file.relPath.toLowerCase()}`,
        assetPath: `${SCHEMATIC_ASSET_BASE}${schematicAssetPath(domain, file.relPath)}`,
        sizeX: meta.sizeX,
        sizeY: meta.sizeY,
        sizeZ: meta.sizeZ,
        blockCodeCount: meta.blockCodeCount,
        blockCodes: meta.blockCodes,
        itemCodes: meta.itemCodes,
        fileBytes: statSync(file.fullPath).size,
        usedBy: [],
      });
    }
  }
  return { schematics: [...byId.values()], duplicateIds };
}

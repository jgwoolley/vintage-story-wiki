import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export interface SchematicFile {
  domain: string;
  relPath: string; // relative to worldgen/schematics/, no extension
  fullPath: string;
}

/** Lists schematic files (paths only, no parsing) so glob matching doesn't require loading voxel data. */
export function listSchematicFiles(domain: string, domainRootDir: string): SchematicFile[] {
  const base = join(domainRootDir, "worldgen", "schematics");
  if (!existsSync(base)) return [];
  const out: SchematicFile[] = [];
  const stack = [base];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase().endsWith(".json")) {
        const rel = full.slice(base.length + 1).split(sep).join("/").replace(/\.json$/, "");
        out.push({ domain, relPath: rel, fullPath: full });
      }
    }
  }
  return out;
}

export interface SchematicHeader {
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  blockCodeCount?: number;
}

/**
 * Reads only the lightweight header fields of a schematic file -- dimensions and a count of
 * distinct block codes -- without parsing the (potentially tens-of-MB) Indices/BlockIds/BlockEntities
 * voxel data, which v1 treats as opaque (see project plan).
 */
export function readSchematicHeader(fullPath: string): SchematicHeader {
  const text = readFileSync(fullPath, "utf8");
  const sizeX = Number(text.match(/"SizeX"\s*:\s*(\d+)/)?.[1]);
  const sizeY = Number(text.match(/"SizeY"\s*:\s*(\d+)/)?.[1]);
  const sizeZ = Number(text.match(/"SizeZ"\s*:\s*(\d+)/)?.[1]);

  const blockCodesStart = text.indexOf('"BlockCodes"');
  let blockCodeCount: number | undefined;
  if (blockCodesStart !== -1) {
    const braceStart = text.indexOf("{", blockCodesStart);
    let depth = 0,
      end = -1;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) {
      const section = text.slice(braceStart, end + 1);
      blockCodeCount = (section.match(/"\d+"\s*:/g) ?? []).length;
    }
  }

  return {
    sizeX: Number.isFinite(sizeX) ? sizeX : undefined,
    sizeY: Number.isFinite(sizeY) ? sizeY : undefined,
    sizeZ: Number.isFinite(sizeZ) ? sizeZ : undefined,
    blockCodeCount,
  };
}

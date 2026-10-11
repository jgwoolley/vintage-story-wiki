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

/** Finds the `"BlockCodes": { ... }` substring in a schematic file's raw text, if present. */
function extractBlockCodesSection(text: string): string | undefined {
  const blockCodesStart = text.indexOf('"BlockCodes"');
  if (blockCodesStart === -1) return undefined;
  const braceStart = text.indexOf("{", blockCodesStart);
  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(braceStart, i + 1);
    }
  }
  return undefined;
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

  const section = extractBlockCodesSection(text);
  const blockCodeCount = section ? (section.match(/"\d+"\s*:/g) ?? []).length : undefined;

  return {
    sizeX: Number.isFinite(sizeX) ? sizeX : undefined,
    sizeY: Number.isFinite(sizeY) ? sizeY : undefined,
    sizeZ: Number.isFinite(sizeZ) ? sizeZ : undefined,
    blockCodeCount,
  };
}

/**
 * Reads the actual block code VALUES (e.g. "game:supportbeam-veryaged") out of a schematic's
 * BlockCodes dict -- still without touching the huge Indices/BlockIds/BlockEntities arrays, since
 * BlockCodes itself is just a small id->code dictionary. Used to find which structures contain a
 * specific block (e.g. a painting or tapestry), by checking membership rather than full voxel decode.
 */
export function readSchematicBlockCodes(fullPath: string): string[] {
  const text = readFileSync(fullPath, "utf8");
  const section = extractBlockCodesSection(text);
  if (!section) return [];
  try {
    return Object.values(JSON.parse(section) as Record<string, string>);
  } catch {
    return [];
  }
}

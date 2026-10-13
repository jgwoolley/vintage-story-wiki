import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export interface SchematicFile {
  domain: string;
  relPath: string; // relative to worldgen/schematics/, no extension
  fullPath: string;
}

/**
 * Tally of block-entity decode outcomes, filled in by the extractors that decode schematic blobs
 * (`tapestryInstances.ts`, `clutterInstances.ts`) and reported by `index.ts`. They skip a blob that
 * fails to decode rather than abort the ingest, so without this a decoder regression would be silent.
 */
export interface DecodeStats {
  /** Schematic files whose BlockEntities were read (passed the cheap block-code pre-filter). */
  schematics: number;
  /** Schematic files that could not be read or JSON-parsed at all. */
  unreadable: number;
  /** Block entity blobs attempted. */
  entities: number;
  /** Blobs whose decode threw. */
  failures: number;
  /** Up to 3 "<schematic path> #<packed index>: <message>" examples, for the log. */
  examples: string[];
}

export function newDecodeStats(): DecodeStats {
  return { schematics: 0, unreadable: 0, entities: 0, failures: 0, examples: [] };
}

export function recordDecodeFailure(stats: DecodeStats | undefined, where: string, e: unknown): void {
  if (!stats) return;
  stats.failures++;
  if (stats.examples.length < 3) stats.examples.push(`${where}: ${(e as Error).message}`);
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

/** Finds the `"<key>": { ... }` (BlockCodes/ItemCodes) dictionary substring in a schematic file's raw text, if present. */
function extractCodesSection(text: string, key: "BlockCodes" | "ItemCodes"): string | undefined {
  const blockCodesStart = text.indexOf(`"${key}"`);
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

  const section = extractCodesSection(text, "BlockCodes");
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
  return codeValues(readFileSync(fullPath, "utf8"), "BlockCodes");
}

/** Same idea as `readSchematicBlockCodes` for the `ItemCodes` dictionary (items placed into containers/stackrandomizers, e.g. "game:stackrandomizer-darkheat"). */
export function readSchematicItemCodes(fullPath: string): string[] {
  return codeValues(readFileSync(fullPath, "utf8"), "ItemCodes");
}

function codeValues(text: string, key: "BlockCodes" | "ItemCodes"): string[] {
  const section = extractCodesSection(text, key);
  if (!section) return [];
  try {
    return Object.values(JSON.parse(section) as Record<string, string>);
  } catch {
    return [];
  }
}

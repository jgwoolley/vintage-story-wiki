// Reads one file the renderer was given and works out what it is: a model (shape) file, a schematic (`.json` or the wiki's `.json.gz`)
// or a QPTech ChiselTools shape file (`.pf save`, PantographData XML). Everything that can be done without a browser happens here
// (detection, gunzip, schematic -> voxels with chiseled blocks cut into their cuboids, block colors, finding the player body for worn
// items), so it is unit tested under plain Node and the page only draws.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { blockColor, parseBlockColors, type BlockColors } from "vs-schematic/blockColors.js";
import { decodeChiseledBlock, materialVolumes, type ChiselShape } from "vs-schematic/chisel.js";
import { looksLikePortfolio, parsePortfolioXml } from "vs-schematic/chiselExport.js";
import { decodeBlockEntity } from "vs-schematic/schematicDecode.js";
import { assertSchematic, isHiddenByDefault, toVoxels, type SchematicJson } from "vs-schematic/schematicVoxels.js";
import { looksLikeShape } from "vs-schematic/shapeBoxes.js";

export class InputError extends Error {}

/** One box the page draws for a schematic, in block units, cell-centered like the schematic viewer (a whole block is x/y/z with size 1). */
export interface SchematicBox {
  x: number;
  y: number;
  z: number;
  /** Size along each axis when smaller than a block (a chiseled block's cuboid); omitted for a whole block. */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Index into `SchematicInput.codes`. */
  code: number;
}

export interface SchematicSummary {
  /** Size of the drawn blocks' bounding box in blocks (x, y, z), from the lowest to the highest occupied cell. */
  size: [number, number, number];
  /** Blocks in the file, and the ones drawn (after hiding filler / --max-y). */
  blocks: number;
  drawn: number;
  /** Distinct block codes. */
  kinds: number;
  /** The most common codes, with their counts, most first. */
  top: { code: string; count: number }[];
  /** Chiseled blocks drawn as their cuboids, and ones whose entity couldn't be read (drawn as whole cubes). */
  chiseled: number;
  chiselFailed: number;
  /** Blocks hidden by default (meta-filler) that were left out. */
  hiddenFiller: number;
}

export interface ModelInput {
  kind: "model";
  raw: unknown;
  /** The player body shape (seraph-faceless.json) a worn item's pieces hang on, when the model needs it and it was found. */
  body?: unknown;
  /** Whether the model has stepParentName pieces (a worn item), so a missing body is worth reporting. */
  needsBody: boolean;
}

export interface SchematicInput {
  kind: "schematic";
  boxes: SchematicBox[];
  codes: string[];
  /** Color per entry of `codes`. */
  colors: string[];
  /** Codes as drawn, most first, for the legend: a chiseled block counts once for each of its materials instead of as `chiseledblock`. */
  drawnCounts: { code: string; count: number }[];
  summary: SchematicSummary;
}

export interface ChiselInput {
  kind: "chisel";
  shape: ChiselShape;
  /** Color per material of `shape`. */
  colors: string[];
  /** Voxels of 4096 per material. */
  volumes: number[];
}

export type LoadedInput = ModelInput | SchematicInput | ChiselInput;

export interface SchematicOptions {
  showFiller: boolean;
  /** Leave out blocks above this y (a cutaway); undefined draws all. */
  maxY?: number;
  /** Draw chiseled blocks as their cuboids (default) rather than whole cubes. */
  chisel: boolean;
  colors?: BlockColors | null;
}

/** The file's text: gunzipped when it starts with the gzip magic bytes, without a byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return new TextDecoder().decode(raw).replace(/^﻿/, "");
}

/** Turns a schematic into boxes to draw, cutting chiseled blocks into their cuboids. */
export function schematicBoxes(schematic: SchematicJson, options: SchematicOptions): SchematicInput {
  const voxels = toVoxels(schematic);
  const counts = new Map<string, number>();
  for (const v of voxels) counts.set(v.code, (counts.get(v.code) ?? 0) + 1);
  const codes: string[] = [];
  const index = new Map<string, number>();
  const codeIndex = (code: string) => {
    let i = index.get(code);
    if (i === undefined) index.set(code, (i = codes.push(code) - 1));
    return i;
  };
  const boxes: SchematicBox[] = [];
  const drawnCounts = new Map<string, number>();
  const countDrawn = (code: string) => drawnCounts.set(code, (drawnCounts.get(code) ?? 0) + 1);
  let drawn = 0, chiseled = 0, chiselFailed = 0, hiddenFiller = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of voxels) {
    if (!options.showFiller && isHiddenByDefault(v.code)) {
      hiddenFiller++;
      continue;
    }
    if (options.maxY !== undefined && v.y > options.maxY) continue;
    drawn++;
    [v.x, v.y, v.z].forEach((c, i) => ((lo[i] = Math.min(lo[i], c)), (hi[i] = Math.max(hi[i], c))));
    const entity = options.chisel ? schematic.BlockEntities?.[String(v.packed)] : undefined;
    if (typeof entity === "string") {
      let shape: ChiselShape | null = null;
      let failed = false;
      try {
        shape = decodeChiseledBlock(decodeBlockEntity(entity), schematic.BlockCodes);
      } catch {
        failed = true;
      }
      if (shape?.cuboids.length) {
        chiseled++;
        for (const material of new Set(shape.materials)) countDrawn(material);
        // Cuboid min/max are 0..16 inside the block; the block's cell spans x - 0.5 .. x + 0.5.
        for (const c of shape.cuboids) {
          boxes.push({
            x: v.x - 0.5 + (c.x1 + c.x2) / 32, y: v.y - 0.5 + (c.y1 + c.y2) / 32, z: v.z - 0.5 + (c.z1 + c.z2) / 32,
            sx: (c.x2 - c.x1) / 16, sy: (c.y2 - c.y1) / 16, sz: (c.z2 - c.z1) / 16,
            code: codeIndex(shape.materials[c.material] ?? "unknown"),
          });
        }
        continue;
      }
      if (failed) chiselFailed++;
    }
    boxes.push({ x: v.x, y: v.y, z: v.z, code: codeIndex(v.code) });
    countDrawn(v.code);
  }
  const size = drawn ? ([0, 1, 2].map((i) => hi[i] - lo[i] + 1) as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
  return {
    kind: "schematic",
    boxes,
    codes,
    colors: codes.map((c) => blockColor(c, options.colors)),
    drawnCounts: [...drawnCounts].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
    summary: {
      size,
      blocks: voxels.length,
      drawn,
      kinds: counts.size,
      top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code, count]) => ({ code, count })),
      chiseled,
      chiselFailed,
      hiddenFiller,
    },
  };
}

/** Where the game keeps the player body model that armor and clothing models hang their pieces on, under an assets domain folder. */
const BODY_SHAPE = "shapes/entity/humanoid/seraph-faceless.json";

/**
 * Candidate paths of the player body for a worn item's model, the way the VS Code extension's host looks (src/extension.ts findBodyShape):
 * the model's own domain, then `game` and `survival` beside it, then the same in the game install's assets folder.
 */
export function bodyCandidates(file: string, gameAssets?: string): string[] {
  const parts = path.resolve(file).split(path.sep);
  const at = parts.lastIndexOf("shapes");
  const out: string[] = [];
  if (at >= 2) {
    const assets = parts.slice(0, at - 1).join(path.sep);
    for (const domain of [parts[at - 1], "game", "survival"]) out.push(path.join(assets, domain, BODY_SHAPE));
  }
  if (gameAssets) for (const domain of ["game", "survival"]) out.push(path.join(gameAssets, domain, BODY_SHAPE));
  return [...new Set(out)];
}

/** Reads a file and works out what it is. Throws InputError for one that is none of the three. */
export async function loadInput(file: string, options: SchematicOptions & { gameAssets?: string }): Promise<LoadedInput> {
  let text: string;
  try {
    text = decodeText(new Uint8Array(await readFile(file)));
  } catch (err) {
    throw new InputError(`${file}: ${(err as Error).message}`);
  }
  if (looksLikePortfolio(text)) {
    let shape: ChiselShape;
    try {
      shape = parsePortfolioXml(text).shape;
    } catch (err) {
      throw new InputError(`${file} isn't a readable ChiselTools shape file: ${(err as Error).message}`);
    }
    return { kind: "chisel", shape, colors: shape.materials.map((c) => blockColor(c, options.colors)), volumes: materialVolumes(shape) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new InputError(`${file}: not JSON or a ChiselTools shape file (${(err as Error).message})`);
  }
  if (looksLikeShape(parsed)) {
    const needsBody = text.includes("stepParentName");
    let body: unknown;
    if (needsBody) {
      for (const candidate of bodyCandidates(file, options.gameAssets)) {
        try {
          body = JSON.parse(decodeText(new Uint8Array(await readFile(candidate))));
          break;
        } catch {
          // not here; try the next
        }
      }
    }
    return { kind: "model", raw: parsed, body, needsBody };
  }
  try {
    assertSchematic(parsed);
  } catch {
    throw new InputError(`${file} isn't a Vintage Story model (no "elements" boxes), schematic (no Indices / BlockIds / BlockCodes) or ChiselTools shape file`);
  }
  return schematicBoxes(parsed, options);
}

/** The bundled block colors (the wiki's copy of BlockColorMod's output), or the file given; null when the default file isn't there. */
export async function loadBlockColors(file: string | undefined, defaultFile: string): Promise<BlockColors | null> {
  let text: string;
  try {
    text = await readFile(file ?? defaultFile, "utf8");
  } catch (err) {
    if (!file) return null;
    throw new InputError(`--block-colors ${file}: ${(err as Error).message}`);
  }
  try {
    return parseBlockColors(JSON.parse(text));
  } catch (err) {
    throw new InputError(`${file ?? defaultFile}: ${(err as Error).message}`);
  }
}

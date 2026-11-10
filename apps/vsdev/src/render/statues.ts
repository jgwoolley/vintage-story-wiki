// Statues of the Player Statues mod (nf3tstatue) for the renderer: the geometry is `@nf3t/vs-schematic/statue.js` (a port of the mod's
// StatueMesh, kept in sync with it); this supplies its files. Shapes come from the game install and the mods folder (the mod's own
// pedestal and robot shapes are in its zip), worn and held items from the game's item and block types.
import { readFile } from "node:fs/promises";
import JSON5 from "json5";
import { decodeBlockEntity } from "@nf3t/vs-schematic/schematicDecode.js";
import type { SchematicJson } from "@nf3t/vs-schematic/schematicVoxels.js";
import { buildStatue, isStatueBlock, statueDesignFromTree, type StatueIo, type StatueResult } from "@nf3t/vs-schematic/statue.js";
import { findCollectible, statueCollectible } from "./collectible.js";

/**
 * A StatueIo over `findFile` (a `domain:path` asset to a file on disk, like `findAsset`) and the game's `assets/` folder for item types.
 * Shapes and types are read once.
 */
export function statueIo(findFile: (ref: string) => string | undefined, typesAssets: string | undefined): StatueIo {
  const shapes = new Map<string, Promise<unknown>>();
  return {
    shape(ref) {
      let p = shapes.get(ref);
      if (!p) {
        const file = findFile(ref);
        p = file ? readFile(file, "utf8").then((t) => JSON5.parse(t.replace(/^﻿/, "")) as unknown).catch(() => undefined) : Promise.resolve(undefined);
        shapes.set(ref, p);
      }
      return p;
    },
    async collectible(code) {
      if (!typesAssets) return undefined;
      // Types are looked up by their code in the game's folders (game, survival, creative all are the "game" domain).
      const c = findCollectible(typesAssets, code.replace(/^[a-z0-9_-]+:/i, ""));
      return c ? statueCollectible(c) : undefined;
    },
  };
}

/** Every statue block with a block entity in a schematic, built: packed position -> the statue. Unreadable entities are skipped. */
export async function schematicStatues(schematic: SchematicJson & { ItemCodes?: Record<string, string> }, io: StatueIo): Promise<{ statues: Map<number, StatueResult>; warnings: string[] }> {
  const statues = new Map<number, StatueResult>();
  const warnings: string[] = [];
  const statueIds = new Set(Object.entries(schematic.BlockCodes ?? {}).filter(([, code]) => isStatueBlock(code)).map(([id]) => Number(id)));
  if (!statueIds.size) return { statues, warnings };
  for (let n = 0; n < schematic.Indices.length; n++) {
    if (!statueIds.has(schematic.BlockIds[n])) continue;
    const packed = schematic.Indices[n];
    const entity = schematic.BlockEntities?.[String(packed)];
    if (typeof entity !== "string") continue;
    let tree: Record<string, unknown>;
    try {
      tree = decodeBlockEntity(entity);
    } catch {
      warnings.push(`statue at ${packed}: unreadable block entity`);
      continue;
    }
    const block = schematic.BlockCodes[String(schematic.BlockIds[n])];
    const design = statueDesignFromTree(tree, block, { blockCodes: schematic.BlockCodes, itemCodes: schematic.ItemCodes });
    const statue = await buildStatue(design, io);
    for (const w of new Set(statue.warnings)) warnings.push(`statue ${block}: ${w}`);
    statues.set(packed, statue);
  }
  return { statues, warnings };
}

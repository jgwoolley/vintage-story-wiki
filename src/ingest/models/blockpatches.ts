import type { AssetIndex, BlockPatchSpawnInfo } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";

/**
 * Crops, flowers, mushrooms, ferns, berry bushes, grass, and misc. plants/aquatic life are placed
 * by flat `worldgen/blockpatches/*.json` rules -- each one a simple climate band (temperature,
 * rain, forest density, fertility) plus the literal block codes it can place. Unlike deposits,
 * these need no variant-expansion or template substitution: `blockCodes` already lists concrete codes.
 */
export function extractBlockPatchSpawns(index: AssetIndex): {
  patches: BlockPatchSpawnInfo[];
  codeToPatchIds: Map<string, string[]>;
} {
  const patches: BlockPatchSpawnInfo[] = [];
  const codeToPatchIds = new Map<string, string[]>();

  for (const asset of assetsUnderAnyDomain(index, "worldgen/blockpatches/")) {
    const category = asset.relPath.split("/").pop()!.replace(/\.json$/, "");
    const entries = Array.isArray(asset.json) ? (asset.json as any[]) : [asset.json as any];

    entries.forEach((entry, i) => {
      const blockCodes: string[] = entry?.blockCodes ?? [];
      if (blockCodes.length === 0) return;

      const patch: BlockPatchSpawnInfo = {
        id: `${asset.domain}:blockpatch/${category}#${i}`,
        domain: asset.domain,
        sourceMod: asset.modid,
        category,
        blockCodes,
        minTemp: entry.minTemp,
        maxTemp: entry.maxTemp,
        minRain: entry.minRain,
        maxRain: entry.maxRain,
        minForest: entry.minForest,
        maxForest: entry.maxForest,
        minFertility: entry.minFertility,
        maxFertility: entry.maxFertility,
        chance: entry.chance,
        placement: entry.placement,
      };
      patches.push(patch);

      for (const code of blockCodes) {
        const key = `${asset.domain}:${code}`;
        const list = codeToPatchIds.get(key) ?? [];
        list.push(patch.id);
        codeToPatchIds.set(key, list);
      }
    });
  }

  return { patches, codeToPatchIds };
}

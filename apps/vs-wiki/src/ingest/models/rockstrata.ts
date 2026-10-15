import type { AssetIndex, RockStrataInfo } from "../types.js";
import { assetsUnderAnyDomain } from "vs-wiki-core/assetLoader.js";

/**
 * Base rock-type placement (`worldgen/rockstrata.json`) is a separate worldgen system from ore/gem
 * deposits (`models/deposits.ts`) -- deposits describe what occurs *inside* a rock type, this
 * describes how the rock type itself gets placed. Each variant is placed by multi-octave layered
 * noise (`amplitudes`/`thresholds`/`frequencies`, not surfaced here -- not meaningfully readable
 * without the actual noise function) compared against per-variant thresholds, not a depth band,
 * climate rule, or fixed ordering; `genDir` says which direction (bottom-up, anchored near
 * bedrock, or top-down, anchored near the surface) that variant's layer fills from.
 */
export function extractRockStrata(index: AssetIndex): { rockStrata: RockStrataInfo[]; codeToRockStrataIds: Map<string, string[]> } {
  const rockStrata: RockStrataInfo[] = [];
  const codeToRockStrataIds = new Map<string, string[]>();

  for (const asset of assetsUnderAnyDomain(index, "worldgen/rockstrata.json")) {
    const variants = (asset.json as { variants?: { blockcode?: string; rockGroup?: string; genDir?: string }[] })?.variants ?? [];
    variants.forEach((v, i) => {
      if (!v.blockcode) return;
      const entry: RockStrataInfo = {
        id: `${asset.domain}:rockstrata#${i}`,
        domain: asset.domain,
        sourceMod: asset.modid,
        blockCode: v.blockcode,
        rockGroup: v.rockGroup,
        genDir: v.genDir,
      };
      rockStrata.push(entry);
      const codeKey = `${asset.domain}:${v.blockcode}`;
      const list = codeToRockStrataIds.get(codeKey) ?? [];
      list.push(entry.id);
      codeToRockStrataIds.set(codeKey, list);
    });
  }

  return { rockStrata, codeToRockStrataIds };
}

import type { AssetIndex, FruitTreeSpawnInfo, TreeSpawnInfo } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { expandVariants, resolveByType } from "../variantExpander.js";

type RawGenEntry = {
  Generator?: string;
  Weight?: number;
  MinTemp?: number;
  MaxTemp?: number;
  MinRain?: number;
  MaxRain?: number;
  MinFert?: number;
  MaxFert?: number;
  MinForest?: number;
  MaxForest?: number;
  MinHeight?: number;
  MaxHeight?: number;
  MinSize?: number;
  MaxSize?: number;
  SuitabilitySizeBonus?: number;
  habitat?: string;
};

function norm255(n: number | undefined): number | undefined {
  return n === undefined ? undefined : n / 255;
}

/** Builds `{sapling code -> generator code}` groupings from `plaintreesapling.json`'s glob-keyed `attributes.treeGenByType`. */
function buildSaplingCodesByGenerator(index: AssetIndex): Map<string, string[]> {
  const bySaplingGenerator = new Map<string, string[]>();
  const saplings = expandVariants(index, ["blocktypes/plant/"]).filter((v) => v.baseCode === "sapling");
  for (const sapling of saplings) {
    const byType = (sapling.json as any)?.attributes?.treeGenByType;
    const generator = resolveByType<string>(byType, sapling.code);
    if (!generator) continue;
    const list = bySaplingGenerator.get(generator) ?? [];
    list.push(sapling.code);
    bySaplingGenerator.set(generator, list);
  }
  return bySaplingGenerator;
}

/**
 * Regular (non-fruit) tree/shrub species spawn climate bands (`worldgen/treengenproperties.json`'s
 * `treegens`/`shrubgens` arrays), cross-referenced to concrete log/leaves/sapling block codes via
 * each species' own `worldgen/treegen/<Generator>.json` shape file and `plaintreesapling.json`'s
 * sapling->species glob map. Unlike deposits/blockpatches, rain/fertility/forest-density here are on
 * a 0-255 scale in the raw data (confirmed against the raw file), normalized to this codebase's
 * usual 0-1 scale on the way out. Not every `Generator` has a matching treegen shape file (e.g.
 * "ferntree-normal-trunk", "bamboo-grown-green" use a different placement system) -- tolerated as a
 * climate band with no attached block codes rather than skipped.
 */
export function extractTrees(index: AssetIndex): { trees: TreeSpawnInfo[]; codeToTreeIds: Map<string, string[]> } {
  const trees: TreeSpawnInfo[] = [];
  const codeToTreeIds = new Map<string, string[]>();
  const saplingCodesByGenerator = buildSaplingCodesByGenerator(index);

  function addCode(domain: string, code: string | undefined, id: string): void {
    if (!code) return;
    const key = `${domain}:${code}`;
    const list = codeToTreeIds.get(key) ?? [];
    list.push(id);
    codeToTreeIds.set(key, list);
  }

  for (const asset of assetsUnderAnyDomain(index, "worldgen/treengenproperties.json")) {
    const json = asset.json as { treegens?: RawGenEntry[]; shrubgens?: RawGenEntry[] };
    const groups: [RawGenEntry[] | undefined, boolean][] = [
      [json.treegens, false],
      [json.shrubgens, true],
    ];

    for (const [entries, isShrub] of groups) {
      (entries ?? []).forEach((entry, i) => {
        if (!entry.Generator) return;
        const speciesAsset = index.get(`${asset.domain}:worldgen/treegen/${entry.Generator}.json`);
        const treeBlocks = (speciesAsset?.json as any)?.treeBlocks as
          | {
              logBlockCode?: string;
              otherLogBlockCode?: string;
              leavesBlockCode?: string;
              leavesBranchyBlockCode?: string;
            }
          | undefined;
        const saplingCodes = saplingCodesByGenerator.get(entry.Generator!);

        const tree: TreeSpawnInfo = {
          id: `${asset.domain}:treegen/${isShrub ? "shrub" : "tree"}/${entry.Generator}#${i}`,
          domain: asset.domain,
          sourceMod: asset.modid,
          generator: entry.Generator,
          isShrub,
          weight: entry.Weight,
          minTemp: entry.MinTemp,
          maxTemp: entry.MaxTemp,
          minRain: norm255(entry.MinRain),
          maxRain: norm255(entry.MaxRain),
          minFertility: norm255(entry.MinFert),
          maxFertility: norm255(entry.MaxFert),
          minForest: norm255(entry.MinForest),
          maxForest: norm255(entry.MaxForest),
          minHeight: entry.MinHeight,
          maxHeight: entry.MaxHeight,
          minSize: entry.MinSize,
          maxSize: entry.MaxSize,
          suitabilitySizeBonus: entry.SuitabilitySizeBonus,
          habitat: entry.habitat,
          logBlockCode: treeBlocks?.logBlockCode,
          otherLogBlockCode: treeBlocks?.otherLogBlockCode,
          leavesBlockCode: treeBlocks?.leavesBlockCode,
          leavesBranchyBlockCode: treeBlocks?.leavesBranchyBlockCode,
          saplingCodes,
        };
        trees.push(tree);

        addCode(asset.domain, tree.logBlockCode, tree.id);
        addCode(asset.domain, tree.otherLogBlockCode, tree.id);
        addCode(asset.domain, tree.leavesBlockCode, tree.id);
        addCode(asset.domain, tree.leavesBranchyBlockCode, tree.id);
        for (const code of saplingCodes ?? []) addCode(asset.domain, code, tree.id);
      });
    }
  }

  return { trees, codeToTreeIds };
}

/**
 * Fruit tree variety climate bands (`blocktypes/plant/fruittreebranch.json`'s `attributes.worldgen`
 * array) -- a flat temp/rain band per variety, no forest/fertility/height gating unlike regular
 * trees. Cross-referenced to the concrete fruit item code via the sibling
 * `attributes.fruittreeProperties.<type>.fruitStacks[0].code` lookup (confirmed against the raw
 * file, e.g. "pinkapple" -> "fruit-pinkapple").
 */
export function extractFruitTrees(index: AssetIndex): {
  fruitTrees: FruitTreeSpawnInfo[];
  codeToFruitTreeIds: Map<string, string[]>;
} {
  const fruitTrees: FruitTreeSpawnInfo[] = [];
  const codeToFruitTreeIds = new Map<string, string[]>();

  for (const asset of assetsUnderAnyDomain(index, "blocktypes/plant/fruittreebranch.json")) {
    const attrs = (asset.json as any)?.attributes;
    const worldgen = attrs?.worldgen as { type?: string; mintemp?: number; maxtemp?: number; minrain?: number; maxrain?: number }[] | undefined;
    if (!Array.isArray(worldgen)) continue;

    worldgen.forEach((entry, i) => {
      if (!entry.type) return;
      const fruitItemCode = attrs?.fruittreeProperties?.[entry.type]?.fruitStacks?.[0]?.code;
      if (!fruitItemCode) {
        console.warn(`  ! fruit tree variety "${entry.type}" has no resolvable fruitStacks[0].code -- skipping cross-reference`);
      }

      const fruitTree: FruitTreeSpawnInfo = {
        id: `${asset.domain}:fruittree/${entry.type}#${i}`,
        domain: asset.domain,
        sourceMod: asset.modid,
        variety: entry.type,
        minTemp: entry.mintemp,
        maxTemp: entry.maxtemp,
        minRain: entry.minrain,
        maxRain: entry.maxrain,
        fruitItemCode,
      };
      fruitTrees.push(fruitTree);

      if (fruitItemCode) {
        const key = `${asset.domain}:${fruitItemCode}`;
        const list = codeToFruitTreeIds.get(key) ?? [];
        list.push(fruitTree.id);
        codeToFruitTreeIds.set(key, list);
      }
    });
  }

  return { fruitTrees, codeToFruitTreeIds };
}

import { readFileSync } from "node:fs";
import type { AssetSource, ModInfo, ModSummary, VsManifest } from "./types.js";
import { loadMod, listModZips } from "./modExtractor.js";
import { loadAssets } from "./assetLoader.js";
import { listSchematicFiles, type SchematicFile } from "./schematicHeader.js";
import { collectPatches, filterPatches, applyPatches } from "./patchEngine.js";
import { extractRecipes } from "./models/recipes.js";
import { extractLoot } from "./models/loot.js";
import { extractStructures } from "./models/structures.js";
import { extractDecorCatalog } from "./models/decor.js";
import { extractLoreBooks } from "./models/lore.js";
import { extractDeposits } from "./models/deposits.js";
import { extractBlockPatchSpawns } from "./models/blockpatches.js";
import { extractTrees, extractFruitTrees } from "./models/trees.js";
import { buildBlockCodeToSchematicIndex, buildSchematicToStructureIndex, findStructuresContaining } from "./structureContents.js";
import { buildLangResolver } from "./lang.js";
import { buildItemIndex } from "./crossref.js";
import { writeGenerated } from "./write.js";

const SERVER_ASSETS_DIR = "vs_server/assets";
const VANILLA_DOMAINS = ["game", "survival", "creative"];

function loadManifest(): VsManifest {
  return JSON.parse(readFileSync("vs-manifest.json", "utf8"));
}

function main(): void {
  const manifest = loadManifest();
  const manifestModIds = new Set(manifest.mods.map((m) => m.modid.toLowerCase()));

  console.log("== Resolving mods ==");
  const mods: (ModInfo & { domains: string[]; rootDir: string })[] = [];
  for (const zipFile of listModZips()) {
    const { info, extractedDir } = loadMod(zipFile);
    if (!manifestModIds.has(info.modid.toLowerCase())) {
      console.log(`  - ${info.modid} present in Mods/ but not in vs-manifest.json, skipping`);
      continue;
    }
    if (info.hasCompiledCode) {
      console.log(`  ! ${info.modid}: ships compiled code (.dll) -- its custom behavior cannot be captured from JSON`);
    }
    mods.push({ ...info, domains: [info.modid], rootDir: `${extractedDir}/assets` });
    console.log(`  - ${info.modid} v${info.version} (${info.side}, hasCompiledCode=${info.hasCompiledCode})`);
  }

  const activeModIds = new Set(["game", ...mods.map((m) => m.modid.toLowerCase())]);

  console.log("== Building asset sources ==");
  const sources: AssetSource[] = [
    ...VANILLA_DOMAINS.map((domain) => ({ domain, modid: "game", rootDir: `${SERVER_ASSETS_DIR}/${domain}` })),
    ...mods.flatMap((mod) => mod.domains.map((domain) => ({ domain, modid: mod.modid, rootDir: `${mod.rootDir}/${domain}` }))),
  ];

  console.log("== Indexing schematic files (headers only, voxel data stays unparsed) ==");
  const schematicsByDomain = new Map<string, SchematicFile[]>();
  for (const source of sources) {
    const existing = schematicsByDomain.get(source.domain) ?? [];
    schematicsByDomain.set(source.domain, [...existing, ...listSchematicFiles(source.domain, source.rootDir)]);
  }
  console.log(`  ${[...schematicsByDomain.values()].reduce((n, files) => n + files.length, 0)} schematic files indexed`);

  console.log("== Loading assets (JSON5) ==");
  const { index, report } = loadAssets(sources);
  console.log(`  loaded ${report.filesLoaded} files, ${report.parseErrors.length} parse errors, ${report.overrides.length} overrides`);
  for (const err of report.parseErrors.slice(0, 20)) console.log(`  parse error: ${err.file}: ${err.error}`);

  console.log("== Applying patches ==");
  const allPatches = collectPatches(index);
  const activePatches = filterPatches(allPatches, activeModIds);
  const patchReport = applyPatches(index, activePatches);
  console.log(
    `  collected ${allPatches.length} patches, ${activePatches.length} active, ${patchReport.applied} applied, ${patchReport.unresolvedFileTargets.length} unresolved targets`
  );
  for (const t of patchReport.unresolvedFileTargets.slice(0, 40)) console.log(`  unresolved: ${t.file} (op ${t.op}, from ${t.sourceFile})`);

  const lang = buildLangResolver(index);

  console.log("== Extracting recipes ==");
  const recipes = extractRecipes(index);
  console.log(`  ${recipes.length} normalized recipes`);

  console.log("== Extracting loot ==");
  const loot = extractLoot(index, lang);
  console.log(`  ${loot.length} loot entries`);

  // Groups the flat loot entries by their source block/entity -- one row per thing that drops
  // something. Split in two: "creatures" (entity sources, kept as their own page since they also
  // carry stats/spawn-condition info) and "blockDrops" (block sources, folded directly onto that
  // block's own /items/ page instead of a separate listing -- see ensureSpawnTarget below).
  function groupLoot(entries: typeof loot): import("./types.js").LootSourceGroup[] {
    const byKey = new Map<string, import("./types.js").LootSourceGroup>();
    for (const entry of entries) {
      const id = `${entry.sourceDomain}:${entry.sourceCode}`;
      const group =
        byKey.get(id) ??
        {
          id,
          sourceDomain: entry.sourceDomain,
          sourceCode: entry.sourceCode,
          sourceDisplayName: entry.sourceDisplayName,
          sourceKind: entry.sourceKind,
          sourceMod: entry.sourceMod,
          entityStats: entry.entityStats,
          entries: [],
        };
      group.entries.push(entry);
      byKey.set(id, group);
    }
    return [...byKey.values()];
  }
  const lootGroups = groupLoot(loot);
  const creatures = lootGroups.filter((g) => g.sourceKind === "entity");
  const blockDrops = lootGroups.filter((g) => g.sourceKind === "block");
  const blockDropsById = Object.fromEntries(blockDrops.map((g) => [g.id, g]));

  console.log("== Extracting structures ==");
  const structures = extractStructures(index, schematicsByDomain);
  console.log(`  ${structures.length} structures`);

  console.log("== Extracting decor catalog (paintings/tapestries/clothing) ==");
  const decorCatalog = extractDecorCatalog(index, lang);
  console.log(`  ${decorCatalog.length} decor items`);

  console.log("== Cross-referencing decor items against structure schematics ==");
  const blockCodeToSchematic = buildBlockCodeToSchematicIndex(schematicsByDomain);
  const schematicToStructure = buildSchematicToStructureIndex(structures);
  let decorWithStructures = 0;
  for (const item of decorCatalog) {
    item.foundInStructures = findStructuresContaining(item.code, blockCodeToSchematic, schematicToStructure);
    if (item.foundInStructures.length) decorWithStructures++;
  }
  console.log(`  ${decorWithStructures}/${decorCatalog.length} decor items found in at least one structure's schematics`);

  console.log("== Extracting lore books ==");
  const loreBooks = extractLoreBooks(index, lang);
  console.log(`  ${loreBooks.length} books/lore pieces`);

  // Tapestries have no flat "description" lang key -- their actual text lives in the matching
  // lore book's chapters (picked at placement time via a runtime "type" attribute). Cross-link
  // rather than leave tapestry pages looking like they have no content at all.
  for (const item of decorCatalog) {
    if (item.kind !== "tapestry") continue;
    const book = loreBooks.find((b) => b.code === "tapestry" && b.domain === item.domain);
    if (book) item.relatedLoreBookId = book.id;
  }

  console.log("== Extracting ore/gem/rock deposits ==");
  const { deposits, codeToDepositIds } = extractDeposits(index);
  console.log(`  ${deposits.length} deposits, covering ${codeToDepositIds.size} concrete block codes`);

  console.log("== Extracting crop/flower/mushroom/etc. spawn patches ==");
  const { patches: blockPatches, codeToPatchIds } = extractBlockPatchSpawns(index);
  console.log(`  ${blockPatches.length} patches, covering ${codeToPatchIds.size} concrete block codes`);

  console.log("== Extracting tree/shrub species spawn data ==");
  const { trees, codeToTreeIds } = extractTrees(index);
  console.log(`  ${trees.length} species climate bands, covering ${codeToTreeIds.size} concrete block codes`);

  console.log("== Extracting fruit tree variety spawn data ==");
  const { fruitTrees, codeToFruitTreeIds } = extractFruitTrees(index);
  console.log(`  ${fruitTrees.length} fruit tree varieties, covering ${codeToFruitTreeIds.size} concrete item codes`);

  console.log("== Building item index ==");
  const itemIndex = buildItemIndex(recipes, loot, lang);
  console.log(`  ${itemIndex.size} distinct items/blocks referenced`);

  // Ore/gem/rock, crop/flower/etc., tree, and block-drop data is keyed by block code regardless
  // of whether that block is reachable from a recipe or drop table -- this is one of the few
  // deliberate exceptions to the "only what a recipe/loot references" rule (see README), since
  // "where does this spawn"/"what does this drop" are exactly the kind of question that needs a
  // page even for a block nothing else currently points to.
  function ensureSpawnTarget(domain: string, code: string, kind: "item" | "block" = "block"): import("./types.js").ItemIndexEntry {
    const key = `${domain}:${code}`;
    let entry = itemIndex.get(key);
    if (!entry) {
      const { name, missing } = lang.displayName(kind, domain, code);
      entry = {
        domain,
        code,
        kind,
        displayName: name,
        missingTranslation: missing,
        sourceMod: "game",
        producedBy: [],
        consumedBy: [],
        droppedBy: [],
        appearsInStructures: [],
        spawnDeposits: [],
        spawnBlockPatches: [],
        spawnTrees: [],
        spawnFruitTrees: [],
      };
      itemIndex.set(key, entry);
    }
    return entry;
  }

  for (const [key, depositIds] of codeToDepositIds) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    ensureSpawnTarget(domain, code).spawnDeposits.push(...depositIds);
  }
  for (const [key, patchIds] of codeToPatchIds) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    ensureSpawnTarget(domain, code).spawnBlockPatches.push(...patchIds);
  }
  for (const [key, treeIds] of codeToTreeIds) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    ensureSpawnTarget(domain, code).spawnTrees.push(...treeIds);
  }
  for (const [key, fruitTreeIds] of codeToFruitTreeIds) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    ensureSpawnTarget(domain, code, "item").spawnFruitTrees.push(...fruitTreeIds);
  }
  console.log(`  item index grown to ${itemIndex.size} after adding spawn-only blocks`);

  // A block that drops something when broken/interacted with is, likewise, a fact about that
  // block worth a page even if nothing else (recipe, worldgen) references it -- folds the old
  // per-source /loot/ block pages directly onto /items/ instead (see site/items/items.njk's
  // "Drops" section, looked up live via blockDropsById rather than a stored id list).
  for (const group of blockDrops) {
    ensureSpawnTarget(group.sourceDomain, group.sourceCode);
  }
  console.log(`  item index grown to ${itemIndex.size} after adding block-drop-only blocks`);

  const modSummaries: ModSummary[] = [
    { modid: "game", name: "Vintage Story (vanilla)", version: manifest.serverVersion, side: "Universal", hasCompiledCode: false, isVanilla: true },
    ...mods.map((m) => ({ modid: m.modid, name: m.name, version: m.version, side: m.side, hasCompiledCode: m.hasCompiledCode, isVanilla: false })),
  ];

  const recipesById = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const depositsById = Object.fromEntries(deposits.map((d) => [d.id, d]));
  const blockPatchesById = Object.fromEntries(blockPatches.map((p) => [p.id, p]));
  const treesById = Object.fromEntries(trees.map((t) => [t.id, t]));
  const fruitTreesById = Object.fromEntries(fruitTrees.map((t) => [t.id, t]));

  console.log("== Writing generated data ==");
  writeGenerated("recipes", recipes);
  writeGenerated("recipesById", recipesById);
  writeGenerated("loot", loot);
  writeGenerated("creatures", creatures);
  writeGenerated("blockDrops", blockDrops);
  writeGenerated("blockDropsById", blockDropsById);
  writeGenerated("structures", structures);
  writeGenerated("decor", decorCatalog);
  writeGenerated("lore", loreBooks);
  writeGenerated("deposits", deposits);
  writeGenerated("depositsById", depositsById);
  writeGenerated("blockPatches", blockPatches);
  writeGenerated("blockPatchesById", blockPatchesById);
  writeGenerated("trees", trees);
  writeGenerated("treesById", treesById);
  writeGenerated("fruitTrees", fruitTrees);
  writeGenerated("fruitTreesById", fruitTreesById);
  writeGenerated("items", [...itemIndex.values()]);
  writeGenerated("mods", modSummaries);

  console.log("Done.");
}

main();

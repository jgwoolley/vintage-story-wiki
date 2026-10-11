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

  const lootBySourceMap = new Map<
    string,
    {
      sourceDomain: string;
      sourceCode: string;
      sourceDisplayName: string;
      sourceKind: string;
      sourceMod: string;
      entityStats: (typeof loot)[number]["entityStats"];
      entries: typeof loot;
    }
  >();
  for (const entry of loot) {
    const k = `${entry.sourceDomain}:${entry.sourceCode}`;
    const group =
      lootBySourceMap.get(k) ??
      {
        sourceDomain: entry.sourceDomain,
        sourceCode: entry.sourceCode,
        sourceDisplayName: entry.sourceDisplayName,
        sourceKind: entry.sourceKind,
        sourceMod: entry.sourceMod,
        entityStats: entry.entityStats,
        entries: [],
      };
    group.entries.push(entry);
    lootBySourceMap.set(k, group);
  }
  const lootBySource = [...lootBySourceMap.values()];

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

  console.log("== Building item index ==");
  const itemIndex = buildItemIndex(recipes, loot, lang);
  console.log(`  ${itemIndex.size} distinct items/blocks referenced`);

  const modSummaries: ModSummary[] = [
    { modid: "game", name: "Vintage Story (vanilla)", version: manifest.serverVersion, side: "Universal", hasCompiledCode: false, isVanilla: true },
    ...mods.map((m) => ({ modid: m.modid, name: m.name, version: m.version, side: m.side, hasCompiledCode: m.hasCompiledCode, isVanilla: false })),
  ];

  const recipesById = Object.fromEntries(recipes.map((r) => [r.id, r]));

  console.log("== Writing generated data ==");
  writeGenerated("recipes", recipes);
  writeGenerated("recipesById", recipesById);
  writeGenerated("loot", loot);
  writeGenerated("lootBySource", lootBySource);
  writeGenerated("structures", structures);
  writeGenerated("decor", decorCatalog);
  writeGenerated("lore", loreBooks);
  writeGenerated("items", [...itemIndex.values()]);
  writeGenerated("mods", modSummaries);

  console.log("Done.");
}

main();

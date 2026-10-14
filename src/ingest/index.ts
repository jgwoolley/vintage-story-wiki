import { readFileSync } from "node:fs";
import type { AssetSource, ModInfo, ModSummary, VsManifest } from "./types.js";
import { loadMod, listModZips } from "./modExtractor.js";
import { loadAssets } from "./assetLoader.js";
import { listSchematicFiles, newDecodeStats, type DecodeStats, type SchematicFile } from "./schematicHeader.js";
import { collectPatches, filterPatches, applyPatches } from "./patchEngine.js";
import { extractRecipes } from "./models/recipes.js";
import { extractLoot, extractStackRandomizerPools } from "./models/loot.js";
import { handbookItemRefs } from "./codeUtil.js";
import { extractStructures } from "./models/structures.js";
import { extractSchematics } from "./models/schematics.js";
import { writeCompressedSchematics } from "./schematicFiles.js";
import { extractDecorCatalog } from "./models/decor.js";
import { extractGear } from "./models/gear.js";
import { extractLoreBooks, buildLoreSections } from "./models/lore.js";
import { attachLoreLocations } from "./models/loreLocations.js";
import { extractDeposits } from "./models/deposits.js";
import { extractBlockPatchSpawns } from "./models/blockpatches.js";
import { extractTrees, extractFruitTrees } from "./models/trees.js";
import { extractRockStrata } from "./models/rockstrata.js";
import { extractTapestryInstances } from "./models/tapestryInstances.js";
import { extractClutterTypes } from "./models/clutterInstances.js";
import { extractGuides } from "./models/guides.js";
import { extractTrades } from "./models/trades.js";
import { extractDialogue } from "./models/dialogue.js";
import { extractTraits, extractCharacterClasses } from "./models/classes.js";
import { buildBlockCodeToSchematicIndex, buildItemCodeToSchematicIndex, buildSchematicToStructureIndex, findStructuresContaining } from "./structureContents.js";
import { expandVariants } from "./variantExpander.js";
import { buildLangResolver } from "./lang.js";
import { extractBlockNames } from "./models/blockNames.js";
import type { IngestStepTiming } from "./types.js";
import { buildItemIndex, attachItemMetadata, attachDescriptionsAndCodeRefs, includeManifestItems } from "./crossref.js";
import { writeGenerated } from "./write.js";

const SERVER_ASSETS_DIR = "vs_server/assets";
const VANILLA_DOMAINS = ["game", "survival", "creative"];

function loadManifest(): VsManifest {
  return JSON.parse(readFileSync("vs-manifest.json", "utf8"));
}

// Per-step timing: every `step("...")` call (replacing the old bare "== ... ==" console headings)
// closes the previous step's clock and starts the next, so each phase's duration lands in
// `ingestTiming.steps` -- surfaced on `/<lang>/build/`.
const stepTimings: IngestStepTiming[] = [];
let currentStep: { name: string; startedAt: number } | undefined;
function endStep(): void {
  if (currentStep) stepTimings.push({ name: currentStep.name, durationMs: Date.now() - currentStep.startedAt });
  currentStep = undefined;
}
function step(name: string): void {
  endStep();
  console.log(`== ${name} ==`);
  currentStep = { name, startedAt: Date.now() };
}

/** Prints how many schematic block entities an extractor decoded; warns (never aborts) on any failure. */
function reportDecodeStats(label: string, s: DecodeStats): void {
  console.log(`  ${label}: decoded ${s.entities - s.failures}/${s.entities} block entities in ${s.schematics} schematics`);
  if (s.failures || s.unreadable) {
    console.warn(`  WARNING (${label}): ${s.failures} block entities failed to decode, ${s.unreadable} schematics unreadable`);
    for (const ex of s.examples) console.warn(`    e.g. ${ex}`);
  }
}

function main(): void {
  // Measured around the whole function (asset loading through the final writeGenerated calls)
  // so `ingestTiming.json` reflects the real end-to-end cost of `npm run ingest` -- surfaced on
  // `/<lang>/build/` alongside the download and Eleventy-build phase timings. Written last (after
  // every other writeGenerated call below) so a failed/aborted run never leaves a stale success
  // number sitting next to data that didn't actually finish regenerating.
  const ingestStartedAt = Date.now();

  const manifest = loadManifest();
  const manifestModIds = new Set(manifest.mods.map((m) => m.modid.toLowerCase()));

  step("Resolving mods");
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

  step("Building asset sources");
  const sources: AssetSource[] = [
    ...VANILLA_DOMAINS.map((domain) => ({ domain, modid: "game", rootDir: `${SERVER_ASSETS_DIR}/${domain}` })),
    ...mods.flatMap((mod) => mod.domains.map((domain) => ({ domain, modid: mod.modid, rootDir: `${mod.rootDir}/${domain}` }))),
  ];

  step("Indexing schematic files (headers only, voxel data stays unparsed)");
  const schematicsByDomain = new Map<string, SchematicFile[]>();
  for (const source of sources) {
    const existing = schematicsByDomain.get(source.domain) ?? [];
    schematicsByDomain.set(source.domain, [...existing, ...listSchematicFiles(source.domain, source.rootDir, source.modid)]);
  }
  console.log(`  ${[...schematicsByDomain.values()].reduce((n, files) => n + files.length, 0)} schematic files indexed`);

  step("Loading assets (JSON5)");
  const { index, report } = loadAssets(sources);
  console.log(`  loaded ${report.filesLoaded} files, ${report.parseErrors.length} parse errors, ${report.overrides.length} overrides`);
  for (const err of report.parseErrors.slice(0, 20)) console.log(`  parse error: ${err.file}: ${err.error}`);

  step("Applying patches");
  const allPatches = collectPatches(index);
  const activePatches = filterPatches(allPatches, activeModIds);
  const patchReport = applyPatches(index, activePatches);
  console.log(
    `  collected ${allPatches.length} patches, ${activePatches.length} active, ${patchReport.applied} applied, ${patchReport.unresolvedFileTargets.length} unresolved targets`
  );
  for (const t of patchReport.unresolvedFileTargets.slice(0, 40)) console.log(`  unresolved: ${t.file} (op ${t.op}, from ${t.sourceFile})`);

  const lang = buildLangResolver(index);

  step("Extracting recipes");
  const recipes = extractRecipes(index);
  console.log(`  ${recipes.length} normalized recipes`);

  step("Extracting loot");
  const { loot, creatureRoster } = extractLoot(index, lang);
  console.log(`  ${loot.length} loot entries, ${creatureRoster.length} living entities (health behavior)`);

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
  const creaturesWithDrops = new Map(lootGroups.filter((g) => g.sourceKind === "entity").map((g) => [g.id, g]));
  // Every living entity gets a /creatures/ row, drops or not -- a trader/villager/locust/etc.
  // with no drop table was previously invisible, silently excluded by deriving the creature list
  // from loot.json alone (see CreatureRosterEntry's doc comment). Real drops (when they exist)
  // are merged in from the entity-kind loot groups above by matching domain:code.
  const creatures: import("./types.js").LootSourceGroup[] = creatureRoster.map((c) => {
    const id = `${c.domain}:${c.code}`;
    const existing = creaturesWithDrops.get(id);
    return (
      existing ?? {
        id,
        sourceDomain: c.domain,
        sourceCode: c.code,
        sourceDisplayName: c.sourceDisplayName,
        sourceKind: "entity",
        sourceMod: c.sourceMod,
        entityStats: c.entityStats,
        entries: [],
      }
    );
  });
  const blockDrops = lootGroups.filter((g) => g.sourceKind === "block");
  const blockDropsById = Object.fromEntries(blockDrops.map((g) => [g.id, g]));

  step("Extracting schematics + structures");
  const { schematics, duplicateIds } = extractSchematics(schematicsByDomain);
  console.log(`  ${schematics.length} schematics`);
  for (const id of duplicateIds.slice(0, 10)) console.warn(`  ! schematic ${id} is shipped by more than one source; the first one wins`);
  const structures = extractStructures(index, schematics);
  console.log(`  ${structures.length} structures`);

  // The reverse of each structure's schematic references, so a schematic knows who places it.
  const schematicById = new Map(schematics.map((sc) => [sc.id, sc]));
  for (const structure of structures) {
    for (const ref of structure.schematics) {
      for (const id of ref.schematicIds) {
        schematicById.get(id)?.usedBy.push({
          structureId: structure.id,
          via: ref.globPath,
          ...(ref.weight !== undefined ? { weight: ref.weight } : {}),
          ...(ref.minQuantity !== undefined ? { minQuantity: ref.minQuantity } : {}),
          ...(ref.maxQuantity !== undefined ? { maxQuantity: ref.maxQuantity } : {}),
        });
      }
    }
  }
  console.log(`  ${schematics.filter((sc) => sc.usedBy.length).length}/${schematics.length} schematics referenced by at least one structure`);

  step("Compressing schematics for the in-browser viewer");
  const compressed = writeCompressedSchematics(schematics, schematicsByDomain);
  console.log(
    `  ${(compressed.rawBytes / 1e6).toFixed(0)} MB -> ${(compressed.gzBytes / 1e6).toFixed(0)} MB gzip ` +
      `(${compressed.written} written, ${compressed.reused} reused)`
  );
  if (compressed.gzBytes > 300e6) console.warn("  ! compressed schematics exceed 300 MB; GitHub Pages limits a site to 1 GB");

  step("Extracting decor catalog (paintings/tapestries/clothing)");
  const decorCatalog = extractDecorCatalog(index, lang);
  console.log(`  ${decorCatalog.length} decor items`);

  step("Cross-referencing decor items against structure schematics");
  const blockCodeToSchematic = buildBlockCodeToSchematicIndex(schematicsByDomain);
  const schematicToStructure = buildSchematicToStructureIndex(structures);
  let decorWithStructures = 0;
  for (const item of decorCatalog) {
    item.foundInStructures = findStructuresContaining(item.code, blockCodeToSchematic, schematicToStructure);
    if (item.foundInStructures.length) decorWithStructures++;
  }
  console.log(`  ${decorWithStructures}/${decorCatalog.length} decor items found in at least one structure's schematics`);

  step("Extracting lore books");
  const loreBooks = extractLoreBooks(index, lang);
  console.log(`  ${loreBooks.length} books/lore pieces`);
  step("Locating lore books in structure schematics");
  attachLoreLocations(loreBooks, schematicsByDomain, schematicToStructure);
  const loreSections = buildLoreSections(loreBooks, lang);
  // Books (findable, readable) and tapestry/wallcarving chapter collections get separate pages --
  // split here, like paintings/tapestries/clothing from decor, rather than filtered in a template.
  const books = loreBooks.filter((b) => b.kind === "book");
  const loreChapters = loreBooks.filter((b) => b.kind === "chapters");
  console.log(`  ${books.filter((b) => b.foundInStructures.length).length}/${books.length} books found in at least one structure; ${loreSections.length} lore sections`);

  // Tapestries have no flat "description" lang key -- their actual text lives in the matching
  // lore book's chapters (picked at placement time via a runtime "type" attribute). Cross-link
  // rather than leave tapestry pages looking like they have no content at all.
  for (const item of decorCatalog) {
    if (item.kind !== "tapestry") continue;
    const book = loreBooks.find((b) => b.code === "tapestry" && b.domain === item.domain);
    if (book) item.relatedLoreBookId = book.id;
  }

  step("Resolving tapestry/wallcarving instances in worldgen schematics");
  const decodeStats = newDecodeStats();
  const tapestryInstances = extractTapestryInstances(schematicsByDomain, schematicToStructure, index, lang, decodeStats);
  console.log(`  ${tapestryInstances.length} resolved instances`);
  reportDecodeStats("tapestry", decodeStats);
  // Wallcarvings aren't in the decor catalog yet (no page to attach them to) -- only tapestry-*
  // instances find a match here; wallcarving-* ones are computed (same shared mechanism, nearly
  // free to support) but currently unused, ready for whenever a /wallcarvings/ page exists.
  for (const item of decorCatalog) {
    if (item.kind !== "tapestry") continue;
    const matches = tapestryInstances.filter((t) => t.blockCode === item.code);
    if (matches.length) item.tapestryInstances = matches;
  }

  step("Resolving clutter types (ShapeFromAttributes) in worldgen schematics");
  const clutterDecodeStats = newDecodeStats();
  const clutter = extractClutterTypes(schematicsByDomain, schematicToStructure, structures, lang, clutterDecodeStats);
  reportDecodeStats("clutter", clutterDecodeStats);
  console.log(`  ${clutter.length} distinct clutter types (${clutter.filter((c) => c.missingTranslation).length} without a lang key)`);

  // Paintings/tapestries/clothing each get their own top-level page/nav entry rather than one
  // shared /decor/ listing with a kind filter -- split here (post cross-reference) rather than
  // filtering in a template, consistent with how creatures/blockDrops were split from loot.
  const paintings = decorCatalog.filter((d) => d.kind === "painting");
  const tapestries = decorCatalog.filter((d) => d.kind === "tapestry");
  const clothing = decorCatalog.filter((d) => d.kind === "clothing");

  step("Extracting ore/gem/rock deposits");
  const { deposits, codeToDepositIds } = extractDeposits(index);
  console.log(`  ${deposits.length} deposits, covering ${codeToDepositIds.size} concrete block codes`);

  step("Extracting crop/flower/mushroom/etc. spawn patches");
  const { patches: blockPatches, codeToPatchIds } = extractBlockPatchSpawns(index);
  console.log(`  ${blockPatches.length} patches, covering ${codeToPatchIds.size} concrete block codes`);

  step("Extracting tree/shrub species spawn data");
  const { trees, codeToTreeIds } = extractTrees(index);
  console.log(`  ${trees.length} species climate bands, covering ${codeToTreeIds.size} concrete block codes`);

  step("Extracting fruit tree variety spawn data");
  const { fruitTrees, codeToFruitTreeIds } = extractFruitTrees(index);
  console.log(`  ${fruitTrees.length} fruit tree varieties, covering ${codeToFruitTreeIds.size} concrete item codes`);

  step("Extracting rock strata (base rock-type placement)");
  const { rockStrata, codeToRockStrataIds } = extractRockStrata(index);
  console.log(`  ${rockStrata.length} rock strata variants`);

  step("Extracting help guides");
  const guides = extractGuides(index, lang);
  console.log(`  ${guides.length} guides`);

  step("Extracting trader buy/sell lists");
  const trades = extractTrades(index);
  console.log(`  ${trades.length} trader specializations`);

  step("Extracting NPC dialogue");
  const dialogue = extractDialogue(index, lang);
  const dialogueRewardCount = dialogue.reduce((n, d) => n + d.rewards.length, 0);
  console.log(`  ${dialogue.length} NPCs with dialogue, ${dialogueRewardCount} reward-granting dialogue lines`);

  // Cross-reference each specialization against the trader entities that actually use it. VS has
  // no explicit "specialization" field anywhere: `entities/humanoid/trader-{male,female}.json`
  // declare a `variantgroups` entry `{ code: "type", states: [...specialization codes...] }`, and
  // `attributes.tradePropsFile: "config/tradelists/trader-{type}"` substitutes that same `type`
  // variant value into the tradelist filename -- so the specialization code (the `{type}` variant
  // state, e.g. "treasurehunter") IS the join key. Re-expands entities/ rather than reusing
  // extractLoot's creatureRoster because CreatureRosterEntry doesn't retain each variant's
  // groupValues (only the already-flattened code), and we need the `type` value specifically, not
  // just the concrete code, to know which specialization a variant belongs to. Deliberately not
  // hardcoded to "trader" -- any entity (vanilla or modded) whose `type` variantgroup states
  // overlap a loaded specialization code is picked up the same way.
  step("Cross-referencing trader specializations against trader entity variants");
  const specializationCodes = new Set(trades.map((t) => t.id.split(/:(.+)/)[1]));
  const traderEntitiesByType = new Map<string, import("./types.js").TraderEntityRef[]>();
  for (const variant of expandVariants(index, ["entities/"])) {
    const groups = (variant.json as { variantgroups?: { code: string; states?: string[] }[] }).variantgroups ?? [];
    const typeGroup = groups.find((g) => g.code === "type" && (g.states ?? []).some((s) => specializationCodes.has(s)));
    if (!typeGroup) continue;
    const type = variant.groupValues["type"];
    if (!type || !specializationCodes.has(type)) continue;
    const list = traderEntitiesByType.get(type) ?? [];
    list.push({ domain: variant.domain, code: variant.code });
    traderEntitiesByType.set(type, list);
  }
  for (const trade of trades) {
    const specialization = trade.id.split(/:(.+)/)[1];
    trade.traderEntities = traderEntitiesByType.get(specialization) ?? [];
    const first = trade.traderEntities[0];
    const entityName = first ? lang.displayName("entity", first.domain, first.code) : undefined;
    trade.displayName =
      entityName && !entityName.missing
        ? entityName.name.replace(/\s*\([^)]*\)\s*$/, "")
        : `${specialization.charAt(0).toUpperCase()}${specialization.slice(1)} trader`;
  }
  console.log(
    `  ${trades.filter((t) => t.traderEntities.length).length}/${trades.length} specializations matched to at least one trader entity variant`
  );

  step("Extracting player traits and starting classes");
  const traits = extractTraits(index, lang);
  const characterClasses = extractCharacterClasses(index, lang);
  console.log(`  ${traits.length} traits, ${characterClasses.length} starting classes`);

  step("Building item index");
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
        rockStrata: [],
        tradesSelling: [],
        tradesBuying: [],
        npcRewards: [],
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
  for (const [key, rockStrataIds] of codeToRockStrataIds) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    ensureSpawnTarget(domain, code).rockStrata.push(...rockStrataIds);
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

  step("Extracting weapon/tool stats");
  const gear = extractGear(index, lang);
  // Every weapon/tool gets an /items/ page too (that's what the /weapons/ table links to).
  for (const g of gear) {
    const entry = ensureSpawnTarget(g.domain, g.code, "item");
    if (entry.sourceMod === "game" && g.sourceMod !== "game") entry.sourceMod = g.sourceMod;
  }
  console.log(`  ${gear.length} weapons/tools/ammo; item index now ${itemIndex.size}`);

  attachItemMetadata(itemIndex, index, ensureSpawnTarget);
  console.log(`  item index grown to ${itemIndex.size} after adding tagged-tool-only items`);

  const includeMatches = includeManifestItems(itemIndex, index, manifest.includeItems ?? [], ensureSpawnTarget);
  for (const [pattern, count] of includeMatches) {
    if (count === 0) console.warn(`  ! vs-manifest.json includeItems pattern "${pattern}" matched no item/block variant`);
  }
  console.log(`  item index grown to ${itemIndex.size} after adding vs-manifest.json includeItems`);

  // `ItemStackRandomizer` items ("stackrandomizer-ore", ...) are what a world-generated chest
  // actually holds in a schematic; the game swaps each for one random stack from its pool when the
  // chest is generated. Only a couple ever got a page (via being someone's drop), and none listed
  // what they can become. Give every randomizer a page with its pool, and every pool member a
  // reverse "can be generated by" link -- the same carve-out shape as deposits/crops/trees.
  const randomizerPools = extractStackRandomizerPools(index);
  let poolStacks = 0;
  for (const [key, stacks] of randomizerPools) {
    const [rDomain, rCode] = key.split(/:(.+)/) as [string, string];
    const randomizer = ensureSpawnTarget(rDomain, rCode, "item");
    const totalWeight = stacks.reduce((sum, s) => sum + s.weight, 0) || stacks.length;
    randomizer.randomPool = stacks
      .map((s) => {
        const kind: "item" | "block" = s.type === "block" ? "block" : "item";
        const chance = s.weight / totalWeight;
        const target = ensureSpawnTarget(s.domain, s.code, kind);
        (target.generatedBy ??= []).push({ domain: rDomain, code: rCode, chance });
        return {
          domain: s.domain,
          code: s.code,
          kind,
          ...(s.quantityAvg !== undefined ? { quantityAvg: s.quantityAvg } : {}),
          ...(s.quantityVar !== undefined ? { quantityVar: s.quantityVar } : {}),
          chance,
          ...(s.attributes ? { attributes: s.attributes } : {}),
        };
      })
      .sort((a, b) => b.chance - a.chance);
    poolStacks += stacks.length;
  }
  for (const entry of itemIndex.values()) entry.generatedBy?.sort((a, b) => b.chance - a.chance);
  console.log(`  ${randomizerPools.size} randomizer items, ${poolStacks} possible results; item index grown to ${itemIndex.size}`);

  // Guide, dialogue and class text links to items/blocks with `handbook://item-<code>` (rewritten
  // to /items/ URLs while that text was extracted). The recipe/loot graph doesn't reach everything
  // a handbook page mentions (muddy gravel, pit kilns, ...), so give each real referenced
  // item/block a page here rather than leave a dead link. Only codes that exist as a concrete
  // itemtype/blocktype variant (or are already indexed) qualify; anything else is a typo in the text, left as it is.
  const concreteCodes = new Map<string, "item" | "block">();
  for (const [prefix, kind] of [["itemtypes/", "item"], ["blocktypes/", "block"]] as const) {
    for (const v of expandVariants(index, [prefix])) concreteCodes.set(`${v.domain}:${v.code}`, kind);
  }
  let handbookAdded = 0;
  const handbookDead: string[] = [];
  for (const key of handbookItemRefs.keys()) {
    const [domain, code] = key.split(/:(.+)/) as [string, string];
    // The link text says item- or block-, but the real definition decides which it is.
    const kind = concreteCodes.get(key) ?? itemIndex.get(key)?.kind; // already-indexed counts too: expandVariants misses some property-loaded variants
    if (!kind) { handbookDead.push(key); continue; }
    if (!itemIndex.has(key)) handbookAdded++;
    ensureSpawnTarget(domain, code, kind);
  }
  console.log(`  ${handbookItemRefs.size} handbook-linked items/blocks, ${handbookAdded} given a page of their own`);
  if (handbookDead.length) console.warn(`  ! ${handbookDead.length} handbook links name no real item/block: ${handbookDead.slice(0, 8).join(", ")}`);

  // Cross-reference each trade listing back onto the item it lists, same "give it a page even if
  // nothing else does" synthesis as everything else above -- a traded-only item (no recipe, no
  // drop, no worldgen spawn) would otherwise have no /items/ page at all.
  const tradeListingsById: Record<string, import("./types.js").TradeListing> = {};
  for (const trade of trades) {
    for (const listing of [...trade.selling, ...trade.buying]) {
      tradeListingsById[listing.id] = listing;
      const entry = ensureSpawnTarget(listing.domain, listing.code, listing.itemKind);
      if (listing.direction === "selling") entry.tradesSelling.push(listing.id);
      else entry.tradesBuying.push(listing.id);
    }
  }
  console.log(`  item index grown to ${itemIndex.size} after adding traded-only items`);

  // Flattens each NPC's rewards out into their own array (same "flat array + ids-into-it"
  // cross-link shape generated.loot/ItemIndexEntry.droppedBy already uses) and cross-references
  // each one back onto the reward item's own /items/ page -- same "give it a page even if nothing
  // else does" synthesis as every other reverse cross-link above (a reward-only item, e.g. a
  // locator map, would otherwise have no /items/ page at all).
  const dialogueRewards: import("./types.js").DialogueRewardEntry[] = [];
  for (const npc of dialogue) {
    for (const reward of npc.rewards) {
      const idx = dialogueRewards.length;
      dialogueRewards.push({
        npcId: npc.id,
        npcDomain: npc.domain,
        npcCode: npc.code,
        npcDisplayName: npc.sourceDisplayName,
        npcMod: npc.sourceMod,
        domain: reward.domain,
        code: reward.code,
        kind: reward.kind,
        stacksize: reward.stacksize,
      });
      ensureSpawnTarget(reward.domain, reward.code, reward.kind).npcRewards.push(String(idx));
    }
  }
  console.log(`  item index grown to ${itemIndex.size} after adding NPC-reward-only items`);

  step("Cross-referencing items against structure schematics");
  // Every item/block in the index -- not just the decor catalog's paintings/tapestries/clothing
  // -- can be placed inside a worldgen schematic (storage vessels, bookshelves/books, etc.), and
  // the blockCodeToSchematic/schematicToStructure maps built above for the decor cross-reference
  // already cover any code, not just decor ones. Run the same lookup for the whole item index
  // rather than leaving ItemIndexEntry.appearsInStructures permanently empty.
  // Items placed in containers (notably the stackrandomizer-* ones) live in a schematic's ItemCodes
  // dictionary rather than its BlockCodes, so item entries are looked up in both.
  const itemCodeToSchematic = buildItemCodeToSchematicIndex(schematicsByDomain);
  let itemsWithStructures = 0;
  for (const entry of itemIndex.values()) {
    entry.appearsInStructures = findStructuresContaining(entry.code, blockCodeToSchematic, schematicToStructure);
    if (entry.kind === "item") {
      for (const id of findStructuresContaining(entry.code, itemCodeToSchematic, schematicToStructure)) {
        if (!entry.appearsInStructures.includes(id)) entry.appearsInStructures.push(id);
      }
    }
    if (entry.appearsInStructures.length) itemsWithStructures++;
  }
  console.log(`  ${itemsWithStructures}/${itemIndex.size} items/blocks found in at least one structure's schematics`);

  step("Attaching item descriptions + C# class references");
  attachDescriptionsAndCodeRefs(itemIndex, index, lang);
  const itemValues = [...itemIndex.values()];
  console.log(
    `  ${itemValues.filter((e) => e.description).length} with a description, ` +
      `${itemValues.filter((e) => e.codeRefs?.some((r) => r.url)).length} with at least one linked C# file`
  );

  const modSummaries: ModSummary[] = [
    { modid: "game", name: "Vintage Story (vanilla)", version: manifest.serverVersion, side: "Universal", hasCompiledCode: false, isVanilla: true },
    ...mods.map((m) => ({
      modid: m.modid,
      name: m.name,
      version: m.version,
      side: m.side,
      type: m.type,
      website: m.website,
      assetid: m.assetid,
      logoUrl: m.logoUrl,
      description: m.description,
      authors: m.authors,
      hasCompiledCode: m.hasCompiledCode,
      isVanilla: false,
    })),
  ];

  const recipesById = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const depositsById = Object.fromEntries(deposits.map((d) => [d.id, d]));
  const blockPatchesById = Object.fromEntries(blockPatches.map((p) => [p.id, p]));
  const treesById = Object.fromEntries(trees.map((t) => [t.id, t]));
  const fruitTreesById = Object.fromEntries(fruitTrees.map((t) => [t.id, t]));
  const rockStrataById = Object.fromEntries(rockStrata.map((r) => [r.id, r]));
  const traitsById = Object.fromEntries(traits.map((t) => [t.code, t]));
  const dialogueById = Object.fromEntries(dialogue.map((d) => [d.id, d]));

  step("Extracting block display names (schematic viewer legend)");
  const blockNames = extractBlockNames(index, lang);

  step("Writing generated data");
  writeGenerated("recipes", recipes);
  writeGenerated("recipesById", recipesById);
  writeGenerated("loot", loot);
  writeGenerated("creatures", creatures);
  writeGenerated("blockDrops", blockDrops);
  writeGenerated("blockDropsById", blockDropsById);
  writeGenerated("structures", structures);
  writeGenerated("schematics", schematics);
  writeGenerated("decor", decorCatalog);
  writeGenerated("paintings", paintings);
  writeGenerated("clutter", clutter);
  writeGenerated("tapestries", tapestries);
  writeGenerated("clothing", clothing);
  writeGenerated("gear", gear);
  writeGenerated("books", books);
  writeGenerated("lore", loreChapters);
  writeGenerated("loreSections", loreSections);
  writeGenerated("deposits", deposits);
  writeGenerated("depositsById", depositsById);
  writeGenerated("blockPatches", blockPatches);
  writeGenerated("blockPatchesById", blockPatchesById);
  writeGenerated("trees", trees);
  writeGenerated("treesById", treesById);
  writeGenerated("fruitTrees", fruitTrees);
  writeGenerated("fruitTreesById", fruitTreesById);
  writeGenerated("rockStrata", rockStrata);
  writeGenerated("rockStrataById", rockStrataById);
  writeGenerated("guides", guides);
  writeGenerated("trades", trades);
  writeGenerated("tradeListingsById", tradeListingsById);
  writeGenerated("dialogue", dialogue);
  writeGenerated("dialogueById", dialogueById);
  writeGenerated("dialogueRewards", dialogueRewards);
  writeGenerated("traits", traits);
  writeGenerated("traitsById", traitsById);
  writeGenerated("classes", characterClasses);
  writeGenerated("items", [...itemIndex.values()]);
  writeGenerated("mods", modSummaries);
  writeGenerated("blockNames", blockNames);

  endStep();
  const ingestTiming: import("./types.js").IngestTiming = {
    durationMs: Date.now() - ingestStartedAt,
    finishedAtIso: new Date().toISOString(),
    steps: stepTimings,
  };
  writeGenerated("ingestTiming", ingestTiming);

  console.log("Done.");
}

main();

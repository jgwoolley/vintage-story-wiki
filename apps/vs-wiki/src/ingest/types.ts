/** One mod pin in `vs-manifest.json` -- the single source of truth for what this wiki documents. */
export interface ModManifestEntry {
  modid: string; // mods.vintagestory.at mod id, e.g. "betterruins"
  version?: string; // pinned release version; omitted means "latest" when downloading
}

/** The whole contents of `vs-manifest.json`. */
export interface VsManifest {
  serverBranch: string; // e.g. "stable" -- which cdn.vintagestory.at release channel to fetch from
  serverVersion: string; // e.g. "1.22.7" -- the vanilla dedicated server version to fetch
  /** Where the production wiki is deployed; the build info page links to it (also on local builds). */
  prodWikiUrl?: string;
  mods: ModManifestEntry[];
  /** Items/blocks to force into the item index even when no recipe/drop/worldgen/trade/dialogue
   * rule reaches them (e.g. static translocators). Each entry is a `domain:code` glob (`*`
   * wildcards; the domain part is optional and then matches any domain), matched against every
   * concrete itemtypes/blocktypes variant -- see `includeManifestItems` in crossref.ts. The JSON
   * Schema at vs-manifest.schema.json documents the same shape for editors. */
  includeItems?: string[];
}

/** Parsed `modinfo.json` from one mod's zip, plus what `modExtractor.ts` detected about it. */
export interface ModInfo {
  modid: string;
  name: string;
  version: string;
  side: string; // "Client" | "Server" | "Universal", as declared in modinfo.json
  type?: string; // modinfo.json's own "type" field, e.g. "Code" | "content"
  website?: string; // modinfo.json's own "website" field, when the author set one
  assetid?: number; // mods.vintagestory.at's numeric asset id, cached by `npm run download` -- always present once cached; `https://mods.vintagestory.at/show/mod/<assetid>` always resolves, unlike guessing a slug from modid
  urlalias?: string; // mods.vintagestory.at's own slug, when the author set one -- NOT reliably equal to this mod's own `modid` (confirmed false for at least one real mod), so never assume it is
  logoUrl?: string; // mods.vintagestory.at's own CDN logo image URL, cached by `npm run download` alongside assetid/urlalias -- absent for mods downloaded before this existed, or that never set a logo
  authors?: string[];
  description?: string;
  dependencies?: Record<string, string>; // modid -> version requirement
  hasCompiledCode: boolean; // true if the zip contains a .dll -- its custom behavior can't be read from JSON alone
  isVanilla: boolean; // true only for the synthetic "game" entry representing the vanilla server itself
}

// Asset-loading shapes live in the vs-wiki-core package; re-exported so ingest code keeps one import site.
export type { AssetSource, LoadedAsset, AssetIndex, PatchOp } from "vs-wiki-core/types.js";

/** A bare domain:code pair, used wherever a reference doesn't need the full `IngredientSpec` shape. */
export interface Code {
  domain: string;
  code: string;
}

/** One ingredient slot in a normalized recipe -- shape varies a lot by recipe category, hence the index signature. */
export interface IngredientSpec {
  type?: "item" | "block";
  code?: string; // concrete or wildcard/`{placeholder}` code; absent when matched by `tags` instead
  domain?: string; // defaults to the recipe's own domain when absent
  tags?: string[]; // alternative to `code`: matches any item/block carrying one of these tags
  quantity?: number;
  litres?: number; // for liquid ingredients (barrel recipes)
  isTool?: boolean; // true if this slot is consumed as durability loss rather than consumed outright
  toolDurabilityCost?: number;
  allowedVariants?: string[]; // restricts a wildcard `code`'s `*`/`{placeholder}` to exactly these concrete values
  name?: string; // cooking-recipe ingredient display name override
  minratio?: number; // alloy recipes: minimum fraction of the molten metal this ingredient may contribute
  maxratio?: number;
  minQuantity?: number; // cooking recipes: quantity range rather than a fixed amount
  maxQuantity?: number;
  validStacks?: { type?: string; code?: string }[]; // cooking recipes: any one of these concrete item/block stacks satisfies the slot
  [key: string]: unknown; // tolerates category-specific fields not otherwise modeled
}

/** A recipe's output -- same "varies by category" shape as `IngredientSpec`. */
export interface OutputSpec {
  type?: "item" | "block";
  code?: string; // may carry an unresolved `{placeholder}` -- see `NormalizedRecipe.wildcard`
  domain?: string;
  quantity?: number;
  litres?: number;
  stacksize?: number; // max stack size of the produced item/block, when the recipe itself overrides it
  [key: string]: unknown;
}

export type RecipeCategory =
  | "grid"
  | "smithing"
  | "clayforming"
  | "knapping"
  | "alloy"
  | "barrel"
  | "cooking";

/** One recipe, normalized across all 7 `RecipeCategory` shapes into one common structure. */
export interface NormalizedRecipe {
  id: string; // stable, unique across the whole recipe set -- used as a cross-ref key elsewhere
  category: RecipeCategory;
  domain: string;
  sourceMod: string;
  name?: string; // most categories (alloy/barrel/cooking/knapping/smithing/clayforming) never set this -- see README
  shapeless?: boolean; // grid recipes only: ingredient positions don't matter
  width?: number; // grid recipes only: crafting grid footprint
  height?: number;
  ingredients: IngredientSpec[];
  ingredientsBySlot?: Record<string, IngredientSpec>; // grid recipes only: keyed by the pattern character used in `raw.ingredientPattern`
  /** Grid recipes can also carry a recipe-level `allowedVariants: {placeholder: [...]}` map (e.g.
   * {metal: [...], lining: [...]}), applying to every ingredient/output `{placeholder}` token at once,
   * independent of the single-ingredient `wildcard` mechanism above. */
  templateVariants?: Record<string, string[]>;
  output: OutputSpec;
  wildcard?: { placeholder: string; allowedVariants: string[] }; // output carries one unresolved `{placeholder}`, resolved via this ingredient-driven allow-list
  sealHours?: number; // barrel recipes only: how long the barrel must remain sealed
  raw: unknown; // original unpatched-but-concrete recipe JSON, shown on the recipe detail page
}

// "stackRandomizer": a block/entity drop can itself be an `ItemStackRandomizer`-class item -- a
// sealed "box" item (e.g. "stackrandomizer-alljonas", in-game display name "Jonas Parts&Frames
// Stack randomizer", dropped by locust/shiver/drifter/bowtorn/bell -- confirmed via the vanilla
// lang key `item-stackrandomizer-alljonas`) rather than a concrete reward by itself. Its itemtype
// JSON (`class: "ItemStackRandomizer"`, e.g. `survival/itemtypes/meta/stackrandomizer.json`)
// carries an `attributesByType["*-<variant>"].stacks` weighted pool of the *actual* possible
// contents (e.g. jonasparts-*/jonasframes-* items for the "alljonas" variant), resolved the same
// `resolveByType`/concrete-code way as every other `*ByType` field elsewhere in this file.
// `extractLoot` keeps the original entry for the box item itself (so it still gets its own
// `/items/` page and `droppedBy` link) and additionally synthesizes one `stackRandomizer` entry
// per pool content, so a creature's drop table shows what it can concretely yield, not just the
// opaque box.
export type LootMechanism = "blockDrop" | "panning" | "entityDrop" | "harvestable" | "stackRandomizer";

/** An entity's `server.spawnconditions`/`spawnconditionsByType` -- NOT top-level `spawnconditions`, see CLAUDE.md. */
export interface EntitySpawnInfo {
  minTemp?: number; // °C
  maxTemp?: number;
  minRain?: number; // 0-1 scale
  maxRain?: number;
  minForest?: number; // 0-1 scale (forest density)
  maxForest?: number;
  habitatBlocks?: string[]; // block code(s) that must be present at/adjacent to the spawn position; may include wildcards
  chance?: number; // probability per spawn attempt
  group?: string; // spawn-balancing group, e.g. "hostile" | "neutral" | "harmless"
  triesPerChunk?: number;
}

/** Health/size/behavior facts about one entity, shown on its `/creatures/` detail page. */
export interface EntityStats {
  tags: string[]; // behavior tags, e.g. "predator" -- clickable, filter `/creatures/?q=<tag>`
  weight?: number; // kg
  sizeX?: number; // hitbox width, blocks
  sizeY?: number; // hitbox height, blocks
  maxHealth?: number;
  spawn?: EntitySpawnInfo;
  /**
   * The mob's attack tier: the highest `damageTier`/`projectileDamageTier` among its attack AI tasks,
   * resolved for this variant (drifters: normal 0, deep 1, tainted 2, corrupt 3, nightmare 4). It's the
   * value the game compares against armor's protection tier and the thing players read as "how tough
   * is this mob". Absent when the entity has no tiered attack.
   */
  damageTier?: number;
  /** The C# the entity's own JSON names -- its `class`, each behavior `code` and each AI task `code` (deduped across server/client), linked to source where `csharpClassMap.json` knows the name; engine/VSEssentials-only names stay unlinked. */
  codeRefs?: CodeRef[];
}

/** One normalized drop: something a block/entity can yield, via one of the 5 `LootMechanism`s. */
export interface LootEntry {
  sourceKind: "block" | "entity";
  sourceDomain: string;
  sourceCode: string;
  sourceDisplayName: string;
  sourceMod: string;
  entityStats?: EntityStats; // only set when sourceKind === "entity"
  mechanism: LootMechanism;
  panningKeyPattern?: string; // panning mechanism only: the sluice-box pattern key this drop corresponds to
  stackRandomizerCode?: string; // stackRandomizer mechanism only: the container item this entry's contents were expanded from, as "domain:code" (e.g. "survival:stackrandomizer-alljonas") -- domain included since a pool's contents aren't guaranteed to share the container's own domain
  drop: {
    type?: string;
    domain: string;
    code: string;
    quantityAvg?: number;
    quantityVar?: number; // +/- variance around quantityAvg
    // 0-1 probability of this drop occurring at all -- EXCEPT for a `stackRandomizer` entry,
    // where the container's own drop chance/quantity is tracked on its own separate (kept)
    // LootEntry, so this is instead that content's share of the container's weighted pool
    // (each pool content's raw `chance` weight, normalized so the pool's weights sum to 1).
    chanceAvg?: number;
    chanceVar?: number;
    manMade?: boolean; // true if this drop only occurs from a player-made (not wild-spawned) instance
    dropModbyStat?: string; // name of a player/entity stat that scales this drop's quantity (e.g. a "harvesting" skill)
  };
}

/** `LootEntry[]` grouped by source (one row per block/entity that drops something). */
export interface LootSourceGroup {
  id: string; // `${sourceDomain}:${sourceCode}`
  sourceDomain: string;
  sourceCode: string;
  sourceDisplayName: string;
  sourceKind: "block" | "entity";
  sourceMod: string;
  entityStats?: EntityStats; // only set when sourceKind === "entity"
  entries: LootEntry[];
}

/**
 * Every "living" entity (has the "health" server behavior), regardless of whether it has a drop
 * table -- `generated.loot`/`LootSourceGroup` only cover entities that actually drop something,
 * which silently excluded real creatures with none (traders, villagers, locusts, ...) from
 * `/creatures/`. This is the complete roster `index.ts` seeds that page from; real drops (if any)
 * get merged in on top by matching `domain:code`.
 */
export interface CreatureRosterEntry {
  domain: string;
  code: string;
  sourceDisplayName: string;
  sourceMod: string;
  entityStats: EntityStats;
}

export type StructureKind = "structure" | "village" | "storystructure" | "hookgenerated";

/**
 * One schematic file (`worldgen/schematics/**.json`): a pre-built block layout that world generation
 * pastes into the world. Structures reference these (`NormalizedStructure.schematics`); this holds
 * everything that belongs to the file itself. Read from the header only -- the voxel data stays
 * unparsed at ingest time (the in-browser viewer decodes it on demand).
 */
export interface SchematicInfo {
  id: string; // "<domain>:worldgen/schematics/<relPath>.json" -- the join key every schematic cross-reference in this codebase already uses (tapestry/clutter instances, lore locations, item "found in structures")
  domain: string; // asset domain the file lives in (e.g. "survival", "betterruins"); structure globs only match schematics of their own domain
  sourceMod: string; // modid that ships the file ("game" for vanilla)
  relPath: string; // relative to worldgen/schematics/, no extension, "/" separators
  name: string; // last path segment of `relPath`
  pagePath: string; // "<domain>/<relPath lowercased>" -- the page URL segment under /schematics/. Not `slugify(id)`: slugifying collapses "/", "-" and "_" alike, and two real files ("trader/forest/-hut3-agr" and ".../hut3-agr") collided
  assetPath: string; // site-root-relative URL of the gzip copy the viewer fetches, e.g. "assets/schematics/world/survival/well/deep-1.json.gz" (prefix with `'/' | url` in templates)
  sizeX?: number; // bounding box, blocks
  sizeY?: number;
  sizeZ?: number;
  blockCodeCount?: number; // distinct block codes, from the `BlockCodes` dict
  blockCodes: string[]; // the `BlockCodes` dict's values, e.g. "game:supportbeam-veryaged" (a domain prefix is present as written in the file)
  itemCodes: string[]; // the `ItemCodes` dict's values -- items placed inside containers, notably `stackrandomizer-*`
  fileBytes: number; // size of the original .json
  gzBytes?: number; // size of the gzip copy served to the viewer (`schematicFiles.ts`); absent if that copy wasn't written
  usedBy: SchematicUse[]; // structures that reference this file (the reverse of `NormalizedStructure.schematics`)
}

/** One structure's use of a schematic file -- the reverse side of a `SchematicRef`. */
export interface SchematicUse {
  structureId: string;
  via: string; // the structure's raw schematic path/glob that matched this file
  weight?: number; // from that reference (see SchematicRef)
  minQuantity?: number;
  maxQuantity?: number;
}

/**
 * A structure's reference to one schematic path or glob. The weight/quantities belong to this
 * reference (the structure's own choice), not to the schematic file, which is why they live here.
 */
export interface SchematicRef {
  globPath: string; // the raw glob/path reference as written in the structure's own JSON
  schematicIds: string[]; // `SchematicInfo.id`s this glob resolved to (empty if nothing matched)
  weight?: number; // relative chance this specific schematic is picked when the structure has several
  minQuantity?: number; // how many copies of this schematic piece to place at once (e.g. village buildings)
  maxQuantity?: number;
}

/**
 * A "clutter" block's placed `type` (`blocktypes/clutter.json`'s `ShapeFromAttributes` behavior --
 * one block code whose identity is a per-instance block-entity attribute, e.g. "skull/human-crystal"),
 * decoded from worldgen schematics (`models/clutterInstances.ts`). One entry per distinct type.
 */
export interface ClutterType {
  id: string; // the raw `type` (merged across domains)
  type: string; // the raw `type` attribute value, e.g. "skull/human-crystal"
  domain: string;
  displayName: string; // localized via `clutter-<type with "/" -> "-">`; falls back to `type` when no lang key exists
  missingTranslation: boolean;
  sourceMod: string; // mod of the first structure the type was seen in
  blockCodes: string[]; // which clutter block code(s) carry it: "clutter" | "clutter-devastation" | "clutter-aquatic"
  structures: { structureId: string; count: number }[]; // structures whose schematics place it, and how many times
}

/** One world-generated structure, normalized across all 4 `StructureKind` registries. */
export interface NormalizedStructure {
  id: string; // unique, including a `#<index>` suffix when the same code is reused across size/depth variants
  kind: StructureKind;
  code: string;
  name?: string; // falls back to `code` in templates when absent
  domain: string;
  sourceMod: string;
  group?: string; // some structures are grouped (e.g. all variants of one village type)
  chance?: number; // spawn chance per candidate location
  placement?: string; // "surface" | "underground" | a specific ruin/story layer
  minSpawnDistance?: number; // blocks from world spawn before this is allowed to generate at all
  minGroupDistance?: number; // blocks required between two instances of this same structure
  restrictions: Record<string, unknown>; // raw worldgen restriction keys not promoted to a field above -- see RESTRICTION_GLOSSARY
  schematics: SchematicRef[]; // which schematic files this structure can place; the files themselves are `generated.schematics`
  raw: unknown; // original structure JSON, shown on the detail page
}

/** One item/block in the cross-referenced item index -- see README for how this differs from a full registry walk. */
export interface ItemIndexEntry {
  domain: string;
  code: string;
  kind: "item" | "block";
  displayName: string;
  missingTranslation: boolean; // true if no lang key resolved and `displayName` is just the raw code
  sourceMod: string;
  producedBy: string[]; // NormalizedRecipe ids that output this item/block
  consumedBy: string[]; // NormalizedRecipe ids that consume this item/block as an ingredient
  droppedBy: string[]; // indices (as strings) into the flat `generated.loot` array -- other things that drop this
  appearsInStructures: string[]; // structure ids whose schematics' BlockCodes dictionary contains this item/block's code -- populated in index.ts via the same structureContents.ts cross-reference used for the decor catalog's DecorItem.foundInStructures; a coarse match (confirms the code is somewhere in that schematic, not where/how many times)
  spawnDeposits: string[]; // DepositInfo ids (ore/gem/rock -- where this specific grade+rock combo occurs)
  spawnBlockPatches: string[]; // BlockPatchSpawnInfo ids (crops/flowers/mushrooms/etc -- climate band this grows in)
  spawnTrees: string[]; // TreeSpawnInfo ids (regular tree/shrub species -- climate band this grows in)
  spawnFruitTrees: string[]; // FruitTreeSpawnInfo ids (fruit tree varieties -- climate band this grows in)
  rockStrata: string[]; // RockStrataInfo ids -- for bare rock blocks, the noise rule governing where this rock type forms
  tags?: string[]; // the item/blocktype's own top-level `tags` (e.g. "tool-hammer") -- lets a recipe ingredient's tag-based slot (IngredientSpec.tags) cross-link to every item/block declaring that same tag
  maxStackSize?: number; // the item/blocktype's own top-level `maxstacksize`; absent in the raw JSON for many items (engine-side default, not recoverable from JSON alone) -- never guessed
  tradesSelling: string[]; // TradeListing ids (direction "selling") -- traders who sell this item to the player
  tradesBuying: string[]; // TradeListing ids (direction "buying") -- traders who buy this item from the player
  npcRewards: string[]; // indices (as strings) into the flat `generated.dialogueRewards` array -- NPCs whose dialogue can hand over this item
  description?: string; // flavor text from an itemdesc-/blockdesc- lang key, when the game defines one (most don't); trusted HTML like DecorItem.description
  codeRefs?: CodeRef[];
  randomPool?: RandomPoolStack[]; // `ItemStackRandomizer` items only: everything it can turn into, most likely first (see extractStackRandomizerPools in models/loot.ts). The randomizer placed in a world-generated chest may also carry its own `totalChance` attribute (chance to generate nothing at all) -- per-instance data, not in this definition.
  generatedBy?: RandomizerSource[]; // randomizer items that can generate this item/block, most likely first (the reverse of `randomPool`)
  includedByManifest?: string; // the vs-manifest.json `includeItems` pattern that matched this entry, when one did (set even if other rules also reach it) // the C# classes/behaviors this item/block's own JSON names (see attachItemMetadata in crossref.ts); absent when it names none
}

/**
 * One possible result of an `ItemStackRandomizer` item (`ItemIndexEntry.randomPool`): the game rolls
 * one of these when the randomizer is resolved (placed in a world-generated chest, dropped, ...).
 */
export interface RandomPoolStack {
  domain: string;
  code: string;
  kind: "item" | "block";
  quantityAvg?: number; // the stack's `quantity.avg`; the resolved size is uniform in avg ± var (the game's default when absent is exactly 1)
  quantityVar?: number;
  chance: number; // 0-1, this stack's raw `chance` weight divided by the pool's total weight (the game normalizes the same way)
  attributes?: Record<string, unknown>; // attributes the generated stack is given -- e.g. the generic `clutter` block's `type` (which decides what it actually is)
}

/** Reverse of `RandomPoolStack`: a randomizer item whose pool can produce this item/block (`ItemIndexEntry.generatedBy`). */
export interface RandomizerSource {
  domain: string; // of the randomizer item, e.g. "survival"
  code: string; // e.g. "stackrandomizer-ore"
  chance: number; // 0-1 chance of this item among that randomizer's results (not including the randomizer's own per-instance `totalChance`)
}

/** Which engine registry a JSON-referenced C# name lives in -- one per `api.Register<X>Class`
 * method (`block` = RegisterBlockClass, `blockEntity` = RegisterBlockEntityClass, ...). The entity
 * ones: `entity` = RegisterEntity (an entity JSON's `class`), `entityBehavior` = RegisterEntityBehaviorClass
 * (`server.behaviors[].code`), `aiTask` = AiTaskRegistry.Register (`taskai`'s `aitasks[].code`). */
export type CSharpRegistrationKind = "block" | "item" | "blockEntity" | "blockBehavior" | "collectibleBehavior" | "blockEntityBehavior" | "entity" | "entityBehavior" | "aiTask";

/**
 * `src/ingest/csharpClassMap.json`: a committed snapshot of which C# file implements each name the
 * game's JSON can reference, generated by hand with `scripts/map-csharp-classes.ts` from the local
 * `vssurvivalmod/` reference clone. Only covers what that repo registers -- names from
 * VSEssentials, the closed-source engine, or a mod DLL are absent by design.
 */
export interface CSharpClassMap {
  repo: string; // GitHub "owner/name" the paths are relative to, e.g. "anegostudios/vssurvivalmod"
  commit: string; // the clone's commit when the map was generated -- links are pinned to it so line numbers stay correct
  registrations: Partial<Record<CSharpRegistrationKind, Record<string, CSharpTypeLocation>>>; // kind -> JSON-facing name -> where it's implemented
}

/** Where one registered name's C# type is declared. `path`/`line` are absent if the generator
 * found the registration but no matching `class`/`struct` declaration in the repo. */
export interface CSharpTypeLocation {
  type: string; // the C# type name passed to typeof(...), e.g. "BlockTobiasTeleporter"
  path?: string; // repo-relative .cs file path, e.g. "Block/BlockTobiasTeleporter.cs"
  line?: number; // 1-based line of the type's declaration in that file
}

/** One C# name an item/block's JSON refers to, resolved against CSharpClassMap where possible. */
export interface CodeRef {
  role: "class" | "entityClass" | "behavior" | "entityBehavior" | "aiTask"; // which JSON field named it (`class`, `entityClass`, `behaviors[].name`, `entityBehaviors[].name`); for an entity (EntityStats.codeRefs): `class` = its entity class, `entityBehavior` = a `behaviors[].code`, `aiTask` = an `aitasks[].code`
  name: string; // the name exactly as written in the JSON, e.g. "HorizontalOrientable"
  type?: string; // resolved C# type name, when found in the map
  path?: string; // repo-relative .cs file declaring `type` (CSharpTypeLocation.path), e.g. "Block/BlockTobiasTeleporter.cs"
  url?: string; // GitHub link to the declaring file + line, pinned to the map's commit; absent when the name isn't implemented in vssurvivalmod
}

/** An ore/gem/rock deposit (`worldgen/deposits/**`): which rock(s) host it, and at which grades. */
export interface DepositInfo {
  id: string;
  code: string; // the deposit definition's own code, e.g. "chromite"
  domain: string;
  sourceMod: string;
  category: string; // derived from the deposits folder structure: "metalore" | "gem" | "rock" | "other"
  hostRocks: string[]; // bare rock names (e.g. "andesite") this deposit can replace
  gradesByRock?: Record<string, string[]>; // when grade varies by rock: rock name -> allowed grades (e.g. "poor","rich")
  generator?: string; // worldgen generator algorithm name, as given in the raw deposit JSON
  triesPerChunk?: number;
  yPosRel?: { avg?: number; var?: number }; // typical depth as a fraction of world height (1.0 = surface, 0.0 = bottom)
}

/**
 * How a base rock type (not an ore/gem deposit -- see `DepositInfo` for those) is itself placed
 * into the world (`worldgen/rockstrata.json`): a layered-noise rule compared against per-variant
 * thresholds, not a simple depth band, climate rule, or fixed global ordering.
 */
export interface RockStrataInfo {
  id: string;
  domain: string;
  sourceMod: string;
  blockCode: string; // e.g. "rock-andesite"
  rockGroup?: string; // "Volcanic" | "Sedimentary" | "Metamorphic" | "Igneous"
  genDir?: string; // "BottomUp" (anchored near bedrock) | "TopDown" (anchored near the surface)
}

/** A flat worldgen placement rule for crops/flowers/mushrooms/ferns/berry bushes/etc. */
/** A farmable crop's growth/soil requirements (`cropProps` in `blocktypes/plant/crop/<type>.json`). */
export interface CropProps {
  requiredNutrient?: "N" | "P" | "K" | string; // which soil nutrient (nitrogen/phosphorus/potassium) the crop draws on
  nutrientConsumption?: number; // how much of that nutrient one growth cycle uses up
  growthStages?: number;
  totalGrowthMonths?: number;
  coldDamageBelow?: number; // °C below which the crop takes frost damage
  heatDamageAbove?: number; // °C above which the crop takes heat damage
}

export interface BlockPatchSpawnInfo {
  id: string;
  domain: string;
  sourceMod: string;
  category: string; // derived from the filename: "crop" | "flower" | "mushroom" | "fern" | "berrybush" | ...
  blockCodes: string[]; // concrete block codes this patch can place -- no wildcard/template resolution needed
  minTemp?: number; // °C
  maxTemp?: number;
  minRain?: number; // 0-1 scale
  maxRain?: number;
  minForest?: number; // 0-1 scale
  maxForest?: number;
  minFertility?: number; // 0-1 scale
  maxFertility?: number;
  crop?: CropProps; // only for crop patches (`crop-<type>-<stage>` blocks): that crop's `cropProps`
  chance?: number;
  placement?: string; // e.g. "OnSurfacePlusUnderTrees" -- raw placement-string value from the worldgen rule
}

/** A regular (non-fruit) tree or shrub species' climate band (`worldgen/treengenproperties.json`). */
export interface TreeSpawnInfo {
  id: string;
  domain: string;
  sourceMod: string;
  generator: string; // species code, matches a `worldgen/treegen/<generator>.json` shape file when one exists
  isShrub: boolean; // true if this came from the `shrubgens` array rather than `treegens`
  weight?: number; // relative chance this species is picked among others whose climate band also matches
  minTemp?: number; // °C
  maxTemp?: number;
  minRain?: number; // normalized 0-1 (raw data is 0-255 -- see CLAUDE.md)
  maxRain?: number;
  minFertility?: number; // normalized 0-1 (raw data is 0-255)
  maxFertility?: number;
  minForest?: number; // normalized 0-1 (raw data is 0-255)
  maxForest?: number;
  minHeight?: number; // already 0-1 -- relative terrain height (0 = bottom of world, 1 = top)
  maxHeight?: number;
  minSize?: number; // relative tree size (0-1) this band may generate at
  maxSize?: number;
  suitabilitySizeBonus?: number; // bonus to this generator's suitability score when a larger tree would fit at the spot
  habitat?: string; // e.g. "Water" for swamp-growing species; absent means ordinary dry land
  logBlockCode?: string; // concrete block codes from this species' own treegen shape file, when one exists
  otherLogBlockCode?: string;
  leavesBlockCode?: string;
  leavesBranchyBlockCode?: string;
  saplingCodes?: string[]; // sapling block codes that grow into this species, via plaintreesapling.json's treeGenByType map
}

/** A fruit tree variety's climate band (`blocktypes/plant/fruittreebranch.json`). */
export interface FruitTreeSpawnInfo {
  id: string;
  domain: string;
  sourceMod: string;
  variety: string; // e.g. "pinkapple" -- the fruittreeProperties key this band corresponds to
  minTemp?: number; // °C
  maxTemp?: number;
  minRain?: number; // already 0-1
  maxRain?: number;
  fruitItemCode?: string; // concrete fruit item code (e.g. "fruit-pinkapple"), resolved via fruittreeProperties[variety].fruitStacks[0].code
}

export type DecorKind = "painting" | "tapestry" | "clothing";

/** One painting/tapestry/clothing item -- a deliberate full-registry-walk carve-out, see README. */
export interface DecorItem {
  id: string;
  kind: DecorKind;
  itemKind: "item" | "block"; // clothing is an inventory item; paintings/tapestries are placed blocks
  domain: string;
  code: string;
  displayName: string;
  description?: string; // flavor text from an itemdesc-/blockdesc- lang key, when the game defines one (most don't -- see README)
  sourceMod: string;
  /** Structure ids whose schematics contain this block/item code (see structureContents.ts). */
  foundInStructures: string[];
  /** For tapestries: the lore book id whose chapters this tapestry can display (picked at
   * placement time via a runtime "type" attribute, not encoded in the block code itself -- see
   * README). Undefined for everything else. */
  relatedLoreBookId?: string;
  /** For tapestries/wallcarvings only: per-structure resolved outcomes, decoded directly from
   * each worldgen schematic's block-entity attributes (see `models/tapestryInstances.ts`). */
  tapestryInstances?: TapestryInstance[];
}

/** One resolved possible identity for a tapestry/wallcarving instance -- see `TapestryInstance`. */
export interface TapestryOutcome {
  rawType: string; // the actual block-entity "type" attribute value for this outcome, e.g. "temporality1" -- what's literally stored in the schematic's BlockEntities data
  baseCode: string; // e.g. "temporality" (rawType with its trailing piece-number digits stripped)
  displayName: string; // e.g. "Dangers of Temporality (tapestry)" -- composed from two lang keys, see lang.ts
  loreChapterId?: number; // index into the matching lore book's `pages` array; absent for non-lore-tied base codes (loreChapterIds[code] === -1)
  size?: string; // e.g. "3x1" -- the multi-tile shape (tapestry.json/wallcarving.json's own "sizes" attribute); shared by every member of a reroll group
}

/**
 * One placed tapestry/wallcarving block-entity instance, decoded from a worldgen schematic's
 * `BlockEntities` data (Ascii85 + TreeAttribute, see `site/assets/schematicDecode.js`). The
 * schematic's own stored "type" attribute is just one deterministic sample -- the game rerolls it
 * to a uniformly random member of the same `tapestryGroups`/`wallcarvingGroups` entry when the
 * schematic is actually placed into a world (`BlockTapestry.OnLoadCollectibleMappings`), unless
 * `preserveType` is set. `outcomes` lists every real possibility, not just the stored one.
 */
export interface TapestryInstance {
  id: string; // `${structureId}#${schematicKey}#${packedIndex}`
  structureId: string;
  blockCode: string; // concrete code, e.g. "tapestry-west"
  storedBaseCode: string; // what this schematic file literally has baked in (always one of `outcomes`)
  rerolls: boolean; // false when the group has exactly one member (e.g. "gate1") -- always shows storedBaseCode, no "could show" hedge needed
  outcomes: TapestryOutcome[]; // every member of the reroll group; just [storedBaseCode]'s outcome when rerolls is false
}

/** One row on the `/mods/` page. */
export interface ModSummary {
  modid: string;
  name: string;
  version: string;
  side: string;
  type?: string; // modinfo.json's own "type" field, e.g. "Code" | "content"
  website?: string; // modinfo.json's own "website" field, when the author set one
  assetid?: number; // links to https://mods.vintagestory.at/show/mod/<assetid> -- see ModInfo for why this, not modid, is used
  logoUrl?: string; // see ModInfo.logoUrl
  description?: string;
  authors?: string[];
  hasCompiledCode: boolean;
  isVanilla: boolean;
}

/**
 * One in-game handbook help-guide article (`config/handbook/<NN>-<name>.json`). `title`/`text` are
 * lang keys (same pattern as `models/lore.ts`), with `text` resolving to trusted HTML containing
 * `handbook://`/`handbooksearch://` cross-links -- `models/guides.ts` rewrites the ones it
 * recognizes (item/block codes, other guides) into real site-relative paths (lang-prefix-free,
 * templates splice in `{{ lang }}` via a `__LANG__` placeholder -- see `site/guides/guides.njk`).
 */
export interface GuideInfo {
  id: string; // pageCode, e.g. "craftinginfo-starterguide"
  domain: string;
  sourceMod: string;
  title: string;
  html: string; // resolved text, with recognized handbook:// links rewritten; unrecognized ones left inert
  order: number; // from the two-digit numeric filename prefix -- the only ordering signal that exists
}

/** One entry in a trader's buy or sell list (`config/tradelists/<specialization>.json`). */
export interface TradeListing {
  id: string; // `${tradeList.id}#selling#<i>` or `#buying#<i>` -- unique, used by ItemIndexEntry.tradesSelling/tradesBuying
  tradeListId: string; // the owning TradeList's id, to link back to the trader's own page
  direction: "selling" | "buying";
  domain: string;
  code: string;
  itemKind: "item" | "block";
  stacksize?: number;
  stockAvg?: number;
  stockVar?: number;
  priceAvg?: number;
  priceVar?: number;
  // priceMin/priceMax/stockMin/stockMax are derived (avg - var / avg + var) at ingest time purely
  // so templates can show a plain "min-max" range (e.g. the flat /trades/ listing) without
  // re-deriving it in Nunjucks -- avg/var above are kept as-is, not replaced, since they're the
  // actual game-data shape and other code may still want the "average ± variance" framing.
  stockMin?: number;
  stockMax?: number;
  priceMin?: number;
  priceMax?: number;
}

/**
 * One concrete trader entity variant (e.g. `trader-male-treasurehunter-cold`) that uses a given
 * specialization's trade list. VS has no explicit "specialization" field anywhere -- the link is
 * entirely implicit: `entities/humanoid/trader-{male,female}.json` declare a `variantgroups` entry
 * `{ code: "type", states: [...specialization codes...] }`, and the entity's own
 * `attributes.tradePropsFile: "config/tradelists/trader-{type}"` substitutes that same `type`
 * variant value into the tradelist filename. So the *specialization code itself* (the `{type}`
 * state, e.g. "treasurehunter") is the join key between a concrete entity variant and its
 * TradeList -- there's no separate ID to look up. One specialization is used by several concrete
 * entity codes (every gender x climate combination), so this is an array, not a single ref.
 */
export interface TraderEntityRef {
  domain: string;
  code: string; // fully-resolved entity code, e.g. "trader-male-treasurehunter-cold" -- links to /creatures/<domain>/<code>/
}

/** One trader specialization's full buy/sell list. */
export interface TradeList {
  id: string; // specialization code, e.g. "artisan"
  // Human-readable trader name, e.g. "Agriculture trader": the first matching trader entity's
  // localized name with its trailing climate qualifier ("(cold)") dropped; falls back to the
  // capitalized specialization code when no entity variant matches.
  displayName: string;
  domain: string;
  sourceMod: string;
  moneyAvg?: number;
  moneyVar?: number;
  selling: TradeListing[];
  buying: TradeListing[];
  // Every concrete trader entity variant (gender x climate) that resolves to this specialization
  // via its `type` variantgroups state -- see TraderEntityRef's doc comment. Empty when no loaded
  // entity's `type` variant states include this specialization's code (e.g. a mod-added tradelist
  // with no matching entity variant yet).
  traderEntities: TraderEntityRef[];
}

/** One item a dialogue branch hands over as a reward (the `giveitemstack` trigger -- the only
 * reward-shaped trigger actually found in the real dialogue data; `takefrominventory` is the
 * mirror-image "player pays the NPC" trigger and isn't a reward, so it's not modeled). */
export interface DialogueReward {
  domain: string;
  code: string;
  kind: "item" | "block";
  stacksize?: number;
}

/**
 * One NPC's dialogue (`config/dialogue/<name>.json`, referenced by an entity's `conversable`
 * behavior -- a flat `dialogue: "config/dialogue/x"` string, or a glob-keyed `dialogueByType` map
 * resolved the same `resolveByType` way as drops/spawn conditions elsewhere) flattened to the two
 * facts actually useful on a wiki page: every line the NPC side of the conversation can say, and
 * every item it can hand over as a reward. The underlying file is a genuine branching state
 * machine (a `components` array of talk/condition nodes wired together by `jumpTo` targets,
 * conditioned on player/entity variables) -- not rendered as a graph, deliberately; see
 * `models/dialogue.ts`. One `NpcDialogue` per concrete entity variant (not per dialogue file),
 * since several variants commonly share the same file -- both trader genders share "trader" (via
 * `dialogueByType`'s `"*"` fallback), most villager jobs share the generic "villager" file the
 * same way -- so the same `lines`/`rewards` legitimately repeat verbatim across several entries.
 * Only covers entities that also have the "health" server behavior (see `hasHealthBehavior` in
 * `models/loot.ts`), i.e. ones that actually get a `/creatures/` page to cross-link from -- a
 * handful of inanimate "conversable" lore props (`skeletonarm`, `skeletonwithloot`,
 * `libraryresonator`, part of the Resonance Archive puzzle) have dialogue too but no health
 * behavior and so no creature page to attach it to; they're intentionally left out.
 */
export interface NpcDialogue {
  id: string; // `${domain}:${code}`, matches the owning entity variant's `CreatureRosterEntry`/`LootSourceGroup` id
  domain: string;
  code: string;
  sourceMod: string;
  sourceDisplayName: string;
  dialogueFile: string; // bare dialogue file code, e.g. "trader" -- which config/dialogue/<x>.json these lines/rewards came from
  lines: string[]; // NPC-side lines only (components whose `owner` isn't "player"), lang-resolved, handbook:// links rewritten, de-duplicated, file order preserved
  rewards: DialogueReward[]; // de-duplicated giveitemstack rewards, file order preserved
}

/**
 * One `NpcDialogue.rewards` entry flattened out into its own array, the same "flat array +
 * ids-into-it" cross-link shape `generated.loot`/`ItemIndexEntry.droppedBy` already uses (see
 * `LootEntry`) -- lets an item's page list every NPC that can give it as a reward without the NPC
 * side needing to know about the item side. `ItemIndexEntry.npcRewards` stores indices (as
 * strings) into this array.
 */
export interface DialogueRewardEntry {
  npcId: string; // the owning NpcDialogue.id, to link back to its /creatures/ page
  npcDomain: string;
  npcCode: string;
  npcDisplayName: string;
  npcMod: string;
  domain: string;
  code: string;
  kind: "item" | "block";
  stacksize?: number;
}

export type TraitType = "positive" | "negative";

/**
 * One player trait (`config/traits.json`): a named bundle of stat modifiers assigned to a
 * character class at world start (see `CharacterClassInfo.traits`), never obtainable or
 * changeable afterward. `attributes` are raw stat-modifier key/value pairs exactly as the game
 * defines them (e.g. `"walkspeed": 0.1` = +10% walk speed, `"maxhealthExtraPoints": -2` = -2 flat
 * health points) -- deliberately not normalized into a fixed schema since the key set is
 * open-ended and varies per trait; rendered generically (label the key, show the signed raw
 * value) rather than hardcoding a glossary entry per possible key.
 */
export interface TraitInfo {
  code: string;
  domain: string;
  sourceMod: string;
  type: TraitType;
  displayName: string;
  /** Flavor/mechanical text from a `traitdesc-<code>` lang key -- only defined for traits that
   * unlock something non-numeric (e.g. "bowyer" unlocks bow crafting); most traits have none,
   * since their effect is fully described by `attributes`. */
  description?: string;
  attributes: Record<string, number>;
}

/** A starting-equipment reference on a `CharacterClassInfo` -- resolved to a display name at
 * ingest time (same as everywhere else gear/drops reference an item) rather than looked up live
 * in a template, since clothing never joins the main item index (see README) and so has no
 * generic cross-reference filter available at render time. */
export interface CharacterClassGearItem {
  domain: string;
  code: string;
  displayName: string;
  missingTranslation: boolean;
}

/**
 * A player starting class (`config/characterclasses.json`) -- purely a character-creation choice
 * (fixed trait bundle + starting gear set), not tied to any recipe/loot/worldgen data, so (like
 * paintings/tapestries/clothing) it's extracted as its own standalone catalog rather than forced
 * through the recipe/loot item index.
 */
export interface CharacterClassInfo {
  id: string; // `${domain}:${code}`
  code: string;
  domain: string;
  sourceMod: string;
  displayName: string;
  description?: string; // from a `characterdesc-<code>` lang key (flavor quote + summary), trusted HTML with the game's color-only <font> tags stripped; absent if the class has none
  traits: string[]; // trait codes, cross-referenced against TraitInfo.code via `traitsById`
  gear: CharacterClassGearItem[];
}

/** How one piece of `npm run download` (the server install, or a single mod) resolved this run. */
export type DownloadAction =
  | "downloaded" // actually fetched from the network this run
  | "skipped-present" // already present on disk, left untouched (the common case once cached)
  | "failed"; // lookup/fetch failed; see the console log for the specific error

/** One mod's outcome within a `npm run download` run, written into `downloadTiming.json`. */
export interface ModDownloadResult {
  modid: string;
  action: DownloadAction;
  durationMs: number; // wall-clock time spent on just this mod (lookup + fetch + extract, or the skip-check)
}

/**
 * Written by `scripts/download.ts` on every run (`site/_data/generated/downloadTiming.json`) --
 * one of the three pipeline-phase timing files surfaced on `/<lang>/build/`. Wall-clock duration
 * is measured around the whole `main()` (server install + every mod), so a cache-hit run (nothing
 * actually fetched) legitimately reports a small number -- `anyDownloaded` is what distinguishes
 * "fast because nothing needed fetching" from "fast because something's broken."
 */
export interface DownloadTiming {
  durationMs: number; // wall-clock time for this whole `npm run download` invocation
  finishedAtIso: string; // UTC timestamp this run finished, for "how stale is this" display
  serverAction: DownloadAction; // outcome for the vanilla dedicated server install
  serverDurationMs: number; // wall-clock time spent on just the server install step
  modActions: ModDownloadResult[]; // outcome for each mod in vs-manifest.json, in manifest order
  anyDownloaded: boolean; // true if the server or at least one mod was freshly fetched this run
}

/**
 * Written by `src/ingest/index.ts`'s `main()` (`site/_data/generated/ingestTiming.json`) -- the
 * second of the three pipeline-phase timing files surfaced on `/<lang>/build/`. Measured around
 * the entire ingest run (asset loading, patching, every `models/*.ts` extractor, cross-referencing,
 * and the final `writeGenerated` calls), so it reflects the real end-to-end cost of `npm run ingest`.
 */
export interface IngestTiming {
  durationMs: number; // wall-clock time for this whole `npm run ingest` invocation
  finishedAtIso: string; // UTC timestamp this run finished
  steps: IngestStepTiming[]; // per-step breakdown, in run order (one per "== ... ==" console section)
}

/** One named phase of the ingest run (e.g. "Loading assets (JSON5)") and how long it took. */
export interface IngestStepTiming {
  name: string; // the step's console heading, without the "== ==" decoration
  durationMs: number; // wall-clock time from this step starting to the next one starting
}

/**
 * Written by `scripts/build-site.ts` (a thin wrapper around the Eleventy CLI, see that file for
 * why) to `site/_data/generated/eleventyBuildTiming.json` *after* the wrapped `eleventy` child
 * process exits. Eleventy has no way to report its own total duration to its own templates (the
 * number isn't known until the process is already exiting), so this file is always one full
 * build run stale: whatever `/<lang>/build/` renders came from the *previous* successful
 * `scripts/build-site.ts` run, not the one producing the page currently being viewed. The page
 * labels it that way explicitly rather than presenting it as a live measurement of itself.
 */
export interface EleventyBuildTiming {
  durationMs: number; // wall-clock time the wrapped `eleventy` child process took to exit
  finishedAtIso: string; // UTC timestamp that previous run finished
  succeeded: boolean; // false if the wrapped eleventy process exited non-zero
}

/**
 * One weapon, tool or ammo variant with combat/durability stats (`models/gear.ts` -> `/weapons/`).
 * Every stat is resolved for this exact variant (nearly all are `*ByType` in the game files) and
 * absent when the item doesn't define it. Each entry also gets a normal `/items/` page (see
 * `ensureSpawnTarget` in `src/ingest/index.ts`), which is what `displayName` links to.
 */
export interface GearEntry {
  id: string; // `${domain}:${code}`, same key as ItemIndexEntry
  domain: string;
  code: string; // fully-resolved variant code, e.g. "spear-generic-copper"
  sourceMod: string;
  displayName: string;
  missingTranslation: boolean;
  type: string; // the definition's own base code, e.g. "spear", "pickaxe", "arrow" -- the "what kind of thing" column
  /** "melee weapon" = tagged `weapon-melee`; "ranged weapon" = a bow/sling-style `tool` with its own `attributes.damage`; "ammo" = `attributes.damage` with no `tool` (arrows, bullets); "tool" = everything else. */
  category: "melee weapon" | "ranged weapon" | "ammo" | "tool";
  durability?: number; // uses before it breaks (`durability`)
  attackPower?: number; // melee damage per hit (`attackpower`); hit points of damage, 1 = bare-handed
  attackRange?: number; // melee reach in blocks (`attackRange`), only set when it differs from the default
  toolTier?: number; // mining/working tier (`tooltier`): which blocks it can break at all, e.g. copper 2, iron 4, steel 5
  damageTier?: number; // attack damage tier (`attributes.damageTier`): compared against armor's protection tier, same meaning as EntityStats.damageTier
  damage?: number; // ranged damage (`attributes.damage`): a bow's/sling's base damage, or an arrow/bullet's modifier added to it
  bestMiningSpeed?: number; // highest multiplier across the item's `miningspeed` material table (e.g. 6 for a tin bronze pickaxe on stone/ore/metal)
}

/** One waypoint icon the in-game world map offers (see `extractWaypointIcons` in `models/waypointIcons.ts`). */
export interface WaypointIcon {
  code: string; // what a waypoint's `icon` field and `/waypoint addati` take: the svg's file name without extension or leading ordering number
  source: string; // modid that ships the icon; "game" for vanilla
}

/**
 * One edible item/block variant with its `nutritionProps`, read from `itemtypes/` and `blocktypes/` (see
 * `extractFoods` in `models/foods.ts`). Each entry also gets a normal `/items/` page via `ensureSpawnTarget`,
 * which is where the table links and where a "Nutrition" section shows the same numbers.
 */
export interface FoodEntry {
  id: string; // `${domain}:${code}`, same key as ItemIndexEntry
  domain: string;
  code: string; // fully-resolved variant code, e.g. "fruit-redapple"
  kind: "item" | "block"; // which registry it came from (nearly always "item"; wild mushrooms are blocks)
  sourceMod: string;
  displayName: string;
  missingTranslation: boolean;
  type: string; // the definition's own base code, e.g. "fruit", "redmeat" -- the "what kind of food" column
  satiety: number; // satiety points restored when eaten on its own (`nutritionProps.satiety`)
  health: number; // health change when eaten (`nutritionProps.health`); negative for poisonous ones; 0 when the game doesn't set it
  foodCategory: string; // `nutritionProps.foodcategory`: Fruit, Vegetable, Grain, Protein, Dairy, ... (a balanced diet needs several)
  mealSatiety?: number; // satiety it counts for as an ingredient of a cooked meal (`nutritionPropsWhenInMeal.satiety`), only when that differs from eating it alone
}

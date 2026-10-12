/** One mod pin in `vs-manifest.json` -- the single source of truth for what this wiki documents. */
export interface ModManifestEntry {
  modid: string; // mods.vintagestory.at mod id, e.g. "betterruins"
  version?: string; // pinned release version; omitted means "latest" when downloading
}

/** The whole contents of `vs-manifest.json`. */
export interface VsManifest {
  serverBranch: string; // e.g. "stable" -- which cdn.vintagestory.at release channel to fetch from
  serverVersion: string; // e.g. "1.22.7" -- the vanilla dedicated server version to fetch
  mods: ModManifestEntry[];
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
  authors?: string[];
  description?: string;
  dependencies?: Record<string, string>; // modid -> version requirement
  hasCompiledCode: boolean; // true if the zip contains a .dll -- its custom behavior can't be read from JSON alone
  isVanilla: boolean; // true only for the synthetic "game" entry representing the vanilla server itself
}

/** One physical location assets can be loaded from: a domain folder belonging to a mod (or vanilla). */
export interface AssetSource {
  domain: string; // e.g. "game", "survival", "creative", or a mod's own domain
  modid: string; // "game" for vanilla, otherwise the owning mod's id
  rootDir: string; // filesystem path to this domain's `assets/<domain>/` folder
}

/** One JSON asset file as loaded off disk, before any patching is applied. */
export interface LoadedAsset {
  domain: string;
  relPath: string; // path relative to the domain's assets root, e.g. "recipes/grid/anchor.json", no leading slash
  modid: string; // which mod this specific file came from (last-loaded wins on an override)
  sourceFile: string; // absolute filesystem path, for error messages
  json: unknown; // the parsed (JSON5-tolerant) file contents, unpatched
}

/** `domain:relPath` -> asset (last-loaded wins, matching the game engine's own override behavior). */
export type AssetIndex = Map<string, LoadedAsset>;

/** One operation from a `patches/**\/*.json` file, before `side`/`dependsOn`/`condition` filtering. */
export interface PatchOp {
  op: "add" | "remove" | "replace" | "addmerge" | string; // "addmerge" is VS-specific: merge-append into an array/object rather than replace
  path: string; // JSON-pointer-style path into the target file
  value?: unknown;
  file: string; // target file this patch applies to, e.g. "game:worldgen/structures.json" (domain prefix optional)
  side?: "Server" | "Client" | "Universal"; // only "Server"/"Universal" patches matter to this pipeline (no client-only state)
  condition?: { when: string; isValue?: unknown; useValue?: boolean }; // gated on a world-creation config value; "Default" preset is assumed
  dependsOn?: { modid: string; invert?: boolean }[]; // only applied if the named mod is (or, if invert, is not) present
  // Provenance attached by the loader itself, not read off the JSON -- lets later error messages
  // and the `compatibility/<othermodid>/` folder convention trace a patch back to its source file.
  __modid?: string;
  __sourceFile?: string;
  __domain?: string;
}

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

export type LootMechanism = "blockDrop" | "panning" | "entityDrop" | "harvestable";

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
}

/** One normalized drop: something a block/entity can yield, via one of the 4 `LootMechanism`s. */
export interface LootEntry {
  sourceKind: "block" | "entity";
  sourceDomain: string;
  sourceCode: string;
  sourceDisplayName: string;
  sourceMod: string;
  entityStats?: EntityStats; // only set when sourceKind === "entity"
  mechanism: LootMechanism;
  panningKeyPattern?: string; // panning mechanism only: the sluice-box pattern key this drop corresponds to
  drop: {
    type?: string;
    domain: string;
    code: string;
    quantityAvg?: number;
    quantityVar?: number; // +/- variance around quantityAvg
    chanceAvg?: number; // 0-1 probability of this drop occurring at all
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

export type StructureKind = "structure" | "village" | "storystructure" | "hookgenerated";

/** One schematic file (or glob of them) a structure can place, with header-only metadata (no voxel decode). */
export interface SchematicSummary {
  globPath: string; // the raw glob/path reference as written in the structure's own JSON
  resolvedFiles: {
    path: string; // concrete file this glob resolved to
    sizeX?: number; // schematic bounding-box dimensions, blocks
    sizeY?: number;
    sizeZ?: number;
    blockCodeCount?: number; // number of distinct block codes used, from the schematic's `BlockCodes` dict
  }[];
  weight?: number; // relative chance this specific schematic is picked when the structure has several
  minQuantity?: number; // how many copies of this schematic piece to place at once (e.g. village buildings)
  maxQuantity?: number;
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
  schematics: SchematicSummary[];
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
  appearsInStructures: string[]; // structure ids -- stays empty in v1, schematic voxel data isn't decoded (see README)
  spawnDeposits: string[]; // DepositInfo ids (ore/gem/rock -- where this specific grade+rock combo occurs)
  spawnBlockPatches: string[]; // BlockPatchSpawnInfo ids (crops/flowers/mushrooms/etc -- climate band this grows in)
  spawnTrees: string[]; // TreeSpawnInfo ids (regular tree/shrub species -- climate band this grows in)
  spawnFruitTrees: string[]; // FruitTreeSpawnInfo ids (fruit tree varieties -- climate band this grows in)
  rockStrata: string[]; // RockStrataInfo ids -- for bare rock blocks, the noise rule governing where this rock type forms
  tags?: string[]; // the item/blocktype's own top-level `tags` (e.g. "tool-hammer") -- lets a recipe ingredient's tag-based slot (IngredientSpec.tags) cross-link to every item/block declaring that same tag
  maxStackSize?: number; // the item/blocktype's own top-level `maxstacksize`; absent in the raw JSON for many items (engine-side default, not recoverable from JSON alone) -- never guessed
  tradesSelling: string[]; // TradeListing ids (direction "selling") -- traders who sell this item to the player
  tradesBuying: string[]; // TradeListing ids (direction "buying") -- traders who buy this item from the player
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
   * README). Undefined for everything else. A tapestry's *specific* chapter/name per placed
   * instance is not yet resolved -- see TODOS.md, needs further parsing of placement-time state. */
  relatedLoreBookId?: string;
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
}

/** One trader specialization's full buy/sell list. */
export interface TradeList {
  id: string; // specialization code, e.g. "artisan"
  domain: string;
  sourceMod: string;
  moneyAvg?: number;
  moneyVar?: number;
  selling: TradeListing[];
  buying: TradeListing[];
}

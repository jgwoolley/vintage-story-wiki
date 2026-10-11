export interface ModManifestEntry {
  modid: string;
  version?: string;
}

export interface VsManifest {
  serverBranch: string;
  serverVersion: string;
  mods: ModManifestEntry[];
}

export interface ModInfo {
  modid: string;
  name: string;
  version: string;
  side: string;
  authors?: string[];
  description?: string;
  dependencies?: Record<string, string>;
  hasCompiledCode: boolean;
  isVanilla: boolean;
}

/** One physical location assets can be loaded from: a domain folder belonging to a mod (or vanilla). */
export interface AssetSource {
  domain: string;
  modid: string;
  rootDir: string;
}

export interface LoadedAsset {
  domain: string;
  relPath: string; // e.g. "recipes/grid/anchor.json", no leading slash
  modid: string;
  sourceFile: string;
  json: unknown;
}

/** domain:relPath -> asset (last-loaded wins, matching the game engine's override behavior) */
export type AssetIndex = Map<string, LoadedAsset>;

export interface PatchOp {
  op: "add" | "remove" | "replace" | "addmerge" | string;
  path: string;
  value?: unknown;
  file: string;
  side?: "Server" | "Client" | "Universal";
  condition?: { when: string; isValue?: unknown; useValue?: boolean };
  dependsOn?: { modid: string; invert?: boolean }[];
  // provenance, attached by the loader, not read off the JSON
  __modid?: string;
  __sourceFile?: string;
  __domain?: string;
}

export interface Code {
  domain: string;
  code: string;
}

export interface IngredientSpec {
  type?: "item" | "block";
  code?: string;
  domain?: string;
  tags?: string[];
  quantity?: number;
  litres?: number;
  isTool?: boolean;
  toolDurabilityCost?: number;
  allowedVariants?: string[];
  name?: string;
  minratio?: number;
  maxratio?: number;
  minQuantity?: number;
  maxQuantity?: number;
  validStacks?: { type?: string; code?: string }[];
  [key: string]: unknown;
}

export interface OutputSpec {
  type?: "item" | "block";
  code?: string;
  domain?: string;
  quantity?: number;
  litres?: number;
  stacksize?: number;
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

export interface NormalizedRecipe {
  id: string;
  category: RecipeCategory;
  domain: string;
  sourceMod: string;
  name?: string;
  shapeless?: boolean;
  width?: number;
  height?: number;
  ingredients: IngredientSpec[];
  ingredientsBySlot?: Record<string, IngredientSpec>;
  /** Grid recipes can also carry a recipe-level `allowedVariants: {placeholder: [...]}` map (e.g.
   * {metal: [...], lining: [...]}), applying to every ingredient/output `{placeholder}` token at once,
   * independent of the single-ingredient `wildcard` mechanism above. */
  templateVariants?: Record<string, string[]>;
  output: OutputSpec;
  wildcard?: { placeholder: string; allowedVariants: string[] };
  sealHours?: number;
  raw: unknown;
}

export type LootMechanism = "blockDrop" | "panning" | "entityDrop" | "harvestable";

export interface EntityStats {
  tags: string[];
  weight?: number;
  sizeX?: number;
  sizeY?: number;
  maxHealth?: number;
}

export interface LootEntry {
  sourceKind: "block" | "entity";
  sourceDomain: string;
  sourceCode: string;
  sourceDisplayName: string;
  sourceMod: string;
  entityStats?: EntityStats;
  mechanism: LootMechanism;
  panningKeyPattern?: string;
  drop: {
    type?: string;
    domain: string;
    code: string;
    quantityAvg?: number;
    quantityVar?: number;
    chanceAvg?: number;
    chanceVar?: number;
    manMade?: boolean;
    dropModbyStat?: string;
  };
}

export type StructureKind = "structure" | "village" | "storystructure" | "hookgenerated";

export interface SchematicSummary {
  globPath: string;
  resolvedFiles: {
    path: string;
    sizeX?: number;
    sizeY?: number;
    sizeZ?: number;
    blockCodeCount?: number;
  }[];
  weight?: number;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface NormalizedStructure {
  id: string;
  kind: StructureKind;
  code: string;
  name?: string;
  domain: string;
  sourceMod: string;
  group?: string;
  chance?: number;
  placement?: string;
  minSpawnDistance?: number;
  minGroupDistance?: number;
  restrictions: Record<string, unknown>;
  schematics: SchematicSummary[];
  raw: unknown;
}

export interface ItemIndexEntry {
  domain: string;
  code: string;
  kind: "item" | "block";
  displayName: string;
  missingTranslation: boolean;
  sourceMod: string;
  producedBy: string[]; // recipe ids
  consumedBy: string[]; // recipe ids
  droppedBy: string[]; // loot entry indices (as strings)
  appearsInStructures: string[]; // structure ids
}

export type DecorKind = "painting" | "tapestry" | "clothing";

export interface DecorItem {
  id: string;
  kind: DecorKind;
  itemKind: "item" | "block";
  domain: string;
  code: string;
  displayName: string;
  description?: string;
  sourceMod: string;
  /** Structure ids whose schematics contain this block/item code (see structureContents.ts). */
  foundInStructures: string[];
}

export interface ModSummary {
  modid: string;
  name: string;
  version: string;
  side: string;
  hasCompiledCode: boolean;
  isVanilla: boolean;
}

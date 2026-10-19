// Search a Vintage Story schematic for a block or item: placed blocks, chiseled blocks made of it,
// stacks inside containers (chests, shelves, ground storage, ...) and `stackrandomizer-*` placeholders
// whose pool can turn into it. Pure (no DOM): the wiki's /tools/schematic-search/ page feeds it
// schematics it fetched and decompressed; tests feed it hand-built ones.
import { decodeBlockEntity } from "./schematicDecode.js";
import type { TreeAttributes } from "./schematicDecode.js";
import { decodeChiseledBlock, queryKeys, shapeKey } from "./chisel.js";
import type { ChiselShape, ShapeMatchOptions } from "./chisel.js";
import type { SchematicJson } from "./schematicVoxels.js";

/** `ItemIndexEntry.randomPool` as the page serves it: pool members of one randomizer, with normalized chance. */
export interface PoolMember {
  domain: string;
  code: string;
  kind: "item" | "block";
  chance: number;
}

/** randomizer `domain:code` -> what it can turn into. */
export type RandomizerPools = Record<string, PoolMember[]>;

export type TargetKind = "block" | "item" | "any";

export interface SearchTarget {
  /** Bare code (domain optional and ignored); `*` and `{...}` are wildcards. */
  code: string;
  kind: TargetKind;
}

const bareCode = (code: string): string => code.replace(/^[^:]+:/, "");

/** A case-insensitive matcher on the bare code; `*` (and `{...}`, a variant placeholder) match anything. */
export function codeMatcher(pattern: string): (code: string) => boolean {
  const source = bareCode(pattern.trim())
    .split(/\*|\{[^}]*\}/)
    .map((part) => part.replace(/[.+?^$()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${source}$`, "i");
  return (code) => re.test(bareCode(code));
}

/** Randomizer bare code -> total pool share (0-1) of the members matching `target`. */
export function matchingRandomizers(target: SearchTarget, pools: RandomizerPools): Map<string, number> {
  const matches = codeMatcher(target.code);
  const out = new Map<string, number>();
  for (const [randomizer, members] of Object.entries(pools)) {
    let share = 0;
    for (const m of members) {
      if (target.kind !== "any" && m.kind !== target.kind) continue;
      if (matches(m.code)) share += m.chance;
    }
    if (share > 0) out.set(bareCode(randomizer), share);
  }
  return out;
}

/**
 * Whether a schematic's code lists (`blockCodes` + `itemCodes` from schematics.json) mention the
 * target or a randomizer that can produce it. Exact as a prefilter: anything the scan can find
 * has to use a code from those dictionaries.
 */
export function mayContain(blockCodes: string[], itemCodes: string[], target: SearchTarget, randomizers: Map<string, number>): boolean {
  const matches = codeMatcher(target.code);
  const hit = (code: string) => matches(code) || randomizers.has(bareCode(code));
  return blockCodes.some(hit) || itemCodes.some(hit);
}

export interface ContainerHit {
  /** Block the entity sits on, e.g. `game:chest-east`. */
  block: string;
  x: number;
  y: number;
  z: number;
  /** Sum of the matching stacks' sizes. */
  count: number;
}

export interface RandomizerHit {
  /** The placeholder's bare code, e.g. `stackrandomizer-gear`. */
  randomizer: string;
  slots: number;
  /** The target's share of that randomizer's pool (0-1). */
  poolShare: number;
  /** The slots' own `totalChance` attributes (the placeholder's per-instance chance setting), when set. */
  totalChances: number[];
}

export interface SchematicMatch {
  /** Blocks placed in the schematic whose code matches. */
  placed: number;
  /** Chiseled blocks with at least one material matching. */
  chiseled: number;
  /** Container stacks that definitely hold it. */
  containers: ContainerHit[];
  /** Randomizer placeholders that might turn into it. */
  possible: RandomizerHit[];
}

export const hasMatch = (m: SchematicMatch): boolean => m.placed > 0 || m.chiseled > 0 || m.containers.length > 0 || m.possible.length > 0;

type ItemStack = { itemClass: "block" | "item"; id: number; stackSize: number; attributes?: TreeAttributes };

function isItemStack(value: unknown): value is ItemStack {
  const v = value as Partial<ItemStack> | null;
  return !!v && typeof v === "object" && (v.itemClass === "block" || v.itemClass === "item") && typeof v.id === "number";
}

/** Every item stack anywhere in a decoded entity (slots can nest under any container-specific key). */
function* itemStacks(value: unknown, depth = 0): Generator<ItemStack> {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (isItemStack(value)) {
    yield value;
    return;
  }
  for (const child of Object.values(value)) yield* itemStacks(child, depth + 1);
}

/**
 * Scan one schematic. `randomizers` comes from `matchingRandomizers`. Entities that fail to decode
 * are skipped and counted in `skippedEntities`.
 */
export function scanSchematic(
  schematic: SchematicJson & { ItemCodes?: Record<string, string> },
  target: SearchTarget,
  randomizers: Map<string, number>,
): SchematicMatch & { skippedEntities: number } {
  const matches = codeMatcher(target.code);
  const result: SchematicMatch & { skippedEntities: number } = { placed: 0, chiseled: 0, containers: [], possible: [], skippedEntities: 0 };
  const wantBlock = target.kind !== "item";
  const wantItem = target.kind !== "block";

  const blockMatchIds = new Set<string>();
  const blockOnBlock = (code: string | undefined) => !!code && matches(code);
  for (const [id, code] of Object.entries(schematic.BlockCodes)) if (blockOnBlock(code)) blockMatchIds.add(id);
  if (wantBlock && blockMatchIds.size) {
    for (const id of schematic.BlockIds) if (blockMatchIds.has(String(id))) result.placed++;
  }

  const byRandomizer = new Map<string, RandomizerHit>();
  const itemCodes = schematic.ItemCodes ?? {};
  for (const [key, entity] of Object.entries(schematic.BlockEntities ?? {})) {
    const ascii = typeof entity === "string" ? entity : (entity as { Data?: string; Attributes?: string })?.Data || (entity as { Attributes?: string })?.Attributes;
    if (!ascii) continue;
    let attrs: TreeAttributes;
    try {
      attrs = decodeBlockEntity(ascii);
    } catch {
      result.skippedEntities++;
      continue;
    }

    if (wantBlock) {
      const shape = decodeChiseledBlock(attrs, schematic.BlockCodes);
      if (shape?.materials.some(blockOnBlock)) result.chiseled++;
    }

    const packed = Number(key);
    let count = 0;
    for (const stack of itemStacks(attrs)) {
      const code = (stack.itemClass === "block" ? schematic.BlockCodes : itemCodes)[String(stack.id)];
      if (!code) continue;
      if (matches(code) && (stack.itemClass === "block" ? wantBlock : wantItem)) count += stack.stackSize || 1;
      const share = randomizers.get(bareCode(code));
      if (share !== undefined && stack.itemClass === "item") {
        const hit = byRandomizer.get(bareCode(code)) ?? { randomizer: bareCode(code), slots: 0, poolShare: share, totalChances: [] };
        hit.slots++;
        const total = stack.attributes?.totalChance;
        if (typeof total === "number") hit.totalChances.push(total);
        byRandomizer.set(hit.randomizer, hit);
      }
    }
    if (count > 0) {
      result.containers.push({
        block: typeof attrs.blockCode === "string" ? attrs.blockCode : (schematic.BlockCodes[String(blockIdAt(schematic, packed))] ?? "unknown"),
        x: packed & 0x3ff, z: (packed >> 10) & 0x3ff, y: (packed >> 20) & 0x3ff, count,
      });
    }
  }
  result.possible = [...byRandomizer.values()].sort((a, b) => b.slots - a.slots);
  return result;
}

// Built lazily: only entities that hit need the block they sit on, and Indices can hold a million entries.
const idByPosition = new WeakMap<object, Map<number, number>>();

function blockIdAt(schematic: SchematicJson, packed: number): number | undefined {
  let map = idByPosition.get(schematic);
  if (!map) {
    map = new Map(schematic.Indices.map((p, i) => [p, schematic.BlockIds[i]]));
    idByPosition.set(schematic, map);
  }
  return map.get(packed);
}

/** A chiseled-block search: the shape to find and how loosely to match it. */
export interface ChiselQuery {
  shape: ChiselShape;
  options: ShapeMatchOptions;
}

const CHISELED_BLOCK = /^(?:[^:]+:)?(?:microblock|chiseledblock)/i;

/**
 * Prefilter on schematics.json's code lists: the schematic must place a chiseled block and, when
 * materials matter, contain every block the shape is made of (a chiseled block's materials are keys of
 * the schematic's own BlockCodes).
 */
export function mayContainShape(blockCodes: string[], query: ChiselQuery): boolean {
  if (!blockCodes.some((c) => CHISELED_BLOCK.test(c))) return false;
  if (query.options.materials === "any") return true;
  const have = new Set(blockCodes.map(bareCode));
  const used = new Set(query.shape.cuboids.map((c) => bareCode(query.shape.materials[c.material] ?? "unknown")));
  return [...used].every((code) => have.has(code));
}

export interface ShapeHit {
  x: number;
  y: number;
  z: number;
  /** How the searched shape is oriented in this block ("as-is", "mirrored, turned 90°", ...). */
  orientation: string;
  /** The block's own name, when it has one. */
  name?: string;
}

/** Chiseled blocks in one schematic that are the searched shape (or, if allowed, a turned/mirrored copy). */
export function scanSchematicForShape(schematic: SchematicJson, query: ChiselQuery): { hits: ShapeHit[]; chiseledBlocks: number; skippedEntities: number } {
  const wanted = queryKeys(query.shape, query.options);
  const result = { hits: [] as ShapeHit[], chiseledBlocks: 0, skippedEntities: 0 };
  const memo = new Map<string, string | null>(); // many chiseled blocks in a schematic repeat exactly
  for (const [key, entity] of Object.entries(schematic.BlockEntities ?? {})) {
    const ascii = typeof entity === "string" ? entity : (entity as { Data?: string; Attributes?: string })?.Data || (entity as { Attributes?: string })?.Attributes;
    if (!ascii) continue;
    let shape: ChiselShape | null;
    try {
      shape = decodeChiseledBlock(decodeBlockEntity(ascii), schematic.BlockCodes);
    } catch {
      result.skippedEntities++;
      continue;
    }
    if (!shape) continue;
    result.chiseledBlocks++;
    const memoKey = `${shape.packed.join(",")}|${shape.materials.join(",")}`;
    let own = memo.get(memoKey);
    if (own === undefined) {
      own = shapeKey(shape, query.options.materials);
      memo.set(memoKey, own);
    }
    const orientation = own ? wanted.get(own) : undefined;
    if (orientation === undefined) continue;
    const packed = Number(key);
    result.hits.push({ x: packed & 0x3ff, z: (packed >> 10) & 0x3ff, y: (packed >> 20) & 0x3ff, orientation, name: shape.name });
  }
  return result;
}

/** Case-insensitive match on a chiseled block's name: a substring, or a glob when it contains `*`. */
export function nameMatcher(pattern: string): (name: string) => boolean {
  const text = pattern.trim();
  const source = text.includes("*")
    ? `^${text.split("*").map((part) => part.replace(/[.+?^$()|[\]\\{}]/g, "\\$&")).join(".*")}$`
    : text.replace(/[.+?^$()|[\]\\{}*]/g, "\\$&");
  const re = new RegExp(source, "i");
  return (name) => re.test(name);
}

export interface NameHit {
  x: number;
  y: number;
  z: number;
  name: string;
}

/** Prefilter for a name search: the schematic has to place chiseled blocks at all. */
export const mayContainChiseled = (blockCodes: string[]): boolean => blockCodes.some((c) => CHISELED_BLOCK.test(c));

/** Chiseled blocks in one schematic whose name matches (the name a player gave it with the chisel, or the one the game generated from its material). */
export function scanSchematicForName(schematic: SchematicJson, pattern: string): { hits: NameHit[]; skippedEntities: number } {
  const matches = nameMatcher(pattern);
  const result = { hits: [] as NameHit[], skippedEntities: 0 };
  for (const [key, entity] of Object.entries(schematic.BlockEntities ?? {})) {
    const ascii = typeof entity === "string" ? entity : (entity as { Data?: string; Attributes?: string })?.Data || (entity as { Attributes?: string })?.Attributes;
    if (!ascii) continue;
    try {
      const attrs = decodeBlockEntity(ascii);
      const name = attrs.blockName;
      if (typeof name !== "string" || !name || !Array.isArray(attrs.cuboids) || !matches(name)) continue;
      const packed = Number(key);
      result.hits.push({ x: packed & 0x3ff, z: (packed >> 10) & 0x3ff, y: (packed >> 20) & 0x3ff, name });
    } catch {
      result.skippedEntities++;
    }
  }
  return result;
}

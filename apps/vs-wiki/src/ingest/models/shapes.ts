import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { AssetIndex, ClutterType, ItemIndexEntry, LootSourceGroup, ModelRef } from "../types.js";
import { expandVariants, resolveByType, substitutePlaceholders, type ConcreteVariant } from "vs-wiki-core/variantExpander.js";
import { compactShape } from "vs-schematic/shapeBoxes.js";

/** Where the compacted, gzipped shape files are written; Eleventy copies this folder to `assets/models/` (see eleventy.config.js). */
export const MODEL_FILES_DIR = "apps/vs-wiki/site/_data/generated/modelFiles";

/** Where the shape files are served from, relative to the site root (matches the passthrough copy in eleventy.config.js). */
export const MODEL_ASSET_BASE = "assets/models/";

/** Path of a model's served file under `assets/models/`, e.g. "game/item/ingot.json.gz". */
export function modelAssetPath(ref: ModelRef): string {
  return `${ref.domain}/${ref.path}.json.gz`;
}

const CORE_DOMAINS = ["game", "survival", "creative"];

interface ShapeSpec {
  base?: unknown;
}

/** The shape a variant's JSON names (`shape`, or the best `shapeByType` match), with `{group}` placeholders filled in; undefined when it names none. */
function shapeBase(holder: Record<string, unknown> | undefined, variant: ConcreteVariant): string | undefined {
  if (!holder) return undefined;
  let spec: ShapeSpec | undefined;
  try {
    spec = resolveByType(holder.shapeByType as Record<string, ShapeSpec> | undefined, variant.code);
  } catch {
    // a few mod files key `shapeByType` with an invalid regex ("@*-(...)"); fall back to the flat `shape`
  }
  spec ??= holder.shape as ShapeSpec | undefined;
  const base = spec?.base;
  if (typeof base !== "string" || !base) return undefined;
  return substitutePlaceholders(base, variant.groupValues);
}

/**
 * Finds the loaded `shapes/<base>.json` a reference points at. A bare path is relative to the variant's own
 * domain, then the vanilla ones; a `domain:path` reference names its domain (vanilla domains alias each other, as in resolveFileRef).
 * Wildcard bases (`...*`, a random pick among several files) have no single file and resolve to nothing.
 */
function findShape(index: AssetIndex, base: string, fallbackDomain: string): { domain: string; path: string; json: unknown } | undefined {
  if (base.includes("*")) return undefined;
  const colon = base.indexOf(":");
  const domain = colon >= 0 ? base.slice(0, colon) : fallbackDomain;
  const path = (colon >= 0 ? base.slice(colon + 1) : base).replace(/\.json$/, "");
  const tryDomains = CORE_DOMAINS.includes(domain) ? CORE_DOMAINS : [domain];
  for (const d of tryDomains) {
    const asset = index.get(`${d}:shapes/${path}.json`);
    if (asset) return { domain: d, path, json: asset.json };
  }
  return undefined;
}

export interface ModelStats {
  items: number;
  creatures: number;
  clutter: number;
  files: number;
  bytes: number;
}

/** Resolves a shape reference to its file, writing each distinct shape once as a compacted, gzipped JSON file (see `compactShape`: geometry only). */
function createModelWriter(index: AssetIndex, outDir: string, stats: ModelStats): (base: string | undefined, fallbackDomain: string) => ModelRef | undefined {
  const written = new Map<string, number>(); // `domain:path` -> gz bytes, -1 for a shape with nothing to draw
  return (base, fallbackDomain) => {
    if (!base) return undefined;
    const found = findShape(index, base, fallbackDomain);
    if (!found) return undefined;
    const key = `${found.domain}:${found.path}`;
    if (!written.has(key)) {
      const compact = compactShape(found.json);
      if (!compact.elements.length) {
        written.set(key, -1);
      } else {
        const out = join(outDir, `${found.domain}/${found.path}.json.gz`);
        mkdirSync(dirname(out), { recursive: true });
        const gz = gzipSync(JSON.stringify(compact), { level: 9 });
        writeFileSync(out, gz);
        written.set(key, gz.length);
        stats.files++;
        stats.bytes += gz.length;
      }
    }
    const gzBytes = written.get(key)!;
    return gzBytes < 0 ? undefined : { domain: found.domain, path: found.path, gzBytes };
  };
}

/**
 * Gives every item and creature whose JSON names a shape a `model` reference, and writes each distinct shape
 * once (see `createModelWriter`). Items use `shape`/`shapeByType`; creatures use the same inside their `client`
 * block. Blocks are not covered (their shapes are mostly rotated variants of a handful of files and many are
 * drawn by the engine, not a shape file) -- except clutter, whose per-instance type picks the shape
 * (`attachClutterModels`).
 */
export function extractModels(index: AssetIndex, items: Map<string, ItemIndexEntry>, creatures: LootSourceGroup[], clutter: ClutterType[], outDir = MODEL_FILES_DIR): ModelStats {
  const stats: ModelStats = { items: 0, creatures: 0, clutter: 0, files: 0, bytes: 0 };
  const writeModel = createModelWriter(index, outDir, stats);
  const resolve = (base: string | undefined, variant: ConcreteVariant) => writeModel(base, variant.domain);

  for (const variant of expandVariants(index, ["itemtypes/"])) {
    const entry = items.get(`${variant.domain}:${variant.code}`);
    if (!entry || entry.kind !== "item") continue;
    const model = resolve(shapeBase(variant.json, variant), variant);
    if (model) {
      entry.model = model;
      stats.items++;
    }
  }

  const creaturesById = new Map(creatures.map((c) => [c.id, c]));
  for (const variant of expandVariants(index, ["entities/"])) {
    const creature = creaturesById.get(`${variant.domain}:${variant.code}`);
    if (!creature) continue;
    const model = resolve(shapeBase(variant.json.client as Record<string, unknown> | undefined, variant), variant);
    if (model) {
      creature.model = model;
      stats.creatures++;
    }
  }
  stats.clutter = attachClutterModels(index, clutter, writeModel);
  return stats;
}

/**
 * Clutter blocks (`BlockClutter`, a `ShapeFromAttributes` block) have no shape of their own: each placed block's `type`
 * attribute picks one entry of its blocktype's `attributes.types`, and BlockShapeFromAttributes.LoadTypes turns that entry
 * into a shape path -- `<shapeBasePath>/<code>` unless the entry has its own `shapePath` (relative to the same base, or
 * absolute under `shapes/` when it starts with "/"). Returns how many clutter types got a model.
 */
function attachClutterModels(index: AssetIndex, clutter: ClutterType[], writeModel: (base: string | undefined, fallbackDomain: string) => ModelRef | undefined): number {
  interface ClutterBlockJson {
    code?: string;
    attributes?: { shapeBasePath?: string; types?: { code?: string; shapePath?: string }[] };
  }
  const blocks = new Map<string, { domain: string; json: ClutterBlockJson }>();
  for (const asset of index.values()) {
    if (!asset.relPath.startsWith("blocktypes/")) continue;
    const json = asset.json as ClutterBlockJson;
    if (typeof json.code === "string" && json.code.startsWith("clutter") && Array.isArray(json.attributes?.types)) blocks.set(json.code, { domain: asset.domain, json });
  }
  let count = 0;
  for (const entry of clutter) {
    for (const blockCode of entry.blockCodes) {
      const block = blocks.get(blockCode.includes(":") ? blockCode.slice(blockCode.indexOf(":") + 1) : blockCode);
      const type = block?.json.attributes?.types?.find((t) => t.code === entry.type);
      if (!block || !type) continue;
      const basePath = (block.json.attributes?.shapeBasePath ?? "").replace(/\/+$/, "");
      const shapePath = type.shapePath ?? type.code!;
      const base = shapePath.startsWith("/") ? shapePath.slice(1) : `${basePath}/${shapePath}`;
      // The block's own domain first, then the domain the type was seen under (a mod patching its own types and shapes in).
      const bare = base.replace(/\.json$/, "");
      const model = writeModel(`${block.domain}:${bare}`, block.domain) ?? writeModel(`${entry.domain}:${bare}`, entry.domain);
      if (model) {
        entry.model = model;
        count++;
        break;
      }
    }
  }
  return count;
}

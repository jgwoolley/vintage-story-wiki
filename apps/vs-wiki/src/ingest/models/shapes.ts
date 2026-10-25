import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { AssetIndex, ItemIndexEntry, LootSourceGroup, ModelRef } from "../types.js";
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
  files: number;
  bytes: number;
}

/**
 * Gives every item and creature whose JSON names a shape a `model` reference, and writes each distinct shape
 * once as a compacted, gzipped JSON file (see `compactShape`: geometry only). Items use `shape`/`shapeByType`;
 * creatures use the same inside their `client` block. Blocks are not covered (their shapes are mostly rotated
 * variants of a handful of files and many are drawn by the engine, not a shape file).
 */
export function extractModels(index: AssetIndex, items: Map<string, ItemIndexEntry>, creatures: LootSourceGroup[], outDir = MODEL_FILES_DIR): ModelStats {
  const written = new Map<string, number>(); // `domain:path` -> gz bytes
  const stats: ModelStats = { items: 0, creatures: 0, files: 0, bytes: 0 };

  const resolve = (base: string | undefined, variant: ConcreteVariant): ModelRef | undefined => {
    if (!base) return undefined;
    const found = findShape(index, base, variant.domain);
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
  return stats;
}

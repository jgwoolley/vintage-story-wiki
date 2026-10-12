import type { AssetIndex, CreatureRosterEntry, EntitySpawnInfo, EntityStats, LootEntry } from "../types.js";
import type { LangResolver } from "../lang.js";
import { expandVariants, resolveByType, substitutePlaceholders } from "../variantExpander.js";
import { splitDomainCode } from "../codeUtil.js";

interface DropSpec {
  type?: string;
  code?: string;
  quantity?: { avg?: number; var?: number };
  chance?: { avg?: number; var?: number };
  manMade?: boolean;
  dropModbyStat?: string;
}

/** Pulls the handful of entity stats that are broadly useful on a wiki page: health, size,
 * weight, and behavior tags. `maxhealth` lives on the "health" entry of `server.behaviors`,
 * same `*ByType` glob-resolution mechanism used everywhere else for variant-specific values. */
// Spawn conditions come in two shapes: a flat `spawnconditions` object (fields may themselves be
// *ByType, e.g. bear-adult.json's `climate.minTempByType`), or a `spawnconditionsByType` map keyed
// by the exact concrete code (e.g. fox-adult.json), whose fields are already fully resolved.
// Either way, a given field might be a plain value (fox-style) or need its own *ByType lookup
// (bear-style climate), so every field read goes through this same two-step fallback.
function pickSpawnField(section: any, field: string, concreteCode: string): any {
  if (!section) return undefined;
  if (section[field] !== undefined) return section[field];
  return resolveByType(section[`${field}ByType`], concreteCode);
}

/** Whether an entity is a "living" thing at all (has the "health" server behavior) -- the signal
 * used to decide if a drop-less entity (a trader, villager, locust, ...) still belongs on
 * `/creatures/` (see `extractCreatureRoster`), as opposed to a non-creature utility entity (a
 * boat, thrown projectile, elevator, armor stand, ...) which never has one. */
function hasHealthBehavior(json: any): boolean {
  const behaviors: any[] = json.server?.behaviors ?? [];
  return behaviors.some((b) => String(b?.code ?? "").toLowerCase() === "health");
}

function extractEntitySpawnInfo(json: any, concreteCode: string): EntitySpawnInfo | undefined {
  const server = json.server ?? {};
  const sc = server.spawnconditions ?? resolveByType(server.spawnconditionsByType, concreteCode);
  if (!sc) return undefined;
  const worldgen = sc.worldgen ?? {};
  const runtime = sc.runtime ?? {};
  const climate = sc.climate ?? {};

  const habitatBlocks =
    pickSpawnField(worldgen, "insideBlockCodes", concreteCode) ?? pickSpawnField(runtime, "insideBlockCodes", concreteCode);

  return {
    minTemp: pickSpawnField(climate, "minTemp", concreteCode) ?? pickSpawnField(worldgen, "minTemp", concreteCode) ?? pickSpawnField(runtime, "minTemp", concreteCode),
    maxTemp: pickSpawnField(climate, "maxTemp", concreteCode) ?? pickSpawnField(worldgen, "maxTemp", concreteCode) ?? pickSpawnField(runtime, "maxTemp", concreteCode),
    minRain: pickSpawnField(climate, "minRain", concreteCode) ?? pickSpawnField(worldgen, "minRain", concreteCode) ?? pickSpawnField(runtime, "minRain", concreteCode),
    maxRain: pickSpawnField(climate, "maxRain", concreteCode) ?? pickSpawnField(worldgen, "maxRain", concreteCode) ?? pickSpawnField(runtime, "maxRain", concreteCode),
    minForest: pickSpawnField(climate, "minForest", concreteCode) ?? pickSpawnField(worldgen, "minForestOrShrubs", concreteCode),
    maxForest: pickSpawnField(climate, "maxForest", concreteCode) ?? pickSpawnField(worldgen, "maxForest", concreteCode),
    habitatBlocks: Array.isArray(habitatBlocks) ? habitatBlocks : undefined,
    chance: runtime.chance,
    group: runtime.group,
    triesPerChunk: worldgen.TriesPerChunk?.avg,
  };
}

function extractEntityStats(json: any, concreteCode: string): EntityStats {
  const behaviors: any[] = json.server?.behaviors ?? [];
  const healthBehavior = behaviors.find((b) => String(b?.code ?? "").toLowerCase() === "health");
  const maxHealth = healthBehavior ? resolveByType(healthBehavior.maxhealthByType, concreteCode) ?? healthBehavior.maxhealth : undefined;
  const weight = resolveByType(json.weightByType, concreteCode) ?? json.weight;
  const size = resolveByType(json.collisionBoxSizeByType, concreteCode) ?? json.collisionBoxSize;
  return {
    tags: Array.isArray(json.tags) ? json.tags : [],
    weight,
    sizeX: size?.x,
    sizeY: size?.y,
    maxHealth,
    spawn: extractEntitySpawnInfo(json, concreteCode),
  };
}

function toLootDrop(spec: DropSpec, fallbackDomain: string, groupValues: Record<string, string>) {
  const rawCode = substitutePlaceholders(spec.code ?? "", groupValues);
  const { domain, bareCode } = splitDomainCode(rawCode, fallbackDomain);
  return {
    type: spec.type,
    domain,
    code: bareCode,
    quantityAvg: spec.quantity?.avg,
    quantityVar: spec.quantity?.var,
    chanceAvg: spec.chance?.avg,
    chanceVar: spec.chance?.var,
    manMade: spec.manMade,
    dropModbyStat: spec.dropModbyStat,
  };
}

export function extractLoot(index: AssetIndex, lang: LangResolver): { loot: LootEntry[]; creatureRoster: CreatureRosterEntry[] } {
  const out: LootEntry[] = [];
  const creatureRoster: CreatureRosterEntry[] = [];

  // --- Block drops + panning drops ---
  const blockVariants = expandVariants(index, ["blocktypes/"]);
  for (const variant of blockVariants) {
    const json = variant.json as any;
    const sourceDisplayName = lang.displayName("block", variant.domain, variant.code).name;
    const drops: DropSpec[] = resolveByType(json.dropsByType, variant.code) ?? json.drops ?? [];
    for (const drop of drops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "block",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceDisplayName,
        sourceMod: variant.sourceModid,
        mechanism: "blockDrop",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }

    const panningDrops = json.attributes?.panningDrops as Record<string, DropSpec[]> | undefined;
    if (panningDrops) {
      for (const [pattern, entries] of Object.entries(panningDrops)) {
        for (const drop of entries) {
          if (!drop?.code) continue;
          out.push({
            sourceKind: "block",
            sourceDomain: variant.domain,
            sourceCode: variant.code,
            sourceDisplayName,
            sourceMod: variant.sourceModid,
            mechanism: "panning",
            panningKeyPattern: pattern,
            drop: toLootDrop(drop, variant.domain, variant.groupValues),
          });
        }
      }
    }
  }

  // --- Entity drops (death drops + harvestable behavior) ---
  const entityVariants = expandVariants(index, ["entities/"]);
  for (const variant of entityVariants) {
    const json = variant.json as any;
    const sourceDisplayName = lang.displayName("entity", variant.domain, variant.code).name;
    const entityStats = extractEntityStats(json, variant.code);

    if (hasHealthBehavior(json)) {
      creatureRoster.push({ domain: variant.domain, code: variant.code, sourceDisplayName, sourceMod: variant.sourceModid, entityStats });
    }

    // A real bug, fixed: this only ever read the flat `drops` array, same as block drops do --
    // but unlike the block-drop extraction above, it never fell back to the *ByType glob-keyed
    // form (confirmed real entities use it, e.g. locust.json's top-level `dropsByType`), so any
    // entity whose death drops vary by variant silently got none at all.
    const deathDrops: DropSpec[] = resolveByType(json.dropsByType, variant.code) ?? json.drops ?? [];
    for (const drop of deathDrops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "entity",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceDisplayName,
        sourceMod: variant.sourceModid,
        entityStats,
        mechanism: "entityDrop",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }

    const behaviors: any[] = json.server?.behaviors ?? [];
    const harvestable = behaviors.find(
      (b) => String(b?.code ?? b?.name ?? "").toLowerCase() === "harvestable"
    );
    // Same bug, same fix: the harvestable behavior's drops can likewise be glob-keyed
    // (`dropsByType`, confirmed on shiver/bowtorn/drifter) instead of a flat `drops` array.
    const harvestDrops: DropSpec[] = resolveByType(harvestable?.dropsByType, variant.code) ?? harvestable?.drops ?? [];
    for (const drop of harvestDrops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "entity",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceDisplayName,
        sourceMod: variant.sourceModid,
        entityStats,
        mechanism: "harvestable",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }
  }

  return { loot: out, creatureRoster };
}

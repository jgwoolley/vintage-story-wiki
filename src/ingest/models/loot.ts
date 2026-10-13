import type { AssetIndex, CodeRef, CreatureRosterEntry, CSharpRegistrationKind, EntitySpawnInfo, EntityStats, LootEntry } from "../types.js";
import type { LangResolver } from "../lang.js";
import { expandVariants, resolveByType, substitutePlaceholders } from "../variantExpander.js";
import { splitDomainCode } from "../codeUtil.js";
import { resolveCodeRef } from "../csharpRefs.js";

interface DropSpec {
  type?: string;
  code?: string;
  quantity?: { avg?: number; var?: number };
  chance?: { avg?: number; var?: number };
  manMade?: boolean;
  dropModbyStat?: string;
}

/** One entry of an `ItemStackRandomizer` item's `attributesByType["*-<variant>"].stacks` pool --
 * NOT a `DropSpec`: its `chance` is a flat relative weight (not a {avg,var} 0-1 probability), and
 * its `quantity` is its own {avg,var}, both independent of whatever drop table handed out the
 * container item itself. See the `LootMechanism` doc comment in types.ts. */
interface StackRandomizerStack {
  type?: string;
  code: string;
  domain: string;
  quantityAvg?: number;
  quantityVar?: number;
  weight: number;
}

/** Finds every `ItemStackRandomizer`-class itemtype (e.g. `survival/itemtypes/meta/
 * stackrandomizer.json`) and, for each of its concrete variants (via the same `expandVariants`
 * used for blocktypes/entities), resolves that variant's `attributesByType` (glob-keyed the same
 * way as every other `*ByType` field) down to its `stacks` pool. Keyed by `${domain}:${code}` --
 * e.g. "survival:stackrandomizer-alljonas" -- so a drop's own `${drop.domain}:${drop.code}` can
 * look itself up directly. */
function extractStackRandomizerPools(index: AssetIndex): Map<string, StackRandomizerStack[]> {
  const pools = new Map<string, StackRandomizerStack[]>();
  const itemVariants = expandVariants(index, ["itemtypes/"]);
  for (const variant of itemVariants) {
    const json = variant.json as any;
    if (String(json.class ?? "").toLowerCase() !== "itemstackrandomizer") continue;
    const attrs = resolveByType<any>(json.attributesByType, variant.code);
    const stacks: any[] = Array.isArray(attrs?.stacks) ? attrs.stacks : [];
    if (!stacks.length) continue;
    const normalized: StackRandomizerStack[] = [];
    for (const stack of stacks) {
      if (!stack?.code) continue;
      const { domain, bareCode } = splitDomainCode(String(stack.code), variant.domain);
      normalized.push({
        type: stack.type,
        domain,
        code: bareCode,
        quantityAvg: stack.quantity?.avg,
        quantityVar: stack.quantity?.var,
        weight: typeof stack.chance === "number" ? stack.chance : 1,
      });
    }
    if (normalized.length) pools.set(`${variant.domain}:${variant.code}`, normalized);
  }
  return pools;
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
 * boat, thrown projectile, elevator, armor stand, ...) which never has one. Exported for
 * `models/dialogue.ts`, which uses the same signal to decide whether a "conversable" entity is a
 * real NPC with a `/creatures/` page to cross-link to, as opposed to an inanimate "conversable"
 * lore prop (e.g. `skeletonarm`/`libraryresonator`, part of the Resonance Archive puzzle) that
 * never gets a creature page at all. */
export function hasHealthBehavior(json: any): boolean {
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

/** Highest `damageTier`/`projectileDamageTier` (plain or `*ByType`, resolved for `concreteCode`) found anywhere under `node` -- i.e. across every attack AI task. */
function maxDamageTier(node: any, concreteCode: string): number | undefined {
  let best: number | undefined;
  const visit = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    for (const field of ["damageTier", "projectileDamageTier"]) {
      const v = n[field] ?? resolveByType(n[`${field}ByType`], concreteCode);
      if (typeof v === "number" && (best === undefined || v > best)) best = v;
    }
    // `fooByType` maps hold the variant-specific version of `foo`; follow only this variant's pick.
    for (const [k, child] of Object.entries(n)) visit(k.endsWith("ByType") ? resolveByType(child as any, concreteCode) : child);
  };
  visit(node);
  return best;
}

/** The C# an entity's JSON names: its `class`, then every server/client behavior `code` and nested `aitasks[].code`, deduped by role+name. */
function extractEntityCodeRefs(json: any): CodeRef[] {
  const refs: CodeRef[] = [];
  const seen = new Set<string>();
  const add = (kinds: CSharpRegistrationKind[], role: CodeRef["role"], name: unknown): void => {
    if (typeof name !== "string" || !name || seen.has(`${role}:${name}`)) return;
    seen.add(`${role}:${name}`);
    refs.push(resolveCodeRef(kinds, role, name));
  };
  add(["entity"], "class", json.class);
  for (const side of [json.server, json.client]) {
    for (const b of Array.isArray(side?.behaviors) ? side.behaviors : []) {
      add(["entityBehavior"], "entityBehavior", b?.code);
      for (const task of Array.isArray(b?.aitasks) ? b.aitasks : []) add(["aiTask"], "aiTask", task?.code);
    }
  }
  return refs;
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
    damageTier: maxDamageTier(json.server?.behaviors, concreteCode),
    codeRefs: extractEntityCodeRefs(json),
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
  const stackRandomizerPools = extractStackRandomizerPools(index);

  // Pushes `entry` as-is (so a stackRandomizer "box" item, e.g. "stackrandomizer-alljonas",
  // still gets its own normal loot entry / `/items/` droppedBy link), then -- if `entry.drop`
  // itself resolves to a known `ItemStackRandomizer` pool -- also synthesizes one additional
  // `stackRandomizer` entry per pool content, weight-normalized within that pool. See the
  // `LootMechanism` doc comment in types.ts for why this is additive rather than a replacement.
  function pushDrop(entry: LootEntry): void {
    out.push(entry);
    const pool = stackRandomizerPools.get(`${entry.drop.domain}:${entry.drop.code}`);
    if (!pool || !pool.length) return;
    const totalWeight = pool.reduce((sum, stack) => sum + stack.weight, 0) || pool.length;
    for (const stack of pool) {
      out.push({
        sourceKind: entry.sourceKind,
        sourceDomain: entry.sourceDomain,
        sourceCode: entry.sourceCode,
        sourceDisplayName: entry.sourceDisplayName,
        sourceMod: entry.sourceMod,
        entityStats: entry.entityStats,
        mechanism: "stackRandomizer",
        stackRandomizerCode: `${entry.drop.domain}:${entry.drop.code}`,
        drop: {
          type: stack.type,
          domain: stack.domain,
          code: stack.code,
          quantityAvg: stack.quantityAvg,
          quantityVar: stack.quantityVar,
          chanceAvg: stack.weight / totalWeight,
        },
      });
    }
  }

  // --- Block drops + panning drops ---
  const blockVariants = expandVariants(index, ["blocktypes/"]);
  for (const variant of blockVariants) {
    const json = variant.json as any;
    const sourceDisplayName = lang.displayName("block", variant.domain, variant.code).name;
    const drops: DropSpec[] = resolveByType(json.dropsByType, variant.code) ?? json.drops ?? [];
    for (const drop of drops) {
      if (!drop?.code) continue;
      pushDrop({
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
          pushDrop({
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
      pushDrop({
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
      pushDrop({
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

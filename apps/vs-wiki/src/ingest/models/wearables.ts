import type { ArmorEntry, ArmorProtection, AssetIndex, RepairMaterial, WearableStats } from "../types.js";
import { expandVariants, resolveByType } from "vs-wiki-core/variantExpander.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { num, prop } from "./gear.js";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `attributes` with the glob-matched `attributesByType` entry laid over it, like the game's merge of the two. */
function attributesOf(json: Record<string, unknown>, code: string): Record<string, unknown> {
  const base = isObject(json.attributes) ? json.attributes : {};
  let byType: unknown;
  try {
    byType = resolveByType(json.attributesByType as Record<string, unknown> | undefined, code);
  } catch {
    // invalid-regex glob key in some file: ignore the override
  }
  return { ...base, ...(isObject(byType) ? byType : {}) };
}

const numberList = (v: unknown): number[] | undefined => (Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : undefined);

/**
 * Clothing and armor stats from `itemtypes/` variants that declare the `Wearable` behavior or a `clothescategory`: warmth,
 * armor protection/durability, rain protection and stat modifiers (see `WearableStats`). Variants with no stat at all are skipped.
 * `defaultProtLoss` (the armor file's per-tier loss defaults) fills in the per-tier losses an individual piece leaves out.
 */
export function extractWearables(index: AssetIndex): WearableStats[] {
  const out: WearableStats[] = [];
  for (const variant of expandVariants(index, ["itemtypes/"])) {
    const json = variant.json;
    const behaviors = Array.isArray(json.behaviors) ? (json.behaviors as { name?: string }[]) : [];
    const attrs = attributesOf(json, variant.code);
    const slot = prop(attrs, "clothescategory", variant.code);
    if (!behaviors.some((b) => b?.name === "Wearable") && typeof slot !== "string") continue;

    const stats: WearableStats = { id: `${variant.domain}:${variant.code}`, domain: variant.domain, code: variant.code, sourceMod: variant.sourceModid, groups: variant.groupValues };
    if (typeof slot === "string") stats.slot = slot;
    const warmth = num(prop(attrs, "warmth", variant.code));
    if (warmth) stats.warmth = warmth;
    const durability = num(prop(json, "durability", variant.code));
    if (durability) stats.durability = durability;
    const rain = num(prop(attrs, "rainProtectionPerc", variant.code));
    if (rain) stats.rainProtection = rain;

    const prot = prop(attrs, "protectionModifiers", variant.code);
    if (isObject(prot)) {
      const defaults = prop(attrs, "defaultProtLoss", variant.code);
      const protection: ArmorProtection = { protectionTier: num(prot.protectionTier) ?? 0 };
      const relative = num(prot.relativeProtection);
      const flat = num(prot.flatDamageReduction);
      if (relative !== undefined) protection.relativeProtection = relative;
      if (flat !== undefined) protection.flatDamageReduction = flat;
      const relativeLoss = numberList(prot.perTierRelativeProtectionLoss) ?? numberList(isObject(defaults) ? defaults.perTierRelativeProtectionLoss : undefined);
      const flatLoss = numberList(prot.perTierFlatDamageReductionLoss) ?? numberList(isObject(defaults) ? defaults.perTierFlatDamageReductionLoss : undefined);
      if (relativeLoss) protection.perTierRelativeProtectionLoss = relativeLoss;
      if (flatLoss) protection.perTierFlatDamageReductionLoss = flatLoss;
      if (prot.highDamageTierResistant === true) protection.highDamageTierResistant = true;
      stats.protection = protection;
    }

    const mods = prop(attrs, "statModifiers", variant.code);
    if (isObject(mods)) {
      const numeric = Object.fromEntries(Object.entries(mods).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] !== 0));
      if (Object.keys(numeric).length) stats.statModifiers = numeric;
    }

    if (stats.warmth || stats.durability || stats.rainProtection || stats.protection || stats.statModifiers) out.push(stats);
  }
  return out;
}

/** Everything that repairs worn clothing: items and blocks carrying `attributes.clothingRepairStrength` (twine, linen, sewing kit...). */
export function extractRepairMaterials(index: AssetIndex): RepairMaterial[] {
  const out: RepairMaterial[] = [];
  for (const [kind, prefix] of [["item", "itemtypes/"], ["block", "blocktypes/"]] as const) {
    for (const variant of expandVariants(index, [prefix])) {
      const strength = num(prop(attributesOf(variant.json, variant.code), "clothingRepairStrength", variant.code));
      if (strength) out.push({ domain: variant.domain, code: variant.code, kind, strength });
    }
  }
  // Collapse families (14 cloth colors, 24 linen sheet orientations) into one wildcard row each: `cloth-*`.
  const grouped = new Map<string, RepairMaterial & { count: number }>();
  for (const m of out) {
    const family = m.code.split("-")[0];
    const key = `${m.domain}:${m.kind}:${family}:${m.strength}`;
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { ...m, count: 1 });
  }
  return [...grouped.values()]
    .map(({ count, ...m }) => (count > 1 ? { ...m, code: `${m.code.split("-")[0]}-*` } : m))
    .sort((a, b) => b.strength - a.strength || a.code.localeCompare(b.code));
}

/** The armor rows (wearables with a protection value), named through the lang files, best protected first within each slot. */
export function extractArmor(wearables: WearableStats[], lang: LangResolver): ArmorEntry[] {
  return wearables
    .filter((w): w is WearableStats & { protection: ArmorProtection } => !!w.protection)
    .map((w) => {
      const { name, missing } = lang.displayName("item", w.domain, w.code);
      return { ...w, displayName: name, missingTranslation: missing };
    })
    .sort((a, b) => (a.slot ?? "").localeCompare(b.slot ?? "") || b.protection.protectionTier - a.protection.protectionTier || a.displayName.localeCompare(b.displayName));
}

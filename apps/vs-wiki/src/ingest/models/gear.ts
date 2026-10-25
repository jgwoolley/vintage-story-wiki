import type { AssetIndex, GearEntry } from "../types.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { expandVariants, resolveByType } from "vs-wiki-core/variantExpander.js";

/**
 * Case-insensitive property read with the engine's `<name>ByType` glob fallback: game JSON mixes
 * `attackpowerbytype`, `damageByType` and `attackRange` freely (VS reads them case-insensitively),
 * so this finds `name` or `name + "ByType"` in whatever casing the file used and resolves the latter
 * against the concrete variant code (most specific glob wins, see `resolveByType`).
 */
export function prop(obj: unknown, name: string, concreteCode: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const wanted = name.toLowerCase();
  let byType: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (k === wanted) return value;
    if (k === `${wanted}bytype` && value && typeof value === "object") byType = value as Record<string, unknown>;
  }
  return byType ? resolveByType(byType, concreteCode) : undefined;
}

export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Weapons, tools and ammo with combat/durability stats, read from `itemtypes/` variants: anything
 * with a `tool` type, an `attackpower`, or an `attributes.damage`/`damageTier` (ranged weapons and
 * ammo keep their damage under `attributes`) *and* at least one numeric stat to show. Stats are
 * resolved per concrete variant (e.g. `spear-generic-copper`), since nearly all of them are `*ByType`.
 */
export function extractGear(index: AssetIndex, lang: LangResolver): GearEntry[] {
  const out: GearEntry[] = [];

  for (const variant of expandVariants(index, ["itemtypes/"])) {
    const json = variant.json;
    const attrs = json.attributes;
    const code = variant.code;
    const toolType = prop(json, "tool", code);
    const tags = Array.isArray(json.tags) ? (json.tags as string[]) : [];

    const durability = num(prop(json, "durability", code));
    const attackPower = num(prop(json, "attackpower", code));
    const attackRange = num(prop(json, "attackRange", code));
    const toolTier = num(prop(json, "tooltier", code));
    const damage = num(prop(attrs, "damage", code));
    const damageTier = num(prop(attrs, "damageTier", code)) ?? num(prop(json, "damageTier", code));
    const speeds = prop(json, "miningspeed", code);
    const speedValues = speeds && typeof speeds === "object" ? Object.values(speeds as Record<string, unknown>).filter((v): v is number => typeof v === "number") : [];
    const bestMiningSpeed = speedValues.length ? Math.max(...speedValues) : undefined;

    const looksLikeGear = typeof toolType === "string" || attackPower !== undefined || damage !== undefined || damageTier !== undefined || tags.includes("tool") || tags.includes("weapon");
    const hasStat = [durability, attackPower, toolTier, damage, bestMiningSpeed].some((v) => v !== undefined);
    if (!looksLikeGear || !hasStat) continue;

    const category: GearEntry["category"] = tags.includes("weapon-melee") || (tags.includes("weapon") && damage === undefined)
      ? "melee weapon"
      : typeof toolType === "string" && damage !== undefined
        ? "ranged weapon"
        : damage !== undefined
          ? "ammo"
          : "tool";

    const { name, missing } = lang.displayName("item", variant.domain, code);
    out.push({
      id: `${variant.domain}:${code}`,
      domain: variant.domain,
      code,
      sourceMod: variant.sourceModid,
      displayName: name,
      missingTranslation: missing,
      type: variant.baseCode,
      category,
      durability,
      attackPower,
      attackRange,
      toolTier,
      damageTier,
      damage,
      bestMiningSpeed,
    });
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

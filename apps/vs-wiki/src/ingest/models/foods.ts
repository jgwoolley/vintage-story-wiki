import type { AssetIndex, FoodEntry } from "../types.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { expandVariants, resolveByType } from "vs-wiki-core/variantExpander.js";

/** Case-insensitive property read with the `<name>ByType` glob fallback (same idea as `prop` in gear.ts). */
function prop(obj: Record<string, unknown>, name: string, concreteCode: string): unknown {
  const wanted = name.toLowerCase();
  let byType: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (k === wanted) return value;
    if (k === `${wanted}bytype` && value && typeof value === "object") byType = value as Record<string, unknown>;
  }
  return byType ? resolveByType(byType, concreteCode) : undefined;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const record = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/**
 * Everything with `nutritionProps` (a satiety value and food category) per concrete variant. The
 * `*PerLitre` liquid forms (milk, juice, ...) are a different mechanic -- nutrition scales with the
 * portion's volume -- and are not listed.
 */
export function extractFoods(index: AssetIndex, lang: LangResolver): FoodEntry[] {
  const out: FoodEntry[] = [];
  for (const [prefix, kind] of [["itemtypes/", "item"], ["blocktypes/", "block"]] as const) {
    for (const variant of expandVariants(index, [prefix])) {
      const code = variant.code;
      // A mushroom block has a variant per facing and per picked state; only one standing, north-facing row is the food.
      if (kind === "block" && /-harvested(-|$)|-(east|south|west)$/.test(code)) continue;
      const props = record(prop(variant.json, "nutritionProps", code));
      const satiety = num(props?.satiety);
      if (!props || satiety === undefined || typeof props.foodcategory !== "string" || props.foodcategory === "NoNutrition") continue;
      const inMeal = num(record(prop(variant.json, "nutritionPropsWhenInMeal", code))?.satiety);
      const health = num(props.health);
      const { name, missing } = lang.displayName(kind, variant.domain, code);
      out.push({
        id: `${variant.domain}:${code}`,
        domain: variant.domain,
        code,
        kind,
        sourceMod: variant.sourceModid,
        displayName: name,
        missingTranslation: missing,
        type: variant.baseCode,
        satiety,
        health: health ?? 0, // 0 when the game sets none, so the column sorts as numbers
        foodCategory: props.foodcategory[0].toUpperCase() + props.foodcategory.slice(1), // files write both "Vegetable" and "vegetable"; the game parses it case-insensitively
        mealSatiety: inMeal !== undefined && inMeal !== satiety ? inMeal : undefined,
      });
    }
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

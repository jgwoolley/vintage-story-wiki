import type { AssetIndex, IngredientSpec, NormalizedRecipe, OutputSpec, RecipeCategory } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { splitDomainCode } from "../codeUtil.js";

const CATEGORY_PREFIX: Record<RecipeCategory, string> = {
  grid: "recipes/grid/",
  smithing: "recipes/smithing/",
  clayforming: "recipes/clayforming/",
  knapping: "recipes/knapping/",
  alloy: "recipes/alloy/",
  barrel: "recipes/barrel/",
  cooking: "recipes/cooking/",
};

function normalizeIngredientCode(spec: IngredientSpec, fallbackDomain: string): IngredientSpec {
  if (typeof spec.code === "string") {
    const { domain, bareCode } = splitDomainCode(spec.code, fallbackDomain);
    return { ...spec, domain, code: bareCode };
  }
  return spec;
}

function normalizeOutputCode(spec: OutputSpec, fallbackDomain: string): OutputSpec {
  if (typeof spec.code === "string") {
    const { domain, bareCode } = splitDomainCode(spec.code, fallbackDomain);
    return { ...spec, domain, code: bareCode };
  }
  return spec;
}

function findWildcard(ingredients: IngredientSpec[]): NormalizedRecipe["wildcard"] {
  for (const ing of ingredients) {
    if (typeof ing.code === "string" && ing.code.includes("*") && Array.isArray(ing.allowedVariants)) {
      return { placeholder: (ing.name as string) ?? "variant", allowedVariants: ing.allowedVariants };
    }
  }
  return undefined;
}

function parseGrid(raw: any, domain: string): Partial<NormalizedRecipe> {
  const ingredientsMap = (raw.ingredients ?? {}) as Record<string, IngredientSpec>;
  const ingredients = Object.entries(ingredientsMap).map(([slotKey, spec]) => ({
    ...normalizeIngredientCode(spec, domain),
    slotKey,
  }));
  const ingredientsBySlot = Object.fromEntries(ingredients.map((ing) => [ing.slotKey as string, ing]));
  const rows = String(raw.ingredientPattern ?? "").split(",");
  const templateVariants =
    raw.allowedVariants && !Array.isArray(raw.allowedVariants) ? (raw.allowedVariants as Record<string, string[]>) : undefined;
  return {
    name: raw.name,
    shapeless: raw.shapeless,
    width: raw.width ?? rows[0]?.length,
    height: raw.height ?? rows.length,
    ingredients,
    ingredientsBySlot,
    templateVariants,
    output: normalizeOutputCode(raw.output ?? {}, domain),
    wildcard: findWildcard(ingredients),
  };
}

function parseVoxelShaped(raw: any, domain: string): Partial<NormalizedRecipe> {
  // smithing / clayforming / knapping: single `ingredient`, `pattern` as layers of row-strings.
  const ingredient = normalizeIngredientCode(raw.ingredient ?? {}, domain);
  return {
    name: raw.name,
    ingredients: [ingredient],
    output: normalizeOutputCode(raw.output ?? {}, domain),
    wildcard: findWildcard([ingredient]),
  };
}

function parseAlloy(raw: any, domain: string): Partial<NormalizedRecipe> {
  const ingredients = ((raw.ingredients ?? []) as IngredientSpec[]).map((i) => normalizeIngredientCode(i, domain));
  return {
    ingredients,
    output: normalizeOutputCode(raw.output ?? {}, domain),
  };
}

function parseBarrel(raw: any, domain: string): Partial<NormalizedRecipe> {
  const ingredients = ((raw.ingredients ?? []) as IngredientSpec[]).map((i) => normalizeIngredientCode(i, domain));
  return {
    name: raw.code,
    sealHours: raw.sealHours,
    ingredients,
    output: normalizeOutputCode(raw.output ?? {}, domain),
    wildcard: findWildcard(ingredients),
  };
}

function parseCooking(raw: any, domain: string): Partial<NormalizedRecipe> {
  // `code` on a cooking ingredient is a slot label (e.g. "crushed chromite"), not an item code --
  // the actual item code(s) live in `validStacks`. Omit `code` so crossref doesn't mistake it for one.
  const ingredients = ((raw.ingredients ?? []) as any[]).map(({ code, ...rest }) => ({
    ...rest,
    slotKey: code,
    validStacks: (rest.validStacks ?? []).map((v: any) =>
      typeof v.code === "string" ? { ...v, ...normalizeIngredientCode(v, domain) } : v
    ),
  })) as IngredientSpec[];
  return {
    name: raw.code,
    ingredients,
    output: normalizeOutputCode(raw.cooksInto ?? {}, domain),
  };
}

const PARSERS: Record<RecipeCategory, (raw: any, domain: string) => Partial<NormalizedRecipe>> = {
  grid: parseGrid,
  smithing: parseVoxelShaped,
  clayforming: parseVoxelShaped,
  knapping: parseVoxelShaped,
  alloy: parseAlloy,
  barrel: parseBarrel,
  cooking: parseCooking,
};

export function extractRecipes(index: AssetIndex): NormalizedRecipe[] {
  const out: NormalizedRecipe[] = [];

  for (const category of Object.keys(CATEGORY_PREFIX) as RecipeCategory[]) {
    const prefix = CATEGORY_PREFIX[category];
    const assets = assetsUnderAnyDomain(index, prefix);
    for (const asset of assets) {
      const entries = Array.isArray(asset.json) ? asset.json : [asset.json];
      entries.forEach((entry, i) => {
        if (entry == null || entry.enabled === false) return;
        const parsed = PARSERS[category](entry, asset.domain);
        out.push({
          id: `${asset.domain}:${category}/${asset.relPath}#${i}`,
          category,
          domain: asset.domain,
          sourceMod: asset.modid,
          raw: entry,
          ingredients: [],
          output: {},
          ...parsed,
        });
      });
    }
  }

  return out;
}

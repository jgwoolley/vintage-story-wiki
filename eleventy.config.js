export default function (eleventyConfig) {
  eleventyConfig.addFilter("slugify", (str) =>
    String(str ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );

  eleventyConfig.addFilter("displayName", (items, domain, code) => {
    const item = items.find((i) => i.domain === domain && i.code === code);
    return item ? item.displayName : code;
  });

  // Turns a wildcard/placeholder ingredient code (e.g. "leather-normal-*", "plank-{wood}") into a
  // plain substring usable as an /items/ search query, by dropping the "*"/"{...}" parts.
  eleventyConfig.addFilter("wildcardQuery", (code) => String(code ?? "").replace(/\{[^}]*\}/g, "").replace(/\*/g, ""));

  eleventyConfig.addFilter("round", (n, digits = 3) => (typeof n === "number" ? Number(n.toFixed(digits)) : n));

  eleventyConfig.addFilter("percent", (n) => (typeof n === "number" ? `${(n * 100).toFixed(2)}%` : n));

  eleventyConfig.addFilter("json", (val) => JSON.stringify(val, null, 2));

  // When a recipe has a wildcard ingredient/output (e.g. ingredient "ingot-*" -> output
  // "arrowhead-{metal}"), the generic recipe summary is less useful on a specific item's page
  // than showing the exact variant relevant there -- e.g. "Copper ingot -> Arrowhead (copper)"
  // instead of "ingot-* -> arrowhead-{metal}". Finds the allowedVariants value that makes the
  // substituted recipe mention (domain, code), and returns a copy of the recipe with every
  // ingredient/output code resolved to that variant; returns the recipe unchanged otherwise.
  eleventyConfig.addFilter("contextualRecipe", (recipe, domain, code) => {
    if (!recipe.wildcard) return recipe;
    const { placeholder, allowedVariants } = recipe.wildcard;
    for (const variant of allowedVariants) {
      const substitute = (s) => (typeof s === "string" ? s.replace(new RegExp(`\\{${placeholder}\\}`, "g"), variant) : s);
      const subIngredients = recipe.ingredients.map((ing) =>
        typeof ing.code === "string" && ing.code.includes("*") ? { ...ing, code: ing.code.replace("*", variant) } : { ...ing, code: substitute(ing.code) }
      );
      const outCode = substitute(recipe.output.code);
      const matches =
        subIngredients.some((ing) => ing.domain === domain && ing.code === code) || (recipe.output.domain === domain && outCode === code);
      if (matches) return { ...recipe, ingredients: subIngredients, output: { ...recipe.output, code: outCode } };
    }
    return recipe;
  });

  eleventyConfig.addPassthroughCopy("site/assets");

  return {
    dir: {
      input: "site",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
}

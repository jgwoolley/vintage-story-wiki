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

  eleventyConfig.addFilter("findById", (list, id) => list.find((x) => x.id === id));

  // Turns a wildcard/placeholder ingredient code (e.g. "leather-normal-*", "plank-{wood}") into a
  // plain substring usable as an /items/ search query, by dropping the "*"/"{...}" parts.
  eleventyConfig.addFilter("wildcardQuery", (code) => String(code ?? "").replace(/\{[^}]*\}/g, "").replace(/\*/g, ""));

  eleventyConfig.addFilter("round", (n, digits = 3) => (typeof n === "number" ? Number(n.toFixed(digits)) : n));

  eleventyConfig.addFilter("percent", (n) => (typeof n === "number" ? `${(n * 100).toFixed(2)}%` : n));

  eleventyConfig.addFilter("json", (val) => JSON.stringify(val, null, 2));

  // Plain-English explanations for the worldgen restriction fields that show up raw in
  // structures.json/storystructures.json/villages.json -- these are otherwise cryptic
  // PascalCase/camelCase keys with no in-game documentation.
  const RESTRICTION_GLOSSARY = {
    minTemp: "Only generates where the chunk's yearly-average temperature is at or above this value (°C).",
    maxTemp: "Only generates where the chunk's yearly-average temperature is at or below this value (°C).",
    minRain: "Only generates where the chunk's rainfall value is at or above this (0-1 scale).",
    maxRain: "Only generates where the chunk's rainfall value is at or below this (0-1 scale).",
    minForestDensity: "Only generates where local forest density is at or above this (0-1 scale).",
    maxForestDensity: "Only generates where local forest density is at or below this (0-1 scale).",
    requireLandform: "Only generates on/in a landform matching this name (e.g. \"cold glaciers\").",
    landformRadius: "How far around the structure, in blocks, the required landform must extend.",
    forceTemperature: "Overrides the local climate reading for this structure's own placement logic, regardless of the world's actual temperature there.",
    MaxBelowSealevel: "Maximum depth below sea level, in blocks, this structure may be placed at.",
    maxYDiff: "Maximum terrain height variation allowed under the structure's footprint (keeps it off very uneven ground).",
    dependsOnStructure: "Only generates at a fixed position relative to another named structure (usually \"spawn\").",
    minSpawnDistX: "Minimum X-axis distance from spawn, in blocks (used with the Z bounds below for a rectangular band instead of a simple radius).",
    maxSpawnDistX: "Maximum X-axis distance from spawn, in blocks.",
    minSpawnDistZ: "Minimum Z-axis distance from spawn, in blocks.",
    maxSpawnDistZ: "Maximum Z-axis distance from spawn, in blocks.",
    chance: "Probability this structure is attempted at a given candidate location, before any global frequency multiplier from world-creation settings.",
    placement: "Where this structure is anchored: on the terrain surface, buried underground, or a specific ruin/story layer.",
    minSpawnDistance: "Minimum distance from the world spawn point, in blocks, before this structure is allowed to generate at all.",
    minGroupDistance: "Minimum distance enforced between two instances of this same structure, in blocks, so copies don't generate too close together.",
  };
  eleventyConfig.addFilter("restrictionLabel", (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()));
  eleventyConfig.addFilter("restrictionInfo", (key) => RESTRICTION_GLOSSARY[key]);

  // Lore/description text is trusted static game content that mixes plain newlines with real
  // inline HTML (<strong>, <font color="...">) -- so it's rendered with `| safe` after this,
  // unlike nunjucks' built-in nl2br which escapes everything first.
  eleventyConfig.addFilter("lineBreaks", (text) => String(text ?? "").replace(/\r\n|\n/g, "<br>"));

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
    // GitHub Pages project sites (the common case: no custom domain) serve from
    // https://<user>.github.io/<repo>/, not the domain root -- every internal href/src in the
    // templates goes through the `{{ '/' | url }}` + relative-path idiom specifically so this one
    // setting (via PATH_PREFIX, set by CI to "/<repo>/") fixes every link/asset at once instead of
    // hardcoding the repo name into the templates themselves. Defaults to "/" for local dev.
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: {
      input: "site",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
}

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true });

function resolveCommitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function resolveRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY; // "owner/repo", set automatically in Actions
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    // Handles both "git@github.com:owner/repo.git" and "https://github.com/owner/repo.git".
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export default function (eleventyConfig) {
  // The commit this build was generated from, and when -- rendered in the footer (base.njk) and
  // linked to the actual commit on GitHub. GITHUB_SHA/GITHUB_REPOSITORY are set automatically by
  // every Actions run, so this needs no extra CI configuration; local builds fall back to the
  // working tree's own git state.
  eleventyConfig.addGlobalData("buildInfo", () => {
    const commitSha = resolveCommitSha();
    const repoSlug = resolveRepoSlug();
    return {
      utcIso: new Date().toISOString(),
      commitSha,
      commitUrl: commitSha && repoSlug ? `https://github.com/${repoSlug}/commit/${commitSha}` : undefined,
    };
  });

  // Renders README.md fresh on every build so the Info page (site/info.njk) always matches the
  // repo's actual README -- one source of truth, no manual copy to keep in sync.
  eleventyConfig.addGlobalData("readmeHtml", () => md.render(readFileSync("README.md", "utf8")));

  // Lets CI provide the real deployed origin (e.g. "https://<user>.github.io") for building
  // absolute Open Graph/Twitter image URLs, which unlike internal links are supposed to be
  // absolute per spec. Empty string (default) means og:image falls back to a relative path --
  // fine for local dev, where there's no stable "real" origin to point to anyway.
  eleventyConfig.addGlobalData("siteUrl", () => process.env.SITE_URL || "");

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

  // Several recipe categories (alloy, barrel, cooking, knapping, smithing, clayforming) never
  // carry an explicit `name` -- without this, templates fell back to showing the raw OUTPUT CODE
  // (e.g. "ingot-electrum") as if it were the recipe's title, which looks exactly like a missing
  // item translation even though the item itself ("Electrum ingot") is fully localized. Labeling
  // it as a recipe, using the item's real name, makes the distinction obvious instead.
  eleventyConfig.addFilter("recipeTitle", (recipe, items) => {
    if (recipe.name) return recipe.name;
    const out = recipe.output;
    if (out?.code && !out.code.includes("*") && !out.code.includes("{")) {
      const item = items.find((i) => i.domain === out.domain && i.code === out.code);
      if (item) return `${item.displayName} (Item Recipe)`;
    }
    return `${recipe.category} recipe`;
  });

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

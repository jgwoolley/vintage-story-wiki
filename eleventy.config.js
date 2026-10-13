import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";
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

// GITHUB_HEAD_REF is only set for pull_request-triggered runs, and is the PR's actual source
// branch; GITHUB_REF_NAME is set for every trigger but on a PR run is the synthetic merge ref
// ("42/merge"), not a real branch name -- prefer HEAD_REF when present. Local (non-CI) builds
// fall back to the working tree's current branch.
function resolveBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

// Subject line + author of the resolved commit, read via `git log` rather than any GitHub env var
// (Actions doesn't expose the commit message/author directly) -- works the same whether `sha`
// came from GITHUB_SHA (CI) or the local git fallback, since actions/checkout always leaves that
// exact commit checked out. \x1f (unit separator) is used as the field delimiter since it can't
// appear in a normal commit subject/author, so no escaping is needed to split it back apart.
// execFileSync (not execSync) avoids ever shell-interpolating `sha`, which can come from an
// externally-set env var (GITHUB_SHA).
function resolveCommitDetails(sha) {
  if (!sha) return {};
  try {
    const raw = execFileSync("git", ["log", "-1", "--format=%s\x1f%an\x1f%ae", sha], { encoding: "utf8" }).trim();
    const [commitMessage, commitAuthor, commitAuthorEmail] = raw.split("\x1f");
    return { commitMessage, commitAuthor, commitAuthorEmail };
  } catch {
    return {};
  }
}

export default function (eleventyConfig) {
  // The commit this build was generated from, and when -- the footer (base.njk) shows a short
  // relative-time summary that now links to the site's own `/<lang>/build/` page (site/build/
  // index.njk) rather than straight to GitHub, since that page is where the full resolved detail
  // (repo/branch/commit/CI run, plus pipeline timings) actually lives.
  //
  // `isCi` distinguishes a real GitHub Actions run from a local `npm run build` -- GITHUB_ACTIONS
  // is set to the literal string "true" on every Actions runner and never set locally. CI-only
  // facts (the Actions run link) are simply absent on a local build; commit/branch/repo are still
  // resolved from the working tree's own git state where possible, since they're useful in local
  // dev too, but the page makes clear they're not describing a CI run when `isCi` is false.
  eleventyConfig.addGlobalData("buildInfo", () => {
    const isCi = process.env.GITHUB_ACTIONS === "true";
    const commitSha = resolveCommitSha();
    const repoSlug = resolveRepoSlug();
    const branch = resolveBranch();
    const { commitMessage, commitAuthor, commitAuthorEmail } = resolveCommitDetails(commitSha);
    const runId = process.env.GITHUB_RUN_ID;
    return {
      utcIso: new Date().toISOString(),
      isCi,
      repoSlug,
      branch,
      commitSha,
      commitShortSha: commitSha ? commitSha.slice(0, 7) : undefined,
      commitMessage,
      commitAuthor,
      commitAuthorEmail,
      commitUrl: commitSha && repoSlug ? `https://github.com/${repoSlug}/commit/${commitSha}` : undefined,
      runId,
      // Only meaningful for an actual Actions run -- a local build has no run id to link to even
      // though it might still resolve a repoSlug (e.g. from `git remote`).
      runUrl: isCi && runId && repoSlug ? `https://github.com/${repoSlug}/actions/runs/${runId}` : undefined,
    };
  });

  // The Info page (site/info.njk) renders INFO.md, which is written for wiki *visitors* (why this
  // exists, how to use it). README.md is written for *contributors/maintainers* instead -- it has
  // its own full pipeline/architecture writeup, which would be overwhelming reading for someone
  // who just wants to look up a crafting recipe. Keep them as two separate files, not variants of
  // the same text.
  eleventyConfig.addGlobalData("infoHtml", () => md.render(readFileSync("INFO.md", "utf8")));

  // The Research page (site/research/index.njk) renders RESEARCH.md the same way -- a hand-written
  // investigation doc (no code implemented, per its own header) kept at the repo root like
  // README.md/CLAUDE.md/INFO.md, published so it's actually readable without cloning the repo.
  eleventyConfig.addGlobalData("researchHtml", () => md.render(readFileSync("RESEARCH.md", "utf8")));

  // Lets CI provide the real deployed origin (e.g. "https://<user>.github.io") for building
  // absolute Open Graph/Twitter image URLs, which unlike internal links are supposed to be
  // absolute per spec. Empty string (default) means og:image falls back to a relative path --
  // fine for local dev, where there's no stable "real" origin to point to anyway.
  eleventyConfig.addGlobalData("siteUrl", () => process.env.SITE_URL || "");

  // Every content page lives under a language-code path segment (e.g. /en/items/) even though
  // only English exists today. This is routing-only prep: baking the segment into permalinks now
  // means adding a second language later is "generate another tree under /xx/", not "rewrite every
  // URL in every template." Shared assets (css/js/favicon/og-image) stay outside this prefix since
  // they aren't language-specific. Override via LANG env var; nothing else reads it yet.
  eleventyConfig.addGlobalData("lang", () => process.env.LANG_PREFIX || "en");

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

  // Every `data-mod="<modid>"` row (the datatable mod filter's matching value) should also carry
  // a `data-mod-label="<human name>"` so the <select> shows "BetterRuins" instead of "betterruins"
  // -- see datatable.js's populateSelect, which reads this sibling attribute for the option text.
  // Max stack size of the crucible-ready "bit" form of an ingot code ("ingot-copper" ->
  // "metalbit-copper"), for the alloy calculator; 128 (vanilla's metalbit stack) if unknown.
  eleventyConfig.addFilter("bitStackSize", (items, ingotCode) => {
    const bit = String(ingotCode).replace(/^ingot-/, "metalbit-");
    const item = items.find((i) => i.code === bit);
    return item?.maxStackSize ?? 128;
  });

  eleventyConfig.addFilter("modName", (mods, modid) => {
    const mod = mods.find((m) => m.modid === modid);
    return mod ? mod.name : modid;
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
  // search query for /items/: "*" is kept and "{...}" placeholders become "*", since datatable.js
  // treats "*" in a query as a glob ("jug-*-fired" must match "jug-blue-fired").
  eleventyConfig.addFilter("wildcardQuery", (code) => String(code ?? "").replace(/\{[^}]*\}/g, "*"));

  // A recipe ingredient's tag-based slot (e.g. `tags: ["tool-hammer"]`) shows this instead of the
  // raw tag string, e.g. "tool-hammer" -> "hammer (tool)" -- the raw tag itself is still what's
  // used for the ?tag= filter link (see items/index.njk's data-tags), only the label changes.
  eleventyConfig.addFilter("tagLabel", (tag) => {
    const m = /^tool-(.+)$/.exec(tag ?? "");
    return m ? `${m[1]} (tool)` : tag;
  });

  eleventyConfig.addFilter("round", (n, digits = 3) => (typeof n === "number" ? Number(n.toFixed(digits)) : n));

  // Formats a millisecond duration (from downloadTiming.json/ingestTiming.json/
  // eleventyBuildTiming.json, surfaced on /<lang>/build/) as a short human string -- e.g. "842 ms",
  // "3.4s", "1m 06s" -- rather than showing a raw millisecond count on the page.
  eleventyConfig.addFilter("durationLabel", (ms) => {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "unknown";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  });

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
    chance: "How likely this is attempted at a given candidate location/chunk/attempt, before any global frequency multiplier from world-creation settings. When several entries share the same code (e.g. a structure's small/medium/large size variants), this is actually a relative weight among those siblings rather than an independent probability -- confirmed real game data has values over 1 in exactly that case, so a value like 130 isn't a literal 13000%.",
    placement: "Where this is anchored: on the terrain surface, buried underground, or a specific ruin/story layer.",
    minSpawnDistance: "Minimum distance from the world spawn point, in blocks, before this structure is allowed to generate at all.",
    minGroupDistance: "Minimum distance enforced between two instances of this same structure, in blocks, so copies don't generate too close together.",
    minForest: "Only spawns/grows where local forest density is at or above this (0-1 scale).",
    maxForest: "Only spawns/grows where local forest density is at or below this (0-1 scale).",
    minFertility: "Only grows where soil fertility is at or above this (0-1 scale).",
    maxFertility: "Only grows where soil fertility is at or below this (0-1 scale).",
    habitatBlocks: "Needs one of these blocks at/adjacent to the spawn position to appear at all (wildcards like tallgrass-* match any grade/variant of that block; \"air\" means empty space is fine).",
    group: "The spawn-balancing group this creature belongs to (e.g. hostile, neutral, harmless) -- the game caps how many creatures from each group can exist near a player at once.",
    triesPerChunk: "How many times per chunk the game attempts this placement. Combined with chance, this governs how rare the result actually is in practice -- a high tries-per-chunk with a low chance can still be rarer than a low tries-per-chunk with a higher chance.",
    hostRocks: "The rock type(s) this deposit can replace. Where grade varies by rock, richer grades (rich/bountiful) are rarer than poor ones within the same deposit.",
    yPosRel: "Typical depth as a fraction of the world's height range: near 1.0 is close to the surface, near 0.0 is near the bottom of the world.",
    minHeight: "Only generates where terrain height (relative to the world's full height range, 0 = bottom, 1 = top) is at or above this.",
    maxHeight: "Only generates where terrain height is at or below this.",
    habitat: "Restricted to a specific habitat (e.g. \"Water\" for swamp-growing species) instead of ordinary dry land.",
    suitabilitySizeBonus: "Bonus added to this generator's suitability score when a larger tree would fit at the candidate spot, making bigger viable trees preferred over smaller ones up to this amount.",
    minSize: "Minimum relative tree size (0-1) this climate band may generate at.",
    maxSize: "Maximum relative tree size (0-1) this climate band may generate at.",
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
  // Three.js (the 3D voxel viewer's only dependency, pinned exactly in package.json) is served
  // from our own /assets/vendor/three/ rather than a CDN, so the pinned npm version is the one that
  // actually ships. three.module.min.js imports ./three.core.min.js by relative path, so both go
  // in the same folder; the addons keep their upstream `from 'three'` imports, resolved by the
  // importmap in layouts/base.njk.
  eleventyConfig.addPassthroughCopy({
    "node_modules/three/build/three.module.min.js": "assets/vendor/three/three.module.min.js",
    "node_modules/three/build/three.core.min.js": "assets/vendor/three/three.core.min.js",
    "node_modules/three/examples/jsm/controls/OrbitControls.js": "assets/vendor/three/addons/OrbitControls.js",
    "node_modules/three/LICENSE": "assets/vendor/three/LICENSE",
    // Sample schematics for the schematic viewer (fetched client-side by assets/schematicViewer.js).
    "site/tools/schematic/samples": "assets/schematics",
  });

  // sitemap.xml: written after the build from the real list of output pages. (A Nunjucks template
  // over `collections.all` only saw ~40 of the ~12,900 pages -- paginated pages aren't all in it.)
  // Needs SITE_URL (an absolute origin); without it (local builds) no sitemap is written.
  eleventyConfig.on("eleventy.after", ({ dir, results }) => {
    const origin = process.env.SITE_URL;
    if (!origin) return;
    const prefix = (process.env.PATH_PREFIX || "/").replace(/\/?$/, "/");
    const urls = results
      .map((r) => r.url)
      .filter((u) => u && u.endsWith("/") && u.startsWith(`/${process.env.LANG_PREFIX || "en"}/`))
      .map((u) => `  <url><loc>${origin}${prefix.replace(/\/$/, "")}${u}</loc></url>`);
    writeFileSync(
      join(dir.output, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    );
  });

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

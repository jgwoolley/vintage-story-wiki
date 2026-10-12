# Vintage Story Wiki

A statically-generated wiki documenting Vintage Story crafting recipes, drop rates,
world-generated structures, decorative content (paintings/tapestries/clothing), in-game books, and
natural spawn locations (ore/gem deposits, wild crops, trees, entity habitats), built directly from
the game's own asset data (vanilla server + installed mods) rather than hand-maintained. This is
the contributor/maintainer doc; the site's own **Info** tab (`INFO.md`) is a separate, simpler
document aimed at visitors; `CLAUDE.md` is for a future AI coding session picking up this repo.

## How it works

1. **`vs-manifest.json`** pins the vanilla server version/branch and the list of installed mods
   (`modid` + version). This is the single source of truth for what the wiki documents. Currently
   pinned to vanilla **1.22.7** plus two mods: **BetterRuins** (JSON-only) and **Stone Quarry**
   (ships compiled code — see "Compiled-code mods" below).
2. **`npm run download`** (`scripts/download.ts`) reads that manifest, downloading the vanilla
   dedicated server into `vs_server/` and mod `.zip` files into `Mods/` (both gitignored) via
   Node's built-in `fetch`, the mods.vintagestory.at API, and the pure-JS `tar` package for
   extraction — the whole pipeline is plain Node/npm, no OS-provided tool is ever shelled out to.
3. **`npm run ingest`** (`src/ingest/`) reads those raw game assets and produces normalized JSON
   under `site/_data/generated/` — recipes, loot/drop tables, worldgen structures, a decor
   catalog (paintings/tapestries/clothing), readable book content, and a cross-referenced item
   index. See the pipeline stages below.
4. **`npm run build`** runs the ingest step and then builds the static site with Eleventy, from
   `site/` into `_site/`.

```
npm install
npm run download   # fetch the pinned vanilla server + mods
npm run build      # ingest game data + build the static site into _site/
npm run serve      # same, with a local dev server + live reload
```

## Ingestion pipeline (`src/ingest/`)

- **`modExtractor.ts`** — reads `modinfo.json` out of each mod zip, flags mods that ship compiled
  code (`.dll`) since their custom behavior can't be captured from JSON alone, and extracts into
  `.scratch/mods/` (a build-time cache, distinct from the user/CI-managed `Mods/` download cache).
- **`assetLoader.ts`** — walks `assets/<domain>/<category>/**/*.json` for vanilla and every mod,
  parsing with a JSON5-tolerant parser (real game files use unquoted keys, trailing commas, and
  comments). Schematic voxel-data files are skipped here (see `schematicHeader.ts`) since they can
  be tens of megabytes.
- **`schematicHeader.ts`** — lists schematic files and reads only their lightweight header fields
  (dimensions, block-code count) without parsing the huge `Indices`/`BlockIds`/`BlockEntities`
  voxel payloads. Also exposes the actual block-code *values* (still cheap — `BlockCodes` itself is
  a small dict) so `structureContents.ts` can check for membership without a full voxel decode.
- **`structureContents.ts`** — one pass over every schematic's block-code dict, cross-referenced
  against which structures reference which schematic files, to answer "which structures contain
  block X" (used by the decor catalog, see below) without re-scanning schematics per lookup.
- **`patchEngine.ts`** — collects every `patches/**/*.json` file (vanilla + mods), filters by
  `side`/`dependsOn`/`condition` (world-config conditions are resolved against the "Default"
  world-creation preset) and by the `compatibility/<othermodid>/` folder convention, then applies
  the active patches (including the VS-specific `addmerge` op) to compute the *effective* merged
  JSON per target file.
- **`variantExpander.ts`** — resolves `variantgroups` (inline `states` and/or
  `loadFromProperties` worldproperty references) into concrete item/block codes, restricted by a
  top-level `allowedVariants` allow-list when present, and resolves `*ByType` glob/regex-keyed maps
  (e.g. `dropsByType`) per concrete variant — picking the *most specific* matching pattern, not
  whichever happens to appear last in the file (see "Display names" below for why that distinction
  matters).
- **`lang.ts`** — resolves display names and flavor-text descriptions from each domain's own
  `lang/en.json`, falling back to vanilla's shared `game/lang/en.json`, with glob (`block-foo-*`)
  lang keys and the ore-chunk name composition (see "Display names") both supported.
- **`models/{recipes,loot,structures,decor,lore}.ts`** — normalize the 7 recipe categories, the 4
  drop mechanisms (block drops, panning, entity death drops, harvestable drops — plus entity stats:
  health, weight, hitbox size, behavior tags, and spawn conditions, see below), the 4 worldgen
  registries (structures, villages, story structures, hook-generated structures), the
  decorative/clothing catalog, and readable books/lore into common shapes.
- **`models/deposits.ts`** / **`models/blockpatches.ts`** / **`models/trees.ts`** — parse
  `worldgen/deposits/**/*.json` (ore/gem/rock veins: host rock(s), grade-by-rock, typical depth),
  `worldgen/blockpatches/*.json` (wild crops/flowers/mushrooms/etc.: literal block codes plus
  climate/fertility ranges), and `worldgen/treengenproperties.json` plus `blocktypes/plant/
  fruittreebranch.json` (regular tree/shrub species and fruit tree varieties: climate bands
  cross-referenced to concrete log/leaves/sapling/fruit-item codes), then cross-reference all three
  back onto the matching item index entries so an item page can show where it naturally occurs.
  Entity spawn conditions (climate, habitat blocks, spawn group/chance) are parsed in
  `models/loot.ts` instead, from each entity's `server.spawnconditions`/`spawnconditionsByType`,
  since that's nested under the entity's own JSON rather than a separate worldgen registry.
- **`crossref.ts`** — builds the item index (which recipes produce/consume an item, which
  blocks/entities drop it), resolving recipe-level wildcard/template placeholders (e.g.
  `plank-{wood}`) into concrete linked items.

## Display names (`lang.ts`)

Resolving a correct display name turned out to need several fixes verified against the actual
game source (`anegostudios/vssurvivalmod`, `vsapi` on GitHub), not just the asset JSON:

- **`variantgroups` can be restricted by a top-level `allowedVariants` list.** Some item/block
  definitions (`ore-graded.json`, `fishraw.json`, ~40 files total) combine multiple variant groups
  (e.g. grade × mineral × rock type) whose full cartesian product includes combinations that don't
  actually exist in the game (not every mineral occurs in every rock). When a top-level
  `allowedVariants: [...]` array is present, `variantExpander.ts` filters the generated combinations
  down to that allow-list — without this, the pipeline over-generated thousands of nonexistent ore
  variants as if they were real droppable items.
- **Ore/crystalized-ore chunks compose their name from two separate lang keys**, not a single
  `item-<code>` lookup — mirroring `ItemOre.GetHeldItemName` in the game source: a per-grade
  template (`"rich-ore-chunk": "Rich chunk of {0}"`) plus a per-mineral name (`"ore-ilmenite"`),
  with the rock-type segment ignored entirely. `lang.ts` replicates this composition.
- **Entities resolve under a different lang key than items/blocks** — `item-creature-<code>`
  (e.g. `item-creature-bear-polar-adult-male` → "Polar bear (male)"), not `entity-<code>`.
- **`*ByType` glob resolution must pick the most specific match, not the last one in file order.**
  A real bug this surfaced: `bear-adult.json` lists `"*-polar-adult-male"` (specific hitbox size)
  *before* the generic `"*-male"`/`"*-female"` fallbacks, so picking "whichever matched last"
  silently gave every bear the generic hitbox. Fixed to prefer the longer (more specific) pattern.
- **Attribute-parametrized blocks (lanterns, scroll racks, figureheads) have no single "the" name.**
  Their material is a runtime attribute (e.g. `itemStack.Attributes.GetString("material")`), not
  part of the registered block code, so `GetHeldItemName` composes the name from code + attribute
  at the moment an instance exists — there's no context-free display name for the bare code.
- **Clothing/painting/tapestry flavor text, when present, is a separate `itemdesc-`/`blockdesc-`
  lookup**, not part of the display name at all (see the Decor catalog section below).

After these fixes, vanilla item/block display names resolve at ~97%. The remaining gaps are real
upstream data, not pipeline bugs: the attribute-parametrized blocks above, and a larger set of
BetterRuins' own decorative schematic-only blocks that the mod itself never added lang entries for.

## Decor catalog: Paintings, Tapestries, Clothing (`models/decor.ts`)

Paintings, tapestries, and clothing have no recipe and no drop table — worldgen placement, the
creative-mode `/giveblock` command, or NPC trade are the only ways to get them in survival — so the
normal recipe/loot-driven item index never sees them (see "Known v1 limitations" below).
`extractDecorCatalog` is a deliberate, separate full-registry walk scoped to just these three
categories, returning one flat list (`generated.decor`) that `src/ingest/index.ts` then splits by
`kind` into `generated.paintings`/`tapestries`/`clothing` — each with its own top-level page
(`/paintings/`, `/tapestries/`, `/clothing/`) rather than one shared listing with a kind filter,
consistent with "organize by what the thing is" (see Creatures vs. Items below). Details:

- **Flavor text**, pulled from `itemdesc-`/`blockdesc-` lang keys when the game defines one. Most
  don't — paintings have zero flavor text anywhere in the base game, and only ~24% of clothing
  items have any. That's accurate to the game, not missing data.
- **Tapestries are fully resolved per placement**, not just linked to a lore book: `models/
  tapestryInstances.ts` decodes each worldgen schematic's own `BlockEntities` data (Ascii85 +
  `TreeAttribute` binary parse — a port of `vsapi`'s own format, verified against real downloaded
  schematic data) to read the placed tapestry's `type` runtime attribute directly, then resolves
  every real possible outcome by finding which `tapestryGroups`/`wallcarvingGroups` entry it
  belongs to (the game rerolls to a uniformly random member of that group at world-placement time
  unless the schematic pins it — see `BlockTapestry.OnLoadCollectibleMappings` in
  `vssurvivalmod`). The decoder itself lives at `site/assets/schematicDecode.js`, not under
  `src/ingest/` — plain dependency-free ES module JS, directly `<script>`-loadable, since the
  planned `/tools/` schematic viewer (see "Coming soon" below) will need the exact same decode
  logic client-side; `tapestryInstances.ts` just imports that same file. `/tapestries/` is one
  flat, sortable table of every (structure, possible tapestry) pairing this produces — not a page
  per block code/direction, since direction/code aren't the interesting axis here. Scoped to
  schematics actually referenced by world generation only (`structureContents.ts`'s existing
  index), never a blanket scan of every `.json` under `worldgen/schematics/`.
- **"Found in structures"**, built from `structureContents.ts`: one pass over every schematic's
  block-code dictionary, cross-referenced against which structures reference which schematic
  files. Works for paintings/tapestries (real placed blocks); clothing items correctly show zero
  matches, since worn/stored items live inside a schematic's opaque block-entity inventory data
  (e.g. a chest or wardrobe), which this wiki doesn't decode. This is also a coarser match than
  ideal — it confirms a structure's schematic *contains* the block code somewhere, not that a
  specific ruin/story-structure variant from `worldgen/storystructures.json`/`structures.json` was
  directly evaluated (see `/tools/`).

## Books & Lore (`models/lore.ts`)

`/lore/` presents the actual readable text of every in-game book, journal, and tapestry chapter —
both vanilla (19 books) and BetterRuins' own (53 more). `config/lore/<code>.json` files just list a
title key and an ordered array of "piece" lang keys; the real prose lives in the lang file itself,
resolved through the same mechanism as every other display string (including mod-domain-prefixed
keys like `betterruins:lore-brickworkerslament-title`), with the game's own `___NEWPAGE___`
page-break marker preserved.

## Creatures vs. Items (`/<lang>/creatures/`, `/<lang>/items/`)

Content is organized by *what the thing is*, not by *mechanism*: `/creatures/` is entity-only
(health, hitbox, tags, spawn conditions, and its own drop table), while every block's drops —
"this block drops X when broken" — live directly on that block's own `/items/` page instead of a
separate listing, right alongside what produces/consumes it. `src/ingest/index.ts` groups the flat
loot entries by source (`LootSourceGroup`) and splits the result: entity-kind groups become
`generated.creatures`; block-kind groups become `generated.blockDrops`/`blockDropsById`, looked up
live by each item page via its own `domain:code` (no stored id list needed, same pattern as the
deposit/blockpatch lookups below). A block that only drops something, with no recipe or worldgen
reference of its own (confirmed: the large majority of block drop sources), still gets synthesized
an `/items/` page via `ensureSpawnTarget` — the same "give it a page even though nothing else
points to it" pattern already used for spawn-only blocks. Entity stats (health
`maxhealth`/`maxhealthByType` from the `health` server behavior, weight, hitbox size, behavior
tags) are resolved through the same `*ByType` glob-matching used for drops; tags are clickable,
linking to `/creatures/?q=<tag>` so e.g. every `predator`-tagged entity is one click away.

## Spawn locations (`/<lang>/deposits/`, `/<lang>/crops/`, `/<lang>/trees/`, and per-item)

Ore/gem/rock deposits, wild crops/flowers/etc., and trees are blocks with no recipe and no drop
table of their own — nothing "produces" them, the world just generates them — so like
paintings/tapestries (see above) they fall outside the recipe/loot-driven item index and get their
own extraction path, each with its own top-level page: `models/deposits.ts` (→ `/deposits/`),
`models/blockpatches.ts` (→ `/crops/`, wild crops/flowers/mushrooms/etc.), and `models/trees.ts`
(→ `/trees/`, regular tree/shrub species plus fruit tree varieties). Each item's own page also
shows just the entries relevant to it.

`models/trees.ts` reads a third, structurally distinct worldgen system —
`worldgen/treengenproperties.json`'s per-species climate bands (confirmed 0–255 scale for
rain/fertility/forest-density, normalized to this codebase's usual 0–1 on the way out), cross-
referenced to concrete log/leaves/sapling block codes via each species' own
`worldgen/treegen/<species>.json` shape file and `plaintreesapling.json`'s glob-keyed
sapling→species map (reusing `variantExpander.ts`'s `resolveByType`) — plus a wholly separate
fruit-tree climate band in `blocktypes/plant/fruittreebranch.json`'s `attributes.worldgen`,
cross-referenced to the concrete fruit item code via its sibling
`attributes.fruittreeProperties.<type>.fruitStacks[0].code`.

Entity spawn conditions (climate, required nearby block, spawn group/chance, tries-per-chunk) are
shown on the entity's own `/creatures/` page instead, next to its drop table, parsed from
`server.spawnconditions`/`spawnconditionsByType` in `models/loot.ts`. All of these values are the
raw worldgen *rule* the game checks per chunk/attempt, not a placement guarantee — see the in-site
Info page for the visitor-facing version of that caveat.

## Site features

- **Every listing is one real `<table>`**, not a grid-list of plain links, with pagination, a
  free-text search box, and — whenever rows carry a `data-category`/`data-mod` — an auto-populated
  `<select>` filtering on it (hidden only if no row has a value for that dimension at all; a single
  distinct value still shows the dropdown). Sections with zero rows (e.g. an item with no known
  recipe) are omitted entirely rather than shown empty.
- **All filter state lives in the URL** (`?q=`, `?category=`, `?mod=`, `?tag=`, numbered
  `q2`/`category2`/... for a 2nd+ table on the same page) via `history.replaceState`, so a
  filtered/searched view can be bookmarked, shared, or revisited with back/forward navigation. See
  `site/assets/datatable.js`. `tag` is a separate exact-match filter dimension (against
  `data-tags`) from the free-text `q` substring search, used for creature tags — a tag link
  shouldn't also match unrelated rows whose name/code happens to contain the same substring.
- **Wildcard/placeholder ingredients are clickable**, e.g. a recipe using `leather-normal-*` links
  to `/items/?q=leather-normal-`, pre-filtering the items list to that family.
- **Recipes without their own name** (alloy, barrel, cooking, knapping, smithing, clayforming never
  have one in the game data) are titled after their output item and labeled "(Item Recipe)" — e.g.
  "Electrum ingot (Item Recipe)" — so it's clear that's a recipe title, not a second name for the
  item. Every recipe listing also shows its resolved ingredients → output inline.
- **GitHub Pages project-site deployment**: every internal link/asset goes through Eleventy's
  `{{ '/' | url }}` + `pathPrefix` idiom (set via the `PATH_PREFIX` env var in CI), since a project
  site like `https://<user>.github.io/<repo>/` serves from a subpath, not the domain root — a
  hardcoded `/assets/style.css` would 404 there even though it works fine in local dev.
- **Every content page lives under a `/<lang>/` path segment** (currently just `/en/`) — baked into
  each page's `permalink` via the `lang` global data value (eleventy.config.js), composed with the
  `('/' ~ lang ~ '/') | url` idiom instead of the plain `'/' | url` one used for shared,
  non-language-specific assets (css/js/favicon/og-image, which stay outside the prefix). The bare
  site root (`/index.html`) is a tiny meta-refresh redirect to `/en/` (`site/redirect.njk`). This is
  routing-only prep for a second language later — nothing currently generates non-English content,
  and `LANG_PREFIX` is the only knob, overriding the default `"en"` for local experimentation.
- **Footer build info**: every page shows when it was generated (stored in UTC, rendered
  client-side as a relative time string — see `site/assets/build-time.js`), itself the link to
  the exact commit it was built from (`GITHUB_SHA`/`GITHUB_REPOSITORY`, set automatically by every
  Actions run; falls back to the local git working tree otherwise, where it's plain unlinked text).
  The " ago" suffix lives in a separate sibling element so "just now" doesn't read as "just now ago".

## Coming soon (`/guides/`, `/trades/`, `/tools/`)

Three pages are intentionally empty stubs, each explaining in-page what's planned and exactly
where the underlying game data already lives, rather than silently having no page at all:

- **`/guides/`** — the game's own 20 in-game handbook help-guide articles
  (`config/handbook/00-starterguide.json` through `19-stonelayers.json`).
- **`/trades/`** — what wandering traders buy/sell, per specialization
  (`config/tradelists/*.json`, `entities/humanoid/trader-{male,female}.json`,
  `config/dialogue/trader.json`).
- **`/tools/`** — interactive tools beyond the generated reference pages: a schematic
  viewer/uploader (likely adapting
  [jgwoolley/vintage-story-schematic-preview](https://github.com/jgwoolley/vintage-story-schematic-preview)),
  and a proper painting/tapestry-in-ruins lookup evaluated directly against
  `worldgen/storystructures.json`/`structures.json` (see the "Decor catalog" caveat above).

## Why not run the game engine directly?

It's natural to ask whether a small companion mod that hooks the real dedicated server's
`ModSystem` lifecycle (`AssetsFinalize`/`StartServerSide`) and dumps its already-resolved, in-memory
state would be more robust than re-implementing patch application and variant expansion in
TypeScript. Investigated and decided against, for now:

- Recipes, items/display-names, and drops *are* cleanly available via public `vsapi` (e.g.
  `api.GetCookingRecipes()`, `world.Collectibles`, `GetHeldItemName()`, `Block.Drops`), fully
  patched and resolved — and this would also fix the current blind spot where mods shipping
  compiled `.dll` code are undocumented, since running the real engine executes that code too.
- Worldgen structures are the weak point: the general `structures.json` registry sits behind an
  unsupported `internal` field (would need reflection) and isn't populated until world-generator
  init, later than clean asset-loading — an engine-based export of structures would be fragile.
- This environment has no .NET 10 runtime/SDK at all, there's no "validate assets only" server
  mode (every path that resolves patches/recipes requires creating or opening a real world), and
  there's no prior art combining all four content types this way in the VS modding community.

Given the JSON pipeline already resolves vanilla display names at ~97% (see above), the tradeoff
of a new C#/.NET toolchain and heavier CI (real server+world startup vs. instant JSON parsing)
wasn't worth it yet.

### Compiled-code mods are a real, current blind spot

This isn't just theoretical anymore: **Stone Quarry** (one of the two installed mods) ships
`StoneQuarry.dll` and is flagged `hasCompiledCode: true` on the Mods page. Its JSON assets (if any)
are still ingested normally, but any custom mechanic implemented in C# is invisible to this
pipeline — revisit the engine-based approach above if a mod's compiled behavior actually needs
documenting rather than just flagging.

## Item icons

The wiki is text-only, and that isn't just an unfinished feature — real icons turned out to be
genuinely blocked, not merely skipped:

- The dedicated server download contains **zero item/block appearance textures**. The only PNGs
  anywhere in `vs_server/assets/` are ~46 environment/skybox/season-tint images needed for
  server-side world simulation (`textures/environment/...`) — nothing for how an item or block
  actually looks. Textures are a client-only concern, and the headless server never renders
  anything, so Anego Studios doesn't ship them in that download at all.
- Even with textures, Vintage Story doesn't use pre-baked flat icon images the way many other
  games do — an inventory icon *is* the item's real 3D shape+texture, rendered by the client at a
  fixed camera angle at runtime (see e.g. `BlockLantern.GetOrCreateMesh`/`OnBeforeRender` in the
  game source). A faithful icon would need a shape parser and a 3D rasterizer, not a PNG crop.
- Getting real textures at all would require the game's **client** package. Unlike the freely
  redistributable dedicated server, that sits behind an account/purchase gate — a CDN URL of the
  same shape as the server's exists (`vs_client_linux-x64_<version>.tar.gz`) but isn't meant to be
  fetched anonymously, and downloading it without authorization isn't something this pipeline
  should do.
- We tried procedurally generated placeholder icons as a no-licensing-risk stand-in — a colored
  chip showing the item's initials, computed deterministically from its code, no game assets
  involved. It didn't look good enough to keep and was reverted; the wiki stays text-only.

## Known v1 limitations

- **The recipe/loot item index (`/items/`) only lists things reachable from a recipe, a drop
  table (either direction), or a worldgen spawn rule.** `generated.items` (`crossref.ts` +
  `index.ts`'s synthesis loops) is built by walking recipe ingredients/outputs, loot entries (both
  what something drops and what drops it), and deposit/blockpatch/tree spawn data — not by
  enumerating every `itemtypes`/`blocktypes` definition in the game. Paintings, tapestries, and
  clothing are specifically carved out into their own pages (`/paintings/`, `/tapestries/`,
  `/clothing/`, see above) precisely because of this gap, but it's not fully closed: roughly 100
  other blocktype/itemtype files carry the same handbook-exclude/admin-only pattern (e.g.
  `attributes.handbook.exclude: true`, same as `tapestry`) and still have no page anywhere on the
  wiki. Closing it fully would mean switching the item catalog from a recipe/loot/worldgen graph
  to a full registry walk — a bigger change than this note,
  flagged here rather than taken on silently.
- Schematic geometry (the actual block-by-block layout of a generated structure) is not decoded —
  only dimensions and a block-code inventory count are shown, plus (for the decor catalog) whether
  a specific block code is present at all.
- `condition`-gated patches assume the "Default" world-creation preset; a world created with
  non-default settings would see slightly different effective data.
- Compiled-code mods (currently: Stone Quarry) are flagged but otherwise invisible to this
  pipeline — see "Compiled-code mods are a real, current blind spot" above.

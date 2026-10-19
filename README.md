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
   (ships compiled code — see "Compiled-code mods" below). Its optional `includeItems` list
   (`domain:code` globs, e.g. `"survival:statictranslocator-*"`) forces items/blocks into the item
   index that no recipe/drop/worldgen/trade/dialogue rule reaches (`includeManifestItems` in
   `crossref.ts`; ingest warns about patterns that match nothing). The file's shape is described
   by `vs-manifest.schema.json` (JSON Schema draft-07), referenced from the manifest's own
   `"$schema"` key so VS Code validates and autocompletes it with no extra setup. Keep the schema
   in sync with `VsManifest` in `apps/vs-wiki/src/ingest/types.ts` when adding a field.
2. **`npm run download`** (`apps/vs-wiki/scripts/download.ts`) reads that manifest, downloading the vanilla
   dedicated server into `vs_server/` and mod `.zip` files into `Mods/` (both gitignored) via
   Node's built-in `fetch`, the mods.vintagestory.at API, and the pure-JS `tar` package for
   extraction — the whole pipeline is plain Node/npm, no OS-provided tool is ever shelled out to.
   Alongside each mod zip it caches `Mods/<modid>.meta.json` (`assetid`, `urlalias`, `logoUrl`)
   from the API response, since `assetid` is the only reliable way to link to a mod's
   mods.vintagestory.at listing (a mod's own `modid` isn't reliably the same as that listing's
   slug) and `logoUrl` is a ready-to-use CDN image URL rendered on `/mods/` — ingest itself never
   touches the network, so re-run `npm run download` to pick either up for mods fetched before
   this caching existed.
3. **`npm run ingest`** (`apps/vs-wiki/src/ingest/`) reads those raw game assets and produces normalized JSON
   under `apps/vs-wiki/site/_data/generated/` — recipes, loot/drop tables, worldgen structures, a decor
   catalog (paintings/tapestries/clothing), readable book content, and a cross-referenced item
   index. See the pipeline stages below.
4. **`npm run build`** compiles the TypeScript libs (`build:libs`), runs the ingest step and then builds the static site with Eleventy, from
   `apps/vs-wiki/site/` into `_site/`.

```
npm install
npm run download   # fetch the pinned vanilla server + mods
npm run build      # compile libs, ingest game data, build the static site into _site/
npm run serve      # same, with a local dev server + live reload
npm run typecheck  # tsc over the wiki + core lib, the vs-schematic lib (DOM) and the extension
npm test           # node:test across every package
```

## Repository layout (npm workspaces)

```
libs/vs-wiki-core/          asset loading, JSON patching, variant expansion, lang resolution (+ their types)
libs/vs-schematic/          schematic decode, voxel conversion, Three.js voxel viewer (TypeScript)
apps/vs-wiki/               the wiki: src/ingest, scripts, test, site (Eleventy input), eleventy.config.js
apps/vs-vscode-extension/   VS Code preview for schematic files
```

Every command runs **from the repo root**: all pipeline paths are cwd-relative, and the shared data
(`vs_server/`, `Mods/`, `.scratch/`, `_site/`, `vs-manifest.json`, and the gitignored reference clones
`vssurvivalmod/`/`vsapi/`/`vsessentialsmod/`) lives there. Apps import libs by package name
(`vs-wiki-core/lang.js`, `vs-schematic/schematicDecode.js`; each lib's `exports` maps `./*.js` to its
TypeScript source, which `tsx` and `esbuild` consume directly). Libs never import from apps.

- **`libs/vs-wiki-core`** knows nothing about the wiki's content types: only the loaded-asset shapes
  (`AssetSource`/`LoadedAsset`/`AssetIndex`/`PatchOp`, re-exported from the app's `types.ts`).
- **`libs/vs-schematic`** is TypeScript with its own `tsconfig.json` (adds the DOM lib; the root tsconfig has no
  DOM, which keeps `schematicDecode.ts` honest since the ingest imports it). Browsers can't run TS, so
  `npm run build:libs` (`tsc -p libs/vs-schematic/tsconfig.build.json`) compiles it to `libs/vs-schematic/dist/`
  (gitignored); `apps/vs-wiki/eleventy.config.js` passes `dist/*.js` through to `/assets/`, next to the site's own
  scripts, so their relative `./voxelViewer.js`-style imports resolve. `npm run build`/`rebuild`/`serve` and the
  CI workflow run `build:libs` first; `three` is a peer dependency, supplied by the importmap on the site and
  bundled by esbuild in the extension.
- **`apps/vs-vscode-extension`** is a custom read-only editor (`vsSchematic.preview`, priority `option`, so it
  never replaces the normal JSON editor: use "Open With..." or the "Vintage Story: Preview Schematic" command,
  explorer context menu or editor-title button). `src/extension.ts` (Node host: reads the file, gunzips
  `.json.gz`, watches it for changes) talks over `src/protocol.ts` to `src/webview/main.ts` (browser: legend with
  per-block toggles, search, `meta-filler` toggle, height slider, click-to-inspect with decoded block entities;
  the wiki's schematic viewer, minus the wiki-specific parts). `esbuild.mjs` bundles both halves into `dist/`,
  aliasing `three/addons/OrbitControls.js` the way the wiki's importmap does. The webview HTML shell
  (`src/webviewHtml.ts`, strict nonce-only CSP) is plain string building so it is unit tested without VS Code.
  `npm run build:extension` bundles and packages a `.vsix` (`apps/vs-vscode-extension/`, gitignored); `npm run build -w vs-vscode-extension` bundles only. It has
  not been run inside a real VS Code yet (see `RESEARCH.md` topic 8); to try it, open the repo in VS Code and
  launch an Extension Development Host on `apps/vs-vscode-extension`.

## Ingestion pipeline (`apps/vs-wiki/src/ingest/`)

- **`modExtractor.ts`** — reads `modinfo.json` out of each mod zip, flags mods that ship compiled
  code (`.dll`) since their custom behavior can't be captured from JSON alone, and extracts into
  `.scratch/mods/` (a build-time cache, distinct from the user/CI-managed `Mods/` download cache).
- **`assetLoader.ts`** (in `libs/vs-wiki-core/src/`, as are `patchEngine.ts`, `variantExpander.ts` and `lang.ts`) — walks `assets/<domain>/<category>/**/*.json` for vanilla and every mod,
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

## Schematics vs. structures

A **schematic** is a pre-built block layout file (`worldgen/schematics/**/*.json`); a **structure** is a
worldgen rule (where/how often to spawn) that *references* schematics. They are separate things in the data:
- `generated.schematics` (`models/schematics.ts` → `SchematicInfo`): one entry per file, read once (size,
  `BlockCodes`/`ItemCodes`, byte sizes), with `usedBy` (the reverse of the structures' references). Its `id`
  is `<domain>:worldgen/schematics/<relPath>.json`, the key every schematic cross-reference in the pipeline
  already used (tapestry/clutter instances, lore locations, "Found in structures").
- `NormalizedStructure.schematics` (`SchematicRef[]`): the raw path/glob, the structure's own
  weight/quantity for it, and the resolved `schematicIds` (globs resolve against schematics of the
  structure's own domain; `resolveSchematicGlob` in `models/structures.ts`).
- Pages: `/schematics/` + `/schematics/<domain>/<relPath>/` (the URL segment is `SchematicInfo.pagePath`,
  not `slugify(id)`, which collided for `.../-hut3-agr` vs `.../hut3-agr`).
- **3D viewing**: `schematicFiles.ts` gzips every schematic (level 6, built-in `zlib`; ~271 MB → ~51 MB) into
  `apps/vs-wiki/site/_data/generated/schematicFiles/`, which `apps/vs-wiki/eleventy.config.js` passes through to
  `/assets/schematics/world/<domain>/<relPath>.json.gz`. `schematicViewer.js` fetches one on demand and
  unpacks it with the browser's `DecompressionStream`. Redistributing these files (vanilla and mods) is a
  deliberate choice; each schematic page says whose files they are.
- **Two viewers, one core**: each schematic page embeds a read-only preview (`schematicPreview.js`: rotate/pan/zoom
  only, no legend/slider/picking; files over 1.5 MB compressed wait for a click, the rest load when scrolled into
  view) with a button into the full viewer (`schematicViewer.js`, which also has Download for whatever is loaded:
  the exact bytes as `.json`, plus the `.json.gz` for the wiki's own). Both use the pure helpers in
  `libs/vs-schematic/src/schematicVoxels.ts` (packed-index → voxels, gzip fetch). `meta-filler` (a worldgen marker, ~half the voxels
  of the biggest schematic) starts hidden: dropped entirely from the preview, toggleable in the full viewer's
  block list (`isHiddenByDefault`).

## Random-stack placeholders and handbook links

`ItemStackRandomizer` items (`stackrandomizer-*`, the placeholders world-generated chests hold in
schematics' `ItemCodes`) get an item page with a "Can generate" pool and every result a "Can be generated
by" back-link (`ItemIndexEntry.randomPool`/`generatedBy`, built in `apps/vs-wiki/src/ingest/index.ts` from
`extractStackRandomizerPools` in `models/loot.ts`; chances are weight / pool total, stack `attributes` such as
a clutter `type` are kept). "Found in structures" for items also reads the schematic `ItemCodes`
dictionary (`buildItemCodeToSchematicIndex`).
`rewriteHandbookLinks` (`codeUtil.ts`) turns `handbook://item-/block-<[domain:]code>` and guide `pageCode`
links (any mod's) into site paths and records every item/block it linked in `handbookItemRefs`; `index.ts`
then gives each real referenced item/block a page so those links never dead-end.

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

Schematic block names (`models/blockNames.ts`): a `variantgroups` entry that only has `loadFromProperties` (soil's
fertility/grasscoverage) takes its group code from the property file's own `code`, otherwise the groups collapsed
(`soil-sparse-sparse`). A variant with no lang key of its own (fences, logs, lava, ...) borrows the name of the sibling
variant sharing the most group values, since the game names those from the pickable sibling; some blocks (e.g. banners,
`boilingwater`) have no named sibling and still show the code.

After these fixes, vanilla item/block display names resolve at ~97%. The remaining gaps are real
upstream data, not pipeline bugs: the attribute-parametrized blocks above, and a larger set of
BetterRuins' own decorative schematic-only blocks that the mod itself never added lang entries for.

## Decor catalog: Paintings, Tapestries, Clothing (`models/decor.ts`)

Paintings, tapestries, and clothing have no recipe and no drop table — worldgen placement, the
creative-mode `/giveblock` command, or NPC trade are the only ways to get them in survival — so the
normal recipe/loot-driven item index never sees them (see "Known v1 limitations" below).
`extractDecorCatalog` is a deliberate, separate full-registry walk scoped to just these three
categories, returning one flat list (`generated.decor`) that `apps/vs-wiki/src/ingest/index.ts` then splits by
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
  `vssurvivalmod`). The decoder itself lives at `libs/vs-schematic/src/schematicDecode.ts`, not under
  `apps/vs-wiki/src/ingest/` — dependency-free TypeScript with no Node or DOM APIs (compiled to browser JS by
  `npm run build:libs`), since the `/tools/schematic/` viewer (see "Tools" below) and the VS Code extension need
  the exact same decode logic client-side; `tapestryInstances.ts` just imports that same file. `/tapestries/` is one
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

## Classes & Traits (`models/classes.ts`)

`/classes/` catalogs the 6 player starting classes (`config/characterclasses.json`: commoner,
hunter, malefactor, clockmaker, blackguard, tailor) and the 26 traits (`config/traits.json`) they
draw from. Like paintings/tapestries/clothing, this is a standalone catalog rather than something
forced through the recipe/loot item index — a class is a character-creation choice, not a
craftable/droppable thing. Both source files are single flat JSON arrays (no variant expansion, no
`*ByType` glob keys — the only two content types in this pipeline that simple). Trait display names
come from `trait-<code>` lang keys; most traits have no `traitdesc-<code>` flavor text at all (only
the ones that unlock something non-numeric, like `bowyer` unlocking bow crafting, do) — a trait's
real effect is its raw `attributes` stat-modifier map (e.g. `"walkspeed": 0.1`), rendered generically
(label the key via the same camelCase-to-Title-Case `restrictionLabel` filter structures use, show
the signed raw value) rather than hardcoded per possible key, since the key set is open-ended.
Starting gear codes in `characterclasses.json` are bare (no domain prefix) — resolved against the
class file's own domain, same assumption `models/trades.ts` makes for its listing codes — and link
to the matching `/clothing/` page by display name resolved at ingest time, since clothing never
joins the main item index and so has no generic item cross-reference filter available in a
template.

## Books & Lore (`models/lore.ts`, `models/loreLocations.ts`)

Two pages, one source. `config/lore/<code>.json` files list a title key and an ordered array of
"piece" lang keys; the real prose lives in the lang file (resolved like every other display
string, including mod-domain-prefixed keys). Each file's `category` is its **lore section**.

- `/books/` (+ `/books/<domain>/<code>/`) — every readable book/journal/note (`kind: "book"`), its
  section, and the structures whose schematics can contain it.
- `/lore/` — one row per section (description from the `loretype-<category>` lang key), listing
  its books and structures. The `tapestry`/`wallcarving` files aren't books (they're chapters a
  tapestry/wallcarving reveals, `kind: "chapters"`), so their text pages stay at
  `/lore/<domain>/<code>/` (the tapestry pages link to `#chapter-N`; `.card:target` highlights it).

`attachLoreLocations` finds structures from three schematic signals: `clutteredbookshelfwithlore`
block entities' `loreCode` (a section), `discoveryCode` on containers holding a specific book, and
`stackrandomizer-<code|section>` in `ItemCodes`. Block-entity values are matched by regex over the
raw decoded bytes. Outputs: `generated.books`, `generated.lore` (chapters only), `generated.loreSections`.

## Trades (`models/trades.ts`)

Two pages: `/trades/` (in the Tools menu) is a flat, sortable table of every individual buy/sell
listing (in the spirit of vintagestorypriceguide.com); `/traders/` lists the specializations, with
per-specialization detail pages (`/traders/<id>/`) holding their own selling/buying tables plus
starting money. A listing's price is per stack and its stock is a number of stacks (`stacksize`
items each) -- shown as separate columns. Each specialization is one
`config/tradelists/trader-<specialization>.json` file (vanilla also has `villager-<name>.json`
tradelists for named NPCs, which this pipeline treats the same way but which don't resolve any
`traderEntities` — see below). `priceMin`/`priceMax`/`stockMin`/`stockMax` are derived at ingest
time (`avg - var` / `avg + var`) so templates can show a plain range; the original `priceAvg`/
`priceVar`/`stockAvg`/`stockVar` fields are kept alongside, not replaced.

**Which concrete trader entity uses which specialization** is resolved from the entity data
itself, not an explicit field — there isn't one. `entities/humanoid/trader-{male,female}.json`
declare `variantgroups: [{code: "gender", ...}, {code: "type", states: ["agriculture",
"artisan", ..., "treasurehunter"]}, {code: "climate", ...}]`, and the entity's own
`attributes.tradePropsFile: "config/tradelists/trader-{type}"` substitutes that same `type`
variant value into the tradelist filename — so the `type` variant state *is* the specialization
code, and that's the only join key that exists. `apps/vs-wiki/src/ingest/index.ts` re-expands `entities/` via
`expandVariants` (rather than reusing `extractLoot`'s `creatureRoster`, which only keeps the
already-flattened code, not each variant's `groupValues`) and, for every concrete entity variant
whose `type` value matches a loaded specialization's code, records it as a `TraderEntityRef`
(`domain` + concrete `code`, e.g. `trader-male-treasurehunter-cold`) on that `TradeList`'s new
`traderEntities` array — one specialization resolves to several entities (every gender x climate
combination, 6 for vanilla trader-{male,female}). This isn't hardcoded to the literal string
"trader": any entity (vanilla or modded) whose `type` variantgroup states overlap a loaded
specialization code is picked up the same way. The 9 vanilla `trader-*` specializations all
resolve to entities this way; the 8 `villager-*` tradelists intentionally resolve to none, since
named villagers aren't assigned a specialization through this `type`-variant mechanism at all.
Both the flat table and each detail page link `traderEntities` entries to their real
`/creatures/<domain>/<code>/` page.

## NPC Dialogue (`models/dialogue.ts`)

NPC dialogue trees (`config/dialogue/<name>.json`) were previously out of scope (see
`models/trades.ts`'s old doc comment) because the real data is a genuine branching state machine —
a flat `components` array of talk/condition nodes wired together by `jumpTo` targets and
player/entity variable conditions, not flat flavor text. Rather than render that graph, each NPC's
dialogue is flattened to the two facts actually useful on a wiki page: every line its side of the
conversation can say (across every branch, not in any one fixed order), and every item it can hand
over as a reward (the `giveitemstack` trigger — the only reward-shaped trigger among the ones
actually observed: attack/closedialogue/giveitemstack/openhairstyling/opentrade/playanimation/
repairheldarmor/repairheldtool/revealname/spawnentity/takefrominventory/unlockdoor; its mirror
image, `takefrominventory`, is "player pays the NPC" and isn't a reward). Line text resolves
through lang keys the same way lore/guide text does (`resolveLangRef`, now shared in `codeUtil.ts`
rather than duplicated per model), with any embedded `handbook://`/`handbooksearch://` links
rewritten by the same `rewriteHandbookLinks` helper guide text uses (none actually occur in the
dialogue data as shipped, but the mechanism is identical so it's reused rather than skipped).

Vanilla ships 24 dialogue files, not just `trader.json`: a `trader`/`treasurehunter` pair shared by
both trader genders (`entities/humanoid/trader-{male,female}.json`'s `dialogueByType` glob keys —
`"*-treasurehunter-*"` vs `"*"` — resolved the same `resolveByType` way drops/spawn conditions
are), a generic `villager` file plus 18 per-named-villager files (`entities/humanoid/
villager.json`'s own `dialogueByType`, keyed by full concrete variant code rather than a glob), and
3 files (`skeletonarm`/`skeletonwithloot`/`resonator`) belonging to inanimate "conversable" lore
props for the Resonance Archive puzzle that have no "health" server behavior and so never get a
`/creatures/` page — `models/dialogue.ts` only extracts entities that pass the same
`hasHealthBehavior` check `models/loot.ts` uses for `creatureRoster`, so those 3 are intentionally
excluded (a `config/dialogue/example.json` template file, pointed to by no real entity, is likewise
never reached, since extraction walks outward from entity variants to their dialogue file rather
than inward from dialogue files to a guessed owner). BetterRuins adds two more dialogue files of
its own (`agriculture`/`luxuries`) via a patch extending the same trader `dialogueByType` map with
domain-prefixed targets (`betterruins:config/dialogue/agriculture`) — handled for free by the same
domain-prefix-or-fallback resolution (`splitDomainCode`) every other cross-mod reference uses.

One real bug hit and fixed here: `villager.json` declares its `conversable` behavior two different
ways depending on *where* you look — a bare `{code: "conversable"}` placeholder sits in its
`server.behaviors` array (carrying neither `dialogue` nor `dialogueByType`), while the actual
config lives separately under a top-level `behaviorConfigs.conversable` object. Checking the
behaviors array first (as every other `*ByType` field in this pipeline does) finds the placeholder
and wrongly concludes the entity has no dialogue at all. `findConversableConfig` checks
`behaviorConfigs.conversable` first, falling back to a behaviors-array entry only if it actually
carries one of the two fields itself — `trader-{male,female}`/`skeletonarm`/`skeletonwithloot`/
`libraryresonator` only ever use the array form, so both shapes are real and neither predicts the
other.

Rewards cross-link in both directions the same way loot drops do: `NpcDialogue.rewards` is shown
directly on the creature's own `/creatures/` page (linking to the reward item's `/items/` page),
while a second flat array, `generated.dialogueRewards` (mirroring `generated.loot`), lets
`ItemIndexEntry.npcRewards` store indices into it so a reward item's own page can list every NPC
that can give it — the exact same "flat array + ids-into-it" shape `ItemIndexEntry.droppedBy`
already uses for loot.

## Creatures vs. Items (`/<lang>/creatures/`, `/<lang>/items/`)

Content is organized by *what the thing is*, not by *mechanism*: `/creatures/` is entity-only
(health, hitbox, tags, spawn conditions, and its own drop table), while every block's drops —
"this block drops X when broken" — live directly on that block's own `/items/` page instead of a
separate listing, right alongside what produces/consumes it. `/creatures/` is **not** just "every
entity that happens to have a drop table" — that definition silently excluded real creatures with
none at all (traders, villagers, locusts, ...). `models/loot.ts`'s `extractLoot` also returns a
`creatureRoster` (every entity variant with the "health" server behavior, i.e. actually alive,
regardless of drops — this is also what correctly excludes non-creature utility entities like
boats/arrows/elevators, which never have one); `apps/vs-wiki/src/ingest/index.ts` seeds `generated.creatures`
from that complete roster first, then merges in real drop entries (grouped the same way as
before, `LootSourceGroup`) where they exist, leaving `entries: []` where they don't rather than
omitting the creature entirely. Block-kind groups become `generated.blockDrops`/
`blockDropsById`, looked up live by each item page via its own `domain:code` (no stored id list
needed, same pattern as the deposit/blockpatch lookups below). A block that only drops something, with no recipe or worldgen
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

- **`/<lang>/sources/<id>/`** — one page per top-level listing (items, recipes, creatures,
  structures, deposits, crops, trees, fruit-trees, paintings, tapestries, clothing, lore, guides,
  trades, classes, mods), naming the exact raw game-file globs that feed it and a prose
  explanation of how they're processed, generated from `apps/vs-wiki/site/_data/pipelineSources.json`
  (per-page metadata: id/title/globs/model files) via one shared template
  (`apps/vs-wiki/site/sources/sources.njk`) that dynamically includes a per-id prose partial from
  `apps/vs-wiki/site/_includes/sourcedocs/<id>.njk`. Every top-level listing page links to its own source page
  (its existing "Source: ..." one-liner gained a "Full details →" link); `/<lang>/sources/` is
  the index of all of them, also linked from the home page. This is hand-authored documentation
  *about* the pipeline, not pipeline output itself — unlike `apps/vs-wiki/site/_data/generated/`, it's a
  regular tracked file, not gitignored. Keep it in sync the same way README.md itself needs to
  stay in sync with real pipeline changes — a new content-type model or a changed glob should
  update its matching `pipelineSources.json` entry and `sourcedocs/` partial.
- **`/<lang>/items/`'s coverage caveat is a prominent callout** (`.coverage-note` in
  `style.css`), not just a muted one-liner — spelling out every concrete way an item/block can
  earn a page (recipe, drop table, worldgen spawn rule, trade listing, NPC dialogue reward) so
  it's unambiguous this is a cross-referenced graph, not a registry dump. The same `.coverage-note`
  style is reused on the structures/creatures/tapestries source pages for their own non-obvious
  caveats (chance-as-weight, the full living-entity roster, the tapestry reroll mechanic).
- **`/<lang>/research/`** — `RESEARCH.md` published the same way `INFO.md` → `/info/` already
  was (`apps/vs-wiki/eleventy.config.js`'s `researchHtml` global data, `md.render(readFileSync("RESEARCH.md"))`),
  referenced from `/info/`. Investigation notes; each section says whether it has since been implemented.
- **Header "Tools" dropdown** (`apps/vs-wiki/site/assets/nav.js`, next to the Info link) lists every
  individual tool (built and WIP) as a direct link, mirroring the home page's own expanded Tools
  section and `/tools/`'s own per-tool anchors.
- **Sort state also round-trips through the URL** (`?sort=<colIndex>&dir=asc|desc`, numbered
  `sort2`/`dir2`/... the same way the filters are) — a sorted view can be bookmarked/shared just
  like a filtered one now, not just reset on reload.
- **Smithing/clayforming/knapping recipe patterns have two views, one shown at a time**, inside
  one bordered container: a toolbar with labeled View ("3D model | 2D layers"), Show (3D layer
  mode) and Layer (tab per layer) groups, over a stage holding the 3D canvas or the 2D slice.
  Controls that don't apply right now are disabled, never hidden, so the Layer tabs stay in the
  same spot in both views. The chosen view is remembered across pages via `localStorage`.
  - 2D: one flat slice grid per layer, picked with the Layer tabs (`apps/vs-wiki/site/assets/layers.js`).
  - 3D: an interactive voxel model (orbit/zoom/pan) with three layer modes: "All layers", "One
    layer", or "Layer N and below". The last two use the same Layer tabs, so the selected layer
    carries over between views.
  - The slice grids are plain server-rendered HTML. Without JS/WebGL the toggles stay hidden and
    the 2D view is all that shows.
  - `libs/vs-schematic/src/voxelViewer.ts` is the **generic renderer core** (`createVoxelViewer(container,
    {voxels})` → `setStyle`/`pick`/`resetView`/`dispose`; generic over the caller's voxel type). It knows nothing about recipes and is
    reused by the schematic viewer (`apps/vs-wiki/site/assets/schematicViewer.js`, see "Tools" below) and the VS Code extension. It uses one
    `InstancedMesh` per opacity with per-instance colors and renders on demand only.
    `apps/vs-wiki/site/assets/recipeVoxels.js` is the recipe-specific adapter: `pattern[layer][row][col]` →
    `y = layer` (Layer 1 at the bottom), `z = row`, `x = col`.
  - **Three.js is the project's only browser-side library dependency.** It's pinned exactly in
    `package.json` (no `^`) and copied out of `node_modules/three` into `/assets/vendor/three/` by
    `apps/vs-wiki/eleventy.config.js` passthrough. It's never loaded from a CDN. A global `<script
    type="importmap">` in `layouts/base.njk` maps the bare `three` / `three/addons/` specifiers.
    To add another Three.js addon, add it to that passthrough map.
- **Every listing is one real `<table>`**, not a grid-list of plain links, with pagination, a
  free-text search box, and — whenever rows carry a `data-category`/`data-mod`/`data-tags`/
  `data-description` — an
  auto-populated multi-select filter panel for it (a button that opens a checkbox list; hidden only
  if no row has a value for that dimension at all — a single distinct value still shows it).
  Checking several boxes within one dimension matches rows with ANY of them (OR within a
  dimension); category/mod/tag/description/free-text search are ANDed together across dimensions.
  The Description filter ("Has description" / "No description", `?description=yes|no`) is on
  items, clothing, paintings, classes and traits: whatever has a localized
  `itemdesc-`/`blockdesc-`/`characterdesc-`/`traitdesc-` lang string. Every active
  value, from any dimension, also shows as a removable chip below the controls row. Sections with
  zero rows (e.g. an item with no known recipe) are omitted entirely rather than shown empty.
- **Item/block pages show their description and a "Game logic (C#)" table.** The table lists the
  C# names the item's own JSON points at (`class`, `entityClass`, `behaviors`, `entityBehaviors`)
  and links each one to its implementing `.cs` file on GitHub.
  - The name-to-file mapping is a committed snapshot, `apps/vs-wiki/src/ingest/csharpClassMap.json`, generated
    by hand with `npx tsx apps/vs-wiki/scripts/map-csharp-classes.ts`. The script reads the local gitignored
    `vssurvivalmod/` clone and matches each `api.Register...Class("Name", typeof(Type))` call to
    the file declaring `Type`.
  - Links are pinned to the clone's commit, so line anchors stay right. The C# source never enters
    the build.
  - Names implemented outside vssurvivalmod (VSEssentials, the engine, mod DLLs) show unlinked.
  - Re-run the script after updating the clone, e.g. on a game version bump.
- **All filter state lives in the URL** (`?q=`, and `?category=`/`?mod=`/`?tag=` as
  comma-separated lists of active values, e.g. `?category=block,item&tag=tool,weapon`, numbered
  `q2`/`category2`/... for a 2nd+ table on the same page) via `history.replaceState`, so a
  filtered/searched view can be bookmarked, shared, or revisited with back/forward navigation. See
  `apps/vs-wiki/site/assets/datatable.js`. `tag` matches exact tokens split out of the space-separated
  `data-tags` attribute, not the free-text `q` substring search — a tag link shouldn't also match
  unrelated rows whose name/code happens to contain the same substring.
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
  each page's `permalink` via the `lang` global data value (apps/vs-wiki/eleventy.config.js), composed with the
  `('/' ~ lang ~ '/') | url` idiom instead of the plain `'/' | url` one used for shared,
  non-language-specific assets (css/js/favicon/og-image, which stay outside the prefix). The bare
  site root (`/index.html`) is a tiny meta-refresh redirect to `/en/` (`apps/vs-wiki/site/redirect.njk`). This is
  routing-only prep for a second language later — nothing currently generates non-English content,
  and `LANG_PREFIX` is the only knob, overriding the default `"en"` for local experimentation.
- **Footer build info**: every page shows when it was generated (stored in UTC, rendered
  client-side as a relative time string — see `apps/vs-wiki/site/assets/build-time.js`), linking to the site's
  own **`/<lang>/build/`** page (`apps/vs-wiki/site/build/index.njk`) rather than straight to GitHub. The " ago"
  suffix lives in a separate sibling element so "just now" doesn't read as "just now ago".
- **`/<lang>/build/`** is the full build/CI detail page the footer links to: repo, branch, commit
  sha/message/author, and (in CI) a link to the actual GitHub Actions run — all resolved in
  `apps/vs-wiki/eleventy.config.js`'s `buildInfo` global data from `GITHUB_SHA`/`GITHUB_REPOSITORY`/
  `GITHUB_RUN_ID`/`GITHUB_HEAD_REF`/`GITHUB_REF_NAME` (set automatically by every Actions run) with
  a local-git (`git log`/`git rev-parse`) fallback for everything except the CI run link itself.
  `buildInfo.isCi` (true only when `GITHUB_ACTIONS === "true"`) drives a clear "local build — no
  CI metadata available" state on that page for local/dev builds, instead of either hiding the
  section or showing something misleadingly CI-flavored.
- **Pipeline phase timings**, also surfaced on `/<lang>/build/`: each of the three phases
  (`npm run download`, `npm run ingest`, the Eleventy site build) persists its own wall-clock
  duration as a small JSON file under `apps/vs-wiki/site/_data/generated/` — `downloadTiming.json`
  (`apps/vs-wiki/scripts/download.ts`'s `main()`), `ingestTiming.json` (`apps/vs-wiki/src/ingest/index.ts`'s `main()`), and
  `eleventyBuildTiming.json`. These are three separate process invocations (in CI, three separate
  workflow steps, possibly minutes apart), so each is written to disk rather than held in memory —
  see the matching `DownloadTiming`/`IngestTiming`/`EleventyBuildTiming` interfaces in
  `apps/vs-wiki/src/ingest/types.ts`. Each phase also breaks down per step: ingest records one duration per
  `step("...")` section (`ingestTiming.steps`), download records a duration for the server install and
  each mod; both are shown as tables on the build page. (`npm run rebuild` re-runs only the Eleventy
  build, reusing the existing generated data.) `downloadTiming.json` also records a per-mod `"downloaded" |
  "skipped-present" | "failed"` outcome and an overall `anyDownloaded` flag, since a cache-hit
  download run (the common case in CI) legitimately finishes in a couple of seconds — the flag is
  what distinguishes that from something being silently broken.
  **Eleventy can't report its own total duration to its own templates** — the number isn't known
  until the process is already exiting, after every page (including `/<lang>/build/` itself) has
  already rendered. Resolved with `apps/vs-wiki/scripts/build-site.ts`, a thin wrapper that runs the real
  `eleventy` CLI as a child process, times the whole invocation from outside it, and writes
  `eleventyBuildTiming.json` only once that child exits — `npm run build` and the CI "Build site"
  step both invoke this wrapper instead of `eleventy` directly now. The unavoidable consequence:
  the number `/<lang>/build/` shows for the site-build phase is always **one full build run
  stale** (it describes the *previous* successful build, not the one currently rendering that
  page) — the page labels it that way explicitly rather than presenting it as live.
  In CI the file is carried between runs with `actions/cache/restore` + `actions/cache/save`
  (unique `eleventy-timing-<run_id>` key, restored by the `eleventy-timing-` prefix) around the
  "Build site" step, since `apps/vs-wiki/site/_data/generated/` is gitignored and otherwise starts empty.

## Weapons & Tools (`models/gear.ts`)

`/weapons/` is one sortable table of every weapon, tool and ammo variant with a numeric stat:
durability, melee attack power/reach, ranged `attributes.damage`, attack tier (`damageTier`, same
armor-comparison meaning as a creature's Tier), tool (mining) tier and best mining speed. Stats are
read per concrete `itemtypes/` variant from `*ByType` maps, with a case-insensitive property lookup
(files mix `attackpowerbytype`/`damageByType`). Each entry is also given an `/items/` page via
`ensureSpawnTarget`, so the table's name links always resolve. Related fix: `expandVariants` now
treats a definition's `allowedVariants`/`skipVariants` entries as globs (previously exact match, which
silently dropped e.g. every `spear-generic-*` metal spear, and also under-generated some fish and
animal variants).

## Clutter, crop nutrients and alloy calculator

- **`/clutter/`** (`apps/vs-wiki/src/ingest/models/clutterInstances.ts`): the `clutter` block is one code whose real identity
  (skull, statue, broken anvil...) is a per-instance `type` attribute in the placed block's entity data. Every
  structure schematic containing a clutter code is decoded (same Ascii85/TreeAttribute decoder as tapestries) and
  grouped by type, with names from the `clutter-<type with "/" → "-">` lang keys and the structures using each.
- **Crop nutrients**: `models/blockpatches.ts` attaches each crop's `cropProps` (`requiredNutrient` N/P/K,
  `nutrientConsumption`, `totalGrowthMonths`) to its `/crops/` rows; the columns are sortable and filterable.
- **`/tools/alloy/`** (`apps/vs-wiki/site/assets/alloyCalculator.js`): alloy ranges (`recipes/alloy`) and bit stack sizes are
  rendered into the page as JSON; the script finds the most bits a 4-slot crucible holds at a chosen ratio.
- Trader pages use `TradeList.displayName` (the localized trader entity name without its climate suffix) and show
  min and max price/stock as separate columns.
- Storage vessels, chests, trunks, baskets and cluttered bookshelves are forced into the item index through
  `vs-manifest.json` `includeItems` globs, so their pages list the structures they appear in.

## Testing

`npm test` runs every package's `test/*.test.ts` (`libs/*/test`, `apps/*/test`) with Node's built-in runner via
`tsx --test` (no extra dependency), and CI runs `npm run typecheck` + `npm test` right after `npm ci`. The test
files: in `libs/vs-schematic/test`, `schematicDecode` (the decoder, below) and `schematicVoxels` (packed-index
voxels, `meta-filler` hidden by default, gzip fetch); in `apps/vs-vscode-extension/test`, `webviewHtml` (CSP and
element ids of the preview shell); in `apps/vs-wiki/test`, `decodeIntegration` (the committed sample schematic and
ingest's `DecodeStats`, which need wiki-owned files), `climate` (the seed climate port vs. an independent
re-implementation), `handbookLinks` (`rewriteHandbookLinks`), `schematics` (glob resolution, ids/page
paths, the structure→schematic index, gzip round trip and its reuse). The decoder test covers
`libs/vs-schematic/src/schematicDecode.ts`: Ascii85, each `TreeAttribute` type code, hostile array lengths
(regression for the slow-ingest bug in `FINDINGS_SLOW.md`) and flat tapestry/clutter blobs; the committed
`apps/vs-wiki/site/tools/schematic/samples/default.json` is checked by `decodeIntegration`. Blobs are built by hand in the tests rather
than copied from game files. The attribute layouts were
checked against `vsapi`'s `*Attribute.cs` `FromBytes` (ids 1-16, incl. type 7 ItemStack, which decodes to
`{itemClass, id, stackSize, attributes}`; `id` indexes the schematic's own `ItemCodes`/`BlockCodes`, no
running game needed). An id the game doesn't register throws, as it would in-game. `npm run decode-stats`
(`apps/vs-wiki/scripts/decode-stats.ts`, opt-in since it needs the gitignored game data) scans every local schematic and
prints the throw rate, which should stay 0. `tapestryInstances.ts`/`clutterInstances.ts` skip a blob that
fails to decode, but count it in a shared `DecodeStats` (`schematicHeader.ts`) that `index.ts` logs per step
(`decoded N/N block entities`, plus a `WARNING` with examples if any failed; it never aborts the ingest).

## Block colors (schematic viewers)

The schematic viewer and the per-schematic 3D preview colour blocks from
`apps/vs-wiki/site/assets/Nf3tBlockColors.json`, a **committed, hand-refreshed data file** (not produced by the
pipeline). It comes from the BlockColorMod game mod
(<https://github.com/jgwoolley/translocator-locator-cmd>), which writes `Nf3tBlockColors.json`, the real colour of every block the
running game has loaded: `"domain:code": { "hex": "#RRGGBB", "alpha": 0 }` (alpha is ignored). The mod's `hex` is actually **BGR** (soil is `#1D3954`, copper `#3B60AA`),
so `parseBlockColors` swaps red and blue on load; if the mod is ever fixed to write RGB, remove that swap.

- **It must be regenerated when the game version or the mod list changes.** New or renamed blocks (including
  every block of a newly added mod) are not in the file until you re-run the mod in a game with those mods
  loaded and replace `Nf3tBlockColors.json` with its output.
- Blocks missing from the file get a stable hash-derived colour (`stringToColor`), so a stale file looks
  random for the missing blocks instead of breaking. Lookup is in `libs/vs-schematic/src/blockColors.ts`
  (`blockColor`; a code without a domain is looked up as `game:<code>`).
- **Visitors can override it**: the schematic viewer has a "Block colors file" upload. The file is validated,
  applied immediately, and remembered in the browser's `localStorage` (key `vsWiki.blockColors`), where the
  viewer and the schematic-page previews read it in preference to the bundled file; "Use bundled colors" clears it.
- The VS Code extension does not use the file yet; it still uses generated colours.

## Tools (`/tools/`)

The schematic viewer, WayPoint planner and calendar were merged in (with git history) from the user's
former standalone projects `vintage-story-schematic-preview` and `vintage-story-price-guide`; the alloy
calculator (see above) and the seed climate lookup were written here. All are fully client-side:

- **`/tools/schematic/`** — `apps/vs-wiki/site/tools/schematic/index.njk` + `apps/vs-wiki/site/assets/schematicViewer.js`.
  A schematic adapter on `voxelViewer.ts` (`Indices`/`BlockIds` → voxels; legend, floor slider,
  click-to-inspect with `schematicDecode.ts` decoding block-entity blobs; its legend names come from
  `generated.blockNames` (`models/blockNames.ts`, served as `/assets/blockNames.json`)). Upload any schematic
  `.json`, or pick a bundled sample from `apps/vs-wiki/site/tools/schematic/samples/` (copied to
  `/assets/schematics/` by an `apps/vs-wiki/eleventy.config.js` passthrough). `?schematic=<domain>/<relPath>` opens one of
  the wiki's own worldgen schematics (see "Schematics vs. structures" below).
- **`/tools/waypoints/`** — `waypoints.js` (pure logic: distance, Dijkstra route, import/export
  validation), `waypointMap.js` (SVG map), `waypointsPage.js` (DOM wiring); state lives in
  `localStorage`. This replaces the price guide's React/MUI/Cytoscape implementation with no
  library dependency. The upload also accepts the translocator-locator mod's `Nf3tData.json` (keyed by savegame GUID:
  translocators with target locations, the game's waypoints, spawn, last route; the page asks which savegame to
  load, see `isModData`/`importModData`; coordinates display relative to the savegame's spawn, and a game waypoint on the
  same spot as a translocator is dropped in favor of the translocator). The page explains where the mod writes it (`ModData`, e.g.
  `~/.config/VintagestoryData/ModData` on Linux).
- **`/tools/climate/`** — `apps/vs-wiki/site/assets/climate.js` (pure logic, no DOM: a port of the game's realistic
  climate generator, i.e. `NoiseClimateRealistic`/`MapLayerClimate`/`Climate.cs`; BigInt for the 64-bit
  LCG, `Math.fround` for C# floats), `climatePage.js` (DOM wiring + a temperature canvas) and
  `apps/vs-wiki/site/tools/climate/index.njk`, which embeds every wild patch/tree/fruit-tree climate band from
  `generated.blockPatches`/`trees`/`fruitTrees` so the page can list what grows at the computed climate.
  Approximate by design: the game's simplex wobble, forest/shrub maps and landforms aren't ported, and only
  numeric seeds work. `apps/vs-wiki/test/climate.test.ts` checks the generator against an independent re-implementation.
- **`/tools/calendar/`** — `calendar.js`, a small game-date → elapsed days / real hours converter.

The price guide's Next.js trades page was *not* ported: `/trades/` (`models/trades.ts`) supersedes it.

One page is still an intentionally empty stub, explaining in-page what's planned and exactly
where the underlying game data already lives, rather than silently having no page at all
(`/guides/` and `/trades/` were in this category once but are both now fully implemented —
`/trades/` has its own section above; `/guides/` is `models/guides.ts`, sourced from
`config/handbook/00-starterguide.json` through `19-stonelayers.json`):

- **`/tools/`** — the remaining planned tools: a proper painting/tapestry-in-ruins lookup evaluated directly against
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

- Chiseled blocks (`chiseledblock`) are drawn in the schematic viewers as one full unit cube, not their real
  sub-block shape, and every block is a hash color rather than its texture. The chisel data is fully
  decodable (138k chiseled blocks across the schematics, validated); see RESEARCH.md topic 6 for what drawing
  the shape would take.
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
- A structure is shown as the list of the schematics it can place, each viewable in 3D on its own. A
  village's buildings are not assembled into one scene: the engine places them by rules that aren't in the
  game data.
- `condition`-gated patches assume the "Default" world-creation preset; a world created with
  non-default settings would see slightly different effective data.
- Compiled-code mods (currently: Stone Quarry) are flagged but otherwise invisible to this
  pipeline — see "Compiled-code mods are a real, current blind spot" above.

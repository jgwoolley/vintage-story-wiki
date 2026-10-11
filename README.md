# Vintage Story Wiki

A statically-generated wiki documenting Vintage Story crafting recipes, drop rates, and
world-generated structures, built directly from the game's own asset data (vanilla server +
installed mods) rather than hand-maintained.

## How it works

1. **`vs-manifest.json`** pins the vanilla server version/branch and the list of installed mods
   (`modid` + version). This is the single source of truth for what the wiki documents.
2. **`npm run download`** wraps `download.sh` using that manifest, downloading the vanilla
   dedicated server into `vs_server/` and mod `.zip` files into `Mods/` (both gitignored).
3. **`npm run ingest`** (`src/ingest/`) reads those raw game assets and produces normalized JSON
   under `site/_data/generated/` — recipes, loot/drop tables, worldgen structures, and a
   cross-referenced item index. See the pipeline stages below.
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
- **`schematicHeader.ts`** — lists and reads only the lightweight header fields (dimensions, a
  block-code count) of `worldgen/schematics/**/*.json` files, without parsing their huge
  `Indices`/`BlockIds`/`BlockEntities` voxel payloads.
- **`patchEngine.ts`** — collects every `patches/**/*.json` file (vanilla + mods), filters by
  `side`/`dependsOn`/`condition` (world-config conditions are resolved against the "Default"
  world-creation preset) and by the `compatibility/<othermodid>/` folder convention, then applies
  the active patches (including the VS-specific `addmerge` op) to compute the *effective* merged
  JSON per target file.
- **`variantExpander.ts`** — resolves `variantgroups` (inline `states` and/or
  `loadFromProperties` worldproperty references) into concrete item/block codes, and resolves
  `*ByType` glob/regex-keyed maps (e.g. `dropsByType`) per concrete variant.
- **`lang.ts`** — resolves display names from each domain's own `lang/en.json`, falling back to
  vanilla's shared `game/lang/en.json`, with glob (`block-foo-*`) lang keys supported.
- **`models/{recipes,loot,structures}.ts`** — normalize the 7 recipe categories, the 4 drop
  mechanisms (block drops, panning, entity death drops, harvestable drops), and the 4 worldgen
  registries (structures, villages, story structures, hook-generated structures) into common
  shapes.
- **`crossref.ts`** — builds the item index (which recipes produce/consume an item, which
  blocks/entities drop it), resolving recipe-level wildcard/template placeholders (e.g.
  `plank-{wood}`) into concrete linked items.

## Display names (`lang.ts`)

Resolving a correct display name turned out to need two fixes verified against the actual game
source (`anegostudios/vssurvivalmod`, `vsapi` on GitHub), not just the asset JSON:

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

After both fixes, vanilla item/block display names resolve at ~97%. The remaining gaps are real
upstream data, not pipeline bugs: a few vanilla blocks (lanterns, scroll racks, figureheads) whose
material is a runtime attribute rather than part of the registered code (so there's no single
"the" display name for the block in isolation), and a larger set of BetterRuins' own decorative
schematic-only blocks that the mod itself never added lang entries for.

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
wasn't worth it yet. Compiled-code mods remain an explicit blind spot as a result — revisit this
if a mod that actually ships compiled behavior needs documenting.

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

- **The item/block catalog only lists things reachable from a recipe or a drop table.**
  `generated.items` (`crossref.ts`) is built by walking recipe ingredients/outputs and loot
  entries, not by enumerating every `itemtypes`/`blocktypes` definition in the game. Purely
  decorative content that's neither crafted nor dropped never enters it — e.g. `tapestry`
  (`blocktypes/cloth/tapestry.json`, which the game's *own* in-game Handbook explicitly excludes
  too via `attributes.handbook.exclude: true`) and `painting` (obtained only through worldgen
  placement or the creative-mode `/giveblock` command). Around 100 other blocktype/itemtype files
  carry the same handbook-exclude/admin-only pattern and have the same gap. Closing it would mean
  switching the item catalog from a recipe/loot graph to a full registry walk — a bigger change
  than this note, flagged here rather than taken on silently.
- Schematic geometry (the actual block-by-block layout of a generated structure) is not decoded —
  only dimensions and a block-code inventory count are shown.
- `condition`-gated patches assume the "Default" world-creation preset; a world created with
  non-default settings would see slightly different effective data.

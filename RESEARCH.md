# Research notes

Investigation notes. Unless a section says otherwise, nothing here has been implemented.
Each section below is one of the four research tasks requested, with findings from the real game
data and a recommended approach for a future implementation session to pick up.

## 1. Collapsing direction/orientation variants that share one localization name

**The question**: do blocks with north/south/east/west (or similar orientation) variants that all
resolve to the same display name get surfaced as separate rows on `/items/` unnecessarily, and
could they be summarized into one row?

**Findings**:
- The display-name *resolution* side of this already works correctly today. `lang.ts`'s
  `lookup()` does wildcard/glob matching (`splitExactAndWildcard` + `globToRegExp`), and the real
  lang files already author exactly this pattern for orientation-only variant families — e.g.
  `"block-door-solid-*": "Solid door"`, `"block-door-ruined-rough*": "Ruined door"`,
  `"block-door-1x3gate-*": "3-tall door"` (`vs_server/assets/*/lang/en.json`). So a door's 8+
  concrete orientation/open-state variants already collapse to one shared `displayName` string.
- The problem is purely on the *listing* side: `crossref.ts`/`index.ts` build one
  `ItemIndexEntry` per **concrete code**, not per display-name group, so `/items/` still shows one
  row per orientation variant even though several rows have an identical `displayName`. This is
  confirmed widespread — `palisadewall.json` alone (`variantgroups`: logs × type × layout × side,
  with a `side` dimension loaded from `abstract/horizontalorientation`) generates dozens of
  concrete codes that all share whatever name their `type`/`layout` wildcard key matches, varying
  only in orientation. Doors, palisade walls, ladders, and most "placed with `HorizontalOrientable`
  behavior" blocks are the same shape of problem.
- `variantgroups` entries that come from `loadFromProperties: "abstract/horizontalorientation"` (or
  similarly-named direction/rotation worldproperty files) are a strong, cheap signal for "this
  dimension is pure orientation, not a distinct item" — confirmed real across several block files,
  not a one-off. A dimension literally named `side`/`direction`/`rotation` sourced from that kind of
  abstract worldproperty file is a good heuristic starting point, separate from a dimension like
  `metal`/`wood`/`type` that genuinely changes the item.

**Recommended approach (not implemented)**:
1. At ingest time, for each concrete `ItemIndexEntry`, also compute a "display group key" = `(domain,
   baseCode, displayName)` — i.e. group by resolved display name within the same base block, not by
   full concrete code.
2. On `/items/` specifically (not on a block's own detail page — the detail page should still show
   its own real concrete code), collapse rows sharing a display-group key into one row, picking a
   representative concrete code to link to (e.g. the alphabetically-first, or whichever orientation
   variant isn't in a `skipVariants` list) and showing something like "× 8 orientations" as a
   secondary annotation.
3. This must NOT merge rows whose variant differs in something that genuinely changes the item
   (metal, wood species, rock type, etc.) even if by coincidence two unrelated codes happened to
   share a display string — grouping strictly by `(baseCode, displayName)` together, not display
   name alone, avoids that.
4. Watch for the already-documented `resolveByType`-must-pick-most-specific-match gotcha
   (`variantExpander.ts`) if this grouping logic ends up needing its own glob resolution.

## 2. Rendering smithing/clayforming/knapping layers in 3D

**Status: implemented.** Recipe pages now show an interactive 3D voxel model, built on a shared
renderer meant to be reused for schematics. One correction to the findings below: smithing
patterns are *not* always a single layer. 22 of the 48 vanilla smithing recipes have 2–5 layers
(e.g. the helve hammer has 3).

**The question**: recipe voxel patterns ("layers") currently render as flat text — should they be
shown as an actual 3D shape instead?

**Findings**:
- `site/recipes/recipes.njk`'s voxel-pattern branch (`recipe.category == "smithing" or
  "clayforming" or "knapping"`) currently renders `recipe.raw.pattern` as a stack of `<pre>` text
  blocks, one per layer, with no visual/3D representation at all — just literal ASCII rows of
  `#`/`_` characters under a "Layer N" label.
- **Smithing recipes are always exactly 1 layer** (confirmed: every file checked under
  `recipes/smithing/` has `pattern.length === 1`) — a smithing recipe is inherently a flat 2D
  hammering pattern on one work-piece face, so "3D" for smithing specifically would mean rendering
  that one flat grid as a small shaded/extruded plate rather than raw text, not a true multi-layer
  voxel model.
- **Clayforming genuinely has multi-layer 3D voxel shapes** — confirmed real depth, not a one-off:
  `anvilmold.json` (11 layers), `clayoven.json` (16 layers), `clayplanter.json` (9), `crock.json`
  (7), `crucible.json` (7), `bullets.json` (3), `axemold.json`/`blade-falxmold.json`/`bowl.json` (2
  each). These are the ones that would benefit most from an actual 3D voxel preview, since stacking
  16 separate ASCII text blocks is genuinely hard to read as a shape today.
- Knapping wasn't spot-checked in as much depth but uses the exact same `pattern`
  shape/parsing (`parseVoxelShaped` in `src/ingest/models/recipes.ts`), so whatever rendering
  approach is picked should cover all three categories uniformly, the same way the ingest side
  already does.

**Recommended approach (not implemented)**:
1. This is purely a presentation change — no new ingest data is needed. `recipe.raw.pattern`
   already has everything (rows of `#`/`_` per layer, in order).
2. A lightweight client-side option: render each layer as a small `<canvas>` or CSS-grid 2D
   top-down view (quick win, still 2D but far more readable than raw text), OR go further and
   stack the layers into a genuine isometric/3D view using a minimal WebGL/CSS-3D approach (no need
   to pull in a full 3D engine for this — it's just colored unit cubes on a grid, not textured
   geometry).
3. If the planned `/tools/` schematic viewer (see topic 3 below) ends up using a real 3D rendering
   library for schematic voxels, strongly consider reusing that same renderer here instead of
   building a second, separate 3D code path — the data shapes are different (recipe `pattern` rows
   vs. schematic `Blocks`/`BlockIds` arrays) but the "draw a grid of unit cubes" rendering core
   would be shared.
4. Smithing (1 layer) can probably ship a simpler "flat plate" version of whatever renderer is
   built for the multi-layer case, as a reduced case rather than a separate implementation.

## 3. Integrating jgwoolley/vintage-story-schematic-preview (upload + in-browser viewing)

**Status: upload + bundled samples implemented** (`/tools/schematic/`, as an adapter on the shared
`voxelViewer.js`). Still open: browsing this wiki's own `worldgen/schematics/**` in the viewer.
The findings below are the pre-implementation notes.

**The question**: what would it take to pull in upload + browser-side viewing from the external
schematic-preview project, beyond the decode logic already adapted earlier this project?

**Findings**:
- The binary decode layer is **already done and already browser-ready** — `site/assets/
  schematicDecode.js` is a verbatim-ported, dependency-free ES module (`Ascii85`,
  `TreeAttributeParser`, `decodeBlockEntity`) with zero Node-specific or DOM-specific APIs,
  confirmed because it's already imported directly by the Node-side ingest pipeline
  (`src/ingest/models/tapestryInstances.ts`) with no shims. This file is already exactly what a
  `<script type="module" src="...">` on a future tools page would load — no rework needed there.
- What's genuinely missing is everything *around* that decode layer: (a) a file upload UI (an
  `<input type="file">` + `FileReader`, reading a `.json` schematic client-side — no server
  component needed, this is a fully static site); (b) parsing the schematic's `Blocks`/`BlockIds`/
  `BlockCodes` arrays into a 3D grid (not yet ported — `schematicHeader.ts`/`tapestryInstances.ts`
  only read the small header metadata and the `BlockEntities` attribute blobs respectively, neither
  touches the actual per-voxel block-id grid that a viewer needs to render full geometry); (c) an
  actual 3D renderer (the reference repo renders via Three.js, per the original plan file's
  description of the repo as using "THREE.js" for rendering — this project currently has zero 3D
  rendering code or library dependency of any kind).
- Reusing this wiki's own already-downloaded structure schematics (`worldgen/schematics/**`) for
  "view this wiki's own structures in 3D" (the second half of the existing `/tools/` WIP
  description) is a second, separable feature from "let a visitor upload their own arbitrary
  schematic file" — the upload case needs no server-side ingest involvement at all (pure
  client-side), while "browse this wiki's own schematics" would need those files made fetchable by
  the browser somehow (they currently only exist as ingest-time Node filesystem reads of the
  gitignored `vs_server/`/`Mods/` trees, never copied into the static `_site/` output) — a real,
  separate design decision (likely: copy a chosen subset of schematic JSON files into a static
  assets folder at build time) that the upload-only feature doesn't require at all.
- The external repo is a single-file `index.html` (per the original plan file's description, read
  in full during the earlier tapestry-decoding work this session) — meaning the Three.js usage,
  camera/controls setup, and render loop are all one more thing to port, not available piecemeal
  anywhere in this repo today.

**Recommended approach (not implemented)**:
1. Ship the upload-only case first — it's genuinely standalone (no server/build changes), reuses
   the existing decode module as-is, and delivers real value (anyone can inspect any schematic
   file, not just this wiki's own curated set).
2. Scope the voxel-grid parsing (`Blocks`/`BlockIds`/`BlockCodes` → a 3D array of concrete block
   codes) as new, dedicated client-side JS — a sibling to `schematicDecode.js`, not an extension of
   it, since it's a different part of the schematic format (bulk voxel grid vs. per-instance
   block-entity attributes).
3. Pin whichever 3D rendering approach is chosen to a specific version per this project's existing
   CSP/library-pinning convention (the artifact tooling's own rule of thumb applies generally here
   too: pin an exact version, don't float a tag) if a library like Three.js is added — this would
   be the first binary/3D dependency in the project, worth flagging explicitly in README.md when it
   lands.
4. "Browse this wiki's own schematics in the viewer" should be treated as a distinct follow-up
   phase, gated on deciding how (and how much of) `worldgen/schematics/**` gets copied into the
   static build output — don't conflate it with the upload feature's scope.

## 4. Resolution of "clutter" objects

**The question**: what are "clutter" blocks/items, and how/whether they should be resolved into
the existing catalogs (items, decor, etc.)?

**Findings**:
- "Clutter" is a real, fairly large vanilla content family, not a single block: 8 distinct files
  found — `blocktypes/clutter.json`, `itemtypes/clutter.json`, `blocktypes/aquatic/
  clutter-aquatic.json`, `blocktypes/devastation/clutter-devastation.json`, `itemtypes/meta/
  stackrandomizer-clutter.json` (a clutter-themed variant of the same `ItemStackRandomizer`
  mechanism documented elsewhere this session for Jonas Parts&Frames — see `LootMechanism`'s
  `"stackRandomizer"` case), and the three `bookshelf-clutter*.json` files (`bookshelf-clutter.json`,
  `bookshelf-clutter-agedacacia.json`, `bookshelf-clutter-lore.json` — the last one being the
  lore-bearing bookshelf, `class: "BlockClutterBookshelfWithLore"`, confirmed this session as a real
  gap: it has no recipe and no static drop table of its own, so it's currently invisible to the
  item index exactly the same way decor items were before `foundInStructures` existed).
- The generic `block-metalblock-<metal>`-style lang-key pattern (one shared name regardless of a
  cosmetic variant dimension) likely recurs for at least some clutter variants too — not fully
  verified across all 8 files in this pass, worth re-checking with the same technique used for the
  `metalblock-corroded-riveted-*` fix this session (grep the real lang file for the family's actual
  authored key shape before assuming any particular composition rule).
- `clutter` (the plain, undifferentiated item/block) already resolves a display name correctly
  today — confirmed via the generated item index (`"block-clutter": "Clutter"` is a plain exact lang
  key, no special composition needed) and already gets a real `/items/survival/clutter/` page
  through the normal pipeline, so "clutter has no name" is not a currently-live bug the way
  `metalblock-corroded-riveted-*` was.
- The real open question is less "does clutter resolve a name" and more "does clutter get full
  *content-type* treatment" — i.e., should `BlockClutterBookshelfWithLore` and similar
  special-behavior clutter blocks (ones with their own `entityBehaviors`, not just a cosmetic prop)
  get a dedicated extraction the way tapestries/paintings do, versus being left as a generic,
  recipe-less block that only shows up via the newly-generalized `appearsInStructures` reverse
  lookup (which already covers it today, just coarsely — confirmed `clutteredbookshelfwithlore`
  would be picked up by this session's `appearsInStructures` generalization since it's keyed by
  bare code regardless of content type, though this specific code wasn't individually re-verified
  post-merge).

**Recommended approach (not implemented)**:
1. Re-run the same "grep the real lang file for this family's actual key shape" check (that caught
   the `metalblock-corroded-riveted-*` bug) across all 8 clutter files specifically, rather than
   assuming the generic pipeline already handles every clutter variant correctly — this family
   wasn't exhaustively checked, only spot-checked.
2. Decide, block-by-block, whether a given clutter block is "just a decoration with no special
   behavior" (leave it as a generic item/block, relying on the generalized `appearsInStructures`)
   versus "has real entityBehaviors worth extracting" (`BlockClutterBookshelfWithLore` is the clear
   example — it's conceptually identical to the "book drops" ask from this same session's task
   list, i.e. a recipe-less, content-bearing block found in structures) — the latter category is a
   much better candidate for a small dedicated model (mirroring `models/decor.ts`'s pattern) than
   for being force-fit through the generic item index.
3. Specifically for `BlockClutterBookshelfWithLore`: investigate whether its lore content is
   runtime-randomized (picked at interaction/loot time, analogous to how tapestries reroll via a
   `type` block-entity attribute) or fixed per schematic instance — if it's the former, the same
   `tapestryInstances.ts`-style per-instance block-entity decode approach would apply directly; if
   fixed, a simpler static extraction suffices.

## 5. Tool-only builds: regenerating just the non-ingest pages

**Status: not researched yet** -- notes on what the investigation will need.

**The question**: today `npm run build` = `ingest` (minutes of asset parsing) + Eleventy over everything.
The tool pages (`/tools/schematic/`, `/tools/waypoints/`, `/tools/calendar/`, `/nf3t/`) and shared
assets are pure client-side and don't need ingest data. Could a change to only those be built and
deployed without re-running ingest -- and could the build be split so those are "the only thing that
generates"?

**What I expect to need to find out**:
- Which templates actually read `generated.*`. Known: the footer/header use only `buildInfo` (global
  data, not ingest), but `/assets/blockNames.json` (schematic viewer legend names) comes from ingest,
  the home page counts come from ingest, and `/trades/` obviously does. Need a full audit to see what a
  "tools-only" page set can include without `generated` being present (Eleventy errors or renders
  empty on a missing `generated` global).
- How to select a subset: an env flag (`TOOLS_ONLY=1`) feeding `eleventyConfig.ignores`/a second
  config file with its own `input` globs, versus a separate Eleventy invocation over `site/tools` +
  `site/assets` only. The second keeps the full-site config untouched but duplicates layout/filter setup.
- Whether it should still be able to render the shared header/footer without `generated.mods` etc.
- CI side (`.github/workflows/build-deploy.yml`): GitHub Pages deploys a whole artifact, so a tools-only
  build can't just overwrite part of the live site unless the previous `_site` (or the cached
  `site/_data/generated`) is restored first. Options: cache the generated JSON (already cached
  `vs_server/`/`Mods/`) keyed on the manifest + `src/ingest/**` hash, and skip ingest on a hit; or
  keep a tools-only local script (the new `npm run rebuild` already skips ingest) for dev only.
- Sitemap/`robots.txt` generation (now an `eleventy.after` hook over `results`) must still produce a
  full sitemap, or be skipped, in a partial build.
- The timing files (`downloadTiming`/`ingestTiming`/`eleventyBuildTiming`) assume all three phases ran;
  a partial build should keep the previous ingest numbers rather than blanking them.

## 6. Chiseled block viewer (similar to the schematic viewer)

**Status: WIP, not researched yet.** A matching stub section is on `/tools/`.

**The idea**: view chiseled blocks (sub-block voxel shapes made with the chisel) in 3D, like the
schematic viewer. As I understand it, chiseled block shape data lives in the block entity attributes, so
it is stored inside schematics, and the qptech chisel mod's blocks could be viewed the same way.

**What I expect to need to find out** (all unverified guesses):
- The attribute layout of the vanilla chiseled block's block entity (likely a microblock entity with a
  list of packed voxel cuboids plus a material list and a rotation) -- verify against the cloned
  `vssurvivalmod/` (look for the micro/chisel block entity and its `FromTreeAttributes`) and against
  real decoded blobs from existing schematics via `schematicDecode.js`'s `decodeBlockEntity`.
- How cuboids are packed (min/max xyz in 0-16 space, material index, flags) and how the material index
  maps back to block codes (to color/name them via `blockNames.json`).
- qptech's chisel mod: which mod it is exactly, whether it stores the same attribute layout or its own
  format, and whether it can be added to `vs-manifest.json` so ingest sees its blocks and lang strings.
- Rendering: `voxelViewer.js` only draws unit cubes. Chisel cuboids are boxes, so either extend the
  viewer to accept sized boxes (preferred: one `InstancedMesh` of scaled boxes) or voxelize at 16x per
  block (up to 4096 cubes per block, too heavy for whole schematics).
- Inputs: a chiseled block inside a larger schematic (click it in the schematic viewer to open it?), a
  standalone item/block stack's attributes, or an uploaded export. Which sources contain chiseled blocks
  in the wiki's own data (ruins/structures) so there are samples to test with.
- Rotation/flip handling and any per-face material overrides.

## 7. vs-mod-updater (separate repo, not merged)

The user's Python `vs-mod-updater` lives in its own repo, <https://github.com/jgwoolley/vs-mod-updater>.
A local copy was briefly placed in this checkout but is being removed; the current plan is to **keep the
two projects separate** rather than merge the updater into this one (at least for now), so nothing here
depends on it. `scripts/download.ts` already implements the overlapping part in TypeScript: resolving a
mod via `mods.vintagestory.at/api/mod/<id>`, picking a release, downloading and skipping when present.
What the updater has beyond that (per its README): checking installed mods for newer releases,
recursively installing declared dependencies, and never leaving duplicate versions. If this is revisited,
the question is whether to port those behaviors to TypeScript (keeping the pipeline pure Node, per
CLAUDE.md) or leave the Python tool as a companion. No earlier note in this file referred to the updater.

## Vintage Story temperature from seed

Yes, this is feasible, and the C# → JavaScript port is smaller than you might fear. The catch is that "temperature" has a cheap part and an expensive part, so the right scope depends on what you want to show.

### The cheap part: the regional climate map

Vintage Story's base climate comes from a 2D noise "map layer" pipeline. It lives in the open-source game code (the survival mod and API repos on GitHub), not in the closed engine. Each climate value packs temperature, rainfall, and geologic activity into one int. The inputs are:

- the world seed
- world config values: `worldClimate` (realistic vs. patchy), `polarEquatorDistance`, `globalTemperature`, `globalPrecipitation`, map size, and the spawn/starting-climate offset

The code involved is a few hundred lines: the climate noise classes, simplex noise, the base map layer hashing, plus the zoom/fuzz/blur layers. Porting it to TypeScript is a weekend-scale job. Running it in the browser for a whole map preview is fast.

### The things that bite in the port

- **Integer semantics.** The hashing relies on C# `int`/`long` overflow wrapping. In JS you need `Math.imul` and `| 0` for 32-bit math, and `BigInt` (or careful hi/lo splitting) for any 64-bit LCG steps. This is where most "almost right but not quite" bugs come from.
- **Float vs. double.** C# code using `float` rounds differently than JS doubles. Use `Math.fround` where the original uses `float`. Otherwise values near thresholds will occasionally flip.
- **Seed handling.** Make sure you replicate exactly how a text seed becomes the numeric seed, rather than assuming.
- **Version drift.** Worldgen changes between major versions. Pin the port to one game version and test against real worlds.

### The expensive part: altitude

Actual temperature at a block drops with height above sea level. Reproducing exact terrain height means porting the landform system too. That includes the landform map, per-landform noise octaves, and the 3D terrain density that `landforms.json` drives. It's doable, but it's much more code and much more CPU, closer to running real worldgen.

A practical compromise:
- Show sea-level climate exactly from the ported map.
- Let the user enter a Y level, and apply the game's altitude adjustment formula on top.

### On "biome"

Vintage Story doesn't have discrete biomes the way Minecraft does. What you see as a "biome" emerges from climate plus forest, shrub, and landform maps and per-block-type climate ranges. You can approximate it well by porting the forest/shrub map layers (same style of noise as the climate code) and classifying the results: tundra, taiga, temperate forest, desert, and so on. Exact vegetation placement would mean porting the block patch configs, which is overkill for a seed viewer.

Seasonal and daily temperature swings come from the weather system, layered on top. You can add a "season" slider fairly easily if you want it.

### An alternative to porting by hand

You could compile the relevant C# to WebAssembly (Blazor WASM, or .NET's WASI/browser targets) and call it from JS. That avoids all the overflow and float headaches because it's the same code. The downsides are a heavier download, awkward extraction from the mod's dependencies, and a need to check that the game's source license permits redistributing it that way. For a public web tool, a clean TS port of just the climate layers is usually nicer.

I can sketch the structure of the TS port or the integer-hash helpers if you'd like.
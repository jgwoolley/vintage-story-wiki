# Research notes

Investigation notes: findings from the real game data and a recommended approach for a future
implementation session to pick up. Each section starts with a **Status** line saying how much of it has
been built (several sections have since been implemented, partly or fully, and now live on their own
Source pages instead); a section without one is still just research.

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

## 3. Integrating jgwoolley/vintage-story-schematic-preview (upload + in-browser viewing)

**Status: upload + bundled samples implemented** (`/schematics/viewer/`, as an adapter on the shared
`voxelViewer.ts`), and **browsing this wiki's own `worldgen/schematics/**` is implemented too**: every
schematic is gzip-compressed at ingest and fetched on demand (`?schematic=<domain>/<relPath>`); see
`apps/vs-wiki/site/_includes/sourcedocs/schematics.njk` (`/sources/schematics/`). Each schematic page also embeds a
read-only preview (rotate/pan/zoom only), the full viewer has Download buttons, and `meta-filler` starts
hidden. Not done: rendering chiseled blocks as their real shape (topic 6).
The findings below are the pre-implementation notes.

**The question**: what would it take to pull in upload + browser-side viewing from the external
schematic-preview project, beyond the decode logic already adapted earlier this project?

**Findings**:
- The binary decode layer is **already done and already browser-ready** — `libs/vs-schematic/src/schematicDecode.ts`
  is a dependency-free module (`Ascii85`, `TreeAttributeParser`, `decodeBlockEntity`) with zero Node-specific
  or DOM-specific APIs, confirmed because it's imported directly by the Node-side ingest pipeline
  (`apps/vs-wiki/src/ingest/models/tapestryInstances.ts`) with no shims. (It was originally a plain `.js` file
  loaded by a `<script type="module">`; it is TypeScript now, compiled for the browser by `npm run build:libs`
  — see topic 8.)
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
  "view this wiki's own structures in 3D" (the second half of the former `/tools/` WIP
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
   codes) as new, dedicated client-side JS — a sibling to `schematicDecode.ts`, not an extension of
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

**Status: partly implemented.** Clutter types are now decoded per structure from schematic block entities and shown on
`/clutter/` (`models/clutterInstances.ts`). Not done: the lore bookshelf's lore content, and clutter placed by
`stackrandomizer-clutter` loot mechanisms (not visible in schematic data). The notes below predate this.

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
The tool pages (`/schematics/viewer/`, `/map/`, `/calendar/`, `/nf3t/git-merge/`) and shared
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
  config file with its own `input` globs, versus a separate Eleventy invocation over `apps/vs-wiki/site/tools` +
  `apps/vs-wiki/site/assets` only. The second keeps the full-site config untouched but duplicates layout/filter setup.
- Whether it should still be able to render the shared header/footer without `generated.mods` etc.
- CI side (`.github/workflows/build-deploy.yml`): GitHub Pages deploys a whole artifact, so a tools-only
  build can't just overwrite part of the live site unless the previous `_site` (or the cached
  `apps/vs-wiki/site/_data/generated`) is restored first. Options: cache the generated JSON (already cached
  `vs_server/`/`Mods/`) keyed on the manifest + `apps/vs-wiki/src/ingest/**` hash, and skip ingest on a hit; or
  keep a tools-only local script (the new `npm run rebuild` already skips ingest) for dev only.
- Sitemap/`robots.txt` generation (now an `eleventy.after` hook over `results`) must still produce a
  full sitemap, or be skipped, in a partial build.
- The timing files (`downloadTiming`/`ingestTiming`/`eleventyBuildTiming`) assume all three phases ran;
  a partial build should keep the previous ingest numbers rather than blanking them.

## 6. Chiseled block viewer (rendering chiseled blocks as they really look)

**Status: partly implemented.** The schematic viewer's block panel decodes a clicked chiseled block (materials, a
mini 3D shape preview, ChiselTools export; `libs/vs-schematic/src/chisel.ts`). Drawing the shapes in the *main* view
and real *appearance* (textures/colors) are not done.

**The idea**: today a chiseled block (`chiseledblock`, a "microblock") is drawn in the schematic viewer as one
full unit cube colored by the generic block code. Draw its real sub-block shape instead.

**Findings (verified against `vssurvivalmod/Systems/Microblock/BEMicroBlock.cs` and real decoded blobs):**
- A chiseled block's block entity (decoded by `schematicDecode.ts`) carries `cuboids`, `materials`,
  `rotation`, plus `decorRot`, `emitSideAo`, `sideSolid`, `sideAlmostSolid`, `blockName`,
  `availMaterialQuantities` and a `beams` byte array. `beams` is not shape data: it's written by the
  separate support-beam behavior (`BEBehaviorSupportBeam.cs`, `tree.SetBytes("beams", ...)`) that chiseled blocks
  can also carry.
- `cuboids` is an int array; each int is one box inside the block's 16x16x16 grid. **The bit layout in the
  game source's own comment is wrong**; the real `ToUint`/`FromUint` is: bits 0-3 minX, 4-7 minY, 8-11 minZ,
  12-15 maxX-1, 16-19 maxY-1, 20-23 maxZ-1, 24-31 material index (so `max = field + 1`, 1..16).
- `materials` is an int array of block ids; the box's material index picks one. In a schematic those ids
  are keys of the schematic's own `BlockCodes` (e.g. `game:genericwood`, `game:rock-chert`), so they resolve
  to block codes with no running game.
- `rotation` stores `(rotationY + 360) << 10` as **bookkeeping only**: `RotateModel` already rotates the
  `cuboids` themselves (`TransformList`) when a schematic is rotated, so the stored cuboids are already in
  their final orientation and need no further rotation to draw the shape. `rotationY` only matters for decor
  faces (`decorRot`) and material face lookups.
- Corpus check over all vanilla + BetterRuins schematics: **138,570 chiseled blocks in 475 schematics, 875,451
  cuboids**, average 6.3 per block (max 462), 14,351 of them plain full-block boxes. Zero malformed boxes
  (min < max on every axis) and zero material indexes outside their block's `materials` list; every material
  resolves through `BlockCodes`. Decoding all of them takes about 1.6 s in Node.
- Heaviest schematic: `brsunrift` has 15,718 chiseled blocks / 171,290 cuboids on top of ~600k visible
  voxels. The median schematic that has chiseled blocks has about 300 cuboids. Only one schematic exceeds
  100k cuboids.

**What implementing the shape would take:**
1. When a schematic loads, decode the `chiseledblock` entities (`decodeBlockEntity`) and replace each one's
   single unit-cube voxel with one box per cuboid, colored per material block instead of by `chiseledblock`.
2. Teach `voxelViewer.ts` sized boxes. It draws only unit cubes today (one `InstancedMesh` per opacity with
   per-instance color); a per-instance scale/offset on the same mesh is a small change and keeps the cost
   proportional to box count. Voxelizing at 16x instead (up to 4096 cubes per block) is too heavy.
3. Decide how hiding, the legend counts and `pick` treat the new boxes, and keep the schematic-page preview
   and the full viewer consistent (they share `schematicVoxels.ts`).
4. Add a test using a chiseled blob decoded from a bundled sample (e.g. `story/devastation/small/small-13.json`
   has two).

**What "actually look" needs beyond shape (not solved):**
- The viewers color every block by a hash of its code; there are no textures. Real colors need per-block
  color/texture data. The raw textures are in `assets/*/textures/block/**.png`, so one option is averaging
  each block's texture color at ingest, which needs a PNG decoder (a small npm dependency, or a minimal
  reader) and the block-code to texture mapping from each blocktype's `textures`. That would improve every
  block in the viewers, not just chiseled ones.
- Per-face textures and the `decorRot` decor faces are a further step again.

**Open questions:**
- `chiseltools` (QP's Chisel Tools 1.17.9) was decompiled (ilspycmd): it edits vanilla chiseled blocks
  (`BlockEntityMicroBlock.VoxelCuboids`/`BlockIds`) and has its own *file* format only for saved shapes
  ("portfolio"): an XmlSerializer dump of `PantographData` with protobuf-net-serialized `List<uint>` cuboids and
  `int[]` block ids, plus `blockcodes`, in `<VintagestoryData>/chiselportfolio/` (see README, Tools). It also
  imports MagicaVoxel `.vox` files.
- Standalone input (a chiseled item stack's attributes, or an export) isn't covered by anything above; the
  schematic case is the one with real data to test on.

## 7. vs-mod-updater (separate repo, not merged)

The user's Python `vs-mod-updater` lives in its own repo, <https://github.com/jgwoolley/vs-mod-updater>.
A local copy was briefly placed in this checkout but is being removed; the current plan is to **keep the
two projects separate** rather than merge the updater into this one (at least for now), so nothing here
depends on it. `apps/vs-wiki/scripts/download.ts` already implements the overlapping part in TypeScript: resolving a
mod via `mods.vintagestory.at/api/mod/<id>`, picking a release, downloading and skipping when present.
What the updater has beyond that (per its README): checking installed mods for newer releases,
recursively installing declared dependencies, and never leaving duplicate versions. If this is revisited,
the question is whether to port those behaviors to TypeScript (keeping the pipeline pure Node, per
CLAUDE.md) or leave the Python tool as a companion. No earlier note in this file referred to the updater.

## Vintage Story temperature from seed

**Status: the easy part is implemented** (`/map/`, `apps/vs-wiki/site/assets/climate.js`). What is and isn't
ported, and how it was checked, now lives on the site's own source page
(`apps/vs-wiki/site/_includes/sourcedocs/climate.njk`, shown at `/sources/climate/`), not here. Still open and worth
researching: porting the simplex wobble (`MapLayerPerlinWobble`), and finding the text-seed to int conversion
(closed `VintagestoryLib.dll`; candidates `GameMath.DotNetStringHash` and `StringUtil.GetNonRandomizedHashCode`).

## 8. Splitting the pipeline into packages, and a VS Code schematic preview

**Status: implemented.** The repo is an npm-workspaces monorepo: `libs/vs-wiki-core` (asset loading, JSON
patching, variant expansion, lang resolution), `libs/vs-schematic` (schematic decode, voxel conversion, the
Three.js voxel viewer; TypeScript, compiled to `dist/` for browsers) and `apps/vs-wiki` (the ingest, Eleventy
site, scripts and tests). `apps/vs-vscode-extension` is a custom read-only editor that previews `.json` /
`.json.gz` schematics, bundled with esbuild around the same `vs-schematic` code. See `README.md` ("Repository
layout") for how they fit together.

Decisions and what was left out, for whoever revisits this:
- **No headless C# API.** The pipeline reads JSON and applies the engine's rules to it; the C# source is only
  a reference for checking behavior (hence `csharpClassMap.json`). Running engine code would add a .NET
  toolchain and the game's proprietary DLLs to CI and break the pure Node/npm property.
- **Downloader not merged with the separate mod-updater CLI** (topic 7). The only contract the ingest has with
  it is the directory layout (`vs_server/`, `Mods/`) plus `vs-manifest.json`, so either tool can fill it.
- **The extension isn't published or tested inside a real VS Code yet.** It type-checks, bundles and packages
  to a `.vsix` (`npm run build:extension`), and the HTML shell has unit tests, but nothing here
  launched an Extension Development Host; the first thing to do is press F5 on a schematic file and check the
  webview (WebGL, CSP, the file watcher). Not done: running it under `@vscode/test-electron`, a Marketplace
  publisher/icon/license, and an extension-side setting for default-hidden blocks (it reuses
  `isHiddenByDefault`, so `meta-filler` starts hidden like on the wiki).
- **`libs/vs-schematic`'s package `exports` point at the TypeScript source**, which suits the Node/tsx and
  esbuild consumers; only the wiki's browser build needs the compiled `dist/`.

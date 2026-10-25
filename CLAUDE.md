# CLAUDE.md

Orientation for a fresh Claude Code session picking up this repo cold. `README.md` is the
contributor-facing architecture writeup (read it too) — this file is the shorter "how to actually
work in here without repeating known mistakes" doc.

## What this is

A statically-generated Vintage Story wiki. `npm run download` fetches the vanilla dedicated server
+ mods pinned in `vs-manifest.json`; `npm run ingest` (`apps/vs-wiki/src/ingest/`) parses that raw game data into
normalized JSON under `apps/vs-wiki/site/_data/generated/`; Eleventy (`apps/vs-wiki/site/`, Nunjucks templates) builds the
static HTML into `_site/`. Deployed to GitHub Pages via `.github/workflows/build-deploy.yml`.

```
npm install
npm run download   # fetch vanilla server + mods into vs_server/ and Mods/ (gitignored, cached in CI)
npm run build       # ingest + eleventy build into _site/
npm run serve       # same, with live reload
npm run typecheck   # tsc --noEmit over libs/ + apps/
npm run clean        # rm -rf .scratch _site apps/vs-wiki/site/_data/generated
```

`vssurvivalmod/` at the repo root (gitignored) is a clone of the game's C# source
(`anegostudios/vssurvivalmod`), kept around purely as a reference for verifying display-name /
spawn-condition logic against the real engine behavior — it's not part of the build. It's also the
input to `apps/vs-wiki/scripts/map-csharp-classes.ts`, a hand-run generator for the committed
`apps/vs-wiki/src/ingest/csharpClassMap.json` (JSON class/behavior name → `.cs` file + line, pinned to the
clone's commit), which item pages use for their "Game logic (C#)" links. The user explicitly does
**not** want the C# source pulled into the project or the download/build pipeline. Only the
mapping is committed; refresh it by re-running that script, don't fetch source in CI.

## Repo layout (npm workspaces)

```
libs/vs-wiki-core/   asset loading, patching, variant expansion, lang resolution (+ their shared types)
libs/vs-schematic/   schematic decode, voxel conversion, Three.js voxel viewer (TypeScript), with tests
apps/vs-wiki/        the wiki: src/ingest, scripts, test, site (Eleventy input), eleventy.config.js
apps/vs-vscode-extension/   VS Code custom read-only editor previewing schematic .json/.json.gz (esbuild bundle of vs-schematic)
```

Everything is still run **from the repo root** (all pipeline paths are cwd-relative; `vs_server/`, `Mods/`,
`.scratch/`, `_site/`, `vs-manifest.json` and the reference clones stay at the root). Apps import libs by
package name (`vs-wiki-core/lang.js`, `vs-schematic/schematicDecode.js`; `exports` map `./*.js`). 
`libs/vs-schematic` is TypeScript: browsers can't run it, so `npm run build:libs` (`tsc`, run first by `build`/
`rebuild`/`serve` and in CI) compiles it to the gitignored `libs/vs-schematic/dist/`, and an Eleventy passthrough
(`eleventy.config.js`, `dist/*.js` only) ships that to `/assets/`, so site scripts still import
`./schematicDecode.js`. **If the site 404s on a schematic/voxel module or serves a stale one, you forgot
`build:libs`.** `libs/vs-schematic` has its own tsconfig (with DOM); the root one has none, so DOM use can't leak
into `schematicDecode.ts`, which the ingest imports. `npm run typecheck` runs all of them (root, vs-schematic, the
extension). The extension (`apps/vs-vscode-extension`) bundles the lib with esbuild and `npm run build:extension` produces the `.vsix` (bundle only: `npm run build -w vs-vscode-extension`);
it type-checks, bundles and packages, but has never been launched in a real VS Code, so don't claim it works at
runtime beyond what's tested. Libs must
not import from apps; tests that need wiki files (the sample schematic, ingest's `DecodeStats`) live in
`apps/vs-wiki/test/`. Path references elsewhere in this file that don't say `libs/` or `apps/` are relative
to the app that owns them.

## The one bug you will probably rediscover

**A Nunjucks/Eleventy pattern that silently renders nothing**: inside a `{% for %}` loop,
`{% set x = someDict[loopVar] %}` immediately followed by `{% if x %}` can evaluate false even
when `x` is a genuinely truthy object. Confirmed NOT a caching artifact, NOT reproducible in an
isolated `nunjucks.renderString()` call, and the *identical* pattern works fine elsewhere in this
codebase (e.g. `recipesById` lookups in `items.njk`). Root cause unknown. **Workaround that is
confirmed reliable**: check a property instead of the bare variable — `{% if x.id %}` rather than
`{% if x %}`. See `apps/vs-wiki/site/items/items.njk`'s deposit/blockPatch loops for the pattern. If you add a
new `{% set x = dict[loopVar] %}` + `{% if x %}` combo anywhere, test it before trusting it.

## Conventions that aren't obvious from reading one file

- **Every content page lives under `/<lang>/`** (currently always `en/`). The `lang` global data
  value (`eleventyConfig.addGlobalData("lang", ...)` in `apps/vs-wiki/eleventy.config.js`) feeds both (a) every
  page's `permalink` front matter (`"{{ lang }}/items/.../index.html"`, explicit on every page —
  Eleventy's directory-inferred default permalink is never used) and (b) every internal link via
  `{{ ('/' ~ lang ~ '/') | url }}` instead of the plain `{{ '/' | url }}` idiom. **Shared assets
  (css/js/favicon/og-image) deliberately stay on the plain `'/' | url` form** — they're not
  language-specific, so don't prefix new asset references with `lang`. The bare site root
  (`/index.html`, from `apps/vs-wiki/site/redirect.njk`) is a meta-refresh redirect to `/<lang>/`. This is
  routing-only prep for a second language later; nothing generates non-English content yet.
- **`{{ '/' | url }}` / `{{ ('/' ~ lang ~ '/') | url }}` also carries the GitHub Pages
  `pathPrefix`** (`PATH_PREFIX` env var, set by CI to `/<repo-name>/` since a project site serves
  from a subpath). A hardcoded `/items/...` link works locally and 404s on the deployed site — if
  you add a new internal link, copy the existing idiom, don't hand-roll a path.
- **README.md vs INFO.md vs this file** are three different audiences: `README.md` is for people
  working on the codebase (architecture, pipeline internals); `INFO.md` is rendered on the site's
  own `/info/` page for wiki *visitors* (why it exists, how to use it, kept deliberately simple —
  do not merge it back into README.md); `CLAUDE.md` (this file) is for a future Claude session.
  Keep README.md in sync with real pipeline/feature changes — it's the one most likely to drift.
- **The item index (`generated.items`, built by `apps/vs-wiki/src/ingest/crossref.ts`) is a recipe/loot graph,
  not a full registry walk.** Ore/gem deposits (`models/deposits.ts` → `/deposits/`), wild crop
  spawn patches (`models/blockpatches.ts` → `/crops/`), tree/fruit-tree spawn bands
  (`models/trees.ts` → `/trees/`), `ItemStackRandomizer` placeholder items and their pool members
  (`extractStackRandomizerPools`), items/blocks a `handbook://` link names (`handbookItemRefs`), and blocks that only drop something with no recipe of their own
  (grouped in `apps/vs-wiki/src/ingest/index.ts` as `blockDrops`/`blockDropsById`, looked up live from `/items/`
  by `domain:code` — see below) are all deliberate carve-outs, synthesized via
  `ensureSpawnTarget(domain, code, kind)` in `apps/vs-wiki/src/ingest/index.ts` for things with no recipe and
  (for the first three) no drop table. For one-off things no rule reaches at all (static
  translocators, teleporters), don't write a new carve-out: add a `domain:code` glob to
  `vs-manifest.json`'s `includeItems` (validated by `vs-manifest.schema.json`, which must stay in
  sync with `VsManifest` in `types.ts`). Paintings/tapestries/clothing (`models/decor.ts`) are a
  separate, parallel carve-out that never joins the item index at all — they get their own
  dedicated top-level pages (`/paintings/`, `/tapestries/`, `/clothing/`) instead, each backed by
  its own filtered array (`generated.paintings`/`tapestries`/`clothing`, split from the combined
  `generated.decor` in `apps/vs-wiki/src/ingest/index.ts` right after cross-referencing). Character classes/
  traits (`models/classes.ts` → `/classes/`) and clutter types (`models/clutterInstances.ts` →
  `/clutter/`: the generic `clutter` block's per-instance `type` attribute decoded from schematic block
  entities, like tapestries) are the same "own dedicated page, never joins the
  item index" pattern again — a class is a character-creation choice, not a craftable/droppable
  thing. If you're asked to surface some other spawn-only/recipe-less content type, pick whichever
  of these two patterns fits (joins the item index vs. gets its own dedicated page) — don't force
  it through `crossref.ts`'s recipe/loot walk either way.
- **Content is organized by what the thing is, not by mechanism.** `/creatures/` is entity-only
  (stats, spawn conditions, own drop table); a block's drops live directly on that block's own
  `/items/` page (a "Drops" section, forward direction) rather than a separate per-source listing.
  The existing "Dropped by" section on an item page (reverse direction: what else drops *this*
  item) routes each row to `/creatures/...` or `/items/...` depending on `loot.sourceKind` — if you
  add another cross-link into loot data, check `sourceKind` the same way rather than assuming one
  target page type.
- **`generated.creatures` is not "every entity with a drop table."** A real bug: deriving the
  creature list purely from `loot.json`'s entity-kind entries silently excludes any living
  creature with no drops at all (traders, villagers, locusts, ...). `models/loot.ts`'s
  `extractLoot` also returns a `creatureRoster` (every `entities/**/*.json` variant with the
  "health" server behavior — the same signal that correctly excludes non-creature utility
  entities like boats/arrows/elevators, which never have one) that `index.ts` seeds
  `generated.creatures` from *first*, merging in real drops on top where they exist. If you add
  another entity-derived content type, seed from the full roster the same way, not from loot
  entries alone.
- **Entity spawn conditions live under `json.server.spawnconditions`** (or `...spawnconditionsByType`
  for glob-keyed variants), not top-level `json.spawnconditions` — a real bug hit once already
  (`apps/vs-wiki/src/ingest/models/loot.ts`, `extractEntitySpawnInfo`). If entity-derived data looks
  silently empty, check you're reading from the right nesting level before assuming it's missing
  upstream.
- **`resolveByType` (`libs/vs-wiki-core/src/variantExpander.ts`) must pick the most specific pattern match**,
  not whichever glob/regex key happens to appear last in the source file. This was a real bug
  (wrong bear hitbox sizes) before being fixed — if you touch this function, keep that property.
- **Entity drops can be glob-keyed (`dropsByType`) too, not just a flat `drops` array** — a real
  bug, fixed: `models/loot.ts`'s entity-drop extraction (both death drops and the harvestable
  behavior's drops) originally only read `json.drops`/`harvestable.drops`, mirroring the pattern
  but missing the `resolveByType(json.dropsByType, code) ?? json.drops ?? []` fallback that
  block drops already had. Silently zeroed out real drops for any entity whose drops vary by
  variant (confirmed: shiver/bowtorn/drifter's harvestable drops, locust's death drops). If you
  add another drop-reading code path, use the same two-step fallback, not just the flat array.
- **Trade list → entity is resolved through the entity's own `attributes.tradePropsFile` /
  `tradePropsFileByType`** (placeholders like `{type}` filled from that variant's `groupValues`; the
  list id is `<domain>:<file name minus a "trader-" prefix>`). Wandering traders use
  `config/tradelists/trader-{type}` (the `type` variant state is the specialization); `villager.json`
  maps individual villagers by glob (`*-tobias` → `villager-tobias`). `apps/vs-wiki/src/ingest/index.ts`
  re-expands `entities/` via `expandVariants` (not `creatureRoster`, which drops `groupValues`) and
  appends each match to `TradeList.traderEntities`; creature pages link back to their lists. A listing of
  the generic `clutter` block carries `clutterType` (its `type` attribute) and links to `/clutter/<type>/`.
  The older `variantgroups`-overlap join was replaced by this; don't resurrect it.
- **`expandVariants` honors `allowedVariants` / `AllowedVariants` (and skip) case-insensitively** — the
  game's JSON reading is case-insensitive and `villager.json` spells it `AllowedVariants`; missing that
  once generated ~600 nonexistent villagers (and 600 junk `/creatures/` pages). If a family of variants
  looks wildly over-generated, check the key's spelling first.
- **Every `<table>` paginates**: `apps/vs-wiki/site/assets/datatable.js` pages any plain table outside a
  `.datatable` that has more than 20 body rows (Prev/Next only, no search/sort); `data-no-paginate` opts
  out. Anything that needs search/filter/sort should still be a `datatable` macro.
- **Breadcrumb pattern**: every page except the home page and the root redirect calls the
  `trail(lang, crumbs)` macro (`apps/vs-wiki/site/_includes/macros/breadcrumb.njk`, imported per-template —
  there's no automatic base-layout injection) right before its `<h1>`, rendering
  "Vintage Story Wiki / <Section>" on a listing page (`crumbs` is a single `{label}` entry, no
  `url`, since it's the current page) or "Vintage Story Wiki / <Section> / <item display name>"
  on a paginated detail page (`crumbs` is `[{label, url: "<section>/"}, {label: <item's display
  name>}]`  — only the last entry omits `url`, rendering unlinked). This replaced the old one-off
  `<div class="breadcrumb"><a href="...">&larr; All X</a></div>` back-links that used to be
  hand-rolled per detail template — don't reintroduce that pattern, call the macro instead.
- **Datatable pattern**: any listing page uses the `datatable(pageSize, placeholder, headers)`
  macro (`apps/vs-wiki/site/_includes/macros/datatable.njk`) wrapping
  `<tr data-search data-category data-mod data-mod-label data-tags>` rows (plus
  `{{ dt.descriptionAttrs(x.description) }}` on listings whose content can have a lang
  description, which emits `data-description`/`data-description-label` for the 4th, "Description",
  filter dimension). `data-mod-label`
  (optional) is the human mod name shown in the filter panel (`{{ generated.mods | modName(x.sourceMod) }}`)
  while `data-mod` stays the modid the filter actually matches on — add both together, every
  `data-mod=` row in `apps/vs-wiki/site/` does. Category/mod/tag/description are all **multi-select** filter dimensions:
  each renders as a button (`.datatable-filter-toggle`, labeled "Category"/"Mod"/"Tags") that opens
  a small checkbox panel (`.datatable-filter-panel`) listing every distinct value seen across the
  page's rows (for `tag`, `data-tags` is space-separated and split into individual tokens first,
  since one row can carry several tags). Checking several boxes within one dimension matches rows
  with ANY of those checked values (OR within a dimension); the four dimensions plus the
  free-text search box are ANDed together, same as always. Every currently-active value, from any
  dimension, also renders as a removable chip in `.datatable-active-filters` below the controls
  row. A dimension's whole button+panel widget only hides when a page's rows carry *no* value at
  all for that dimension — a single distinct value still shows it (so it works for free the moment
  a 2nd value appears later, e.g. a new mod or a 2nd tag). All filter/search state round-trips
  through URL query params — `q` stays free text, but `category`/`mod`/`tag` are each a
  **comma-separated list of active values** (e.g. `?category=block,item&tag=tool,weapon`), with
  the numbered `q2`/`category2`/`mod2`/`tag2`/... convention still used for a second table on the
  same page — via `apps/vs-wiki/site/assets/datatable.js`, not just read once on load. Every header is also
  click-to-sort automatically (numeric-aware, 3-state: asc/desc/unsorted) — no per-column opt-in
  needed, it's driven by the rendered `<td>` text, not sync'd to the URL (unlike the filters).
  Follow this pattern for any new listing page rather than inventing a new table/filter shape.
- **`wildcardQuery` keeps `*`** (and turns `{...}` into `*`), and `datatable.js` treats a `*` in a
  search query as a glob — stripping it gave `jug--fired`, which matched nothing. Don't strip wildcards again.
- **Wildcard codes are clickable everywhere**: a code like `tallgrass-*` or `leather-normal-*`
  should link to `/<lang>/items/?q=<code | wildcardQuery | urlencode>` (see `wildcardQuery` filter
  in `apps/vs-wiki/eleventy.config.js` — strips `*`/`{...}` down to a literal prefix the datatable's substring
  search matches against each row's `data-search` attribute).
- **`RESTRICTION_GLOSSARY`** (`apps/vs-wiki/eleventy.config.js`, `restrictionInfo`/`restrictionLabel` filters) is
  the single source of plain-English explanations for cryptic worldgen/spawn condition keys
  (`minTemp`, `chance`, `habitatBlocks`, `yPosRel`, etc.), reused across structures, entity spawn
  conditions, and item deposit/patch info. Add new keys here rather than writing one-off prose in a
  template, so the wording stays consistent across pages.
- **Nunjucks ternary + filter precedence**: `{{ x if cond else y | round(2) }}` applies the filter
  to `y` only, not to the whole expression — a real bug hit twice while building the tree spawn
  pages. Parenthesize the ternary before filtering: `{{ (x if cond else y) | round(2) }}`.
- **A macro imported the normal way (`{% import "macros/x.njk" as x %}`, no `with context`) does
  NOT see the importing template's `lang`** (or any other page-level/global data) — a bare
  `{{ ('/' ~ lang ~ '/') | url }}` reference inside such a macro's body silently renders `lang` as
  the literal text "undefined" rather than erroring. This was a real, long-standing bug in
  `apps/vs-wiki/site/_includes/macros/recipe.njk`'s `ingredientLabel`/`outputLabel`/`summary` macros — every
  compact recipe-summary link on `/items/` and `/recipes/` (thousands of pages) was a broken
  `/undefined/items/...` URL until a user caught a live instance and it was fixed by adding `lang`
  as an explicit first parameter to each macro (same pattern `breadcrumb.njk`'s `trail(lang,
  crumbs)` already used correctly) and passing it from every call site. If you add a new macro
  that builds a `{{ ('/' ~ lang ~ '/') | url }}` link, take `lang` as an explicit parameter — don't
  rely on it being ambient, and don't assume the rendered text looking plausible means the href is
  correct; check the actual `href`/`src` attribute, not just the link text.
- **Every field in `apps/vs-wiki/src/ingest/types.ts` is documented** (inline `//` or leading `/** */` per
  interface) — keep this true for any new/changed field. This is the single source of truth for
  what each generated JSON shape actually means; don't let it drift into "self-explanatory" silence.
- **WIP stub page pattern**: `/tools/` still carries a WIP section (painting lookup) for content not built yet — a `.wip-badge`-styled note plus prose saying exactly
  which raw game files the real implementation would read (see `apps/vs-wiki/site/tools/index.njk`: explain what's
  planned and where the data already lives, don't just say "coming soon"). The schematic viewer,
  WayPoint planner, Calendar, Alloy calculator and Seed climate lookup under `/tools/` are real pages, merged from the user's former
  `vintage-story-schematic-preview` / `vintage-story-price-guide` projects; their pure-client JS is in
  `apps/vs-wiki/site/assets/` (`schematicViewer.js`, `waypoints*.js`, `calendar.js`). The price guide's trades page was
  deliberately not ported (`/trades/` supersedes it). `/guides/` and `/trades/` *used* to be stubs but are
  now fully implemented — don't assume this list is still accurate without checking `apps/vs-wiki/site/<dir>/`.
- **"Source" documentation pages (`/<lang>/sources/<id>/`)**: every top-level listing has a
  matching entry in `apps/vs-wiki/site/_data/pipelineSources.json` (globs + model file paths) and a prose
  partial at `apps/vs-wiki/site/_includes/sourcedocs/<id>.njk`, rendered through one shared pagination
  template (`apps/vs-wiki/site/sources/sources.njk`, dynamically including `"sourcedocs/" + src.id + ".njk"`
  — Nunjucks `{% include %}` accepts a computed string expression for the template path, this is
  the one place in the codebase that relies on that). A tool whose logic is a port of game code (e.g. `/tools/climate/`) gets one too: its "Raw game files read"
  list then says plainly that no asset feeds the logic, and the partial explains what is and isn't ported. Tool pages
  link to their Source page, never to RESEARCH.md (which is going away). If you add a new top-level content type (a
  new `generated.<x>` + its own `apps/vs-wiki/site/<x>/index.njk`), add a matching `pipelineSources.json`
  entry and `sourcedocs/<id>.njk` partial in the same change, and link the new listing page's own
  "Source: ..." line to it — this is now expected for every top-level page, not optional polish.
  Each page's "Pipeline code" file paths link to `https://github.com/{{ buildInfo.repoSlug }}/blob/main/<path>` (pinned to `main`, not whatever branch/commit actually built the page) — `buildInfo.repoSlug` already exists for this (see "Build info page" below), don't hardcode the owner/repo string again.
- **Repo-root markdown files published as real pages**: `INFO.md` → `/info/`, `RESEARCH.md` →
  `/research/`, each via one `eleventyConfig.addGlobalData("<x>Html", () => md.render(readFileSync("<X>.md", "utf8")))`
  in `apps/vs-wiki/eleventy.config.js` (plain markdown-it, no Nunjucks preprocessing of the `.md` file's own
  content — an internal link inside one of these files can't use the `{{ ('/' ~ lang ~ '/') | url }}`
  idiom, which is why neither file links to other site pages; this is consistent with the existing
  file, not a new limitation). The page template just does `{{ <x>Html | safe }}` inside a
  `.readme-content`-styled div. If you add another repo-root doc meant for site visitors, follow
  this exact pattern rather than hand-duplicating its prose into a `.njk` page.
- **A CSS class that sets `display` unconditionally defeats the `hidden` HTML attribute** —
  confirmed real: `.datatable-filter-panel { display: flex; ... }` with no `[hidden]` guard beat
  the browser's own `[hidden]{display:none}` default (author-origin always wins over user-agent
  origin, regardless of selector specificity), so every filter panel rendered open on every page
  load, only "closing" once JS ran. Any element toggled via the `hidden` attribute/property needs
  its `display` set in two paired rules instead of one unconditional rule:
  `.foo[hidden] { display: none; }` + `.foo:not([hidden]) { display: flex; }` (see
  `.datatable-filter-panel`/`.nav-dropdown-panel` for the pattern). Never write
  `.foo { display: flex; }` on an element anything toggles via `hidden`.
- **Only one dropdown/flyout panel open at a time, site-wide**: both the datatable filter panels
  (`apps/vs-wiki/site/assets/datatable.js`, tracked via its module-level `allDimensions` array) and the header
  "Tools" nav dropdown (`apps/vs-wiki/site/assets/nav.js`) close every other open panel before opening the one
  that was just clicked — clicking an already-open panel's toggle just closes it. If you add
  another click-to-open panel anywhere, follow this close-others-then-open-this pattern rather
  than a bare `hidden = !hidden` toggle, which lets multiple panels stack open simultaneously.
- **3D voxel rendering has one shared core, `libs/vs-schematic/src/voxelViewer.ts`** (Three.js, vendored
  from `node_modules` via `apps/vs-wiki/eleventy.config.js` passthrough + the importmap in `base.njk`, never a
  CDN). It's generic: callers pass `{x,y,z,color}` voxels and restyle via `setStyle(fn)`.
  `recipeVoxels.js` is the recipe adapter. The schematic viewer (`schematicViewer.js`, and the VS Code extension's webview) is the schematic adapter (decoded
  `Indices`/`BlockIds` → voxels, packed index `x = i & 0x3FF, z = (i >> 10) & 0x3FF, y = (i >> 20) & 0x3FF`)
  on this core. Don't reintroduce the old project's one-`Mesh`-per-block Three.js r136 renderer
  as a second 3D code path. Smithing patterns are NOT always 1 layer (22 of 48 have 2–5); don't
  special-case by category, branch on `pattern.length`.
- **Recipe voxel-pattern layers (smithing/clayforming/knapping) show one layer at a time**,
  selected via click-to-switch tabs (`.layer-switcher`/`.layer-tab`/`.layer-panel` in
  `apps/vs-wiki/site/recipes/recipes.njk` + `apps/vs-wiki/site/assets/layers.js`) rather than stacking every layer's slice
  on the page at once. Some recipes have a lot of layers (`clayoven` has 16), and the old stacked
  rendering was hard to read as a shape. The tab bar only renders when there's more than one layer.
  `layers.js` fires a `layerchange` CustomEvent on the switcher, which is how the 3D view's "One
  layer"/"Layer N and below" modes follow the tabs. The 2D slices and the 3D model are mutually
  exclusive views (`recipeVoxels.js` owns the view/mode/layer state). The view/mode buttons reuse
  the `.layer-tab` class for styling, so `layers.js` selects `.layer-tab[data-layer-index]`
  specifically. Keep that selector narrow if you add more buttons there. All of these controls
  live in one `.pattern-toolbar` (View / Show / Layer rows) inside the `.pattern-viewer`
  container. The user wants the Layer tabs to look the same and sit in the same place in both
  views, so inapplicable controls are `disabled`, never hidden (Show modes in 2D, Layer tabs in
  3D "All layers"). Don't reintroduce hide/show toggling there.
- **Mods can inject lang keys into a different domain's namespace**: a mod's own `lang/en.json`
  can author a key as a literal `"<domain>:<realkey>"` string (the colon is part of the flat key,
  not a nested object) to place that string under a *different* domain's lookup (confirmed real
  and common: BetterRuins does this for 367 keys, Stone Quarry for 32, mostly to put handbook
  guide/lore text under `"game:"` so vanilla-style `handbook://` links can reference it without a
  domain prefix). `lang.ts`'s `buildLangResolver` redistributes any such key into its target
  domain's bucket before splitting exact/wildcard — a real bug, fixed, that made Stone Quarry's
  handbook guides render raw unresolved key strings instead of their actual text. If a domain's
  lang lookups look suspiciously incomplete, check for `"otherdomain:key"`-shaped keys in that
  mod's own lang file before assuming the string is missing entirely.
- **A worldgen structure's `chance` field (`worldgen/structures.json`) is sometimes a relative
  weight, not an independent 0–1 probability** — confirmed real: `undergroundruin`'s small/medium/
  large size variants share one `code` with `chance: 130/50/10`, which blindly `| percent`-formatted
  renders as a nonsensical "13000.00%". True generator semantics for this weight-vs-probability
  split aren't available in the locally-cloned `vssurvivalmod` (likely live in VSEssentialsMod,
  which is now also cloned at `vsessentialsmod/` but hasn't been checked for this) — `structures.njk` works around it by only formatting as a percent when
  `chance <= 1`, otherwise labeling it a relative weight. If you touch structure chance display
  again, keep that branch rather than assuming it's always a clean probability.
- **The whole download/ingest/build pipeline is pure Node/npm** — `apps/vs-wiki/scripts/download.ts` uses the
  pure-JS `tar` package, not a shelled-out system binary. If you add a new external-tool
  dependency to any script, prefer an npm package over shelling out, to keep this property true.
- **Eleventy cannot report its own total build duration to its own templates** — there's no point
  in its lifecycle where it both knows the number and can still write it into the HTML it's
  producing (by the time an `eleventy.after` hook fires with the real duration, every page has
  already rendered). `/<lang>/build/` (`apps/vs-wiki/site/build/index.njk`) wants to show exactly that number,
  so `apps/vs-wiki/scripts/build-site.ts` wraps the real `eleventy` CLI as a child process, times the whole
  invocation from outside it, and writes `apps/vs-wiki/site/_data/generated/eleventyBuildTiming.json` only
  *after* that child exits — `npm run build` and the CI "Build site" workflow step both call this
  wrapper instead of invoking `eleventy` directly now. The number the page shows is therefore
  always one full build run stale (the *previous* successful build, not the one currently
  rendering that page) — labeled that way on the page rather than presented as live. If you touch
  build timing again, keep writing to disk rather than trying to thread the number through in
  memory — `npm run download`, `npm run ingest`, and the Eleventy build are three genuinely
  separate process invocations (separate CI workflow steps, possibly minutes apart), so
  `downloadTiming.json`/`ingestTiming.json`/`eleventyBuildTiming.json` (see `apps/vs-wiki/src/ingest/types.ts`)
  are the only thing that survives between them.
- **Tests: `npm test`** (`node:test` via `tsx --test` over every package's `test/`, run in CI after `npm ci`). The
  decoder tests live in `libs/vs-schematic/test` (tests needing wiki files go in `apps/vs-wiki/test`).
  `schematicDecode.ts` follows vsapi's real
  `*Attribute.cs` `FromBytes` layouts (the old port had type 7/8/10/12+ wrong, misdecoding ~half of all
  block entities); `npm run decode-stats` scans the local corpus and should report 0 throws. The ingest
  callers skip a failed blob but count it (`DecodeStats`); watch the ingest log for `WARNING (tapestry|clutter)`.
  Build test blobs by hand, don't commit game schematics. Keep `README.md`'s Testing section in sync.
- **`apps/vs-wiki/site/assets/climate.js` is a port of the game's realistic climate generator**, verified against the
  C# in `vsessentialsmod/.../0.GenMaps/` and `vsapi/Common/Climate.cs` (also gitignored clones, like
  `vssurvivalmod/`; read them, don't pull them into the build). It uses BigInt for the 64-bit LCG and
  `Math.fround` for C# `float`; `apps/vs-wiki/test/climate.test.ts` checks it against an independent Python
  re-implementation. It deliberately omits the simplex `MapLayerPerlinWobble` (~900 blocks of
  displacement), forest/shrub maps and landforms, and supports numeric seeds only (the text-seed hash is
  in closed server code). Don't present its output as exact.
- **Adding a tool means linking it from all three places**, not just creating the page: the home page
  tools cards (`apps/vs-wiki/site/index.njk`, the "Tools" grid), the header "Tools" dropdown (`apps/vs-wiki/site/_includes/layouts/base.njk`),
  and a section on `apps/vs-wiki/site/tools/index.njk`. Point each at the real `tools/<name>/` page (not a `tools/#anchor`)
  and drop any `wip-badge` / old WIP stub section it replaces. The seed climate lookup shipped with the home
  card still pointing at its old WIP anchor, which is the mistake this rule exists for. After building, grep
  `_site/en/index.html` for the new `tools/<name>/` href to confirm.
- **Schematics and structures are separate**: `generated.schematics` (one per file, `SchematicInfo`) holds
  everything about a file; a structure's `schematics` are only `SchematicRef`s (path/glob, its own
  weight/quantity, resolved `schematicIds`). Link to a schematic page with `schematics/{{ schematic.pagePath }}/`
  (never `slugify(id)`, which collides) and to the viewer with `tools/schematic/?schematic=<domain>/<relPath>`.
  The viewer's files are gzip copies written by ingest (`schematicFiles.ts`) and served by a passthrough
  copy; don't point `fetch` at the raw game files. Schematic ids are the join key for tapestry/clutter/lore
  cross-references, so don't change their format. The schematic page embeds a read-only preview
  (`schematicPreview.js`); anything interactive (legend, layers, picking) belongs only in the full viewer.
  `meta-filler` starts hidden everywhere via `isHiddenByDefault` in `schematicVoxels.ts`; extend that one
  helper if more marker blocks should be hidden by default.
- **Git is read-only for Claude.** Read operations (`git status`, `log`, `diff`, `show`, `blame`,
  ...) are fine. Never run anything that writes to the repo's git state: no `commit`, `add`,
  `stash`, `checkout`/`switch`, `reset`, `restore`, `rebase`, `merge`, `branch`, `tag`, `push`, and so on.
  The user does all git writes themselves, between sessions. Leave changes as uncommitted edits in
  the working tree.

## Where things are

- `apps/vs-wiki/src/ingest/` — the whole data pipeline. `index.ts` orchestrates; `models/` has one file per
  content type. Shared infrastructure (asset loading, JSON patching, variant expansion, display-name
  resolution) is `libs/vs-wiki-core/src/{assetLoader,patchEngine,variantExpander,lang}.ts`.
- `apps/vs-wiki/site/` — Eleventy input. One directory per content type, each with an `index.njk` (listing) and
  (for paginated detail pages) a same-named `.njk` with `pagination:` front matter. `_includes/`
  has the shared layout and macros.
- `apps/vs-wiki/site/_data/generated/*.json` — ingest output, gitignored, regenerated by `npm run ingest`.
  Eleventy reads it as the `generated` global data object (e.g. `generated.items`,
  `generated.deposits`, `generated.depositsById`).
- `TODOS.md` — the user's own living backlog, not something to write to. Treat phases listed there
  as context for what might be asked next, not as standing authorization to start them — only act
  on what's actually been requested in chat.

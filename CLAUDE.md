# CLAUDE.md

Orientation for a fresh Claude Code session picking up this repo cold. `README.md` is the
contributor-facing architecture writeup (read it too) — this file is the shorter "how to actually
work in here without repeating known mistakes" doc.

## What this is

A statically-generated Vintage Story wiki. `npm run download` fetches the vanilla dedicated server
+ mods pinned in `vs-manifest.json`; `npm run ingest` (`src/ingest/`) parses that raw game data into
normalized JSON under `site/_data/generated/`; Eleventy (`site/`, Nunjucks templates) builds the
static HTML into `_site/`. Deployed to GitHub Pages via `.github/workflows/build-deploy.yml`.

```
npm install
npm run download   # fetch vanilla server + mods into vs_server/ and Mods/ (gitignored, cached in CI)
npm run build       # ingest + eleventy build into _site/
npm run serve       # same, with live reload
npm run typecheck   # tsc --noEmit over src/ingest
npm run clean        # rm -rf .scratch _site site/_data/generated
```

`vssurvivalmod/` at the repo root (gitignored) is a clone of the game's C# source
(`anegostudios/vssurvivalmod`), kept around purely as a reference for verifying display-name /
spawn-condition logic against the real engine behavior — it's not part of the build.

## The one bug you will probably rediscover

**A Nunjucks/Eleventy pattern that silently renders nothing**: inside a `{% for %}` loop,
`{% set x = someDict[loopVar] %}` immediately followed by `{% if x %}` can evaluate false even
when `x` is a genuinely truthy object. Confirmed NOT a caching artifact, NOT reproducible in an
isolated `nunjucks.renderString()` call, and the *identical* pattern works fine elsewhere in this
codebase (e.g. `recipesById` lookups in `items.njk`). Root cause unknown. **Workaround that is
confirmed reliable**: check a property instead of the bare variable — `{% if x.id %}` rather than
`{% if x %}`. See `site/items/items.njk`'s deposit/blockPatch loops for the pattern. If you add a
new `{% set x = dict[loopVar] %}` + `{% if x %}` combo anywhere, test it before trusting it.

## Conventions that aren't obvious from reading one file

- **Every content page lives under `/<lang>/`** (currently always `en/`). The `lang` global data
  value (`eleventyConfig.addGlobalData("lang", ...)` in `eleventy.config.js`) feeds both (a) every
  page's `permalink` front matter (`"{{ lang }}/items/.../index.html"`, explicit on every page —
  Eleventy's directory-inferred default permalink is never used) and (b) every internal link via
  `{{ ('/' ~ lang ~ '/') | url }}` instead of the plain `{{ '/' | url }}` idiom. **Shared assets
  (css/js/favicon/og-image) deliberately stay on the plain `'/' | url` form** — they're not
  language-specific, so don't prefix new asset references with `lang`. The bare site root
  (`/index.html`, from `site/redirect.njk`) is a meta-refresh redirect to `/<lang>/`. This is
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
- **The item index (`generated.items`, built by `src/ingest/crossref.ts`) is a recipe/loot graph,
  not a full registry walk.** Paintings/tapestries/clothing (`models/decor.ts` → `/decor/`) and
  ore/gem deposits + wild crop spawn patches (`models/deposits.ts` / `models/blockpatches.ts` →
  `/spawns/`, cross-referenced onto `ItemIndexEntry.spawnDeposits`/`spawnBlockPatches`) are
  deliberate carve-outs for things with no recipe and no drop table. If you're asked to surface
  some other spawn-only/recipe-less content type, this is the existing pattern to follow — don't
  force it through `crossref.ts`'s recipe/loot walk.
- **Entity spawn conditions live under `json.server.spawnconditions`** (or `...spawnconditionsByType`
  for glob-keyed variants), not top-level `json.spawnconditions` — a real bug hit once already
  (`src/ingest/models/loot.ts`, `extractEntitySpawnInfo`). If entity-derived data looks
  silently empty, check you're reading from the right nesting level before assuming it's missing
  upstream.
- **`resolveByType` (`src/ingest/variantExpander.ts`) must pick the most specific pattern match**,
  not whichever glob/regex key happens to appear last in the source file. This was a real bug
  (wrong bear hitbox sizes) before being fixed — if you touch this function, keep that property.
- **Datatable pattern**: any listing page uses the `datatable(pageSize, placeholder, headers)`
  macro (`site/_includes/macros/datatable.njk`) wrapping `<tr data-search data-category data-mod>`
  rows. All filter/search state round-trips through URL query params (`q`, `category`, `mod`, and
  numbered `q2`/`category2`/... for a second table on the same page) via
  `site/assets/datatable.js` — not just read once on load. Category/mod `<select>` filters
  auto-hide when the page's rows don't actually vary on that dimension. Follow this pattern for
  any new listing page rather than inventing a new table/filter shape.
- **Wildcard codes are clickable everywhere**: a code like `tallgrass-*` or `leather-normal-*`
  should link to `/<lang>/items/?q=<code | wildcardQuery | urlencode>` (see `wildcardQuery` filter
  in `eleventy.config.js` — strips `*`/`{...}` down to a literal prefix the datatable's substring
  search matches against each row's `data-search` attribute).
- **`RESTRICTION_GLOSSARY`** (`eleventy.config.js`, `restrictionInfo`/`restrictionLabel` filters) is
  the single source of plain-English explanations for cryptic worldgen/spawn condition keys
  (`minTemp`, `chance`, `habitatBlocks`, `yPosRel`, etc.), reused across structures, entity spawn
  conditions, and item deposit/patch info. Add new keys here rather than writing one-off prose in a
  template, so the wording stays consistent across pages.
- **Never commit unless explicitly asked.** This has held throughout the project's history; the
  user commits their own work independently between sessions.

## Where things are

- `src/ingest/` — the whole data pipeline. `index.ts` orchestrates; `models/` has one file per
  content type; `assetLoader.ts`/`patchEngine.ts`/`variantExpander.ts`/`lang.ts` are shared
  infrastructure (asset loading, JSON patching, variant expansion, display-name resolution).
- `site/` — Eleventy input. One directory per content type, each with an `index.njk` (listing) and
  (for paginated detail pages) a same-named `.njk` with `pagination:` front matter. `_includes/`
  has the shared layout and macros.
- `site/_data/generated/*.json` — ingest output, gitignored, regenerated by `npm run ingest`.
  Eleventy reads it as the `generated` global data object (e.g. `generated.items`,
  `generated.deposits`, `generated.depositsById`).
- `TODOS.md` — the user's own living backlog, not something to write to. Treat phases listed there
  as context for what might be asked next, not as standing authorization to start them — only act
  on what's actually been requested in chat.

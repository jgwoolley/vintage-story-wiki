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
  not a full registry walk.** Ore/gem deposits (`models/deposits.ts` → `/deposits/`), wild crop
  spawn patches (`models/blockpatches.ts` → `/crops/`), tree/fruit-tree spawn bands
  (`models/trees.ts` → `/trees/`), and blocks that only drop something with no recipe of their own
  (grouped in `src/ingest/index.ts` as `blockDrops`/`blockDropsById`, looked up live from `/items/`
  by `domain:code` — see below) are all deliberate carve-outs, synthesized via
  `ensureSpawnTarget(domain, code, kind)` in `src/ingest/index.ts` for things with no recipe and
  (for the first three) no drop table. Paintings/tapestries/clothing (`models/decor.ts`) are a
  separate, parallel carve-out that never joins the item index at all — they get their own
  dedicated top-level pages (`/paintings/`, `/tapestries/`, `/clothing/`) instead, each backed by
  its own filtered array (`generated.paintings`/`tapestries`/`clothing`, split from the combined
  `generated.decor` in `src/ingest/index.ts` right after cross-referencing). If you're asked to
  surface some other spawn-only/recipe-less content type, pick whichever of these two patterns
  fits (joins the item index vs. gets its own dedicated page) — don't force it through
  `crossref.ts`'s recipe/loot walk either way.
- **Content is organized by what the thing is, not by mechanism.** `/creatures/` is entity-only
  (stats, spawn conditions, own drop table); a block's drops live directly on that block's own
  `/items/` page (a "Drops" section, forward direction) rather than a separate per-source listing.
  The existing "Dropped by" section on an item page (reverse direction: what else drops *this*
  item) routes each row to `/creatures/...` or `/items/...` depending on `loot.sourceKind` — if you
  add another cross-link into loot data, check `sourceKind` the same way rather than assuming one
  target page type.
- **Entity spawn conditions live under `json.server.spawnconditions`** (or `...spawnconditionsByType`
  for glob-keyed variants), not top-level `json.spawnconditions` — a real bug hit once already
  (`src/ingest/models/loot.ts`, `extractEntitySpawnInfo`). If entity-derived data looks
  silently empty, check you're reading from the right nesting level before assuming it's missing
  upstream.
- **`resolveByType` (`src/ingest/variantExpander.ts`) must pick the most specific pattern match**,
  not whichever glob/regex key happens to appear last in the source file. This was a real bug
  (wrong bear hitbox sizes) before being fixed — if you touch this function, keep that property.
- **Datatable pattern**: any listing page uses the `datatable(pageSize, placeholder, headers)`
  macro (`site/_includes/macros/datatable.njk`) wrapping
  `<tr data-search data-category data-mod data-tags>` rows. All filter/search state round-trips
  through URL query params (`q`, `category`, `mod`, `tag`, and numbered `q2`/`category2`/... for a
  second table on the same page) via `site/assets/datatable.js` — not just read once on load.
  Category/mod `<select>` filters only hide when a page's rows carry *no* value at all for that
  dimension — a single distinct value still shows the dropdown (so it works for free the moment a
  2nd value appears later, e.g. a new mod). `tag` is a 4th, separate filter dimension (exact-token
  match against space-separated `data-tags`, not the free-text `q` substring search) with no
  `<select>` — it renders as a removable chip only when a `tag` param is active. Follow this
  pattern for any new listing page rather than inventing a new table/filter shape.
- **Wildcard codes are clickable everywhere**: a code like `tallgrass-*` or `leather-normal-*`
  should link to `/<lang>/items/?q=<code | wildcardQuery | urlencode>` (see `wildcardQuery` filter
  in `eleventy.config.js` — strips `*`/`{...}` down to a literal prefix the datatable's substring
  search matches against each row's `data-search` attribute).
- **`RESTRICTION_GLOSSARY`** (`eleventy.config.js`, `restrictionInfo`/`restrictionLabel` filters) is
  the single source of plain-English explanations for cryptic worldgen/spawn condition keys
  (`minTemp`, `chance`, `habitatBlocks`, `yPosRel`, etc.), reused across structures, entity spawn
  conditions, and item deposit/patch info. Add new keys here rather than writing one-off prose in a
  template, so the wording stays consistent across pages.
- **Nunjucks ternary + filter precedence**: `{{ x if cond else y | round(2) }}` applies the filter
  to `y` only, not to the whole expression — a real bug hit twice while building the tree spawn
  pages. Parenthesize the ternary before filtering: `{{ (x if cond else y) | round(2) }}`.
- **Every field in `src/ingest/types.ts` is documented** (inline `//` or leading `/** */` per
  interface) — keep this true for any new/changed field. This is the single source of truth for
  what each generated JSON shape actually means; don't let it drift into "self-explanatory" silence.
- **WIP stub page pattern**: `/guides/`, `/trades/`, `/tools/` are empty placeholder pages for
  content not extracted yet — a `.wip-badge`-styled note plus prose saying exactly which raw game
  files the real implementation would read (see those three `index.njk` files for the pattern:
  explain what's planned and where the data already lives, don't just say "coming soon").
- **The whole download/ingest/build pipeline is pure Node/npm** — `scripts/download.ts` uses the
  pure-JS `tar` package, not a shelled-out system binary. If you add a new external-tool
  dependency to any script, prefer an npm package over shelling out, to keep this property true.
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

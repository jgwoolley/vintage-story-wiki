# Changelog

What changed in this wiki, newest first, grouped by day; only things a visitor or contributor would notice, not every commit.
There are no version numbers or tags: the site is rebuilt and deployed from `main`, and the footer of every page shows the build time.
(The VS Code extension has its own version, 0.1.0, in `apps/vs-vscode-extension/package.json`.) Older detail is in `git log`.

## Unreleased

- **Top-down map view** on every schematic page: the structure seen from above like a map, with relief shading and a hover tooltip.
- **No more "Tools" section**: each interactive page moved into the section it belongs to (schematic viewer, search and chiseled shape viewer
  under `/schematics/`, the alloy calculator under `/recipes/`, the calendar at `/calendar/`), the header menu and home page are now grouped
  Crafting / World / Decor & Lore, and the old `/tools/...` addresses redirect.
- **New map**: the WayPoint planner and the seed climate lookup are one page, `/map/`. Click the map to see the climate there, and load your
  game's `Maps/<id>.db` file to draw the terrain you have explored behind your waypoints (ported from the vintage-story-launcher; checked
  against hand-made tiles, not yet a real save).
- **VS Code extension**: previews game model (shape) files (items, creatures, blocks, armor, clothes) as untextured 3D models; armor and
  clothing are placed on the player body model when it is found next to them. It has now been launched in a real VS Code
  (`npm run screenshots -w vs-vscode-extension`), and ChiselTools shape files without an extension open in the preview.
- **Links that work**: item links never point at pages that don't exist, wildcard links only appear when their search finds a row,
  and `npm run check-links` verifies every internal link and search link of a build. The search box understands `a or b`, which fixed the
  class trait links ("sewing kit or chateau or ...").
- **Trades**: named villagers now have their trade lists (Tobias is one villager, not 30), listings of the generic clutter block show the
  clutter they sell, and mod-added listings (BetterRuins' locator maps) point at the right item pages. 600 nonexistent villagers
  were removed by honoring `AllowedVariants`.
- **Every table paginates** (plain tables over 20 rows get Prev/Next, including ones filled by scripts).
- **Friendlier creature names** for the developer bots and villagers ("Animal bot: Sirohi goat kid (female)", "Blacksmith Gerhardt").

## 2026-10-25

- **3D models for items and creatures** (untextured boxes, one color per texture name), clutter types with their own pages and models, and
  armor and clothing shown on the player body.
- **Armor page** with protection, durability, warmth and side effects; **armor and clothing stats** (warmth, repair materials, repair
  recipes) on their item pages; **weapon and tool stats** on item pages.

## 2026-10-22

- Moved to its own address, vintagestory-wiki.nf3t.com.

## 2026-10-19

- **VS Code extension** (schematic and ChiselTools shape preview), packaged in CI and downloadable from `/extension/`.
- **Schematic search** by block and **chiseled blocks** drawn as their real shape; fixed the chiseled shape not being centered and the
  waypoint planner; real block colors in the schematic preview.

## 2026-10-15

- Repository became npm workspaces (`libs/vs-wiki-core`, `libs/vs-schematic`, `apps/vs-wiki`, `apps/vs-vscode-extension`).

## 2026-10-13

- **Weapons and tools** table, **climate** (seed lookup), item randomizers (stack randomizer pools), schematic preview on each schematic page,
  fixed schematic parsing, book/lore split into two sections, Eleventy build times on the build page, a large build speed-up.

## 2026-10-12

- **Merged the schematic viewer and the price guide into this repository** (schematic viewer, waypoint planner, calendar, trades),
  plus clutter and the alloy calculator, source pages that document how each page is produced, classes and traits, better tapestries,
  and fixed creature drops for drifters.

## 2026-10-11

- **First release (1.0)**: the download script, the ingest pipeline and the Eleventy site with items, recipes, loot, structures, deposits,
  crops, trees, foods, trades, books, lore, paintings and guides; localized names; mod filter and URL-synced search; SEO.

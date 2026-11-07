# Changelog

What changed in this wiki, newest first, grouped by day; only things a visitor or contributor would notice, not every commit.
There are no version numbers or tags: the site is rebuilt and deployed from `main`, and the footer of every page shows the build time.
(The VS Code extension has its own version, 0.1.0, in `apps/vs-vscode-extension/package.json`.) Older detail is in `git log`.

## 2026-11-07

- **vsdev page** (`/vsdev/`, under About, below Game file locations): the vsdev command line tool's documentation on the wiki. The tool's
  package is now `@nf3t/vsdev`, matching the `vsdev` command.
- **Game file locations page** (`/game-files/`, under About): where Vintage Story installs the game and keeps your mods, saves,
  logs and settings on Windows, Linux and macOS, where a dedicated server keeps its data, and where to download the game and the server.

- **VS Code extension: game folder for textures.** **Vintage Story: Select Game Folder** (setting `vsSchematic.gameFolder`) points the
  extension at the game client install; a model's legend then shows its real textures and lists any it couldn't find.

- **`vsdev`, Vintage Story dev tools on the command line** (`apps/vsdev`, installable globally), for contributors, modders and
  coding agents. `vsdev mod` searches ModDB, shows a mod's releases and game versions, installs mods with their dependencies and
  updates a Mods folder (the Python vs-mod-updater ported, now picking releases for a game version the way the game does, refusing
  retracted and blocklisted releases and never downgrading) and extracts zips. `vsdev moddb` brings the C# ModDbCli's page tools to
  any mod project: `check`, `status`, `scaffold`, `pull`, `diff` and the `serve` review page, plus `export`, a static site (for
  GitHub Pages) that rebuilds your mods' pages with the newest unpublished zips, installable with `vsdev mod install <id> --source
  <site>`. `vsdev game` downloads the dedicated server; for real textures vsdev uses your installed game (it never downloads the paid client). Where the game, mods and project files are is one rule
  everywhere (flag, env such as `VINTAGE_STORY`, `vs-manifest.json`, the current folder, then the real install), shown by
  `vsdev paths`; `npm run download` and ingest use it too. The game (client or server) now lives in `./vintagestory`; an existing
  `./vs_server` keeps working.
- **Headless renderer** (`vsdev render`, or `npm run render -w @nf3t/vsdev -- <file>...`) renders a model file, a schematic (`.json`/`.json.gz`) or a QPTech ChiselTools `.pf` shape to PNGs from several angles, on the same viewers
  as the wiki and the VS Code extension. Models get their real textures with a game client folder (`--game`), worn items sit on the
  player body, and `--animation walk` (or `all`) writes sampled frames plus a contact sheet of each animation. Schematics are drawn in
  block colors with chiseled blocks carved, `meta-filler` hidden and an optional `--max-y` cutaway. `--list`/`--json` describe a file
  without rendering.

- **A wiki-like look**, after the official Vintage Story wiki: green title bar, left navigation panels (replacing the header dropdowns), parchment pages with serif
  headings and a dark variant, a floating **infobox** with the 3D model and key facts on item, creature and clutter pages, a "Contents" box on longer pages, and the
  technical "Game logic (C#)" tables moved to the bottom of those pages.
- **Phone fixes** for the new layout: wide tables scroll inside their own box instead of widening the page, and the search box gets its own full-width row with a readable results list.
- **Site-wide search** in the title bar: type to jump to any item, creature, structure, clutter, painting, clothing, class, guide, book or trader (press `/` to focus it).
- **Animations** in the 3D model previews: creatures, items and clutter that have animations (a wolf's idle, walk, run...) get an Animation picker that plays
  them in a loop on the wiki pages and in the VS Code extension. Worn armor and clothing stay in their rest pose.
- **Show floor** in the model previews (a one-block grid at ground level, to see where a creature or item sits), and the animation and floor choices are in
  the page address (`?anim=walk&floor=1`) so a link shares them. The pickers now follow the site's light/dark theme and the VS Code theme.
- **Climate list is a table**: the plants and trees that fit a climate show their kind, temperature and rainfall bands, 20 per page.
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

# vsdev

Vintage Story dev tools on the command line, for anyone (human or coding agent) making mods:

```
vsdev render <file>...   render models (with animations), schematics and ChiselTools .pf shapes to PNGs, headless; --check lints a model
vsdev texture <spec>...  paint PNG textures from layers (noise, grain, wear, bevels, bricks, pixel art), seeded and tiling
vsdev shape <spec>...    build shape (model) JSON from boxes placed on each other, joints, corners, mirrors, reliefs; checked; --render to look
vsdev find <text>...     asset codes of the game's textures and shapes by name: what to put in a shape's textures, vanilla shapes to copy
vsdev game               download the dedicated server (the game client only with --client --accept-client-terms: see below)
vsdev mod <command>      other people's mods: search, info, install (with dependencies), update, extract
vsdev moddb <command>    your mods' ModDB pages: check, status, scaffold, pull, diff, serve (review page), export (static site)
vsdev download           the dedicated server and pinned mods from a vs-manifest.json
vsdev search <text>...   search the wiki (items, creatures, structures, guides...) from the terminal
vsdev screenshots [name...] render the schematic screenshots listed in vs-manifest.json to PNGs (for a ModDB page)
vsdev manifest <command> vs-manifest.json as a requirements file: freeze (folder -> manifest), install (manifest -> folder)
vsdev paths              where every location below resolves, and why
```

Each command has `--help`. Relative paths are taken from the directory you run it in.

**The manifest schema keeps itself current.** If the folder you run any command from has a `vs-manifest.schema.json` (what a
`vs-manifest.json`'s `"$schema": "./vs-manifest.schema.json"` points at), vsdev rewrites it to the copy that ships with it when
the content differs, and says so on stderr, so new manifest keys complete in your editor after a `npm i -g @nf3t/vsdev@latest`.
It never creates the file, only touches one whose `$id` is vsdev's own, and ignores formatting differences. A *newer* copy than your vsdev's is overwritten too, so update vsdev rather than the file. `--no-schema-update`
(anywhere on the command line, any command) turns it off for that run; `--help` doesn't refresh it.

## Agent skills

The repo is also a Claude Code marketplace (`.claude-plugin/marketplace.json`, skills in `skills/`) teaching coding agents to use vsdev:
`vsdev-render`, `vsdev-generate`, `vsdev-mods`, `vsdev-game-setup`, `vsdev-moddb`, `vsdev-screenshots` and `vsdev-wiki-search`. Claude Code: `claude plugin marketplace add jgwoolley/vintage-story-wiki`,
then `claude plugin install vsdev@vintage-story-wiki`. The oh-my-pi marketplace is `.omp-plugin/marketplace.json`; both files are written by `npx @nf3t/skills-pages repo-files . --yes` (rerun it after adding or
renaming a skill). `src/vs-manifest.schema.json` is copied into the skills that read the manifest (`vsdev-mods`, `vsdev-game-setup`): a git install
(`claude plugin marketplace add`, a clone) gets it, but skills-pages skips symlinks, so the site's per-skill zips don't. Other agents: `npx skills add jgwoolley/vintage-story-wiki`. Check them with
`npx @nf3t/skills-pages check . --strict`; keep them in sync when a command changes.

## Install

Needs Node 22+. From this repo:

```
npm install
npm run build -w @nf3t/vsdev && npm link -w @nf3t/vsdev        # `vsdev` on your PATH, following this checkout (rebuild to update)
# or a fixed copy:
npm pack -w @nf3t/vsdev && npm install -g ./nf3t-vsdev-0.1.0.tgz
npx playwright-core install chromium                            # once, for vsdev render
```

Inside the repo without installing: `npm run vsdev -w @nf3t/vsdev -- <command>` (and `npm run render -w @nf3t/vsdev -- <file>...`).
`dist/cli.js` is an esbuild bundle (`esbuild.mjs`) with the repo's TypeScript-only `vs-schematic` lib inlined; `dist/` also carries
the review page (`web/`), `page.schema.json`, `vs-manifest.schema.json` and the block colors. `playwright-core` (pinned to the exact
version whose Chromium build is installed), `tar`, `adm-zip`, `json5` and `ajv` are its only runtime dependencies.

## Where vsdev reads and writes

One rule for every command (`src/locations.ts`; the wiki's own pipeline uses it too):

**1 flag, 2 environment variable, 3 `vs-manifest.json`, 4 this folder, 5 where the game is really installed.** Reads take the first
that exists (an explicit flag, variable or config entry is taken as given, so a typo is reported instead of skipped). Writes and
downloads stop at 4: vsdev never writes into a real game install unless a flag, variable or config entry says so.

| Location | 1 Flag | 2 Env | 3 `vs-manifest.json` | 4 This folder | 5 Installed (reads only) |
|---|---|---|---|---|---|
| Game install | `--game-dir` | `VINTAGE_STORY` (the variable the VS mod template's csproj files use) | `gameDir` | `./vintagestory` (an old `./vs_server` is still read, and reused while it is the only one) | client: Linux `~/.local/share/vintagestory`, Windows `%APPDATA%\Vintagestory`; then a server at `/home/vintagestory/server` (the official `server.sh`). macOS isn't guessed |
| Data folder (`Mods/` in it) | `-p`/`--data-dir` (a data folder or a Mods folder) | `VINTAGE_STORY_DATA` | `dataDir` | `./Mods` | the game's data folder (`$XDG_CONFIG_HOME` or `~/.config`, `%APPDATA%`, `~/Library/Application Support`, + `VintagestoryData`), then `/var/vintagestory/data` |
| Game version | `--game-version` | `VINTAGE_STORY_VERSION` | `gameVersion` (or `serverVersion`) | the found game install's `assets/version-*.txt` | the newest stable version on ModDB |
| Built mods | `--releases-dir` | | `releasesDir` | `./Releases` (the template's CakeBuild output) | |
| Page sources | `--pages-dir` | | `pagesDir` | `./moddb` | |
| Wiki (`vsdev search`) | `--wiki` | `VSDEV_WIKI_URL` | `prodWikiUrl` | the project's own wiki | |

- **Client and server are one location.** The server download is a strict subset of the client (all its files, `VintagestoryServer`
  included, are in the client, which adds textures, sounds, shaders and the game executable: about 905 MB against 322 MB unpacked).
  Readers prefer a client (your installed game); `vsdev game` downloads the server (the client only with `--client --accept-client-terms`). `vsdev render` skips server-only
  installs when looking for textures.
- `vs-manifest.json` is the nearest one in this folder or a parent; paths in it are relative to it. A mod project can pin
  everything in a few lines: `{ "gameDir": "~/.local/share/vintagestory", "gameVersion": "1.22.7", "gameKind": "client" }`
  (`$schema`: `vs-manifest.schema.json`, shipped in `dist/`; a copy in the folder you run from is kept current, see above).
- Generated output goes under `./.vsdev/`: `renders/`, `extracted/`, `site/`.
- `vsdev paths [--json]` prints each location, the tier it came from and every candidate it checked.

## `vsdev game`

```
vsdev game [--server] [--version <v>] [--branch stable] [--game-dir <dir>] [--force]
```

Downloads the Linux x64 dedicated server from `cdn.vintagestory.at/gamefiles/<branch>/vs_server_linux-x64_<version>.tar.gz` and unpacks
it: the game's data (`assets/`) and DLLs, without textures. The target is `--game-dir`, `$VINTAGE_STORY`, `gameDir`, else
`./vintagestory`; the version `--version`, `$VINTAGE_STORY_VERSION`, `gameVersion`, else the newest stable on ModDB (1.22.7 when ModDB
can't be reached). The download and unpacking happen in temp files next to the target, which is only replaced once both succeed: a
wrong version or a dropped connection never deletes a working install. A folder that isn't empty is handled by what's in it
(`gameInfo` reads the kind from the textures and the version from `assets/version-*.txt`; `vsdev game` leaves a `.vsdev-game.json`
marker in what it installs):

| In the folder | Result |
|---|---|
| the same version (a server, or a client, which includes the server) | left alone |
| a client of another version | refused: a server would lose the textures (pick another `--game-dir`, or `--force`) |
| a server vsdev installed (marker) | replaced with the version asked for |
| your own install, or other files | left alone |

`--force` always reinstalls.

**The game client is not downloaded by default, and only with your say-so.** It is at the same CDN path with `vs_client_linux-x64_`
(the old `extract.sh` in translocator-locator-cmd fetched it), but it's the paid game, and the
[Terms of Service](https://www.vintagestory.at/tos.html) frame downloading it as part of an account that bought it. So
`vsdev game --client` alone prints where the client comes from (Client Area, `https://account.vintagestory.at/`) and exits. If you have
read the terms or checked with the Vintage Story developers and downloading it this way is fine for your use, add
`--accept-client-terms` (`vsdev game --client --accept-client-terms`; `vsdev download` takes the same flag with `"gameKind": "client"`):
that statement is yours, so there is no default, environment variable or config key for it. The client unpacks to the same location as
the server (`.vsdev-game.json` records it, so only installs vsdev made are replaced). Most people should still point vsdev at the copy
they installed: it's found in the default install location, or through `--game-dir` / `$VINTAGE_STORY` / `gameDir`. The note is repeated
in `src/game/download.ts`.

## `vsdev mod`

| Command | |
|---|---|
| `search <text> [--limit 20] [--game-version V]` | find mods: an exact modid first, then name matches, then the rest by downloads |
| `info <mod> [--all]` | details, links, and each release with the game versions it's tagged for |
| `install <mod[@version]>... [-p dir] [-o dir] [--source url] [--no-deps] [--extract dir]` | install with dependencies |
| `update [-p dir] [-o dir] [--source url]` | update every mod in a folder, and install dependencies nothing satisfies |
| `extract <zip>... [--out dir]` | unpack zips into `<dir>/<zip name>/` (default `./.vsdev/extracted`) |

`install` writes to `-p`, `$VINTAGE_STORY_DATA`, `dataDir`, else `./Mods`; `update` reads by the full order (so with no `./Mods`
it updates your game's own Mods folder) and writes back there. With `-o` the zips go elsewhere and the scanned folder isn't touched.
`install` and `update` show a plan and ask before changing files; without a terminal they need `-y`. `--json` gives machine-readable
output everywhere. `--source <url>` (repeatable) installs the mods a `vsdev moddb export` site lists from that site (its `mods.json`;
the sha256 is checked) instead of ModDB; other mods and dependencies still come from ModDB.

**How a release is chosen, and the edge cases, follow the game** (its `ModDbUtil`, `ModLoader` and `ModContainer`, and vsapi's
`GameVersion`, `SemVer` and `ModInfo`):

- ModDB picks the file: `api/v2/mods/install-information?gv=<game version>&ids=...`, as the game's `/moddb install` and its mod
  download screen do. The game version comes from the location rule above (printed). A dependency gets ModDB's recommended version.
- ModDB never picks a pre-release (`-dev`, `-pre`, `-rc`) on its own: a mod with only pre-releases for your game version is reported
  with the version to pin (`mod@2.0.0-dev.17`). A dependency whose required minimum is itself a pre-release gets the newest
  release that meets it (with a note).
- Retracted releases are refused (`--allow-retracted` is the game's "Install anyway"); so is anything on the game's blocklist
  (`cdn.vintagestory.at/api/blockedmods.json`, a whole mod or one `id@version`).
- An installed copy newer than the target is left alone (never a silent downgrade); an installed dependency that meets the declared
  minimum is left alone; after installing, older copies of the same modid are removed (the game would only load the highest).
- Versions compare like the game: `1.17` is `1.17.0`, and dev < pre < rc < release. Dependency minimums are SemVer (`""` or `*` = any).
- Only a `modinfo.json` at the zip's (or folder's) root counts, as in the game. It is read leniently (comments, trailing commas,
  single quotes, unquoted keys, any key case), and a missing `modid` is made from the name. A zip with `modinfo.json` only in a
  subfolder is reported as one the game won't load. `.dll`/`.cs` mods declare themselves in code, which isn't read, so they are
  listed as unchecked.

`install`/`update` are a port of [vs-mod-updater](https://github.com/jgwoolley/vs-mod-updater) (plan lines `[+]`/`[~]`/`[=]`/`[x]`,
dependency resolution from each zip's `modinfo.json`, the `-o` rules). Where the live API differs from the game's code, vsdev follows
the API: search's `gv[]` filter returns HTTP 500, so it uses `gameversions[]`; game version names come without the `v` the game
expects; an unknown mod is HTTP 200 with `"statuscode":"404"`.

## `vsdev moddb`

Your own mods' pages on mods.vintagestory.at, kept in source control and compared with the site: a port of ModDbCli
(translocator-locator-cmd), usable in any mod project. The mods are the zips in `./Releases` (newest per modid); the page sources
are `./moddb/<modid>/`:

| File | Content |
|---|---|
| `page.json` | modid, moddbId, [moddbPageId for a draft], urlalias, name, side, type, the five links, sorted tags, logo, screenshots |
| `description.html` | the page description, as the HTML the site stores |
| `releases/<version>.json` / `.html` | a release's game versions and file name / its changelog |
| `images/` | the logo (`logo.<ext>`) and the screenshots: **keep them here**, published or not; every name in page.json must exist |

`page.json` is validated against `moddb/page.schema.json` if there is one (`scaffold` writes it), else the bundled one. Volatile
values (downloads, follows, timestamps, CDN URLs) aren't stored, so a diff only shows real changes.

| Command | |
|---|---|
| `check [dir\|zip]... [--fail-if-undeployed\|--fail-if-deployed\|--fail-if-skipped]` | each zip: `deployed` / `new-version` / `new-mod` / `error`, and a warning when a new version skips a number (from 1.2.3 the next are 1.2.4, 1.3.0 or 2.0.0); under GitHub Actions also `undeployed`/`any_undeployed` outputs, a step summary and `::warning`s |
| `status` | per mod: local version, newest listed, uploaded or not, changelog drafted, page written |
| `scaffold [modid...] [--force]` | placeholder pages (name/side/description from the zip's modinfo, `TODO:` placeholders, source URL from `git remote`) for mods that aren't published |
| `pull [modid...] [-y]` | rewrite `moddb/<modid>/` from the live page; lists the local files it would overwrite and asks first (no terminal: needs `-y`) |
| `diff [modid...] [--fail-if-placeholders]` | live vs local as a unified diff; local-only release drafts are *pending*, not a difference; exit 1 when they differ |
| `serve [modid...] [--port 5173] [--no-open]` | the review page: a checklist per mod (progress kept in `moddb/.progress.json`), Local / Site / Diff per section with a word diff, rich-text copy buttons (a bare `<pre>` is copied as the editor's own `<pre class="language-plaintext"><code>` code block; "Copy HTML source" into the editor's `<>` source view is the exact route), warnings (missing logo/screenshots/links/tags, image sizes, HTML the editor drops, `<pre>` code blocks without `language-*` and `<code>`, version skips, modicon.png 128x128) |
| `export [modid...] [--out .vsdev/site] [--title text]` | the static site below |

Shared: `--releases-dir`, `--pages-dir`, `--json`, `--offline` (network commands print "offline: skipped"; `serve` and `export` work
from local data). Exit codes: 0 ok, 1 a condition met, 2 a lookup failed or the input was unusable. Drafts, which the API doesn't
show, are read from their public HTML page when `page.json` has `moddbPageId`.

Workflow: first upload: `scaffold`, write the placeholders (`diff --fail-if-placeholders` exits 1 until done), put the images in
`moddb/<modid>/images/`, then `serve` and follow its checklist, then `pull`. New version: write `releases/<version>.html`, upload, `pull`.

Differences from ModDbCli: the default pages folder is `moddb/` (the C# repo: `--pages-dir ModPages`); screenshots must be in
`images/` whether or not the page is published (the C# project's `Screenshots/` folder isn't checked); the server also refuses
requests whose `Host` isn't 127.0.0.1/localhost (DNS rebinding); a published page links to `/show/mod/<assetid>`. On the
translocator-locator-cmd pages, `diff` gives byte-identical output and the same exit code as `dotnet run --project ModDbCli -- diff`.

### `vsdev moddb export`: a static site for GitHub Pages

A public rebuild of each mod's ModDB page from `moddb/<modid>/`, hosting the newest zip from `Releases/`, so people can get versions
that aren't on ModDB yet. What the ModDB page manages (name, description, tags, links, logo, screenshots, changelogs) comes from
`moddb/<modid>/`; the mod itself from the zip: version, game version, dependencies, download and side (its `modinfo.json`, what the game
enforces; a different `page.json` side is warned about). The zip also fills gaps: its `modicon.png` is the logo when `page.json` names
none, and its `modinfo.json` description stands in for a missing `description.html`. None of the review information goes into it (no checklist, diffs, warnings, local paths or progress; the
CLI prints the warnings instead). Output, all links relative so it works under a Pages subpath:

```
index.html  <modid>/index.html  <modid>/images/*  <modid>/files/<zip>  mods.json  style.css  .nojekyll
```

Each page has a **Download** button with where to put the zip, and the `vsdev mod install <modid> --source <this site>` command.
The game's own one-click install (`vintagestorymodinstall://`) can't be offered: it always asks ModDB. Online, versions on ModDB are
marked and the page links to its ModDB listing. `--out` must be empty or a previous export; it refuses a folder that holds your files. A previous export is emptied, not
removed, so a web server that bind-mounts the folder (Docker) keeps serving it.

A GitHub Actions job that builds and publishes it (not part of this repo):

```yaml
  pages:
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write }
    environment: { name: github-pages }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/checkout@v4              # vsdev, from this repo
        with: { repository: jgwoolley/vintage-story-wiki, path: .vintage-story-wiki }
      - run: cd .vintage-story-wiki && npm ci && npm run build -w @nf3t/vsdev && npm link -w @nf3t/vsdev
      - run: ./build.sh                        # your CakeBuild: writes Releases/ (the template's build)
      - run: vsdev moddb export --out _site
      - uses: actions/upload-pages-artifact@v3
        with: { path: _site }
      - uses: actions/deploy-pages@v4
```

## `vsdev search`

```
vsdev search <text>... [--kind Item] [--limit 10] [--lang en] [--wiki <url>] [--json]
```

Searches the wiki the way its header search box does: it fetches `<wiki>/assets/searchIndex.json` (rows of title, page, kind, code) and ranks
titles that start with the text, then titles with a word that starts with it, then titles and codes that contain it; several words must all
appear. Prints title, kind, code and the page's address (`--json`: the same as data; exit 1 when nothing matches). `--kind` takes a page kind
(`Item`, `Block`, `Creature`, `Structure`, `Guide`... the error lists them). The wiki is `--wiki`, else `$VSDEV_WIKI_URL`, else `prodWikiUrl` in
`vs-manifest.json`, else this project's own deployment, so a fork or a mod project can point it at its own build. Needs the network.

## `vsdev manifest`

`vs-manifest.json` works like a requirements file: its `mods` list pins what a project needs, and both directions are one command.

| Command | |
|---|---|
| `freeze [--from mods\|releases] [-p dir] [--releases-dir dir] [--manifest file] [--prune] [--dry-run] [-y]` | like `pip freeze`: write the mods found in a folder into `mods` |
| `install [--manifest file] [-p dir] [--force]` | like `pip install -r`: download the listed mods into the Mods folder (no game server; `vsdev download` does the server too) |

`freeze --from mods` (the default) reads a game Mods folder by the location rule (`-p`, `$VINTAGE_STORY_DATA`, `dataDir`, `./Mods`, then the
game's own data folder; `vsdev paths` shows which); `--from releases` reads a mod project's built zips (`releasesDir`, `./Releases`). Each mod
is pinned at its newest version there (the copy the game would load); zips with no readable `modinfo.json` are listed as skipped. By default
the list is only added to and updated (entries keep their order and spelling; new mods go at the end); `--prune` also drops listed mods the
folder doesn't have. It shows the changes and asks first (no terminal: `-y`; `--dry-run` writes nothing). Only `mods` is written, the other
keys stay, but the file is reformatted as two-space JSON. With no manifest it creates `./vs-manifest.json`. `install` does not follow
dependencies (pin them, or use `vsdev mod install`).

A mod entry can also carry `"src": "MyModFolder"`, the folder with your own mod's source (where its `modinfo.json` is, relative to `vs-manifest.json`), which maps the modid to its folder name. `freeze` keeps it, and `modSourceDirs` (`src/manifest/edit.ts`) reads it. Nothing else uses it yet.

## `vsdev screenshots`

Renders the schematics you list in `vs-manifest.json` from the camera angles you pick, one PNG each: "create all of these screenshots".

```json
{
  "screenshotsDir": "screenshots",
  "screenshots": [
    { "name": "ruin-front", "schematic": "betterruins:worldgen/schematics/ruin.json", "view": "south" },
    { "name": "ruin-corner", "schematic": "schematics/mine.json", "view": [1, 0.6, 1.2], "size": 1600, "maxY": 12 }
  ]
}
```

`vsdev screenshots` renders them all to `./screenshots/<name>.png`; `vsdev screenshots ruin-front` renders one; `--list` shows where each schematic is found without rendering.

- `schematic` is a file relative to `vs-manifest.json`, or `domain:path` inside the game's `assets/` or a mod in `Mods/` (a zip or an unpacked folder; a missing `.json` is added).
- `view` is `default`, `south`, `east`, `north`, `west`, `top`, `bottom`, `back`, or a direction `[x, y, z]` from the model's center (y up, +z south, +x east). `size` is in pixels (default 1280). Also `floor`, `grass` and `sky` (grass out to the horizon instead of the floor grid, and a sky; drawn with the game client's grass, plant-tint, sky and sunlight textures when it is found, built-in colors otherwise), `maxY` (a cutaway) and `showFiller`.
- The game is `./vintagestory` and the mods `./Mods` unless `vs-manifest.json` (`gameDir`, `dataDir`), `$VINTAGE_STORY` / `$VINTAGE_STORY_DATA` or `--game-dir` / `-p` say otherwise (`vsdev paths`).
- `model` instead of `schematic` renders a shape file (`survival:shapes/block/...`, or a path) with its real textures from the game client (`vsdev render`'s textures; asset names are matched case-insensitively, like the game).
- `scene` instead of a single source puts several parts in one image, e.g. a player in armor next to a broken translocator:

  ```json
  { "name": "repair", "view": [-1, 0.5, 1.4], "scene": [
      { "model": "survival:shapes/block/machine/statictranslocator/broken.json", "at": [0, 0, 0] },
      { "player": { "wear": ["armor-head-antique-forlorn-pristine", "armor-body-antique-forlorn-pristine", "armor-legs-antique-forlorn-pristine"],
                    "hold": "rod-cupronickel", "holdScale": 1.8, "animation": "insertgear", "frame": 30 },
        "at": [1.5, 0, 0.6], "facing": "west" } ] }
  ```

  A `model` part sits with its block corner at `at` (blocks: x east, y up, z south; `rotationY` and `scale` turn and scale it about the block's bottom center, `[8, 0, 8]`, like the game). A `player` is the seraph body in one of its animations (`insertgear`, `idle1`, `wave`...: `frame` holds one moment, 30 per second), standing with its feet at `at`; its own front is west at `rotationY` 0, or give `facing`. `wear` lists item codes: each is found in the game's `itemtypes`, its shape hangs on the body's bones like in the game, and the body parts it disables (hair under a helmet: `attachableToEntity.disableElements`, minus what an item keeps, like the game) are hidden. Any part takes `scale` and `material`: one texture for every face of the part, worn and held items included (`"game:block/stone/rock/whitemarble1"` draws a marble statue; faces keep their UVs). `hold` / `holdLeft` put an item in a hand using the game's hand attachment point and the item's `tpHandTransform` (or the default). The game draws most items small in the hand, so `holdScale` enlarges them for an image. It is the same untextured-lighting renderer as the rest, not the game's: no face or eyes are painted, one pose, no hair styles. Item and block types are read from the game install only (not from mods).

  A `statue` part is a statue of the [Player Statues](https://mods.vintagestory.at/playerstatues) mod (`nf3tstatue`), drawn the way the mod draws it (the
  mod builds it in code; `libs/vs-schematic/src/statue.ts` is a port of that code): the faceless seraph in its skin parts, clothing and armor (the body
  parts they disable hidden), frozen in a frame of an emote (default: the most expressive keyframe) or riding a stone elk with tack, items in its hands,
  every face one tile of the block's stone or metal, on the block's pedestal. The fields are the block entity's:

  ```json
  { "statue": { "block": "nf3tstatue:statue-small-whitemarble", "emote": "cheer", "frame": 20,
                "armor": ["armor-head-plate-tinbronze", "armor-body-plate-tinbronze"], "hold": "rod-cupronickel" }, "facing": "south" }
  ```

  `block` is `nf3tstatue:statue-<small|large|bust>-<rock>` or `nf3tstatue:statuemetal-<size>-<metal>`; also `type` (`robot`), `skin` (skin part
  shapes, `game:entity/humanoid/seraphskinparts/...`), `clothing`, `holdLeft`, `mount` (`elkcow`, `elkbull`), `elkPose` (`stand`, `walk`, `gallop`),
  `elkFrame`, `antlers` (0-8), `tack` (`{ "bridle": "bridle1", "face": "face3", "saddle": "saddle1", "bags": "saddlebags1" }`), `noPedestal` and
  `clay` (pieces of fire clay packed around it). The pedestal and the robot come from the mod's zip in `Mods/`. Like the mod, `facing` / `rotationY`
  turn it about the block's bottom center.
- `title`, `subtitle`, `logo` (PNG, JPEG, SVG or WebP, relative to `vs-manifest.json`), `textAt` / `logoAt` (`top-left`, `top-right`, `bottom-left`, `bottom-right`) and `background` (a CSS color) draw text and a logo over the image, for a ModDB banner. `height` makes a non-square image (`"size": 1920, "height": 1080`), and `output` writes the PNG to a path of your choice (e.g. `MyMod/Screenshots/Main.png`) instead of `<screenshotsDir>/<name>.png`.
- `preset` sets sizes for ModDB: `modicon` (128x128, transparent: the icon the game shows), `moddb-logo` (480x480) and `moddb-logo-wide` (480x320, no margin). A ModDB logo is one of the mod's screenshots, shown on its card with the title and counts over the bottom part and a New!/Draft ribbon across the top-right corner, so these presets frame the subject above that (`safe`: `{ "bottom": 0.3 }` sets your own margins). Icons and logos read best as art only, since the card and mod lists already print the name. Prefer `moddb-logo-wide` (480x320): ModDB makes the 480x480 card image from it, adding the reflection below itself (inferred from BetterRuins' two files), so don't draw one (`"reflection": true` exists for square uploads). An entry with only a `logo` (no `schematic`/`model`) is an icon: the image fills the safe area, e.g. `{ "name": "icon", "logo": "MyMod/modicon.svg", "preset": "modicon", "output": "MyMod/modicon.png" }`.
- `vsdev screenshots --guides` writes `<name>-guides.png` with the covered areas shaded red, to check a layout before uploading.
- The images have no title or legend of their own. Blocks are drawn in their block colors and chiseled blocks as their cuboids, like `vsdev render`. Entities inside a schematic (players, creatures) are not drawn, only blocks, chiseled blocks and statues (below).

## `vsdev texture` and `vsdev shape`

```
vsdev texture <spec>... [--out <dir>] [--only a,b*] [--no-preview] [--dry-run] [--json]
vsdev shape <spec>...   [--out <dir>] [--only a,b*] [--render] [--dry-run] [--json] [--game-dir <dir>]
```

Make a mod's textures and models from a short description instead of a paint program or model editor, so they can be tuned and
remade: change a number, rerun, look. Both read a **spec file**: JSON (comments and trailing commas allowed), or a JS module (`.js`/`.mjs`)
whose default export is the spec, or a function that gets helpers (`box`, `joint`, `relief`, `mirror`, `corners`, `place`, `band`, `taper`, `repeat`, `mirrorRows`, and the ones
below) and returns it. Use a module when you want loops, parameters or a symmetric creature; it runs as ordinary code, like any script you run.
The output folder is `--out`, else the spec's `out` (relative to the spec file); names may contain `/` for subfolders.

**Textures** (`textures`: name -> `{ size, seed, layers }`, plus shared `colors`): layers are painted in order. Each paints with
`color` (mix towards it; `#rgb`, `#rrggbb`, `#rrggbbaa`, `[r, g, b(, a)]`, `transparent` or a name from `colors`) or `shade` (multiply the
brightness), times `opacity`, inside `region` `[x, y, w, h]`:

| Layer | What it draws | Fields |
| --- | --- | --- |
| `fill` | everything (a rectangle with `region`) | |
| `gradient` | a fade | `direction` down/up/left/right/radial/edges, `power` |
| `noise` | smooth blotches (grime, rust, moss, patina) | `scale` (pixels per blob), `octaves`, `coverage` (share of pixels: 0.2 = 20%), `softness` |
| `grain` | brightness jitter | `amount`, `scale` (1 = per pixel) |
| `speckle` | random dots (chips, pores) | `density`, `size` |
| `scratches` | short light streaks (or `color`/`shade`) | `count`, `length` (n or [min, max]) |
| `border` | a frame | `width`, `inset` |
| `bevel` | lit top/left, shadowed bottom/right (`sunken` swaps) | `width`, `inset`, `light`, `dark` |
| `circle` | a disc, or a ring with `ring` | `center`, `radius`, `ring` |
| `line` | a straight line | `from`, `to`, `width` |
| `bricks` | brick courses, or planks (bricks as wide as the texture) | `size` [w, h], `mortar`, `mortarWidth`, `offset`, `variation`, `bevel` |
| `pixels` | pixel art; each character a color from `colors` | `at`, `rows`, `colors`, `shadow`, `scale`, `mirror` |
| `custom` | (`.mjs` specs) whatever `draw(ctx)` paints: `ctx.width`/`height`, `random()` (seeded), `noise(scale, octaves)`, `get`/`set(x, y)`, `paint(x, y, t, color)` and `shade(x, y, t, f)` (through region, mask and opacity), `color(name)` | `draw` |

Any layer also takes a `mask`, so it only paints where the mask is on: pixel art (`{ "rows": [...], "at": [x, y], "scale", "keys": "#",
"invert" }`; any character but `.` and space counts unless `keys` says which) or, in a `.mjs` spec, a function `(x, y) => 0..1`.

Everything random is seeded from the texture's `seed` and the layer's position (a layer's own `seed` rerolls just that layer), so a
spec always paints the same pixels. Noise wraps around the edges, so textures tile. Each run also writes a preview sheet,
`.vsdev/renders/textures-<spec>.png`: every texture enlarged and tiled 2 x 2 (a seam shows), on a checkerboard, labelled. Look at it.

**Shapes** (`shapes`: name -> `{ textures, elements, ground?, prune?, textureWidth?, textureHeight?, textureSizes?, extra? }`), in the game's units
(16 = one block; x east, y up, z south):

| Element | What it makes |
| --- | --- |
| `{ "box": [[x1,y1,z1], [x2,y2,z2]], "tex": "key" }` | a box with all six faces; each face's UV is as big as that side (one texel per unit, at most the texture size), so nothing stretches. `faces` overrides sides (`"south": "otherkey"`, `"south": { "texture", "uv": "full" or [u1,v1,u2,v2], "rotation" }`, `"down": false`); `uv: [u, v]` shifts the faces' corner |
| `{ "joint": [x, y, z], "children": [...] }` | an empty pivot: children are placed relative to it and turn with it (how limbs are posed) |
| `"rot": [x, y, z]`, `"origin"` | on a box or joint: degrees about the origin (default: the box's center, the joint's point) |
| `{ "relief": ["..#", ".##"], "at": [x, y, z], "tex", "cell", "depth" }` | pixel art as boxes, facing south from its top-left front corner (`mirror: true` for symmetric art) |
| `{ "mirror": element(s), "axis": "x", "about": 8 }` | the elements plus mirrored copies (left/right in names swapped, east/west faces swapped, turns negated). `about` defaults to the middle of the coordinates the element is written in: 8 in the block, 0 inside a joint, half the parent's size inside a box |
| `{ "corners": element(s), "about": [x, z] }` | the elements at all four corners round a point (same default), named `<name>-nw`, `-ne`, `-sw`, `-se` (n = -z, e = +x): four table legs from one |
| `{ "size": [w, h, d], "on": "name" }`, `"under"`, `"against": ["name", "south"]` | a box of that size put on top of, below or against a face of an element written earlier in the same list (or `"parent"`, or `"block"`), centered on it. `null` in `size` = as big as the target there (`"grow": 0.5` makes that bigger: an overhanging lid). `"align": ["west", "north"]` lines sides up instead of centering, `"inset"` keeps it that far in, `"sink"` pushes it into the target, `"offset": [dx, dy, dz]` moves it last. Otherwise an ordinary box (`tex`, `faces`, `rot`, `children`) |
| `{ "size": [w, h, d], "center": [x, y, z] }`, `"base"` | a box around a point, or standing on one |
| `{ "band": "name", "y": [from, to], "out": 0.25 }` | a strip round an element (along `x`, `y` or `z`), standing `out` proud of it on the other two axes, so its faces never lie in the element's and flicker. At the floor it stops at y 0 |
| `{ "taper": [[x1,y1,z1], [x2,y2,z2]], "top": [w, d], "steps": 3 }` | slabs narrowing from the base box to the top (a roof, a plinth), named `<name>-1` upward |
| `{ "repeat": n, "step": [dx, dy, dz], "of": element(s) }` | n copies, each moved by step |
| `"ground": true` | on a top-level box or joint (a loose piece, a toppled figure): moved up or down until its lowest point is on y = 0, turns included. On a shape: the whole model |
| game JSON (has `from`/`to`) | copied as it is |

Placing boxes by what they touch (`on`, `under`, `against`, `band`, `corners`) is the point of these: coordinates worked out by hand
are where models go wrong (a part 0.2 short of the one it should sit on, trim flush with the face it decorates, a child written in
block coordinates instead of from its parent's corner).

**Poses.** `"poses": { "open": { "lid": [-70, 0, 0] } }` on a shape also writes `<shape>-open.json`, the same model with the element
named `lid` turned that way (replacing its `rot`): look at a chest open and closed, `vsdev render chest-open.json --compare chest.json`.
A positive x turn tips the top toward south (+z), so a lid hinged along its north edge opens with a **negative** x; positive y turns
counter-clockwise seen from above; positive z tips the top toward west.

**Every shape is checked as it is built** (the checks of `vsdev render --check`, below): errors and warnings are printed under the
shape and are in `--json` (`check`). `--check` makes the command exit 1 when a shape has an error, `--strict` on a warning too.

Each shape's bounds are printed (`x 0..16, y 0..12.5, z 2..14`; in `--json` too): check that nothing floats or sinks, and use them
for the block's selection box. Every face's texture key must be in `textures` (else an error lists them); keys no face uses are reported,
or with `"prune": true` (on a shape or the whole spec: a texture map shared by many shapes) left out of the file.

**Inventory icons.** Each shape's icon transform is printed too (`icon: origin 0.5 0.62 0.48, scale 0.71`: the bounds' centre in blocks,
and a scale that fits its longest side in `fit` blocks). With `"gui": { "file": "../blocktypes/thing.json", "key": "*-{name}-*",
"rotateY": 180 }` in the spec, every run writes them into that blocktype's `guiTransformByType`, one line per key (the rest of the file is
untouched; an existing entry keeps its rotation; a new key goes at the top of the block). `rotateY` is the turn of the variant the inventory
shows (the centre turns with it), `fit` (default 0.95), `maxScale` (1.1) and `rotation` ([-22.6, -45.3, 0]) can be set, and `"keepScale":
true` keeps the scale of entries already in the file (tuned by eye) while their origin follows the model.

**Helpers** a `.mjs` spec's function gets besides the elements above (texture specs too):

| Helper | What it gives |
| --- | --- |
| `bar(from, to, width, tex, opts)` | a box from one point to another (cables, rods, a limb between joints); `width` is a number or `[x, z]`. `aim(direction)` is its turn |
| `prism({ apothem, y: [y0, y1], sides, thickness, lean, core, turn, center, tex, panel })` | an n-sided upright section made of flat panels (a box and its 45 degree copy make an eight-pointed star, not an octagon); `lean` tapers it (a joint per panel), `panel(i, angle)` adds elements on a panel |
| `scaled(k, elements)` | the elements k times bigger (boxes, joints, origins, reliefs, game JSON): one model, several sizes |
| `texturesFor(textures, elements)` | of a shared texture map, the keys the elements use |
| `gameShape("entity/humanoid/seraph-faceless")` | a shape from the game install (`--game-dir`, else found as `vsdev render` finds it; the game domain's `game`, `survival` and `creative` folders) |
| `statue(shape, { animation, keyframe, pose, texture, scale, drop, attach })` | the shape as a statue, as the Player Statues mod makes them: a keyframe of one of its own animations baked in (`animationPose` returns it), every face on one material tile, scaled, `drop`ped elements left out, `attach`ed elements added to named ones (they follow the pose) |
| `project(shapeSpec, { width, side })` | the model seen straight on (`side` south, north, east, west or up): `at(x, y)` is the nearest face under a pixel (texture key, element, face, u/v on it), `rows(classify)` pixel-art rows for a texture's `pixels` layer or `mask` |
 Element names are made
unique (`rib`, `rib-2`...). `--render` renders what was written, like `vsdev render`, which finds the textures in the shape's own
`assets/<domain>/textures/` tree, so write textures there first. This is a renderer check, not the game's: open it in-game before releasing.

## `vsdev find`

```
vsdev find <text>... [--textures | --shapes] [--limit 40] [--json] [--game-dir <dir>]
```

Lists the textures and shapes whose path contains every word (`*` matches anything), in the game install and in this folder's own
`assets/` tree, as the codes a shape or blocktype uses, with the file:

```
vsdev find planks oak --textures     # game:block/wood/planks/oak1 ...: what to put in a shape's "textures"
vsdev find chest --shapes            # vanilla shapes to read, render (vsdev render <file> --sheet) and copy from
```

Textures are only in the game client (the server download has none); the command says so when it searched a server.

## `vsdev download`

```
vsdev download [--manifest vs-manifest.json] [--game-dir dir] [-p dir] [--force]
```

The dedicated server (not with `"gameKind": "client"`: the client is your own install) and every mod in a manifest (default: the
nearest `vs-manifest.json`), e.g.
`{ "serverBranch": "stable", "serverVersion": "1.22.7", "gameKind": "server", "mods": [{ "modid": "betterruins", "version": "0.6.4" }] }`.
Locations as above. Unpinned mods get ModDB's pick for the game version; dependencies aren't followed (pin them, or use
`vsdev mod install`). Once a mod's release is in the Mods folder (downloaded, or already there), every other zip with the same modid
(read from its `modinfo.json`) is removed, so bumping a pin replaces the old zip instead of leaving the game two copies; folders,
other mods and anything after a failed lookup are left alone. `vsdev manifest install` does the same. The wiki's `npm run download` runs on this code (`installGame`, `installManifestMod`), adding its own
`Mods/<modid>.meta.json` and timing file.

## `vsdev render`

```
vsdev render <file>... [options]
```

A headless renderer for **model (shape) files** (with their animations), **schematics** and **QPTech ChiselTools shapes**: PNGs from
several angles, without the game. Edit the file, render it, look, repeat.

What a file is gets worked out from its content, not its name:

| Kind | Files | Drawn as |
|---|---|---|
| model | shape JSON (`elements` boxes), e.g. `assets/<domain>/shapes/**.json` | its real textures when found, otherwise one color per texture key |
| schematic | `.json` or gzipped `.json.gz` (`Indices`/`BlockIds`/`BlockCodes`, e.g. `worldgen/schematics/**`, `/blueprint` exports) | one cell per block in its block color; chiseled blocks as their real cuboids; Player Statues statues as their figure |
| ChiselTools shape | `.pf save` files (`PantographData` XML, from the `chiselportfolio` folder) | the chiseled block, in its materials' block colors |

Relative paths are taken from the directory you ran it in. Images go to `./.vsdev/renders/` (or `--out`)
as `<name>-<view>.png`. The command then prints what each file is: a model's box count, texture keys, textures not found and its
**animations with their frame counts**; a schematic's size, block counts, chiseled blocks and most common blocks; a ChiselTools
shape's cuboids and materials. `--list` prints only that and renders nothing. `--json` prints the same thing as JSON, for scripts
and agents.

### Options

| Option | Applies to | |
|---|---|---|
| `--out <dir>` | all | output directory |
| `--size <px>` | all | image width and height (default 640) |
| `--views <a,b>` | all | `default`, `south`, `east`, `north`, `west`, `top`, `bottom`, `back` (`src/render/views.ts`); default: models `default,south,east,top,back`, others `default,top,south,east` |
| `--floor` | all | a one-block grid at ground level |
| `--grass` | all | grass out to the horizon at ground level, instead of `--floor` (the game's grass texture when a client is found) |
| `--sky` | all | a sky behind the subject (the game's `sky.png`/`sunlight.png` colors when a client is found) |
| `--list` / `--json` | all | describe without rendering / machine-readable output |
| `--game-dir <dir>` | models | the game **client** install to read textures from (`--game` is the same); default by the location rule: `$VINTAGE_STORY`, `gameDir`, `./vintagestory`, then an installed client |
| `--no-textures` | models | one color per texture key, as on the wiki |
| `--animation <a,b>` / `all` | models | render animations (see below) |
| `--frames <n>` | models | frames per animation (default 8) |
| `--frame <n>` | models | one pose (frame `n` of the single `--animation`) in every view |
| `--columns <n>` | models | contact sheet columns (default up to 4) |
| `--block-colors <f>` | schematics, `.pf` | a BlockColorMod JSON; default the wiki's `Nf3tBlockColors.json` (copied to `dist/blockColors.json` by the build) |
| `--show-filler` | schematics | draw `meta-filler` (hidden by default, as in the wiki's viewer) |
| `--max-y <n>` | schematics | leave out blocks above y = n, to see inside |
| `--no-chisel` | schematics | draw chiseled blocks as whole cubes |
| `--check` | models | lint the model as text (below); alone it starts no browser and writes no image. Exit code 1 on an error |
| `--strict` | models | with `--check`: exit 1 on a warning too |
| `--sheet` | models | one image, `<name>-sheet.png`: eight views (`default`, `back`, `top`, `bottom`, and the four sides square on), each titled with what it shows ("south side: east (+x) is right"); `--views` picks others |
| `--grid` | models | the axes from 0,0,0 (red +x east, green +y up, blue +z south), the outline of one block (0..16) and the floor grid, labelled |
| `--ortho` | models | no perspective, and side views exactly square on: sizes can be compared across the picture |
| `--color-by element` | models | one color per element instead of textures, with a legend of their names |
| `--highlight <a,b>` | models | these elements as drawn, everything else ghosted. A name also covers its children; `*` is a wildcard; `a/b` matches a path |
| `--hide <a,b>` | models | leave these elements out (to see inside) |
| `--compare <old.json>` | models | `<name>-compare.png`: the old file above the new one in four views, and a list of the elements added, removed and moved |

### Checking a model: `--check`

Looking at a render finds a model that is the wrong shape. It does not find a lid that floats 0.2 above its box, a band whose face
lies in the face under it (in game the two flicker), or a part 40 units away because its coordinates were written in the wrong
frame. `vsdev render model.json --check` reads the file and says so, in words, with every element's box:

```
bounds: x 1..15, y 0..13.2, z 1.75..14.5 (0.88 x 0.83 x 0.8 blocks; 16 units = 1 block)
error: "lid" touches nothing else: 0.2 from "body", lowest point y 9.2. Close the gap
warning: "body" and "band" have faces in the same plane in different textures (south; 16 square units shared): they will flicker. ...
elements (x, y, z of the box around each, after turns):
  body        1..15  0..9  2..14  [wood]
  hinge/lid   1..15  9.2..12.2  2..14  [wood]
check: 1 error, 1 warning
```

| Level | Code | Means |
|---|---|---|
| error | `floating` | a part (or group of parts) touching nothing else and not resting on the floor. A group that reaches the block's side is a note instead (it may hang on a neighbour) |
| error | `empty` | no element has a textured face |
| warning | `coplanar` | two faces in one plane, overlapping, in different textures: z-fighting. Skipped where a third element covers them |
| warning | `flat-in-face` | a zero-thickness element lying in another's face |
| warning | `no-size` | an element with no size on two or three axes |
| warning | `uv` | a face's UV outside its texture (`textureSizes`, else `textureWidth` x `textureHeight`, else 16 x 16) |
| note | `inside`, `outside`, `texture`, `same-texture`, `worn` | wholly inside another element; leaves the block (0..16), listing which parts; a texture key not in the shape's `textures`; coplanar faces in the same texture; a worn item (gap checks skipped: its parts hang on body bones) |

Element boxes are after every turn, in the block's coordinates, whatever frame they were written in: read them to see where a child
really is. `--json` gives the same as data (`check.findings[]`: `level`, `code`, `message`, `elements`; `check.elements[]`: `name`,
`path`, `min`, `max`, `size`, `turned`, `textures`). The code is `src/shape/check.ts`; touching means within 0.05 units.

### Animations

`--animation walk,idle` (or `all`) samples `--frames` evenly spaced frames from each animation, from frame 0 up to (but not
including) its length. Each frame is written as its own image, `<name>-<view>-<anim>-f<frame>.png`, and the frames are also put
together in a **contact sheet**, `<name>-<view>-<anim>-sheet.png`: a grid with each frame labelled, so the whole motion reads in one
image. To keep the output small this uses only the first view (`default`) unless you give `--views`. `--frame 12 --animation walk`
renders that single pose in every view. An animation code the model doesn't have is an error, and the error lists the ones it does
have. The camera stays framed on the rest pose, so a creature's movement shows against a fixed frame.

Poses come from the shared `samplePose` (`libs/vs-schematic/src/shapeBoxes.ts`) through `ModelPreview.showFrame`, the same code
behind the wiki's and the extension's animation picker. Keyframes are interpolated linearly. Every animation is treated as looping
(as in the previews). Animations in the newer `version` matrix format are skipped, as everywhere else.

### Textures, colors and limits

A statue of the Player Statues mod (`nf3tstatue:statue-*`, `statuemetal-*`) in a schematic is drawn as its figure in its rock's (or metal's) block
color: its block entity (pose, worn and held items, elk...) is built through `libs/vs-schematic/src/statue.ts`, a port of the mod's own
meshing, with the game's shapes (any install, a server will do) and the mod's zip in `Mods/` (pedestal, robot). The invisible multiblock
parts around a large statue (`game:multiblock-*`, which the game draws as nothing) are left out of every schematic.

- **Model textures** are looked up the way the game does (`@nf3t/vs-schematic/textureFiles.js`). A path without a domain belongs to the
  model's own domain. `game:` textures are spread over `assets/survival`, `assets/game` and `assets/creative`. The search covers the
  model's own `assets/` tree first, then `--game`. The dedicated server ships almost no textures, so it is refused. Each face uses its
  own `uv` and `rotation`, pixelated, with cut-out transparency. A key with no image is drawn in its own hash color, and the legend
  shows each key's texture or color. Textures named only by the item/block type, rather than in the shape's `textures`, aren't
  resolved.
- **Worn items** (armor, clothing: `stepParentName` pieces) are placed on the player body,
  `shapes/entity/humanoid/seraph-faceless.json`. It is looked for in the model's domain, `game` and `survival` beside it, then in
  `--game`. If it isn't found the pieces are drawn unplaced, and the report says so.
- **Schematics and ChiselTools shapes** use block colors, not block textures (resolving a block's textures goes through its blocktype
  and is not done). Codes missing from the color file get a hash color. Chiseled blocks are cut into their cuboids from the block
  entity (`decodeChiseledBlock`). A blob that can't be read stays a cube and is counted in the report. Only `meta-filler` is hidden
  by default. Other worldgen markers (`meta-underground`, `meta-blocklayer`...) are drawn.
- This is not the game's renderer: there is no game lighting, glow, wind or animated textures. Block shapes inside schematics (stairs,
  fences) are drawn as whole cells.

### How the renderer works

`src/render/inputs.ts` (Node, unit tested) reads each file, gunzips it when needed, and works out what it is. It also turns a schematic
into boxes, cutting chiseled blocks into cuboids, maps block colors and finds the player body. `src/render/page/main.ts` is bundled by
`esbuild.mjs` into `dist/page.js`, with three.js and vs-schematic inlined, as for the extension's webview. `src/render/render.ts` starts
Playwright's Chromium headless with software WebGL (SwiftShader) and loads that bundle into a blank page. It then calls
`loadModel`/`loadSchematic`/`loadChisel` (`src/render/protocol.ts` types the calls) once per view and screenshots the page. For animations
it calls `showFrame` for each frame, and `contactSheet`, which draws the frames into one canvas in the page. The page draws through
the shared viewers: `createModelPreview` (textured when it has images), `createVoxelViewer` and `createChiselPreview`. So there is
still one 3D code path. It uses the Chromium that `playwright-core` expects (`npx playwright-core install chromium` if it's
missing). No X server is needed.

## Tests

`test/mods.test.ts` (offline: a fake ModDB fetch, zips built with adm-zip, a tarball built with tar) covers the version rules, modinfo
parsing, folder scanning, install/update plans and their edge cases, zip-slip, `check`, and the game download's strip and failure
safety. `test/render.test.ts` (part of the root `npm test`) covers:
- argument parsing, output names and frame sampling;
- reading files of each kind, including gzip and a BOM;
- schematic boxes with a hand-built chiseled block entity, filler hiding and `--max-y`;
- renders of a hand-made red-textured cube, then without textures;
- a sliding animated cube, checked by pixel at frame 0 and frame 10, plus the contact sheet's size;
- a schematic and a `.pf` in given block colors;
- `test/schemaUpdate.test.ts`: the working folder's `vs-manifest.schema.json` refreshed (and not created, not overwritten when it is
  another schema, through a symlink), that the shipped copy is the `src/` one and the skills' copies match it, and `--no-schema-update` / `--help` leaving it alone;
- `test/check.test.ts`: every finding of the shape check on hand-written models (and the cases that must not be findings), its text
  report, the new render flags' parsing, the guide and element-name helpers, `--compare`'s summary, renders with `--grid`,
  `--color-by element`, `--highlight`, `--hide`, `--ortho`, the `west`/`bottom` views, `--sheet` and `--compare`, the builder's placed
  boxes, bands, tapers, corners, mirror defaults and poses (and their errors), `vsdev shape`'s check output and exit codes, and `vsdev find`;
- `test/statues.test.ts`: a schematic with a hand-encoded statue block entity, drawn as its figure, its multiblock parts left out;
- with the repo's `vintagestory/`: a vanilla sword, a schematic and the wolf's animations.

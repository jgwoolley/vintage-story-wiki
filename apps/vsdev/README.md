# vsdev

Vintage Story dev tools on the command line, for anyone (human or coding agent) making mods:

```
vsdev render <file>...   render models (with animations), schematics and ChiselTools .pf shapes to PNGs, headless
vsdev game               download the dedicated server (the game client is never downloaded: see below)
vsdev mod <command>      other people's mods: search, info, install (with dependencies), update, extract
vsdev moddb <command>    your mods' ModDB pages: check, status, scaffold, pull, diff, serve (review page), export (static site)
vsdev download           the dedicated server and pinned mods from a vs-manifest.json
vsdev paths              where every location below resolves, and why
```

Each command has `--help`. Relative paths are taken from the directory you run it in.

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

- **Client and server are one location.** The server download is a strict subset of the client (all its files, `VintagestoryServer`
  included, are in the client, which adds textures, sounds, shaders and the game executable: about 905 MB against 322 MB unpacked).
  Readers prefer a client (your installed game); `vsdev game` only ever downloads the server. `vsdev render` skips server-only
  installs when looking for textures.
- `vs-manifest.json` is the nearest one in this folder or a parent; paths in it are relative to it. A mod project can pin
  everything in a few lines: `{ "gameDir": "~/.local/share/vintagestory", "gameVersion": "1.22.7", "gameKind": "client" }`
  (`$schema`: `vs-manifest.schema.json`, shipped in `dist/`).
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

**The game client is deliberately not downloaded.** We know where it is (the same CDN path with `vs_client_linux-x64_`; the old
`extract.sh` in translocator-locator-cmd fetched it), but it's the paid game, and the
[Terms of Service](https://www.vintagestory.at/tos.html) frame downloading it as part of an account that bought it. Until the Vintage
Story developers confirm that fetching it this way is acceptable (we may ask them), vsdev uses the copy you installed from your
account (Client Area, `https://account.vintagestory.at/`): it finds it in the default install location by itself, or through
`--game-dir` / `$VINTAGE_STORY` / `gameDir`. `vsdev game --client` prints this and exits. The note is repeated in
`src/game/download.ts`; don't add a client download back without that confirmation. The same question could be asked of the server
download, which the wiki has always used; the wiki's "Game file locations" page says so publicly.

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
| `serve [modid...] [--port 5173] [--no-open]` | the review page: a checklist per mod (progress kept in `moddb/.progress.json`), Local / Site / Diff per section with a word diff, rich-text copy buttons, warnings (missing logo/screenshots/links/tags, image sizes, HTML the editor drops, version skips, modicon.png 128x128) |
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
that aren't on ModDB yet. None of the review information goes into it (no checklist, diffs, warnings, local paths or progress; the
CLI prints the warnings instead). Output, all links relative so it works under a Pages subpath:

```
index.html  <modid>/index.html  <modid>/images/*  <modid>/files/<zip>  mods.json  style.css  .nojekyll
```

Each page has a **Download** button with where to put the zip, and the `vsdev mod install <modid> --source <this site>` command.
The game's own one-click install (`vintagestorymodinstall://`) can't be offered: it always asks ModDB. Online, versions on ModDB are
marked and the page links to its ModDB listing. `--out` must be empty or a previous export; it refuses a folder that holds your files.

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

## `vsdev download`

```
vsdev download [--manifest vs-manifest.json] [--game-dir dir] [-p dir] [--force]
```

The dedicated server (not with `"gameKind": "client"`: the client is your own install) and every mod in a manifest (default: the
nearest `vs-manifest.json`), e.g.
`{ "serverBranch": "stable", "serverVersion": "1.22.7", "gameKind": "server", "mods": [{ "modid": "betterruins", "version": "0.6.4" }] }`.
Locations as above. Unpinned mods get ModDB's pick for the game version; dependencies aren't followed (pin them, or use
`vsdev mod install`). The wiki's `npm run download` runs on this code (`installGame`, `installManifestMod`), adding its own
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
| schematic | `.json` or gzipped `.json.gz` (`Indices`/`BlockIds`/`BlockCodes`, e.g. `worldgen/schematics/**`, `/blueprint` exports) | one cell per block in its block color; chiseled blocks as their real cuboids |
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
| `--views <a,b>` | all | `default`, `south`, `east`, `north`, `top`, `back` (`src/render/views.ts`); default: models `default,south,east,top,back`, others `default,top,south,east` |
| `--floor` | all | a one-block grid at ground level |
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

- **Model textures** are looked up the way the game does (`vs-schematic/textureFiles.js`). A path without a domain belongs to the
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
- with the repo's `vintagestory/`: a vanilla sword, a schematic and the wolf's animations.

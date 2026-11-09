---
name: vsdev-mods
description: "Find, install and update other people's Vintage Story mods from ModDB with vsdev. Use for mod search, version checks, installing mods or dependencies, or extracting a mod zip."
metadata:
  tags: [vintage-story, vsdev, modding, moddb, mods]
---

# Installing and updating mods with `vsdev mod`

Follows the game's own rules for choosing releases (ModDB picks the file for your game version; retracted and blocklisted releases are
refused; an installed newer copy is never downgraded). If `vsdev` isn't installed see the `vsdev-game-setup` skill.

## Commands

| Goal | Command |
| --- | --- |
| Find a mod | `vsdev mod search "text" [--limit 20] [--game-version 1.22.7]` |
| Details, links, and releases with their game versions | `vsdev mod info <modid> [--all]` |
| Install with dependencies | `vsdev mod install <modid>[@version] ... [-p <Mods or data dir>] [-o <elsewhere>] [--no-deps] [--extract dir]` |
| Update everything in a Mods folder | `vsdev mod update [-p dir] [-o dir]` |
| Unpack zips to read them | `vsdev mod extract file.zip ... [--out dir]` (default `./.vsdev/extracted/<zip name>/`) |

- `install` and `update` print a plan (`[+]` install, `[~]` update, `[=]` already fine, `[x]` error) and then **ask before changing files**.
  Without a terminal (an agent's shell) they refuse unless you pass `-y`: show the user the plan first (run without `-y` on a terminal,
  or read the plan lines of `--json`), and only then re-run with `-y`.
- `--json` gives machine-readable output on every subcommand.
- Where it writes: `-p`, else `$VINTAGE_STORY_DATA`, else `dataDir` in `vs-manifest.json`, else `./Mods`. `update` reads by the full
  location rule (so with no `./Mods` it updates the game's own Mods folder). With `-o`, zips go there and the scanned folder isn't touched.
  Run `vsdev paths` to see which one applies before writing anything.
- The game version used to pick releases is printed (`--game-version`, `$VINTAGE_STORY_VERSION`, the manifest, the game install, else the
  newest stable). A wrong one gives wrong releases, so check the line.
- A mod with only pre-releases for your version isn't picked on its own: the plan says which version to pin (`mod@2.0.0-dev.17`).
- `--allow-retracted` is the game's "Install anyway"; use it only when asked.
- `--source <url>` installs from a `vsdev moddb export` site (its `mods.json`, sha256 checked) instead of ModDB; its dependencies still come from ModDB.

## Pinning mods for a project: `vs-manifest.json` is a requirements file

The manifest's `mods` list (`[{ "modid": "betterruins", "version": "0.6.4" }]`) pins a project's mods. Its schema is
[`vs-manifest.schema.json`](vs-manifest.schema.json) (linked into this skill); read it for every key.

| Direction | Command |
| --- | --- |
| Folder -> manifest (like `pip freeze`) | `vsdev manifest freeze [--from mods\|releases] [-p dir] [--releases-dir dir] [--prune] [--dry-run] [-y]` |
| Manifest -> folder (like `pip install -r`) | `vsdev manifest install [-p dir] [--force]` (only the mods; `vsdev download` also fetches the game server) |

- `freeze --from mods` (default) reads a game Mods folder by the location rule; `--from releases` reads a mod project's built zips in
  `./Releases`. Each mod is pinned at its newest version there.
- By default `freeze` only adds new mods and updates versions; `--prune` also removes listed mods the folder doesn't have. It prints the
  changes (`[+]` add, `[~]` update, `[-]` remove) and asks; run with `--dry-run` first, and pass `-y` only after the user has seen them.
  It rewrites the file as two-space JSON and keeps the other keys.
- `install` and `download` don't follow dependencies: pin them in the manifest too, or use `vsdev mod install`.
- A mod you develop yourself can carry `"src": "MyModFolder"` in its entry, the source folder (with `modinfo.json`) relative to the manifest,
  to map the modid to its folder name; `freeze` keeps it. Keys that only the wiki reads are prefixed `wiki` (`wikiIncludeItems`), and
  `screenshots` / `screenshotsDir` belong to `vsdev screenshots`.

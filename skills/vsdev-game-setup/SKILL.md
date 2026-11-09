---
name: vsdev-game-setup
description: "Install and configure vsdev and locate the Vintage Story game, data folder and Mods. Use for dev-environment setup or 'game not found' problems."
metadata:
  tags: [vintage-story, vsdev, modding, setup, vs-manifest]
---

# Setting up vsdev and finding the game

## Is vsdev installed?

`command -v vsdev` and `vsdev --help`. If missing, from a checkout of the repo that contains `apps/vsdev` (Node 22+):

```
apps/vsdev/scripts/reinstall.sh            # removes stale copies, builds, installs globally (--link follows the checkout)
```

or run without installing: `npm run vsdev -w @nf3t/vsdev -- <command>` from the repo root. `vsdev render` also needs
`npx playwright-core install chromium` once.

## One location rule for every command

**flag, then environment variable, then `vs-manifest.json`, then the current folder, then a real install (reads only).** Writes and
downloads never go into a real game install unless a flag, variable or manifest entry says so.

| Location | Flag | Env | `vs-manifest.json` | Folder |
| --- | --- | --- | --- | --- |
| Game install | `--game-dir` | `VINTAGE_STORY` | `gameDir` | `./vintagestory` |
| Data folder (has `Mods/`) | `-p` / `--data-dir` | `VINTAGE_STORY_DATA` | `dataDir` | `./Mods` |
| Game version | `--game-version` | `VINTAGE_STORY_VERSION` | `gameVersion` | the install's `assets/version-*.txt` |
| Wiki for `vsdev search` | `--wiki` | `VSDEV_WIKI_URL` | `prodWikiUrl` | the project's own wiki |

**Run `vsdev paths` (add `--json` for scripts) first** whenever location matters: it shows each location, which tier it came from and
every candidate checked. A mod project can pin everything in `vs-manifest.json`:
`{ "gameDir": "~/.local/share/vintagestory", "gameVersion": "1.22.7", "gameKind": "client" }`. Every key is described in
[`vs-manifest.schema.json`](vs-manifest.schema.json) (linked into this skill); `prodWikiUrl` sets the wiki `vsdev search` asks, and `mods` is
the requirements-file list (see the `vsdev-mods` skill).

## Getting the game's files

- **Dedicated server** (the game's data and DLLs, no textures; enough for ingesting assets and building mods): `vsdev game`
  (`--version 1.22.7`, `--branch stable|unstable`, `--game-dir dir`, `--force`). It skips what is already there, only replaces installs
  vsdev made itself (`.vsdev-game.json`), and refuses to put a server over a client.
- **From a manifest:** `vsdev download` fetches the server and the pinned mods in `vs-manifest.json`.
- **The game client** (textures; the paid game) is the user's own install: point `$VINTAGE_STORY` or `--game-dir` at it. vsdev finds the
  default install locations by itself.

### The client download is the user's call

`vsdev game --client` alone downloads nothing and explains where the client comes from. `--accept-client-terms` makes vsdev download the
paid client from the CDN; that flag is **the user's statement** that they read the Terms of Service or checked with the Vintage Story
developers and it's fine for their use. **Never add it yourself**, in a command, script, CI file or config, even to make a task work. If a
task needs the client, tell the user and let them decide.

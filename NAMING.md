# Naming: should the repo be renamed? (undecided)

Notes from a discussion, written down so the decision can wait. Nothing here has been changed.

## The question

The repo is `vintage-story-wiki`, but it now holds more than the wiki: `vsdev` (CLI), the VS Code extension and the
schematic lib. Would a name like `vintage-story-tools` be more consistent, and how should "Vintage Story" be spaced in names?

The user is happy to rename anything they created (repo, packages, file paths they chose).

## How the game names things

Verified on this machine (`vintagestory/`, `apps/vsdev/src/locations.ts`, the local clones of the game's source):

- Source repos are cloned as `vsapi`, `vssurvivalmod`, `vsessentialsmod`: `vs` + one lowercase word, no separators.
- Install folder `vintagestory`; Windows installer folder `%APPDATA%\Vintagestory`.
- Data folder `VintagestoryData` (Linux `~/.config/VintagestoryData`), containing `Mods`.
- Official server: `/home/vintagestory/server`, data in `/var/vintagestory/data`.
- Files: `Vintagestory`, `VintagestoryAPI.dll`, `VintagestoryLib.dll`, `VintagestoryServer`.
- The mod template's env var is `VINTAGE_STORY` (the one two-word spelling).

From memory, not checked here: the org is `anegostudios`, and repos such as `vsmodtemplate` and `vscreativemod` exist.

So the game writes "Vintage Story" as two words in prose, and as one word (`vintagestory`) or the `vs` prefix in identifiers.
It never uses `vintage-story-…` in an identifier.

## How this repo compares

| Name | Matches the game? |
| --- | --- |
| `vsdev`, `vs-schematic`, `vs-wiki-core`, `vs-manifest.json` | yes (`vs` prefix) |
| `./vintagestory`, `./Mods` (paths vsdev uses) | yes, deliberately the game's own |
| `@nf3t/vsdev`, `@nf3t/vs-schematic`, `@nf3t/vs-wiki-core`, `@nf3t/vs-wiki` | yes (scope is the user's) |
| `vintage-story-wiki` (repo) | the outlier: prose form used as an identifier |

## Options

1. **Keep `vintage-story-wiki`.** Zero cost; the name says what visitors come for. Slightly inconsistent with everything else.
2. **Rename to `vs-tools`** (or `vstools`). Follows the game's convention, matches the existing `vs-` packages, and covers
   wiki + CLI + extension. Costs the wiki's URL (see below).
3. **Rename to `vs-wiki`** (or `vswiki`). Same convention, but keeps the wiki as the headline.
4. **`vintage-story-tools`.** Reads well, but it repeats the prose-form-as-identifier mismatch, so it fixes scope without fixing consistency.
5. **Split vsdev into its own repo** (`vsdev` / `vs-dev`) and leave the wiki's name and URL alone. Avoids breaking the wiki URL
   while giving each repo an accurate name. Most work (workspace links, CI, the `vs-schematic` lib both depend on).

## Costs of renaming (any option)

- The repo name is the GitHub Pages path, so the wiki's URL changes. GitHub redirects the repo itself, **not** Pages URLs;
  existing links and bookmarks break.
- Adapts by itself: CI's `PATH_PREFIX` and `buildInfo.repoSlug`.
- Needs a manual look: the `moddb` pages and any mods that link to the wiki, README/INFO/CLAUDE.md mentions, the clone path in docs.
- Git renames and pushes are the user's to do.

## Suggested direction (not a decision)

- Spacing: "Vintage Story" in titles and prose; `vintagestory` only where the game defines a path; `vs-` for package names.
- If renaming, prefer the game's convention (`vs-tools` or `vs-wiki`) over `vintage-story-tools`.
- Keep the site's display name ("Nf3t's Vintage Story Wiki") regardless.
- If the wiki stays the headline, leaving the repo name alone is a perfectly good outcome.

## Decided: package and command names

- Every npm package in the workspace uses the `@nf3t/` scope (`@nf3t/vsdev`, `@nf3t/vs-schematic`, `@nf3t/vs-wiki-core`,
  `@nf3t/vs-wiki`, and the private root `@nf3t/vintage-story-wiki`). The one exception is `vs-vscode-extension`: `vsce` rejects
  scoped extension names, and it ships as a `.vsix`, not through npm.
- The command stays `vsdev`, not `vs-dev`: it matches the game's `vs` + one lowercase word style (`vsapi`, `vssurvivalmod`),
  is shorter to type, and equals the package's unscoped name. Renaming it would touch the skills, docs, `.vsdev/`,
  `.vsdev-game.json`, `VSDEV_WIKI_URL` and existing installs.
- Only `@nf3t/vsdev` is meant for npm; `esbuild` bundles `vs-schematic` into it, so the libs are never published.
- The repo name (above) is still undecided.

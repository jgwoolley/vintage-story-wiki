---
name: vsdev-wiki-search
description: "Search the Nf3t Vintage Story wiki from the terminal with vsdev. Use to look up an item, creature or structure, or find an item code."
metadata:
  tags: [vintage-story, vsdev, wiki, search, modding]
---

# Searching the wiki with `vsdev search`

```
vsdev search <text>... [--kind Item] [--limit 10] [--json] [--wiki <url>] [--lang en]
```

It fetches the wiki's own search index and ranks like the site's search box: titles starting with the text, then titles containing it, then
item codes. Several words must all appear. Each result has the title, kind, code (e.g. `ingot-copper`, usable in recipes and
`domain:code` globs) and the page address. Fetch that page for recipes, drops, spawn conditions or the game files that define it.

- `--kind` filters by page kind (`Item`, `Block`, `Creature`, `Structure`, `Clutter`, `Painting`, `Clothing`, `Class`, `Guide`, `Book`,
  `Lore`, `Trader`); a wrong kind lists the valid ones. `--json` is for scripts; the exit code is 1 when nothing matches.
- Needs the network. The wiki is `--wiki`, else `$VSDEV_WIKI_URL`, else `prodWikiUrl` in the nearest `vs-manifest.json`, else the project's
  own deployment. `vsdev paths` shows which one applies. To search a fork or a private build, set `prodWikiUrl` in `vs-manifest.json`.
- The wiki is built from the vanilla game plus the mods pinned in its manifest, so a mod it doesn't pin won't be found.
- If `vsdev` isn't installed, see the `vsdev-game-setup` skill.

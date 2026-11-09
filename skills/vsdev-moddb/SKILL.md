---
name: vsdev-moddb
description: "Manage your own mods' ModDB pages with vsdev. Use to check an upload, review or diff page sources against the live site, or export a release download site."
metadata:
  tags: [vintage-story, vsdev, modding, moddb, release]
---

# Managing your mods' ModDB pages with `vsdev moddb`

Your mods are the zips in `./Releases` (newest per modid); the page sources live in `./moddb/<modid>/`:
`page.json`, `description.html`, `releases/<version>.json|.html`, and `images/` (logo and screenshots: keep them here, published or not;
every name in `page.json` must exist). Volatile values (downloads, timestamps, CDN URLs) aren't stored, so diffs show real changes.
Override the folders with `--releases-dir` / `--pages-dir`. Network commands accept `--offline`; most accept `--json`.

## Commands

| Goal | Command |
| --- | --- |
| Which zips are deployed / a new version / a new mod, and does a version skip a number | `vsdev moddb check [dir\|zip]...` (`--fail-if-undeployed`, `--fail-if-deployed`, `--fail-if-skipped` for CI) |
| Per mod: local version, newest listed, uploaded, changelog drafted, page written | `vsdev moddb status` |
| Placeholder pages for mods not published yet | `vsdev moddb scaffold [modid...]` (`--force` overwrites) |
| Rewrite local pages from the live ones | `vsdev moddb pull [modid...]` (lists local files it would overwrite and asks; without a terminal it needs `-y`) |
| Live vs local, as a unified diff | `vsdev moddb diff [modid...]` (exit 1 when they differ; `--fail-if-placeholders` until `TODO:` text is gone) |
| Review page with a checklist per mod | `vsdev moddb serve [modid...] [--port 5173] [--no-open]` |
| Public site with the newest zips for GitHub Pages | `vsdev moddb export [modid...] [--out .vsdev/site] [--title text]` |

Exit codes: 0 ok, 1 a condition was met (a difference, an undeployed zip), 2 a lookup failed or the input was unusable.

## Workflows

- **First upload:** `scaffold`, replace every `TODO:` placeholder, put images in `moddb/<modid>/images/`, `diff --fail-if-placeholders`
  until it passes, `serve` and follow its checklist, upload by hand on ModDB, then `pull`.
- **New version:** write `moddb/<modid>/releases/<version>.html`, upload, `pull`. Local-only release drafts show as *pending* in `diff`.
- **Before overwriting local edits:** run `diff` first. `pull` replaces files with what the site has, so changes not yet on the site are lost.
- **CI gate:** `vsdev moddb check --fail-if-undeployed`. Under GitHub Actions it also writes `undeployed` / `any_undeployed` outputs, a step
  summary and `::warning`s.
- **Export:** the site has a Download button per mod with the `vsdev mod install <modid> --source <this site>` command. Its `--out` must be
  empty or a previous export.

This tool never uploads to ModDB: uploading and editing the live page stay manual.

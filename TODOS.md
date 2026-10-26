# TODOS

Phases are in the order I'd do them: first make sure what exists is true and checked, then fix wrong data, then reshape the
site, then extend the tools, then change the pipeline, then the larger cross-project and localization work. Items inside a phase
are independent unless noted.

## Phase 1: Trust what exists (left over)

- [ ] After the next push, confirm the CI step that packages the extension and the wiki's `/extension/` download work.
- [ ] In a real VS Code, confirm "Open With..." lists the preview for an arbitrary file (the selector is now `*`; only the
  title-bar button and files in a `chiselportfolio` folder were exercised by `npm run screenshots`).

## Phase 2: Wrong or confusing data

- [ ] Fix clutter appearing in trades.
- [ ] Fix `game` / `survival` clutter being seen as separate (the same vanilla-domain-folders problem the schematics already handle).
- [ ] Explain the "Dropped by" section better on item pages (and link on to the item's recipe list).
- [ ] Handbook links that could be resolved but aren't yet.
- [ ] C# source links: drop the line number if computing it is expensive, and keep only the class name / file. The link to source was
  nice but isn't necessary.

## Phase 4: Chiseled blocks and the extension, next steps

- [ ] Draw chiseled blocks as their real shape in the main schematic view (today only the block panel and the shape pages do);
  mind the 171k-cuboid worst case (`brsunrift`). See RESEARCH.md topic 6.
- [ ] Animate worn armor and clothing on the player body (the body's animations would have to be shared between items, not copied into every
  model file). Items and creatures already animate.
- [ ] Check the `/map/` explored-world overlay against a real `Maps/<id>.db` (it is only tested against hand-made tiles).
- [ ] Real block textures instead of hash colours (also helps every other block in the viewers).
- [ ] Waypoint icon previews in the add-waypoint dropdown (needs the svg files, which the dedicated server download doesn't ship).

## Phase 5: Build and download pipeline

- [ ] Integrate `vs-mod-updater` into the download script (it is its own repo, https://github.com/jgwoolley/vs-mod-updater).
- [ ] Research: what if I created a completely custom build system (instead of the Eleventy + wrapper scripts setup)? The site restructure (no more
  "tools" section, one `/map/` page) is done, so the question is now about the final shape of the site.

## Phase 6: Shared with the Nf3t tools

- [ ] Research a JSON schema for the Nf3t tools, pulled from a common place.
- [ ] Nf3t's Vintage Story Wiki (what this wiki is to the Nf3t tools).

## Phase 7: Localization

- [ ] Localization for any language should be supported (the `/<lang>/` routing is already in place; nothing generates non-English
  content yet).

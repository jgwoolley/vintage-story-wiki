# TODOS

Phases are in the order I'd do them: first make sure what exists is true and checked, then fix wrong data, then reshape the
site, then extend the tools, then change the pipeline, then the larger cross-project and localization work. Items inside a phase
are independent unless noted.

## Phase 1: Trust what exists (small, no design decisions)

- [ ] Make sure documentation hasn't drifted: source documents (`site/_includes/sourcedocs/`, `pipelineSources.json`), `README.md`,
  `INFO.md`, `CLAUDE.md`, `RESEARCH.md`.
- [ ] CHANGELOG: there doesn't appear to be one. Decide whether to keep one (and generate it from commits/releases) or say
  explicitly that there isn't one.
- [ ] Launch the VS Code extension in a real VS Code (it has only ever been type-checked and bundled) and confirm the CI step that
  packages it and the wiki's `/extension/` download work after the next push.
  - [ ] See ../nifi-extension, it uses playright to take screenshots
- [ ] ChiselTools shape files have no extension (QP saves them as plain names in `chiselportfolio`). Files in that folder and `*.pf`
  now open in the preview; check that "Open With..." lets you pick the preview for any file, and that nothing still needs a `.pf`
  extension.

## Phase 2: Wrong or confusing data

- [ ] Fix clutter appearing in trades.
- [ ] Fix `game` / `survival` clutter being seen as separate (the same vanilla-domain-folders problem the schematics already handle).
- [ ] Explain the "Dropped by" section better on item pages (and link on to the item's recipe list).
- [ ] Handbook links that could be resolved but aren't yet.
- [ ] C# source links: drop the line number if computing it is expensive, and keep only the class name / file. The link to source was
  nice but isn't necessary.

## Phase 3: Reshape the site (one navigation pass)

- [ ] Remove the "tools" concept and put each tool into the section it belongs to (the home page, header menu and `/tools/` page all
  change together).
- [ ] Merge the seed climate lookup and the waypoint planner into one map tool.
- [ ] Bring the map renderer from https://github.com/jgwoolley/vintage-story-launcher (also stored locally) into that map. Depends on the
  merge above.

## Phase 4: Chiseled blocks and the extension, next steps

- [ ] Draw chiseled blocks as their real shape in the main schematic view (today only the block panel and the shape pages do);
  mind the 171k-cuboid worst case (`brsunrift`). See RESEARCH.md topic 6.
- [ ] Model Preview for items / creatures
- [ ] Real block textures instead of hash colours (also helps every other block in the viewers).
- [ ] Waypoint icon previews in the add-waypoint dropdown (needs the svg files, which the dedicated server download doesn't ship).

## Phase 5: Build and download pipeline

- [ ] Integrate `vs-mod-updater` into the download script (it is its own repo, https://github.com/jgwoolley/vs-mod-updater).
- [ ] Research: what if I created a completely custom build system (instead of the Eleventy + wrapper scripts setup)? Do this after the
  site restructure in phase 3 so the question is about the final shape of the site.

## Phase 6: Shared with the Nf3t tools

- [ ] Research a JSON schema for the Nf3t tools, pulled from a common place.
- [ ] Nf3t's Vintage Story Wiki (what this wiki is to the Nf3t tools).

## Phase 7: Localization

- [ ] Localization for any language should be supported (the `/<lang>/` routing is already in place; nothing generates non-English
  content yet).

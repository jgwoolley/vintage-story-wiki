---
name: vsdev-render
description: "Render Vintage Story models, schematics and chisel shapes to PNG with vsdev. Use to preview or inspect a shape/schematic file or list a model's animations."
metadata:
  tags: [vintage-story, vsdev, modding, rendering, schematics]
---

# Rendering Vintage Story files with `vsdev render`

Edit a model, schematic or chisel shape, render it, **read the PNGs**, repeat. No game needed. The kind of file is worked out from its
content, not its name.

If `command -v vsdev` finds nothing, see the `vsdev-game-setup` skill for installing it. First use needs `npx playwright-core install chromium`.

## Commands

| Goal | Command |
| --- | --- |
| Render a file (PNGs in `./.vsdev/renders/<name>-<view>.png`) | `vsdev render path/to/file.json` |
| Say what a file is, render nothing | `vsdev render file --list` (`--json` for scripts: box counts, textures, animations and frame counts, schematic size and blocks) |
| All animations as frames + a labelled contact sheet | `vsdev render model.json --animation all` (or `--animation walk,idle`; `--frames 8`) |
| One pose in every view | `vsdev render model.json --animation walk --frame 12` |
| Look inside a schematic | `vsdev render s.json.gz --max-y 20` (cutaway), `--show-filler` (draw `meta-filler`), `--no-chisel` |
| Different angles / size | `--views default,top,south,east,north,back`, `--size 800`, `--floor`, `--out dir` |

After rendering, open the PNGs (the contact sheet for animations) and look at them; the console report (box count, texture keys,
missing textures, animation names) is not a substitute.

## Details that matter

- **Textures:** a model is drawn with its real textures only when it can find them (its own `assets/<domain>/` tree, then `--game-dir`
  = a game *client* install, `$VINTAGE_STORY`, `./vintagestory`). The dedicated server has almost no textures, so it is ignored.
  Otherwise each texture key gets its own color, and the legend says so; `--no-textures` forces that.
- **Schematics and `.pf` shapes** use block colors, not textures (`--block-colors file.json` to override). Codes missing from the file get
  a hash color. Chiseled blocks are drawn as their real cuboids.
- **Worn items** are placed on the player body when `seraph-faceless.json` is found; the report says when it isn't.
- An animation code the model lacks is an error that lists the ones it has. Animations in the newer `version` matrix format are skipped.
- This is not the game's renderer: no lighting, glow or wind, and stairs/fences inside schematics are whole cells.
- Relative paths are taken from the directory you run it in.
- Asset names are matched case-insensitively, like the game (a shape that says `gearboxA` finds `gearboxa.png`).
- To produce the same kind of image repeatedly (ModDB banners, the 480x480 card logo, the 128x128 icon, a fixed camera angle, a title
  and logo drawn over it), list them in `vs-manifest.json` and use `vsdev screenshots`: see the `vsdev-screenshots` skill.

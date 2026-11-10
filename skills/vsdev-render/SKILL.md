---
name: vsdev-render
description: "Render and check Vintage Story models, schematics and chisel shapes with vsdev. Use to preview or inspect a shape/schematic file, to lint a model (floating parts, flickering faces, parts outside the block), when making or editing a 3D model, or to list a model's animations."
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
| **Check a model as text** (no browser, no image) | `vsdev render model.json --check` (exit 1 on an error; `--strict` on a warning too; `--json`) |
| One image with eight labelled views | `vsdev render model.json --sheet --grid` -> `<name>-sheet.png` |
| See which element is which | `--color-by element` (a color and a legend entry per element), `--highlight lid,hinge*` (the rest ghosted), `--hide body` (look inside) |
| Before and after an edit | `vsdev render new.json --compare old.json` -> `<name>-compare.png`, and a list of elements added, removed, moved |
| Measure | `--grid` (axes from 0,0,0, the outline of one block, floor grid) and `--ortho` (no perspective, sides square on) |
| Different angles / size | `--views default,top,bottom,south,east,north,west,back`, `--size 800`, `--floor`, `--out dir` |
| Outdoors | `--grass` (grass to the horizon instead of `--floor`) and `--sky`; the game client's own textures when found, built-in colors otherwise |

After rendering, open the PNGs (the contact sheet for animations) and look at them; the console report (box count, texture keys,
missing textures, animation names) is not a substitute.

## Making or editing a model

A model is a tree of boxes. Pictures alone will not tell you that a part floats 0.2 above the one it should sit on, or that two
faces share a plane and will flicker in game. `--check` does, so run it every time.

**Don't write shape JSON coordinates by hand.** Write a `vsdev shape` spec (the `vsdev-generate` skill): boxes are placed `on`,
`under` or `against` a named part, `corners` and `mirror` make the symmetric copies, UVs are filled in, and it runs the check itself.

### The loop

1. **Plan the parts** in words: names, rough sizes in units, what each one touches. Decide the footprint and height first.
2. **Block out the silhouette** with 3 to 8 boxes. No detail yet.
3. `vsdev render model.json --sheet --grid`, then **open the sheet**. Is it the right size against the block outline? Right proportions from every side?
4. `vsdev render model.json --check`. Fix every error and warning before going on (the element list shows where each part really is).
5. Add detail one group at a time (trim, handles, feet), repeating 3 and 4. `--compare previous.json` shows what the edit did;
   `--highlight <name>` finds a part you can't place by eye.
6. Render with textures, and a pose if something moves (lid open, door ajar).

Size reference (from `--check` on the game's own shapes): a full block is 16 units; the chest is 16 x 13 x 13.5; the table 16 x 16 x 16
with a 3-thick top; Tobias' lantern 13 x 11 x 8; the player about 30 tall and 6 wide.

### Conventions (the game's, verified against its code)

- **Axes:** x runs west (0) to east (16), y up from the floor (0), z north (0) to south (16). 16 units = 1 block = 1 m.
  A block's model sits in 0..16 on each axis, standing on y 0 unless it hangs. The `default` view looks from the south-east and above.
- **Element:** `from` and `to` are opposite corners (`from` the smaller); `faces` has `north` (-z), `east` (+x), `south` (+z), `west` (-x), `up`, `down`.
  A face that is missing or has no texture is not drawn.
- **Children:** a child's `from`, `to` and `rotationOrigin` are measured **from its parent's `from` corner**, not from the block. Only
  top-level elements are in block coordinates. The classic mistake is a child written in block coordinates: it ends up far away, and
  `--check` reports it floating. A child also turns with its parent.
- **Rotation:** `rotationX/Y/Z` in degrees about `rotationOrigin` (which is [0, 0, 0] when left out: the block's corner for a
  top-level element, almost never what you want, so always give it). Applied x, then y, then z (matrix `Rx * Ry * Rz`).
  - **+x** tips the top toward **south** (+z). A lid hinged along its north (back) edge therefore opens with a **negative** x turn, origin on the hinge line.
  - **+y** turns counter-clockwise seen from above (east goes to north).
  - **+z** tips the top toward **west** (-x).
- **UVs:** `uv: [u1, v1, u2, v2]` in texture pixels; v runs **down** the image, so on a side face the top of the box is v1. The up
  face is seen from above with north at the top. The range is 0..`textureWidth`/`textureHeight` (default 16 x 16) whatever the PNG's
  real size, unless `textureSizes` says otherwise for that key. One unit of box per unit of UV keeps the texture unstretched.
- **Never put two faces in one plane.** Trim, bands and plates stand at least 0.25 proud of the surface (or sink into it); never flush.
- A zero-thickness element is fine for a pane or a leaf with both faces textured; not for something lying on another face.

### Vanilla shapes to copy from

Read and render these before inventing a structure (they are under the game's `assets/survival/shapes/block/`):

- `wood/table.json`: a top and four legs, the simplest furniture.
- `wood/chest/normal.json`: body, lid as a child tree with a hinge origin, an `opened` animation.
- `clutter/tobias-lantern.json`: a small detailed prop built from nested parts.

`vsdev find chest --shapes` lists more by name (`vsdev find planks oak --textures` for texture codes); then
`vsdev render <that file> --sheet --grid` and `--check` to see how it is built and how big it is.

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
- To *make* a block/item texture or shape, don't write a Python/Node generator script: describe it in a spec and use `vsdev texture` /
  `vsdev shape` (see the `vsdev-generate` skill), then render the result here.

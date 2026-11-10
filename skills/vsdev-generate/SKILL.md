---
name: vsdev-generate
description: "Generate Vintage Story textures (PNG) and shapes (model JSON) from spec files with vsdev texture / vsdev shape. Use whenever a mod needs new block or item textures or models (instead of writing a Python/Node script that draws PNGs or emits shape JSON), and there is no artist or model editor."
metadata:
  tags: [vintage-story, vsdev, modding, textures, models, procedural]
---

# Textures and shapes from a spec: `vsdev texture`, `vsdev shape`

Don't write a Python/Node script, a PNG encoder, a noise function or hundreds of lines of shape JSON by hand: that is what this tool replaces. Needs vsdev 0.2.0 or newer (check `npm ls -g @nf3t/vsdev`; update with `npm i -g @nf3t/vsdev@latest`, or `apps/vsdev/scripts/reinstall.sh` from the repo; `vsdev texture --help` failing means it is older). Describe the textures and models in a spec
file, generate, **look at the images**, adjust, repeat. If `command -v vsdev` finds nothing, see the `vsdev-game-setup` skill.
`vsdev texture --help` and `vsdev shape --help` list every field; the vsdev README has the full tables.

## Loop

1. Write `textures.json` (or `.mjs`) with `"out": "assets/<modid>/textures/block"`; run `vsdev texture textures.json`.
2. Open `.vsdev/renders/textures-textures.png` (each texture tiled 2 x 2, enlarged, labelled). Fix and rerun; `--only name` for one.
3. Write `shapes.json` (or `.mjs`) with `"out": "assets/<modid>/shapes/block"` and texture keys pointing at `<modid>:block/<name>`.
4. `vsdev shape shapes.json --render`, then open the PNGs in `.vsdev/renders/` (several angles, real textures). Read the
   **errors and warnings printed under each shape** (a part that floats, faces that will flicker) and fix them all; rerun.
   Start with the big boxes only, get the silhouette right, then add detail (the loop in the `vsdev-render` skill).
5. Commit the spec files with the generated files, and say in the mod's README that the assets are made from them (edit the spec, not the output).

## Textures

```json
{
  "out": "assets/mymod/textures/block",
  "colors": { "bronze": "#76603c", "grime": "#30281c", "verdigris": "#587c64" },
  "textures": {
    "bronze": { "size": 32, "seed": 1, "layers": [
      { "type": "fill", "color": "bronze" },
      { "type": "grain", "amount": 0.16 },
      { "type": "noise", "color": "grime", "scale": 8, "opacity": 0.6 },
      { "type": "noise", "color": "verdigris", "scale": 4, "octaves": 2, "coverage": 0.2, "opacity": 0.7 },
      { "type": "speckle", "shade": 0.45, "density": 0.004 },
      { "type": "scratches", "count": 4 }
    ] }
  }
}
```

- Every layer paints `color` (mix) or `shade` (multiply brightness: 0.6 darker, 1.3 lighter) times `opacity`, inside `region` [x, y, w, h].
- Typical material: `fill` base, `grain`, one or two `noise` layers (large `scale` for grime, `coverage` for patches of rust/moss),
  `speckle` and `scratches` for wear. Plates: `border`/`bevel` rims, `circle`, `line`, `pixels` for emblems (`mirror: true` halves the work,
  `shadow` adds depth). Stone and wood: `bricks` (planks are bricks as wide as the texture, `offset` staggers the seams).
- Vanilla block textures are 32 x 32 (some 16); keep a mod's textures to one size so texel density matches.
- Seeds make it repeatable: same spec, same pixels. Change `seed` for a variant; a layer's own `seed` rerolls only that layer.
- Noise tiles; `gradient` edges and `border`/`bevel` don't, which is right for a plate but shows as a grid on a big wall.
- Don't recreate another game's or mod's art. Make original patterns.
- Any layer takes a `mask`: pixel art (`{ "rows": [...], "at": [x, y], "scale": 2, "keys": "#" }`) or, in a `.mjs` spec, a function
  `(x, y) => 0..1`: paint grime only inside an emblem, rust only on the rim.
- When the layers can't say it (a shape drawn from maths, embroidery, an old generator's algorithm), a `.mjs` spec can use a
  `{ "type": "custom", "draw": (ctx) => ... }` layer: `ctx.width/height`, `ctx.random()` (seeded), `ctx.noise(scale, octaves)`,
  `ctx.get/set(x, y)`, `ctx.paint(x, y, t, color)` and `ctx.shade(x, y, t, f)` (through the layer's region, mask and opacity),
  `ctx.color(name)`. Prefer layers when they can: they are shorter and the preview explains them.
- A texture drawn from a model (an emblem embroidered from a statue, a silhouette): `project(shapeSpec, { width, side })` gives
  the model seen straight on; `.rows(hit => char)` turns it into pixel rows for a `pixels` layer or a `mask`.

## Shapes

```json
{
  "out": "assets/mymod/shapes/block",
  "shapes": {
    "reliquary": {
      "textures": { "bronze": "mymod:block/bronze", "plate": "mymod:block/plate" },
      "elements": [
        { "box": [[3, 0, 3], [13, 8, 13]], "tex": "bronze", "name": "body", "faces": { "south": { "texture": "plate", "uv": "full" } } },
        { "mirror": { "box": [[2, 0, 2], [4, 10, 4]], "tex": "bronze", "name": "postleft" } },
        { "repeat": 3, "step": [0, 0, 3], "of": { "box": [[4.5, 8, 4.5], [11.5, 8.5, 5.5]], "tex": "bronze", "name": "rib" } },
        { "joint": [8, 8, 8], "rot": [0, 45, 0], "children": [{ "box": [[-3, 0, -3], [3, 2, 3]], "tex": "bronze", "name": "lid" }] }
      ]
    }
  }
}
```

- Units: 16 = one block, x east, y up, z south; a block's floor is y 0. Keep within 0..16 unless it is meant to stick out.
- **Place parts by what they touch, not by coordinates.** After one `box` for the main body, name it and write the rest relative to it:
  - `{ "size": [w, h, d], "on": "body" }` sits on top of `body`, centered (`"under"`, `"against": ["body", "south"]` likewise).
    `null` in `size` means as big as the target there; `"grow": 0.5` then overhangs it (a lid, a table top). `"align": ["west"]`,
    `"inset": 1`, `"sink": 0.5` (into the target) and `"offset": [dx, dy, dz]` adjust it. The target is an earlier element of the
    same list, `"parent"` or `"block"`.
  - `{ "band": "body", "y": [3, 4], "out": 0.25 }` is a strip round `body`, proud of it so nothing flickers. Never write trim flush.
  - `{ "corners": { "box": [[1, 0, 1], [3, 7, 3]], "name": "leg" } }` makes all four (`leg-nw`, `-ne`, `-sw`, `-se`); `mirror` makes two.
    Both work about the block's middle (8), or about 0 inside a joint, unless `about` says otherwise.
  - `{ "taper": [[2, 9, 2], [14, 15, 14]], "top": [4, 4], "steps": 4 }` is a stepped roof or plinth.
  - `{ "size": [w, h, d], "center": [x, y, z] }` or `"base"` when a point is what you know.
- Children of a `box` are measured from that box's `from` corner; children of a `joint` from the joint's point. They turn with it.
- Turn signs: +x tips the top toward south (+z), so a lid hinged at its north edge **opens with a negative x**; +y is counter-clockwise
  from above; +z tips the top toward west. Order x, then y, then z.
- Something that moves: put it in a named `joint` on the hinge line and give the shape `"poses": { "open": { "lid": [-70, 0, 0] } }`.
  That also writes `<shape>-open.json`, so you can render both and see that the lid clears the body.
- `box` UVs are filled in: each face shows a piece of the texture as big as that side, so a 16-unit face shows a whole 16 px tile
  (with the default 16 x 16 `textureWidth`/`textureHeight`, a 32 px PNG gives 2 px per unit). `"uv": "full"` stretches the whole
  texture over one face (decorated plates); `"down": false` drops a face nobody sees.
- `rot` turns about the box's center by default. To pose a limb, put it in a `joint` at the shoulder/hip and turn the joint;
  children use coordinates relative to the joint's point.
- A piece that is turned over (a fallen part, a toppled figure) ends up floating or sunk. Give that top-level box or joint
  `"ground": true` and it is moved until its lowest point is on y 0; `"ground": true` on the shape rests the whole model.
- The bounds of each shape are printed (`x -1.2..17.8, y 0..9.4, ...`), with the icon transform worked out from them. Use the
  bounds for the block's `selectionBox` / `collisionBox`; let `gui` (below) keep the `guiTransform`.
- In a `.mjs` spec, `export default ({ box, joint, relief, mirror, corners, place, band, taper, repeat, mirrorRows }) => ({ out, shapes })`: write a function
  per part (`leg(name, angle)`) and call it in a loop. The helpers return the same objects as the JSON.
- `--render` uses vsdev render's default views. For one labelled picture of every side with axes, a per-element coloring, or a
  before/after, run `vsdev render file.json --sheet --grid` / `--color-by element` / `--compare old.json` (see `vsdev-render`).
- `vsdev shape spec --check` exits 1 when a shape has an error (`--strict`: a warning too): use it as the last step.
- `vsdev find oak planks --textures` gives the game's texture codes for `textures`; `vsdev find table --shapes` vanilla models to copy.
- More helpers in a `.mjs` spec (`--help` lists them): `bar(from, to, width, tex)` a box along a line (cables, rods: the
  turn is worked out); `prism({ apothem, y: [y0, y1], sides: 8, lean, tex, panel })` an n-sided upright section of panels
  (a box and its 45 degree copy make an eight-pointed star, not an octagon; `lean` tapers it, `panel(i, a)` puts studs on a
  face); `scaled(k, elements)` the same parts k times bigger; `gameShape("entity/humanoid/seraph-faceless")` a shape from
  the game install and `statue(shape, { animation, keyframe, texture, scale, drop, attach })` it posed by one of its own
  animations, in one material, as the Player Statues mod makes statues (`attach` adds parts to a named element: wings on
  `UpperTorso` follow the pose).
- A texture map shared by many shapes: `"prune": true` (on the spec or a shape) leaves each file only the keys it uses.
- Inventory icons: `"gui": { "file": "../blocktypes/thing.json", "key": "*-{name}-*", "rotateY": 180, "keepScale": true }` in
  the spec writes each shape's `guiTransform` (origin = bounds centre, scale = fit) into the blocktype on every run, so a model
  that changes size keeps a centred icon. `rotateY` is the turn of the variant the inventory shows.
- Read the warnings: an unknown texture key is an error, a key no face uses is listed. Then check the block in game:
  the renderer has no lighting or transparency.

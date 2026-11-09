---
name: vsdev-screenshots
description: "Generate a mod's ModDB banners, card logo and modicon with vsdev from vs-manifest.json. Use to make or batch-update mod screenshots, icons or logos."
metadata:
  tags: [vintage-story, vsdev, modding, moddb, screenshots, icons]
---

# Mod screenshots, logos and icons with `vsdev screenshots`

List the images once in `vs-manifest.json`, then `vsdev screenshots` renders all of them (headless, no game running); `vsdev screenshots <name>...` renders
some. Change a model, rerun, **open the PNGs and look at them**. The keys are in
[`vs-manifest.schema.json`](vs-manifest.schema.json) (linked into this skill); `vsdev screenshots --help` has the same text. If `vsdev` isn't
installed or Chromium is missing, see the `vsdev-game-setup` and `vsdev-render` skills.

```json
{
  "screenshots": [
    { "name": "main", "model": "survival:shapes/block/machine/statictranslocator/normal.json", "output": "MyMod/Screenshots/Main.png",
      "title": "My Mod", "subtitle": "by Me", "logo": "ModPages/mymod/logo.png", "size": 1920, "height": 1080 },
    { "name": "card", "model": "MyMod/assets/mymod/shapes/item/thing.json", "preset": "moddb-logo-wide", "background": "#f5f1e8",
      "output": "MyMod/Screenshots/Logo.png" },
    { "name": "icon", "model": "MyMod/assets/mymod/shapes/item/thing.json", "preset": "modicon", "output": "MyMod/modicon.png" },
    { "name": "ruin", "schematic": "betterruins:worldgen/schematics/ruin.json", "view": [1, 0.6, 1.2], "maxY": 12 }
  ]
}
```

## What an entry can say

- **Source** (exactly one): `model` (a shape file, drawn with its real textures from a game *client*) or `schematic` (blocks in block colors,
  chiseled blocks as cuboids; entities such as players and creatures are not drawn). Each is a file relative to `vs-manifest.json`, or
  `domain:path` found in the game's `assets/` or in a mod in `Mods/` (zip or folder; a missing `.json` is added). With only a `logo`, the
  image itself is the icon.
- **Scenes** (`scene`, instead of a source): several parts in one image, placed with `at` in blocks (x east, y up, z south). A part is a `model`
  (`rotationY`, `scale`) or a `player`: the seraph body in an animation pose (`animation` + `frame`, e.g. `insertgear`), standing at `at` and
  looking `facing` north/east/south/west (its own front is west), dressed in `wear` item codes (found in the game's `itemtypes`; they hang on
  the body's bones and hide the hair etc. they disable) and holding `hold` / `holdLeft` in a hand (`holdScale` enlarges it: the game draws most
  items small in the hand). Example: a player in `armor-*-antique-forlorn-pristine` holding `rod-cupronickel` beside
  `survival:shapes/block/machine/statictranslocator/broken.json`. Item types come from the game install only; no face is painted on the body.
- **Camera:** `view` is `default`, `south`, `east`, `north`, `top`, `back`, or `[x, y, z]` from the model's center (y up, +z south, +x east).
  Also `floor`, `maxY` (cutaway), `showFiller`.
- **Size and place:** `size` (width) and `height` in pixels (default 1280 square; `1920` x `1080` suits a banner), `output` (the PNG's path;
  default `<screenshotsDir or ./screenshots>/<name>.png`).
- **Text and logo:** `title`, `subtitle`, `titleSize` (fraction of the shorter side, default 0.075), `logo` (PNG/JPEG/SVG/WebP), `textAt` /
  `logoAt` (a corner), `background` (a CSS color, or `transparent`), `reflection`.
- The game and Mods folders are `./vintagestory` and `./Mods` unless `vs-manifest.json` (`gameDir`, `dataDir`), `$VINTAGE_STORY`,
  `$VINTAGE_STORY_DATA` or `--game-dir` / `-p` say otherwise (`vsdev paths` shows what applies).

## ModDB sizes: frame the subject where the card doesn't cover it

A ModDB **logo** is one of the mod's screenshots, 480x480 or 480x320, shown on the mod's card. The card puts the title and download counts over
the **bottom part** of the image and a "New!" / "Draft" **ribbon across the top-right corner**, and logos aren't shown in the slideshow.
So keep the subject, and any text, out of those areas. The **modicon** is a separate 128x128 PNG the game itself shows (no card).

- `"preset": "moddb-logo"` (480x480), `"moddb-logo-wide"` (480x320) `moddb-logo` frames the model above the covered bottom (`safe`: bottom 28%); `moddb-logo-wide` uses the full height (see below);
  `"preset": "modicon"` is 128x128 and transparent. `safe: { "bottom": 0.3 }` sets your own margins.
- **No text on icons and logos.** The card prints the mod's name over the logo and mod lists print it beside the icon, so baked-in text
  only duplicates it (and is unreadable at 128px). Use art only; keep `title`/`subtitle` for wide banners. BetterRuins does this: a centred
  subject on a light background.
- **Prefer 480x320 (`moddb-logo-wide`) and don't draw a reflection.** ModDB builds the 480x480 card image from a 480x320 upload itself, adding
  the faded reflection under the art: BetterRuins' 480x320 file is plain art filling the whole height, and its 480x480 file is the same art
  with the reflection below. So the wide preset has no margin, and the subject can use the full height. Use a light `background` (e.g.
  `"#f5f1e8"`) so the card's text stays readable. (`"reflection": true` draws one yourself, which is only for a square upload; it would
  double up with ModDB's.) This is inferred from those two files, so check a real card.
- **`vsdev screenshots --guides`** writes `<name>-guides.png` with the covered areas shaded red: check it before uploading. The proportions
  are estimated from ModDB's card preview, so adjust `safe` if a real card differs.
- `vsdev render` and `vsdev screenshots` aren't the game's renderer: flat lighting, no glow, so they're art for a page, not proof of
  how something looks in the game.

## Habits that save time

- Re-render everything after a model changes: it's one command, so don't hand-edit a PNG that a later run would overwrite.
- Output straight into the paths your build and upload scripts read (`<Mod>/Screenshots/Main.png`, `<Mod>/modicon.png`), and keep the
  generated PNGs in version control.
- Model textures are matched case-insensitively, as the game does (`gearboxA` finds `gearboxa.png`).

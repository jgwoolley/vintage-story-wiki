# Nf3t's Vintage Story Tools

Preview Vintage Story worldgen schematics (`.json` and the wiki's `.json.gz` copies) as an interactive 3D
voxel model, without leaving VS Code.

- Orbit, pan and zoom; click a block to see its code, position and decoded block-entity data.
- A block list with counts: click to hide/show a kind, filter by name, show/hide all (schematics only: a model's textures and a chiseled block's materials are just listed).
- `meta-filler` (a worldgen marker) starts hidden, like on the wiki; tick **Show meta-filler** to see it (schematics only).
- An **Up to Y** slider peels the structure away from the top (schematics only).
- Also opens Vintage Story **model (shape) files** (`assets/<domain>/shapes/**.json`: items, creatures, blocks, armor, clothes) as a 3D model of boxes drawn with its real textures when they are found (see below; a texture that isn't found is drawn in a color), with a legend of the model's texture names. Armor and clothing models only name a bone of the player body; they are placed on it when `shapes/entity/humanoid/seraph-faceless.json` can be found in the same `assets/<domain>/` tree (or the sibling `game` / `survival` one). A model with animations gets an **Animation** picker in the toolbar that plays them in a loop (worn items stay in their rest pose). **Show floor** draws a grid of one-block squares at ground level, to judge where a model sits.
- **Model textures**: run **Vintage Story: Select Game Folder** (or click **Choose game folder** under a model's legend) and pick the game *client* install (the dedicated server has almost no textures; the folder is checked). The setting is `vsSchematic.gameFolder`. The model is then drawn with those textures (each face's own UV), and its legend shows each texture key's texture and says which ones couldn't be found; textures in the model's own `assets/<domain>/` tree are found without the setting. Like the game's, the preview has no lighting or transparency.
- Also opens QPTech ChiselTools shape files (saved with `.pf save`, in the `chiselportfolio` folder, or named `*.pf`): the chiseled block's shape in 3D plus its materials.
- Settings (**File > Preferences > Settings**, search "Nf3t's Vintage Story Tools"): `vsSchematic.showCenterMarker` draws a marker at the middle of the shape (the camera's orbit point) and `vsSchematic.showGrid` draws a grid on the y = 0 plane. Both apply to open previews immediately.
- Reloads when the file changes on disk.

## Using it

The preview never replaces VS Code's normal JSON editor. Right-click a file in the Explorer and choose
**Preview Schematic, Model or Chisel Shape**, run **Vintage Story: Preview Schematic, Model or Chisel Shape** from the
Command Palette, or pick **Open With... > Nf3t's Vintage Story Tools**. (There is deliberately no button in the editor title bar.) A JSON file that is neither a schematic nor a model
shows an error instead of a preview.

## Developing

It is part of the `vintage-story-wiki` monorepo and reuses its `vs-schematic` package (decoder, voxel conversion,
Three.js viewer). From the repo root:

```
npm install
npm run build:extension                   # bundle + package: writes vs-vscode-extension-<version>.vsix here
npm run build -w vs-vscode-extension      # bundle only (dist/extension.js, dist/webview.{js,css}), for F5 development
npm run typecheck                         # includes this package
```

`npm run screenshots -w vs-vscode-extension` launches a real VS Code (version pinned in `scripts/screenshots.mjs`, downloaded once to
`.vscode-test/`, or reuse one with `VSCODE_TEST_CACHE=/path`) with the extension loaded from source, opens a schematic, a ChiselTools shape (with
and without an extension) and a few model files, and saves screenshots to `.tmp/screenshots/`; it fails if any preview shows an error or no canvas. It is
headless (`--ozone-platform=headless`, software WebGL), so it needs only Electron's shared libraries, not an X server. On Ubuntu 24.04:
`sudo apt-get install libgtk-3-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcairo2 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libatspi2.0-0t64 libasound2t64 libnss3`.
It needs the game's files under the repo's `vintagestory/` (`npm run download`; an old `vs_server/` works too).

To try it by hand, open the repo in VS Code and start an Extension Development Host on `apps/vs-vscode-extension`
(F5 needs a launch configuration pointing at that folder; none is committed).

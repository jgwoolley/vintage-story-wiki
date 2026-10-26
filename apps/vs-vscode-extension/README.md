# Vintage Story Schematic Preview

Preview Vintage Story worldgen schematics (`.json` and the wiki's `.json.gz` copies) as an interactive 3D
voxel model, without leaving VS Code.

- Orbit, pan and zoom; click a block to see its code, position and decoded block-entity data.
- A block list with counts: click to hide/show a kind, filter by name, show/hide all.
- `meta-filler` (a worldgen marker) starts hidden, like on the wiki; tick **Show meta-filler** to see it.
- An **Up to Y** slider peels the structure away from the top.
- Also opens Vintage Story **model (shape) files** (`assets/<domain>/shapes/**.json`: items, creatures, blocks, armor, clothes) as an untextured 3D model of boxes, with a legend of the model's texture names. Armor and clothing models only name a bone of the player body; they are placed on it when `shapes/entity/humanoid/seraph-faceless.json` can be found in the same `assets/<domain>/` tree (or the sibling `game` / `survival` one). A model with animations gets an **Animation** picker in the toolbar that plays them in a loop (worn items stay in their rest pose). **Show floor** draws a grid of one-block squares at ground level, to judge where a model sits.
- Also opens QPTech ChiselTools shape files (saved with `.pf save`, in the `chiselportfolio` folder, or named `*.pf`): the chiseled block's shape in 3D plus its materials.
- Settings (**File > Preferences > Settings**, search "Vintage Story Schematic Preview"): `vsSchematic.showCenterMarker` draws a marker at the middle of the shape (the camera's orbit point) and `vsSchematic.showGrid` draws a grid on the y = 0 plane. Both apply to open previews immediately.
- Reloads when the file changes on disk.

## Using it

The preview never replaces VS Code's normal JSON editor. Right-click a schematic in the Explorer and choose
**Preview Schematic**, use the button in the editor title bar, run **Vintage Story: Preview Schematic** from the
Command Palette, or pick **Open With... > Vintage Story Schematic Preview**. A JSON file that is neither a schematic nor a model
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
It needs the game's files under the repo's `vs_server/` (`npm run download`).

To try it by hand, open the repo in VS Code and start an Extension Development Host on `apps/vs-vscode-extension`
(F5 needs a launch configuration pointing at that folder; none is committed).

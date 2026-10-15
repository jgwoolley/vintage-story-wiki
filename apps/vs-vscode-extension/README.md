# Vintage Story Schematic Preview

Preview Vintage Story worldgen schematics (`.json` and the wiki's `.json.gz` copies) as an interactive 3D
voxel model, without leaving VS Code.

- Orbit, pan and zoom; click a block to see its code, position and decoded block-entity data.
- A block list with counts: click to hide/show a kind, filter by name, show/hide all.
- `meta-filler` (a worldgen marker) starts hidden, like on the wiki; tick **Show meta-filler** to see it.
- An **Up to Y** slider peels the structure away from the top.
- Reloads when the file changes on disk.

## Using it

The preview never replaces VS Code's normal JSON editor. Right-click a schematic in the Explorer and choose
**Preview Schematic**, use the button in the editor title bar, run **Vintage Story: Preview Schematic** from the
Command Palette, or pick **Open With... > Vintage Story Schematic Preview**. A JSON file that isn't a schematic
shows an error instead of a model.

## Developing

It is part of the `vintage-story-wiki` monorepo and reuses its `vs-schematic` package (decoder, voxel conversion,
Three.js viewer). From the repo root:

```
npm install
npm run build:extension                   # bundle + package: writes vs-vscode-extension-<version>.vsix here
npm run build -w vs-vscode-extension      # bundle only (dist/extension.js, dist/webview.{js,css}), for F5 development
npm run typecheck                         # includes this package
```

To try it, open the repo in VS Code and start an Extension Development Host on `apps/vs-vscode-extension`
(F5 needs a launch configuration pointing at that folder; none is committed).

// Messages between the extension host (src/extension.ts) and the preview webview (src/webview/main.ts).

/** Host -> webview. */
export type HostMessage =
  // The (already gunzipped) file's JSON text: a schematic, a ChiselTools shape, or a Vintage Story model (shape) file. `body` is
  // the player body shape (seraph-faceless.json), found next to a worn item's model so its pieces can be placed on it.
  | { type: "schematic"; name: string; text: string; body?: string }
  | { type: "error"; message: string } // the file couldn't be read
  | { type: "settings"; centerMarker: boolean; grid: boolean }; // the vsSchematic.* display settings (sent on ready and whenever they change)

/** Webview -> host. */
export type WebviewMessage = { type: "ready" }; // the webview's script has loaded and wants the file

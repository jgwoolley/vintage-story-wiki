// Messages between the extension host (src/extension.ts) and the preview webview (src/webview/main.ts).

/** A model's textures, found in the model's own assets tree or the vsSchematic.gameFolder install (see src/textures.ts). */
export interface ModelTextures {
  /** Texture key (without "#") -> PNG as a data: URL. */
  images: Record<string, string>;
  /** Keys whose PNG wasn't found, with the path the shape names. */
  missing: { key: string; ref: string }[];
  /** The configured game folder, if any (shown so the user knows where textures came from). */
  gameFolder?: string;
}

/** Host -> webview. */
export type HostMessage =
  // The (already gunzipped) file's JSON text: a schematic, a ChiselTools shape, or a Vintage Story model (shape) file. `body` is
  // the player body shape (seraph-faceless.json), found next to a worn item's model so its pieces can be placed on it.
  // `textures` is only sent for a model file.
  | { type: "schematic"; name: string; text: string; body?: string; textures?: ModelTextures }
  | { type: "error"; message: string } // the file couldn't be read
  | { type: "settings"; centerMarker: boolean; grid: boolean }; // the vsSchematic.* display settings (sent on ready and whenever they change)

/** Webview -> host. */
export type WebviewMessage =
  | { type: "ready" } // the webview's script has loaded and wants the file
  | { type: "selectGameFolder" }; // the user clicked "Choose game folder" in the legend

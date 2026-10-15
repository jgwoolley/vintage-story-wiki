// Messages between the extension host (src/extension.ts) and the preview webview (src/webview/main.ts).

/** Host -> webview. */
export type HostMessage =
  | { type: "schematic"; name: string; text: string } // the (already gunzipped) schematic JSON text
  | { type: "error"; message: string }; // the file couldn't be read

/** Webview -> host. */
export type WebviewMessage = { type: "ready" }; // the webview's script has loaded and wants the file

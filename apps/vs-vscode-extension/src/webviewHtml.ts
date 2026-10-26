// The preview webview's HTML shell. Pure string building (no `vscode` import) so it can be unit
// tested under plain Node; src/extension.ts supplies the webview-specific URIs and CSP source.

export interface WebviewHtmlOptions {
  /** `webview.cspSource`: the origin the webview may load bundled resources from. */
  cspSource: string;
  /** Fresh random value; the only script allowed to run is the one carrying it. */
  nonce: string;
  /** `webview.asWebviewUri` of dist/webview.js. */
  scriptUri: string;
  /** `webview.asWebviewUri` of dist/webview.css. */
  styleUri: string;
  /** Shown as the document title (the schematic's file name). */
  title: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildWebviewHtml({ cspSource, nonce, scriptUri, styleUri, title }: WebviewHtmlOptions): string {
  // No inline script or style: the bundle sets styles through the CSSOM, which the CSP allows.
  const csp = [
    "default-src 'none'",
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} data:`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="toolbar">
    <button id="resetView" type="button">Reset view</button>
    <label class="check"><input id="showFiller" type="checkbox"> Show meta-filler</label>
    <label class="slider">Up to Y <input id="maxY" type="range" min="0" max="0" value="0" disabled> <output id="maxYValue"></output></label>
    <label class="slider" id="animBox" hidden>Animation <select id="anim"></select></label>
    <label class="check" id="floorBox" hidden><input id="floor" type="checkbox"> Show floor</label>
    <span id="summary"></span>
  </div>
  <div id="error" role="alert" hidden></div>
  <div id="main">
    <div id="viewport" aria-label="Schematic 3D view"></div>
    <aside id="side">
      <input id="search" type="search" placeholder="Filter blocks" aria-label="Filter blocks">
      <div class="side-actions">
        <button id="showAll" type="button">Show all</button>
        <button id="hideAll" type="button">Hide all</button>
      </div>
      <div id="legend"></div>
      <section id="inspector" hidden>
        <button id="closeInspector" type="button" aria-label="Close inspector">&times;</button>
        <div id="traits"></div>
      </section>
    </aside>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

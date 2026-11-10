import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWebviewHtml, escapeHtml } from "../src/webviewHtml.js";

const options = {
  cspSource: "https://file+.vscode-resource.vscode-cdn.net",
  nonce: "abc123==",
  scriptUri: "https://x/dist/webview.js",
  styleUri: "https://x/dist/webview.css",
  title: "ruin <1> & \"co\".json",
};

test("only the bundled script, carrying the nonce, may run; no inline script or style is allowed", () => {
  const html = buildWebviewHtml(options);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-abc123=='(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(html, /<script nonce="abc123==" src="https:\/\/x\/dist\/webview\.js"><\/script>/);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<style|style="/);
});

test("the file name is HTML-escaped in the title", () => {
  const html = buildWebviewHtml(options);
  assert.match(html, /<title>ruin &lt;1&gt; &amp; &quot;co&quot;\.json<\/title>/);
  assert.equal(escapeHtml("a&b<c>\"d"), "a&amp;b&lt;c&gt;&quot;d");
});

test("every element id the webview script looks up exists in the shell", () => {
  const html = buildWebviewHtml(options);
  for (const id of ["viewport", "legend", "summary", "error", "search", "showFiller", "fillerBox", "maxY", "maxYBox", "maxYValue", "sideActions", "inspector", "traits", "resetView", "showAll", "hideAll", "closeInspector", "animBox", "floorBox"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test("the controls that only mean something for some kinds of file start hidden, until the script knows what was opened", () => {
  const html = buildWebviewHtml(options);
  // schematic-only: meta-filler, the Y slider, the block filter and show/hide all; model-only: the animation picker and the floor switch
  for (const id of ["fillerBox", "maxYBox", "search", "sideActions", "animBox", "floorBox"]) {
    assert.match(html, new RegExp(`<[^>]*id="${id}"[^>]*\\shidden`), `${id} starts hidden`);
  }
  assert.doesNotMatch(html, /<[^>]*id="resetView"[^>]*hidden/);
});

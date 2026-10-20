import { test } from "node:test";
import assert from "node:assert/strict";
import { loadViewerSettings, saveViewerSettings, watchViewerSettings } from "../src/viewerSettings.js";

// A minimal browser: localStorage plus an event target standing in for window.
function fakeBrowser(stored?: string) {
  const store = new Map<string, string>(stored === undefined ? [] : [["vsWikiViewerSettings", stored]]);
  const target = new EventTarget();
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    window: Object.assign(target, { CustomEvent }),
  });
  return store;
}

test("settings default to off and tolerate unreadable storage", () => {
  fakeBrowser();
  assert.deepEqual(loadViewerSettings(), { centerMarker: false, grid: false });
  fakeBrowser("not json");
  assert.deepEqual(loadViewerSettings(), { centerMarker: false, grid: false });
});

test("saved settings are stored, and watchers hear about them", () => {
  const store = fakeBrowser();
  const seen: unknown[] = [];
  const stop = watchViewerSettings((s) => seen.push(s));
  saveViewerSettings({ centerMarker: true, grid: false });
  stop();
  saveViewerSettings({ centerMarker: true, grid: true });
  assert.deepEqual(seen, [{ centerMarker: false, grid: false }, { centerMarker: true, grid: false }], "initial value, then the change, then nothing after unsubscribing");
  assert.deepEqual(JSON.parse(store.get("vsWikiViewerSettings")!), { centerMarker: true, grid: true });
});

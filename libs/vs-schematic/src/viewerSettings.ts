// Display options shared by every 3D view (the wiki's viewers and the VS Code extension's preview): helpers
// that make it easy to see where a shape's centre is. On the wiki they are stored in localStorage, set on
// /settings/ (or the schematic viewer's sidebar), and every viewer on the page follows changes live; the VS
// Code extension passes its own settings in explicitly (see createVoxelViewer's `settings` option).

export interface ViewerSettings {
  /** A marker (a dot with short coloured axes) at the middle of the shape: the point the camera orbits. */
  centerMarker: boolean;
  /** A grid on the y = 0 plane (the bottom of the lowest cell row). */
  grid: boolean;
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = { centerMarker: false, grid: false };

const STORAGE_KEY = "vsWikiViewerSettings";
const CHANGE_EVENT = "vs-viewer-settings";

export function loadViewerSettings(): ViewerSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ViewerSettings>;
    return { centerMarker: raw.centerMarker === true, grid: raw.grid === true };
  } catch {
    return { ...DEFAULT_VIEWER_SETTINGS }; // storage blocked or unreadable: the defaults
  }
}

export function saveViewerSettings(settings: ViewerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* storage blocked: the change still applies to this page */ }
  window.dispatchEvent(new CustomEvent<ViewerSettings>(CHANGE_EVENT, { detail: settings }));
}

/** Calls `onChange` now with the stored settings, and again whenever they change (on this page or in another tab). Returns the unsubscribe. */
export function watchViewerSettings(onChange: (settings: ViewerSettings) => void): () => void {
  const fromEvent = (e: Event) => onChange((e as CustomEvent<ViewerSettings>).detail);
  const fromStorage = (e: StorageEvent) => e.key === STORAGE_KEY && onChange(loadViewerSettings());
  window.addEventListener(CHANGE_EVENT, fromEvent);
  window.addEventListener("storage", fromStorage);
  onChange(loadViewerSettings());
  return () => {
    window.removeEventListener(CHANGE_EVENT, fromEvent);
    window.removeEventListener("storage", fromStorage);
  };
}

// Page script for /settings/ (site/settings/index.njk): the 3D view options, stored by viewerSettings.ts.
import { loadViewerSettings, saveViewerSettings } from "./viewerSettings.js";
import { createChiselPreview } from "./chiselPreview.js";

const center = document.getElementById("setCenterMarker");
const grid = document.getElementById("setGrid");
const settings = loadViewerSettings();
center.checked = settings.centerMarker;
grid.checked = settings.grid;

function save() {
  saveViewerSettings({ centerMarker: center.checked, grid: grid.checked });
  document.getElementById("setStatus").textContent = "Saved.";
}
center.addEventListener("change", save);
grid.addEventListener("change", save);

// A small sample (an off-center L-shaped post) so the marker and grid can be tried right here; it follows the settings live.
const bit = (x1, y1, z1, x2, y2, z2) => ({ x1, y1, z1, x2, y2, z2, material: 0 });
createChiselPreview(document.getElementById("setPreview"), {
  cuboids: [bit(2, 0, 2, 6, 16, 6), bit(2, 0, 6, 12, 4, 10)],
  materials: ["game:rock-granite"], materialIds: [0], packed: [],
}, () => "#9a8f80");

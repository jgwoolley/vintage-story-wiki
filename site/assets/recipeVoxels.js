// Smithing/clayforming/knapping recipe patterns in 3D (site/recipes/recipes.njk): turns
// `recipe.raw.pattern` into voxels for the shared voxelViewer.js and switches between the two
// views -- exactly one shows at a time, in the same container under one shared toolbar:
//   - "3d": the voxel model, in one of three layer modes: "all" (every layer), "single" (only the
//     selected layer), "below" (the selected layer and every layer under it).
//   - "2d": the server-rendered per-layer slice grids (also the no-JS/no-WebGL fallback, which is
//     why the controls start hidden and this script reveals them).
// The Layer tabs (layers.js, which fires "layerchange" on the .layer-switcher) are shared by both
// views: they pick the slice in 2D and the layer for the "single"/"below" 3D modes. Controls that
// don't apply right now (the 3D modes while in 2D; the Layer tabs in 3D "all") are disabled, never
// hidden, so the toolbar keeps the same layout in every state.
//
// Pattern axes, matching the game's layered voxel recipes: pattern[layer][row][column] ->
// y = layer (Layer 1 is the bottom), z = row, x = column; '#' is filled, anything else empty.
import { createVoxelViewer } from "./voxelViewer.js";

const CATEGORY_COLORS = {
  smithing: "#a7adb4", // worked metal
  clayforming: "#b06a48", // raw clay
  knapping: "#8f8a80", // flint/stone
};
// The chosen view (3D vs 2D) is remembered across recipe pages; the layer mode isn't, since it
// only makes sense relative to one recipe's shape.
const VIEW_STORAGE_KEY = "recipePatternView";

function patternToVoxels(pattern, color) {
  const voxels = [];
  pattern.forEach((layer, y) => {
    layer.forEach((row, z) => {
      [...row].forEach((ch, x) => {
        if (ch === "#") voxels.push({ x, y, z, color });
      });
    });
  });
  return voxels;
}

function storedView() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // storage blocked (private window etc.) -- the choice just isn't remembered
  }
}

document.querySelectorAll(".voxel-recipe").forEach((root) => {
  const patternEl = root.querySelector("script.voxel-pattern");
  const controlsEl = root.querySelector(".voxel-controls");
  const viewerEl = root.querySelector(".voxel-viewer");
  const canvasEl = root.querySelector(".voxel-viewer-canvas");
  if (!patternEl || !controlsEl || !viewerEl || !canvasEl) return;

  const pattern = JSON.parse(patternEl.textContent);
  const voxels = patternToVoxels(pattern, CATEGORY_COLORS[root.dataset.category] ?? "#9a8f80");
  if (!voxels.length) return;

  // Must be visible (have a size) when the viewer mounts.
  viewerEl.hidden = false;
  // Single-layer patterns (all knapping, some smithing) are flat plates -- start closer to top-down.
  const viewer = createVoxelViewer(canvasEl, {
    voxels,
    label: canvasEl.getAttribute("aria-label") ?? undefined,
    viewDirection: pattern.length === 1 ? [0.35, 1.6, 1] : [1, 1.1, 1.4],
  });
  if (!viewer) {
    viewerEl.hidden = true;
    return;
  }

  const viewButtons = root.querySelectorAll("[data-view]");
  const modeButtons = root.querySelectorAll("[data-mode]");
  const layerTabs = root.querySelectorAll(".layer-tab[data-layer-index]");
  const slicesEl = root.querySelector(".layer-slices");

  const state = {
    view: storedView() === "2d" ? "2d" : "3d",
    mode: "all",
    layer: Number(root.querySelector(".layer-tab.active[data-layer-index]")?.dataset.layerIndex ?? 0),
  };

  function apply() {
    const is3d = state.view === "3d";
    viewerEl.hidden = !is3d;
    slicesEl.hidden = is3d;
    modeButtons.forEach((b) => (b.disabled = !is3d));
    layerTabs.forEach((b) => (b.disabled = is3d && state.mode === "all"));
    viewButtons.forEach((b) => setPressed(b, b.dataset.view === state.view));
    modeButtons.forEach((b) => setPressed(b, b.dataset.mode === state.mode));
    if (!is3d) return;
    if (state.mode === "all") viewer.setStyle();
    else if (state.mode === "single") viewer.setStyle((v) => (v.y === state.layer ? {} : null));
    else viewer.setStyle((v) => (v.y <= state.layer ? {} : null));
  }

  function setPressed(button, pressed) {
    button.classList.toggle("active", pressed);
    button.setAttribute("aria-pressed", String(pressed));
  }

  viewButtons.forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      storeView(state.view);
      apply();
    }),
  );
  modeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      apply();
    }),
  );
  root.addEventListener("layerchange", (e) => {
    state.layer = Number(e.detail.index);
    apply();
  });
  root.querySelector(".voxel-viewer-reset")?.addEventListener("click", () => viewer.resetView());

  controlsEl.hidden = false;
  apply();
});

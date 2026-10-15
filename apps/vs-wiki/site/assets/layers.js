// Smithing/clayforming/knapping recipe voxel-pattern layers: show one layer at a time, selected
// by clicking its tab (site/recipes/recipes.njk). Some recipes have a lot of layers (clayoven has
// 16), so stacking every layer's slice at once is hard to read -- this switches between them
// instead. Each switch also fires a "layerchange" CustomEvent (detail.index = the tab's
// data-layer-index, as a string) on the .layer-switcher, which the 3D view (recipeVoxels.js)
// listens for to pick the layer its "One layer"/"Layer N and below" modes show.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".layer-switcher").forEach((switcher) => {
      const tabs = switcher.querySelectorAll(".layer-tab[data-layer-index]");
      const panels = switcher.querySelectorAll(".layer-panel");
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const index = tab.dataset.layerIndex;
          tabs.forEach((t) => t.classList.toggle("active", t === tab));
          panels.forEach((p) => {
            p.hidden = p.dataset.layerIndex !== index;
          });
          switcher.dispatchEvent(new CustomEvent("layerchange", { detail: { index } }));
        });
      });
    });
  });
})();

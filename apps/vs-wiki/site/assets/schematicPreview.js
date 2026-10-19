// Read-only 3D preview on a schematic's own page (site/schematics/schematics.njk): rotate, pan and
// zoom only. No legend, layer slider or block picking -- those live in the full viewer, which the
// page links to. Reuses the shared voxelViewer.js core and schematicVoxels.js helpers.
import { createVoxelViewer } from "./voxelViewer.js";
import { assertSchematic, fetchGzipText, isHiddenByDefault, toVoxels } from "./schematicVoxels.js";
import { blockColor, loadBlockColors } from "./blockColors.js";

const root = document.getElementById("schematicPreview");
if (root) {
  const status = root.querySelector(".preview-status");
  const stage = root.querySelector(".preview-stage");
  const src = root.dataset.src;
  const gzBytes = Number(root.dataset.gzBytes) || 0;
  // Big files (the biggest is 5.7 MB compressed, over a million blocks) wait for a click instead of
  // downloading and drawing as soon as the page opens.
  const AUTO_LOAD_MAX_BYTES = 1.5e6;
  let started = false;

  const say = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };

  async function start() {
    if (started) return;
    started = true;
    root.querySelector(".preview-load")?.remove();
    say("Loading 3D preview...");
    try {
      const schematic = JSON.parse(await fetchGzipText(src));
      assertSchematic(schematic);
      // Filler markers are dropped outright, so the preview can never show them.
      const { colors } = await loadBlockColors(root.dataset.blockColors);
      const voxels = toVoxels(schematic)
        .filter((v) => !isHiddenByDefault(v.code))
        .map((v) => ({ ...v, color: blockColor(v.code, colors) }));
      if (!voxels.length) return say("Nothing to show: this schematic has no visible blocks.");
      const viewer = createVoxelViewer(stage, { voxels, label: `3D preview of ${root.dataset.name}` });
      if (!viewer) return say("WebGL is unavailable in this browser, so the 3D preview can't be shown.");
      say("");
    } catch (err) {
      console.error(err);
      started = false;
      say(`Couldn't load the preview: ${err.message}`);
    }
  }

  say(gzBytes > AUTO_LOAD_MAX_BYTES ? "" : "Loading 3D preview...");
  if (gzBytes > AUTO_LOAD_MAX_BYTES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button-like preview-load";
    button.textContent = `Load 3D preview (${(gzBytes / 1e6).toFixed(1)} MB download)`;
    button.addEventListener("click", start);
    root.append(button);
  } else if ("IntersectionObserver" in window) {
    // Small enough to load automatically, but only once it scrolls into view.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(root);
  } else {
    start();
  }
}

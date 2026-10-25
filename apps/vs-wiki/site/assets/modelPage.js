// Read-only 3D preview of an item's or creature's shape (site/_includes/macros/model.njk): rotate, pan and zoom only.
// Loads the compacted shape ingest wrote (src/ingest/models/shapes.ts) once the preview scrolls into view and draws it
// untextured through the shared voxel viewer (modelPreview.js in libs/vs-schematic).
import { createModelPreview } from "./modelPreview.js";
import { fetchGzipText } from "./schematicVoxels.js";

const root = document.getElementById("modelPreview");
if (root) {
  const status = root.querySelector(".preview-status");
  const stage = root.querySelector(".preview-stage");
  let started = false;

  const say = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };

  async function start() {
    if (started) return;
    started = true;
    say("Loading 3D preview...");
    try {
      const shape = JSON.parse(await fetchGzipText(root.dataset.src));
      const viewer = createModelPreview(stage, shape, `3D preview of ${root.dataset.name}`);
      if (!viewer) return say("The 3D preview can't be shown: this browser has no WebGL, or the shape has nothing to draw.");
      say("");
    } catch (err) {
      console.error(err);
      started = false;
      say(`Couldn't load the preview: ${err.message}`);
    }
  }

  say("Loading 3D preview...");
  if ("IntersectionObserver" in window) {
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

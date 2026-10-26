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

  // The animation and floor choices live in the address (`?anim=walk&floor=1`) so a link shares exactly what you are looking at. Only these two
  // parameters are touched; replaceState keeps the back button for real navigation.
  function wireControls(viewer) {
    const params = new URLSearchParams(location.search);
    const select = document.getElementById("modelAnim");
    const floor = document.getElementById("modelFloor");
    const remember = () => {
      const next = new URLSearchParams(location.search);
      if (select.value) next.set("anim", select.value); else next.delete("anim");
      if (floor.checked) next.set("floor", "1"); else next.delete("floor");
      const query = next.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    };
    if (viewer.animations.length) {
      select.append(...viewer.animations.map((a) => new Option(a.name, a.code)));
      document.getElementById("modelAnimBox").hidden = false;
      document.getElementById("modelAnimNote").hidden = false;
      // An unknown code (a link to a model that has no such animation) is ignored, leaving the rest pose.
      if (viewer.animations.some((a) => a.code === params.get("anim"))) select.value = params.get("anim");
      viewer.playAnimation(select.value || null);
      select.addEventListener("change", () => {
        viewer.playAnimation(select.value || null);
        remember();
      });
    }
    document.getElementById("modelControls").hidden = false; // only offered once there is a preview to control
    floor.checked = params.get("floor") === "1";
    viewer.setFloor(floor.checked);
    floor.addEventListener("change", () => {
      viewer.setFloor(floor.checked);
      remember();
    });
  }

  async function start() {
    if (started) return;
    started = true;
    say("Loading 3D preview...");
    try {
      const shape = JSON.parse(await fetchGzipText(root.dataset.src));
      const viewer = createModelPreview(stage, shape, `3D preview of ${root.dataset.name}`);
      if (!viewer) return say("The 3D preview can't be shown: this browser has no WebGL, or the shape has nothing to draw.");
      say("");
      wireControls(viewer);
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

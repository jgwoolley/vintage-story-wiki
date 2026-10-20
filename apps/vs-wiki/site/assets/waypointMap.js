// SVG map of the waypoints (site/tools/waypoints/index.njk). Replaces the price guide's Cytoscape
// canvas (useCytoscape.ts): the graph here is just labeled dots on a plane, so plain SVG with a
// viewBox gives pan/zoom/theming for free without a library dependency.
const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Mount a map into `container`. Returns { render(state), focus(waypoint), fit(waypoints) }.
 * `onSelect(waypoint)` fires when a dot is clicked; `render` takes an optional `selectedId` to highlight.
 */
export function createWaypointMap(container, { onSelect }) {
  const root = svg("svg", { class: "waypoint-map", role: "img", "aria-label": "Waypoint map" });
  container.append(root);
  let view = { cx: 0, cz: 0, span: 200 };
  let drag = null;

  function applyView() {
    const rect = container.getBoundingClientRect();
    const aspect = (rect.width || 1) / (rect.height || 1);
    const h = view.span;
    const w = h * aspect;
    root.setAttribute("viewBox", `${view.cx - w / 2} ${view.cz - h / 2} ${w} ${h}`);
  }

  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.span = Math.min(1e7, Math.max(5, view.span * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    redrawLabels();
  }, { passive: false });
  // Pointer capture is only taken once the pointer has actually moved: capturing on pointerdown redirects
  // the click that follows to the <svg> itself, so a plain click on a waypoint never reached the dot.
  const DRAG_THRESHOLD = 4;
  root.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moved = true;
      root.setPointerCapture(drag.id);
    }
    const scale = view.span / (container.clientHeight || 1);
    view.cx -= (e.clientX - drag.x) * scale;
    view.cz -= (e.clientY - drag.y) * scale;
    drag = { ...drag, x: e.clientX, y: e.clientY };
    applyView();
  });
  const endDrag = () => (drag = null);
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  let last = null;
  const redrawLabels = () => last && render(last);

  function render({ waypoints, path = [], sourceId, destinationId, selectedId }) {
    last = { waypoints, path, sourceId, destinationId, selectedId };
    root.replaceChildren();
    applyView();
    const unit = view.span / (container.clientHeight || 400); // user units per CSS pixel
    const onPath = new Set(path.flatMap((s) => [s.from.id, s.to.id]));
    const byId = new Map(waypoints.map((w) => [w.id, w]));
    for (const w of waypoints) {
      const other = w.connection && byId.get(w.connection);
      if (other) root.append(svg("line", { x1: w.x, y1: w.z, x2: other.x, y2: other.z, class: "wp-link", "stroke-width": unit * 1.5 }));
    }
    for (const s of path) {
      root.append(svg("line", { x1: s.from.x, y1: s.from.z, x2: s.to.x, y2: s.to.z, class: "wp-path", "stroke-width": unit * 3 }));
    }
    for (const w of waypoints) {
      const g = svg("g", { class: `wp-node${w.id === selectedId ? " wp-selected" : ""}`, tabindex: 0, role: "button", "aria-label": w.label });
      const cls = w.id === sourceId ? "wp-source" : w.id === destinationId ? "wp-dest" : onPath.has(w.id) ? "wp-onpath" : "";
      g.append(svg("circle", { cx: w.x, cy: w.z, r: unit * 7, class: cls }));
      g.append(svg("text", { x: w.x + unit * 10, y: w.z + unit * 4, "font-size": unit * 12 }, w.label));
      g.addEventListener("click", () => onSelect(w));
      g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && onSelect(w));
      root.append(g);
    }
  }

  function focus(w) {
    view.cx = w.x;
    view.cz = w.z;
    redrawLabels();
  }

  // Fit all points on first render of a non-empty set.
  function fit(waypoints) {
    if (!waypoints.length) return;
    const xs = waypoints.map((w) => w.x), zs = waypoints.map((w) => w.z);
    view.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    view.cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
    view.span = Math.max(60, (Math.max(...zs) - Math.min(...zs)) * 1.4, ((Math.max(...xs) - Math.min(...xs)) * 1.4) / aspect);
    redrawLabels();
  }

  new ResizeObserver(redrawLabels).observe(container);
  return { render, focus, fit };
}

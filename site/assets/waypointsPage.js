// Page controller for site/tools/waypoints/index.njk: state + DOM wiring around waypoints.js
// (logic) and waypointMap.js (SVG map). Waypoints persist in localStorage only.
import { shortestPath, stringifyWayPoint, getWaypointCommand, serializeWayPoints, deserializeWayPoints } from "./waypoints.js";
import { createWaypointMap } from "./waypointMap.js";

const STORAGE_KEY = "vsWaypointTool";
const $ = (id) => document.getElementById(id);

let state = { waypoints: [], source: "", destination: "", createdTime: undefined };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...deserializeWayPoints(JSON.parse(raw)) };
  } catch (err) {
    console.warn("waypoints: ignoring unreadable saved state", err);
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWayPoints(state)));
  } catch { /* storage blocked: tool still works for this visit */ }
}
function setStatus(msg, isError = false) {
  const el = $("wpStatus");
  el.textContent = msg;
  el.classList.toggle("schematic-error", isError);
}

const map = createWaypointMap($("wpMap"), { onSelect: (w) => openDialog(w) });

function td(content) {
  const cell = document.createElement("td");
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content;
  return cell;
}
function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function refresh() {
  const { waypoints } = state;
  if (!waypoints.some((w) => w.id === state.source)) state.source = "";
  if (!waypoints.some((w) => w.id === state.destination)) state.destination = "";

  for (const [id, key] of [["wpSource", "source"], ["wpDest", "destination"], ["wpConnection", null]]) {
    const select = $(id);
    const current = key ? state[key] : select.value;
    select.replaceChildren(new Option(key ? "-- choose --" : "(none)", ""));
    for (const w of waypoints) select.append(new Option(stringifyWayPoint(w), w.id));
    select.value = waypoints.some((w) => w.id === current) ? current : "";
  }

  const path = shortestPath(waypoints, state.source, state.destination);
  const body = $("wpPathBody");
  body.replaceChildren();
  path.forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.append(td(String(i + 1)), td(s.from.label), td(s.to.label), td(s.distance === 0 ? "translocator (0)" : s.distance.toFixed(1)));
    body.append(tr);
  });
  const total = path.reduce((sum, s) => sum + s.distance, 0);
  $("wpPathTotal").textContent = path.length ? `Total: ${total.toFixed(1)} blocks in ${path.length} step(s).` : "Pick a source and destination to see a route.";

  const rows = $("wpTableBody");
  rows.replaceChildren();
  for (const w of waypoints) {
    const tr = document.createElement("tr");
    const actions = document.createElement("div");
    actions.className = "wp-actions";
    actions.append(
      button("Edit", () => openDialog(w)),
      button("Center", () => map.focus(w)),
      button("Copy command", async () => {
        try { await navigator.clipboard.writeText(getWaypointCommand(w)); setStatus(`Copied: ${getWaypointCommand(w)}`); }
        catch { setStatus(getWaypointCommand(w)); }
      }),
    );
    const linked = waypoints.find((o) => o.id === w.connection);
    tr.append(td(w.label), td(`${w.x}, ${w.height}, ${w.z}`), td(linked ? linked.label : ""), td(actions));
    rows.append(tr);
  }
  $("wpEmpty").hidden = waypoints.length > 0;
  map.render({ waypoints, path, sourceId: state.source, destinationId: state.destination });
  save();
}

// ---- Edit dialog ----
const dialog = $("wpDialog");
let editingId = null;
function openDialog(w) {
  editingId = w?.id ?? null;
  $("wpDialogTitle").textContent = w ? "Edit WayPoint" : "Add WayPoint";
  $("wpLabel").value = w?.label ?? "";
  $("wpX").value = w?.x ?? 0;
  $("wpZ").value = w?.z ?? 0;
  $("wpHeight").value = w?.height ?? 0;
  $("wpColor").value = w?.color ?? "red";
  $("wpIcon").value = w?.icon ?? "circle";
  $("wpPinned").checked = w?.pinned ?? false;
  $("wpDelete").hidden = !w;
  refresh();
  $("wpConnection").value = w?.connection ?? "";
  // A waypoint can't link to itself.
  for (const opt of $("wpConnection").options) opt.disabled = opt.value === editingId;
  dialog.showModal();
}
$("wpAdd").addEventListener("click", () => openDialog(null));
$("wpCancel").addEventListener("click", () => dialog.close());
$("wpDelete").addEventListener("click", () => {
  state.waypoints = state.waypoints.filter((w) => w.id !== editingId).map((w) => (w.connection === editingId ? { ...w, connection: undefined } : w));
  dialog.close();
  refresh();
});
$("wpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const next = {
    id: editingId ?? crypto.randomUUID(),
    label: $("wpLabel").value.trim() || "Unnamed",
    x: Number($("wpX").value), z: Number($("wpZ").value), height: Number($("wpHeight").value),
    color: $("wpColor").value || "red", icon: $("wpIcon").value || "circle", pinned: $("wpPinned").checked,
    connection: $("wpConnection").value || undefined,
  };
  if (![next.x, next.z, next.height].every(Number.isFinite)) return setStatus("Coordinates must be numbers.", true);
  const i = state.waypoints.findIndex((w) => w.id === editingId);
  if (i >= 0) state.waypoints[i] = next; else state.waypoints.push(next);
  // Keep translocator links symmetric: the partner points back at this waypoint.
  for (const w of state.waypoints) {
    if (w.id !== next.id && w.connection === next.id && next.connection !== w.id) w.connection = undefined;
    if (w.id === next.connection) w.connection = next.id;
  }
  dialog.close();
  refresh();
  if (state.waypoints.length === 1) map.fit(state.waypoints);
});

$("wpSource").addEventListener("change", (e) => { state.source = e.target.value; refresh(); });
$("wpDest").addEventListener("change", (e) => { state.destination = e.target.value; refresh(); });
$("wpSwap").addEventListener("click", () => { [state.source, state.destination] = [state.destination, state.source]; refresh(); });
$("wpFit").addEventListener("click", () => map.fit(state.waypoints));

// ---- Import / export ----
$("wpExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(serializeWayPoints(state), null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "vintage-story-waypoints.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("wpImport").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    state = { ...state, ...deserializeWayPoints(JSON.parse(await file.text())) };
    refresh();
    map.fit(state.waypoints);
    setStatus(`Imported ${state.waypoints.length} waypoint(s).`);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, true);
  }
});
$("wpClear").addEventListener("click", () => {
  if (!$("wpClear").dataset.armed) {
    $("wpClear").dataset.armed = "1";
    $("wpClear").textContent = "Click again to clear all";
    setTimeout(() => { delete $("wpClear").dataset.armed; $("wpClear").textContent = "Clear all"; }, 3000);
    return;
  }
  state = { waypoints: [], source: "", destination: "", createdTime: undefined };
  delete $("wpClear").dataset.armed;
  $("wpClear").textContent = "Clear all";
  refresh();
});

load();
refresh();
map.fit(state.waypoints);

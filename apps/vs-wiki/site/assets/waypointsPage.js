// Page controller for the waypoint part of site/map/index.njk: state + DOM wiring around waypoints.js
// (logic) and waypointMap.js (SVG map). Waypoints persist in localStorage only.
import { shortestPath, stringifyWayPoint, formatCoords, getWaypointCommand, serializeWayPoints, deserializeWayPoints, isModData, modDataSavegames, importModData } from "./waypoints.js";
import { createWaypointMap } from "./waypointMap.js";

// The waypoint icons the in-game map offers, from the game's and mods' assets (generated at build time).
const iconSelect = () => document.getElementById("wpIcon");
fetch(document.getElementById("wpMap").dataset.icons)
  .then((r) => (r.ok ? r.json() : []))
  .then((icons) => {
    const select = iconSelect();
    const current = select.value;
    select.replaceChildren(...icons.map((i) => new Option(i.source === "game" ? i.code : `${i.code} (${i.source})`, i.code)));
    if (!icons.some((i) => i.code === "circle")) select.prepend(new Option("circle", "circle"));
    select.value = current || "circle";
  })
  .catch(() => {});

const STORAGE_KEY = "vsWaypointTool";
const $ = (id) => document.getElementById(id);

let state = { waypoints: [], source: "", destination: "", createdTime: undefined, spawn: undefined };
let selectedId = null; // the highlighted waypoint: a dot clicked on the map, or a table row clicked

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

// Clicking a dot on the map shows that waypoint in the table; clicking a table row opens the map at it.
const map = createWaypointMap($("wpMap"), { onSelect: (w) => select(w, { table: true }), onPick: pickPosition });

// A click on an empty spot: mark it and hand its position (blocks from the world spawn, like the climate form) to the climate section.
function pickPosition({ x, z }) {
  // Without a known spawn, assume the default one: the middle of the world (half the climate form's world size, 512000 for the default 1,024,000).
  const center = (Number($("clSize").value) || 1024000) / 2;
  const spawn = state.spawn ?? { x: center, z: center };
  const relX = Math.round(x - spawn.x), relZ = Math.round(z - spawn.z);
  map.setMarker({ x, z });
  $("wpPick").textContent = `Picked X ${relX}, Z ${relZ}${state.spawn ? " (relative to the world spawn)" : " (relative to the world center)"}; the climate section below now shows that position.`;
  document.dispatchEvent(new CustomEvent("map:pick", { detail: { x: relX, z: relZ } }));
}
// The explored world map (worldMapPage.js) arrives as a background image in world block coordinates.
document.addEventListener("map:background", (e) => map.setBackground(e.detail, state.waypoints.length === 0));

function select(w, { table = false, centerMap = false } = {}) {
  selectedId = w.id;
  if (centerMap) {
    map.focus(w);
    $("wpMap").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  refresh();
  if (table) document.querySelector("#wpTableBody tr.wp-row-selected")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

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

/** Swaps a button's label for a checkmark for a couple of seconds. */
function flashCopied(btn) {
  clearTimeout(btn.copiedTimer);
  btn.textContent = "\u2713 Copied";
  btn.copiedTimer = setTimeout(() => { btn.textContent = "Copy command"; }, 2500);
}

function refresh() {
  const { waypoints } = state;
  if (!waypoints.some((w) => w.id === state.source)) state.source = "";
  if (!waypoints.some((w) => w.id === state.destination)) state.destination = "";

  for (const [id, key] of [["wpSource", "source"], ["wpDest", "destination"], ["wpConnection", null]]) {
    const select = $(id);
    const current = key ? state[key] : select.value;
    select.replaceChildren(new Option(key ? "-- choose --" : "(none)", ""));
    for (const w of waypoints) select.append(new Option(stringifyWayPoint(w, state.spawn), w.id));
    select.value = waypoints.some((w) => w.id === current) ? current : "";
  }

  const path = shortestPath(waypoints, state.source, state.destination);
  const body = $("wpPathBody");
  body.replaceChildren();
  path.forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.append(td(String(i + 1)), td(stringifyWayPoint(s.from, state.spawn)), td(stringifyWayPoint(s.to, state.spawn)), td(s.distance === 0 ? "translocator (0)" : s.distance.toFixed(1)));
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
      button("Center", () => select(w, { centerMap: true })),
      button("Copy command", async (e) => {
        try {
          await navigator.clipboard.writeText(getWaypointCommand(w));
          setStatus(`Copied: ${getWaypointCommand(w)}`);
          flashCopied(e.currentTarget);
        } catch { setStatus(getWaypointCommand(w)); }
      }),
    );
    const linked = waypoints.find((o) => o.id === w.connection);
    tr.className = w.id === selectedId ? "wp-row wp-row-selected" : "wp-row";
    tr.addEventListener("click", (e) => {
      if (!e.target.closest("button, a")) select(w, { centerMap: true });
    });
    tr.append(td(w.label), td(formatCoords(w, state.spawn)), td(linked ? stringifyWayPoint(linked, state.spawn) : ""), td(actions));
    rows.append(tr);
  }
  $("wpCoordsHead").textContent = state.spawn ? "X, Y, Z (relative to spawn)" : "X, Y, Z";
  $("wpEmpty").hidden = waypoints.length > 0;
  map.render({ waypoints, path, sourceId: state.source, destinationId: state.destination, selectedId });
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
  const icon = w?.icon ?? "circle";
  // A waypoint from elsewhere may use an icon this build doesn't list; keep it selectable rather than silently changing it.
  if (![...$("wpIcon").options].some((o) => o.value === icon)) $("wpIcon").append(new Option(icon, icon));
  $("wpIcon").value = icon;
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

// ---- Upload / download ----
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
    const json = JSON.parse(await file.text());
    if (isModData(json)) return loadModData(json);
    modData = null;
    $("wpSaveRow").hidden = true;
    state = { ...state, ...deserializeWayPoints(json) };
    refresh();
    map.fit(state.waypoints);
    setStatus(`Uploaded ${state.waypoints.length} waypoint(s).`);
  } catch (err) {
    setStatus(`Upload failed: ${err.message}`, true);
  }
});
// Nf3tData.json from the mod: pick one savegame (the busiest is preselected) to load as the waypoint list.
let modData = null;
function loadModData(json) {
  const saves = modDataSavegames(json);
  if (!saves.length) throw new Error("This mod data file has no translocators or waypoints in any savegame.");
  modData = json;
  $("wpSave").replaceChildren(...saves.map((s) => new Option(`${s.id} (${s.translocators} translocators, ${s.waypoints} waypoints)`, s.id)));
  $("wpSaveRow").hidden = false;
  applyModSave();
}
function applyModSave() {
  state = { ...state, ...importModData(modData, $("wpSave").value) };
  refresh();
  map.fit(state.waypoints);
  setStatus(`Imported ${state.waypoints.length} point(s) from savegame ${$("wpSave").value}. Replaces the current list.`);
}
$("wpSave").addEventListener("change", applyModSave);
$("wpClear").addEventListener("click", () => {
  if (!$("wpClear").dataset.armed) {
    $("wpClear").dataset.armed = "1";
    $("wpClear").textContent = "Click again to clear all";
    setTimeout(() => { delete $("wpClear").dataset.armed; $("wpClear").textContent = "Clear all"; }, 3000);
    return;
  }
  state = { waypoints: [], source: "", destination: "", createdTime: undefined, spawn: undefined };
  delete $("wpClear").dataset.armed;
  $("wpClear").textContent = "Clear all";
  refresh();
});

load();
refresh();
map.fit(state.waypoints);

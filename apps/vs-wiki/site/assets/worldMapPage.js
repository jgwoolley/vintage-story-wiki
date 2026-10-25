// The "Explored world map" part of site/map/index.njk: reads a `Maps/<savegame id>.db` file in the browser (sql.js, a WebAssembly build of
// SQLite, vendored by eleventy.config.js and loaded only when a file is chosen), draws the explored tiles with worldMap.js and hands the
// image to the waypoint map as a background (waypointsPage.js listens for `map:background`). Nothing is uploaded.
import { readPieces, renderOverview } from "./worldMap.js";

const $ = (id) => document.getElementById(id);
const SQL_BASE = new URL("./vendor/sql.js/", import.meta.url).href;
let sqlPromise = null;
let lastUrl = null;

/** Loads sql.js on first use: a classic script (it defines `initSqlJs`), then the wasm next to it. */
function loadSql() {
  sqlPromise ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement("script"), { src: `${SQL_BASE}sql-wasm.js` });
    script.onload = () => globalThis.initSqlJs({ locateFile: (file) => `${SQL_BASE}${file}` }).then(resolve, reject);
    script.onerror = () => reject(new Error("couldn't load the SQLite reader (sql.js)"));
    document.head.append(script);
  });
  return sqlPromise;
}

function setStatus(message, isError = false) {
  const el = $("wmStatus");
  el.textContent = message;
  el.classList.toggle("schematic-error", isError);
}

async function loadMapFile(file) {
  setStatus(`Reading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)...`);
  try {
    const [SQL, bytes] = await Promise.all([loadSql(), file.arrayBuffer().then((b) => new Uint8Array(b))]);
    const db = new SQL.Database(bytes);
    let pieces;
    try {
      pieces = readPieces(db);
    } finally {
      db.close();
    }
    const overview = renderOverview(pieces, 4096);
    if (!overview) throw new Error("this file has no readable map tiles (is it a Maps/<id>.db file?)");
    const canvas = Object.assign(document.createElement("canvas"), { width: overview.width, height: overview.height });
    canvas.getContext("2d").putImageData(new ImageData(overview.rgba, overview.width, overview.height), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    document.dispatchEvent(new CustomEvent("map:background", {
      detail: { href: lastUrl, x: overview.x, z: overview.z, width: overview.width * overview.blocksPerPixel, height: overview.height * overview.blocksPerPixel },
    }));
    const detail = overview.blocksPerPixel > 1 ? `, drawn at 1/${overview.blocksPerPixel} resolution` : "";
    setStatus(`Drew ${overview.tiles.toLocaleString()} explored tiles (${overview.width * overview.blocksPerPixel}×${overview.height * overview.blocksPerPixel} blocks${detail}) behind the waypoints.`);
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't read the map file: ${err.message}`, true);
  }
}

$("wmFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) loadMapFile(file);
});

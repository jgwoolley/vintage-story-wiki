// Page script for /tools/chisel-shape/ (site/tools/chisel-shape/index.njk): upload a ChiselTools shape file
// (or open a `?shape=&mats=&name=` link) and show the chiseled block it holds. Decoding is
// libs/vs-schematic/src/chiselExport.ts (parsePortfolioXml); drawing is the shared chiselPreview.js.
import { shapeFromParams, shapeToParams } from "./chisel.js";
import { looksLikePortfolio, parsePortfolioXml } from "./chiselExport.js";
import { createChiselPreview } from "./chiselPreview.js";
import { materialsSection } from "./chiselDetails.js";
import { blockColor, loadBlockColors } from "./blockColors.js";

const root = document.getElementById("chiselShape");
const $ = (id) => document.getElementById(id);

let blockColors = null;
let blockNames = {};
const ready = Promise.all([
  loadBlockColors(root.dataset.blockColors).then(({ colors }) => { blockColors = colors; }).catch(() => {}),
  fetch(root.dataset.blockNames).then((r) => (r.ok ? r.json() : {})).then((n) => { blockNames = n; }).catch(() => {}),
]);
// Exact match first, then drop trailing "-state" segments until one matches (same rule as the schematic viewer).
function displayName(code) {
  for (let c = code; c; c = c.includes("-") ? c.slice(0, c.lastIndexOf("-")) : "") {
    if (blockNames[c]) return blockNames[c];
  }
  return code.replace(/^[^:]+:/, "").replace(/-/g, " ");
}

let preview = null;

async function show(shape, name) {
  await ready;
  $("csError").hidden = true;
  $("csResult").hidden = false;
  $("csName").textContent = name || "(unnamed)";
  preview?.dispose();
  preview = createChiselPreview($("csPreview"), shape, (code) => blockColor(code, blockColors));
  const voxelCount = shape.cuboids.reduce((sum, c) => sum + (c.x2 - c.x1) * (c.y2 - c.y1) * (c.z2 - c.z1), 0);
  $("csSummary").textContent = `${shape.cuboids.length} boxes, ${voxelCount} voxels filled (of 4096, counting overlaps twice).`;
  const params = { ...shapeToParams(shape), ...(name && { name }) };
  const find = document.createElement("a");
  find.href = `${root.dataset.searchUrl}?${new URLSearchParams(params)}`;
  find.textContent = "Find this shape in the game's schematics →";
  $("csFind").replaceChildren(find);
  $("csMaterials").replaceChildren(...materialsSection(shape, { colorOf: (code) => blockColor(code, blockColors), nameOf: displayName, itemsUrl: root.dataset.itemsUrl }));
  $("csBoxes").textContent = JSON.stringify(shape.cuboids, null, 1);
  // Keep the shape in the URL so the page can be reloaded or shared.
  window.history.replaceState(null, "", `${location.pathname}?${new URLSearchParams(params)}`);
}

$("csReset").addEventListener("click", () => preview?.resetView());

$("csFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    if (!looksLikePortfolio(text)) throw new Error("this doesn't look like a ChiselTools shape file (no <PantographData>)");
    const { name, shape } = parsePortfolioXml(text);
    await show(shape, name || file.name);
  } catch (err) {
    $("csResult").hidden = true;
    $("csError").textContent = `Couldn't read ${file.name}: ${err.message}`;
    $("csError").hidden = false;
  }
});

const params = new URLSearchParams(location.search);
if (params.get("shape")) {
  try {
    show(shapeFromParams(params.get("shape"), params.get("mats") || ""), params.get("name") || "");
  } catch (err) {
    $("csError").textContent = `Couldn't read the shape in the link: ${err.message}`;
    $("csError").hidden = false;
  }
}

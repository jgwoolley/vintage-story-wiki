// Page script for /tools/schematic-search/ (site/tools/schematic-search/index.njk). The scan itself is
// libs/vs-schematic/src/schematicSearch.ts; this file is the URL params, fetching and results table.
//
// URL params (the item page links here): `code` (bare code, `*` wildcards), `kind` (block|item|any),
// and the search starts on load when `code` is present. The schematic viewer's chiseled-block panel links
// with `shape` + `mats` instead (see shapeToParams in libs/vs-schematic/src/chisel.ts), plus optional
// `anymat=1` (ignore materials) and `nosym=1` (no turned/mirrored copies).
import { fetchGzipText } from "./schematicVoxels.js";
import { hasMatch, matchingRandomizers, mayContain, mayContainChiseled, mayContainShape, scanSchematic, scanSchematicForName, scanSchematicForShape } from "./schematicSearch.js";
import { shapeFromParams, shapeToParams } from "./chisel.js";
import { parsePortfolioXml } from "./chiselExport.js";
import { createChiselPreview } from "./chiselPreview.js";
import { materialsSection } from "./chiselDetails.js";
import { decodeBlockEntity } from "./schematicDecode.js";
import { blockColor, loadBlockColors } from "./blockColors.js";

const root = document.getElementById("schematicSearch");
const $ = (id) => document.getElementById(id);
const els = { form: $("ssForm"), code: $("ssCode"), kind: $("ssKind"), go: $("ssGo"), cancel: $("ssCancel"), status: $("ssStatus"), error: $("ssError"), results: $("ssResults") };
const CONCURRENCY = 6;
const MAX_LISTED_CONTAINERS = 20;

const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.json(); });
let indexPromise = null;
let poolsPromise = null;

let run = 0; // incremented by every search and cancel; a scan stops when its number is stale

const textEl = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
};
const linkEl = (href, text) => Object.assign(document.createElement("a"), { href, textContent: text });
// A chiseled block's name links to a search for blocks with that name.
const nameLink = (name) => linkEl(`${location.pathname}?${new URLSearchParams({ chiselname: name })}`, name);
const itemsLink = (code) => linkEl(`${root.dataset.itemsUrl}?q=${encodeURIComponent(code.replace(/^[^:]+:/, ""))}`, code.replace(/^[^:]+:/, ""));
const pct = (n) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

function resultRow(schematic, match) {
  const row = document.createElement("tr");
  const nameCell = document.createElement("td");
  nameCell.append(linkEl(`${root.dataset.schematicsUrl}${schematic.pagePath}/`, `${schematic.relPath}`), " ");
  const view = linkEl(`${root.dataset.viewerUrl}?schematic=${encodeURIComponent(`${schematic.domain}/${schematic.relPath}`).replace(/%2F/g, "/")}`, "3D");
  view.title = "Open in the schematic viewer";
  nameCell.append(textEl("span", "muted", "["), view, textEl("span", "muted", "]"));

  const placed = textEl("td", "", match.placed ? String(match.placed) : "");
  const chiseled = textEl("td", "", match.chiseled ? String(match.chiseled) : "");

  const containers = document.createElement("td");
  if (match.containers.length) {
    const details = document.createElement("details");
    const total = match.containers.reduce((a, c) => a + c.count, 0);
    details.append(textEl("summary", "", `${match.containers.length} container${match.containers.length === 1 ? "" : "s"}, ${total} total`));
    const list = document.createElement("ul");
    for (const c of match.containers.slice(0, MAX_LISTED_CONTAINERS)) {
      list.append(textEl("li", "", `${c.block.replace(/^[^:]+:/, "")} at X:${c.x} Y:${c.y} Z:${c.z} (x${c.count})`));
    }
    if (match.containers.length > MAX_LISTED_CONTAINERS) list.append(textEl("li", "muted", `... and ${match.containers.length - MAX_LISTED_CONTAINERS} more`));
    details.append(list);
    containers.append(details);
  }

  const possible = document.createElement("td");
  for (const hit of match.possible) {
    const line = document.createElement("div");
    line.append(itemsLink(hit.randomizer), ` x${hit.slots}, ${pct(hit.poolShare)} of its pool`);
    if (hit.totalChances.length) line.append(textEl("span", "muted", ` (totalChance ${[...new Set(hit.totalChances)].join(", ")})`));
    possible.append(line);
  }
  row.append(nameCell, placed, chiseled, containers, possible);
  return row;
}

function tableWithHeaders(headers) {
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const h of headers) head.append(textEl("th", "", h));
  const thead = document.createElement("thead");
  thead.append(head);
  table.append(thead, document.createElement("tbody"));
  return table;
}

// Rows arrive while the scan runs, so keep them all and show one page at a time (a common item can match
// hundreds of schematics). Returns the controls to show above the table and `add(row)`.
const PAGE_SIZE = 50;
function paginate(table) {
  const rows = [];
  let page = 0;
  const tbody = table.tBodies[0];
  const controls = textEl("div", "pager", "");
  const label = textEl("span", "muted", "");
  const button = (text, delta) => {
    const b = textEl("button", "", text);
    b.type = "button";
    b.addEventListener("click", () => { page += delta; render(); });
    return b;
  };
  const prev = button("Previous", -1);
  const next = button("Next", 1);
  controls.append(prev, label, next);
  function render() {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 0), pages - 1);
    tbody.replaceChildren(...rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    label.textContent = ` Page ${page + 1} of ${pages} (${rows.length} schematic${rows.length === 1 ? "" : "s"}) `;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    controls.hidden = rows.length <= PAGE_SIZE;
  }
  render();
  return { controls, add(row) { rows.push(row); render(); } };
}

const resultTable = () => tableWithHeaders(["Schematic", "Placed", "Chiseled from", "In containers", "Possible (random)"]);

// Shared by both kinds of search: start/finish bookkeeping, loading the index, and a bounded-concurrency
// download + scan of the candidate schematics, smallest first. `scan(schematic)` returns a table row or null.
async function runScan({ params, prefilter, table, scan, describeNone }) {
  const mine = ++run;
  els.error.hidden = true;
  els.results.replaceChildren();
  els.go.disabled = true;
  els.cancel.hidden = false;
  window.history.replaceState(null, "", `${location.pathname}?${new URLSearchParams(params)}`);
  try {
    els.status.textContent = "Loading the schematic index...";
    indexPromise ??= json(root.dataset.indexUrl);
    poolsPromise ??= json(root.dataset.poolsUrl);
    const [index, pools] = await Promise.all([indexPromise, poolsPromise]);
    if (mine !== run) return;
    // The code lists are exact as a prefilter, so only these files need downloading.
    const candidates = index.filter((s) => prefilter(s, pools)).sort((a, b) => a.gzBytes - b.gzBytes);
    const bytes = candidates.reduce((a, s) => a + s.gzBytes, 0);
    if (!candidates.length) {
      els.status.textContent = describeNone;
      return;
    }
    const pager = paginate(table);
    els.results.append(pager.controls, table);
    let done = 0, found = 0, failed = 0, skipped = 0;
    const progress = () => {
      els.status.textContent = `Scanned ${done} of ${candidates.length} candidate schematics (${(bytes / 1e6).toFixed(1)} MB compressed; ${index.length} schematics total). ${found} match${found === 1 ? "" : "es"}.`
        + (failed ? ` ${failed} failed to load.` : "") + (skipped ? ` ${skipped} entities couldn't be decoded.` : "");
    };
    progress();
    const queue = [...candidates];
    const worker = async () => {
      for (let s = queue.shift(); s && mine === run; s = queue.shift()) {
        try {
          const schematic = JSON.parse(await fetchGzipText(`${root.dataset.worldBase}${s.domain}/${s.relPath}.json.gz`));
          const { row, skippedEntities } = scan(s, schematic, pools);
          skipped += skippedEntities;
          if (row) {
            found++;
            pager.add(row);
          }
        } catch (err) {
          console.error(s.relPath, err);
          failed++;
        }
        done++;
        if (mine === run) progress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (mine !== run) return;
    progress();
    els.status.textContent += found ? " Done." : " Done: none of them actually contain it.";
  } catch (err) {
    console.error(err);
    els.error.textContent = `Search failed: ${err.message}`;
    els.error.hidden = false;
  } finally {
    if (mine === run) {
      els.go.disabled = false;
      els.cancel.hidden = true;
    }
  }
}

function search(code, kind) {
  hideShapePanel();
  const target = { code, kind };
  let randomizers = null;
  return runScan({
    params: { code, kind },
    prefilter: (s, pools) => mayContain(s.blockCodes, s.itemCodes, target, (randomizers ??= matchingRandomizers(target, pools))),
    table: resultTable(),
    scan: (s, schematic) => {
      const match = scanSchematic(schematic, target, randomizers);
      return { row: hasMatch(match) ? resultRow(s, match) : null, skippedEntities: match.skippedEntities };
    },
    describeNone: `No schematic's block or item list mentions "${code}" or a random placeholder that can produce it.`,
  });
}

// ---- chiseled shape search ----

let blockNames = {};
fetch(root.dataset.blockNames).then((r) => (r.ok ? r.json() : {})).then((n) => { blockNames = n; }).catch(() => {});
// Exact match first, then drop trailing "-state" segments until one matches (same rule as the schematic viewer).
function displayName(code) {
  for (let c = code; c; c = c.includes("-") ? c.slice(0, c.lastIndexOf("-")) : "") {
    if (blockNames[c]) return blockNames[c];
  }
  return code.replace(/^[^:]+:/, "").replace(/-/g, " ");
}

let blockColors = null;
loadBlockColors(root.dataset.blockColors).then(({ colors }) => { blockColors = colors; }).catch(() => {});
let shapePreview = null;
let currentShape = null;

function hideShapePanel() {
  $("ssShape").hidden = true;
  shapePreview?.dispose();
  shapePreview = null;
}

function shapeRow(s, hits) {
  const row = document.createElement("tr");
  const nameCell = document.createElement("td");
  nameCell.append(linkEl(`${root.dataset.schematicsUrl}${s.pagePath}/`, s.relPath));
  const counts = new Map();
  for (const h of hits) counts.set(h.orientation, (counts.get(h.orientation) || 0) + 1);
  const orientations = textEl("td", "", [...counts].map(([label, n]) => `${label} x${n}`).join("; "));
  const where = document.createElement("td");
  const details = document.createElement("details");
  details.append(textEl("summary", "", "Show in viewer"));
  const list = document.createElement("ul");
  for (const h of hits.slice(0, MAX_LISTED_CONTAINERS)) {
    const item = document.createElement("li");
    const schematic = encodeURIComponent(`${s.domain}/${s.relPath}`).replace(/%2F/g, "/");
    item.append(linkEl(`${root.dataset.viewerUrl}?schematic=${schematic}&select=${h.x},${h.y},${h.z}`, `X:${h.x} Y:${h.y} Z:${h.z}`), ` (${h.orientation}`);
    if (h.name) item.append(", ", nameLink(h.name));
    item.append(")");
    list.append(item);
  }
  if (hits.length > MAX_LISTED_CONTAINERS) list.append(textEl("li", "muted", `... and ${hits.length - MAX_LISTED_CONTAINERS} more`));
  details.append(list);
  where.append(details);
  row.append(nameCell, textEl("td", "", String(hits.length)), orientations, where);
  return row;
}

// The block's decoded entity data, like the schematic viewer's block panel: fetched from the schematic the link came from.
async function showOriginMetadata(container, origin, shape) {
  try {
    const [x, y, z] = origin.at.split(",").map(Number);
    const schematic = JSON.parse(await fetchGzipText(`${root.dataset.worldBase}${origin.schematic}.json.gz`));
    const entity = schematic.BlockEntities?.[x | (z << 10) | (y << 20)];
    const ascii = typeof entity === "string" ? entity : entity?.Data || entity?.Attributes;
    if (!ascii || currentShape?.shape !== shape) return;
    const json = JSON.stringify(decodeBlockEntity(ascii), (k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    const details = document.createElement("details");
    details.open = true;
    details.append(textEl("summary", "trait", "Entity data:"), textEl("pre", "schematic-json", json));
    container.append(details);
  } catch (err) {
    console.error(err);
    container.append(textEl("p", "muted", `Couldn't load the block's entity data: ${err.message}`));
  }
}

function searchShape(shape, name, origin = null) {
  currentShape = { shape, name, origin };
  const options = { materials: $("ssSameMaterials").checked ? "same" : "any", symmetries: $("ssSymmetries").checked };
  // The origin goes into the URL too, so reloading or sharing the page keeps the block details.
  const params = {
    ...shapeToParams(shape),
    ...(shape.name && { name: shape.name }),
    ...(origin?.block && { block: origin.block }),
    ...(origin?.at && { at: origin.at }),
    ...(origin?.schematic && { schematic: origin.schematic }),
    ...(options.materials === "any" && { anymat: 1 }),
    ...(!options.symmetries && { nosym: 1 }),
  };
  $("ssShape").hidden = false;
  $("ssShapeName").textContent = name || "(unnamed)";
  $("ssShapeSummary").textContent = "";
  const details = $("ssShapeDetails");
  details.replaceChildren();
  const trait = (label, value, href) => {
    const row = textEl("div", "trait", "");
    const content = href ? linkEl(href, value) : value;
    row.append(textEl("b", "", label), document.createElement("br"), content);
    details.append(row);
  };
  if (shape.name) trait("Name:", shape.name, `${location.pathname}?${new URLSearchParams({ chiselname: shape.name })}`);
  if (origin?.block) {
    trait("Block:", displayName(origin.block), `${root.dataset.itemsUrl}?q=${encodeURIComponent(origin.block.replace(/^[^:]+:/, ""))}`);
    trait("Code:", origin.block);
  }
  if (origin?.at) trait("Position:", origin.at.split(",").map((n, i) => `${"XYZ"[i]}:${n}`).join(", "));
  if (origin?.schematic) {
    const [x, y, z] = (origin.at || "").split(",");
    const select = origin.at ? `&select=${x},${y},${z}` : "";
    trait("Schematic:", origin.schematic.split("/").slice(1).join("/"), `${root.dataset.viewerUrl}?schematic=${origin.schematic}${select}`);
  }
  const metadata = document.createElement("div");
  details.append(...materialsSection(shape, { colorOf: (code) => blockColor(code, blockColors), nameOf: displayName, itemsUrl: root.dataset.itemsUrl }), metadata);
  if (origin?.schematic && origin.at) showOriginMetadata(metadata, origin, shape);
  shapePreview?.dispose();
  shapePreview = createChiselPreview($("ssShapePreview"), shape, (code) => blockColor(code, blockColors));
  const query = { shape, options };
  const table = tableWithHeaders(["Schematic", "Matching blocks", "Orientation", "Where"]);
  return runScan({
    params,
    prefilter: (s) => mayContainShape(s.blockCodes, query),
    table,
    scan: (s, schematic) => {
      const { hits, skippedEntities } = scanSchematicForShape(schematic, query);
      return { row: hits.length ? shapeRow(s, hits) : null, skippedEntities };
    },
    describeNone: "No schematic places chiseled blocks made of these materials.",
  });
}

for (const id of ["ssSameMaterials", "ssSymmetries"]) {
  $(id).addEventListener("change", () => currentShape && searchShape(currentShape.shape, currentShape.name, currentShape.origin));
}
$("ssShapeReset").addEventListener("click", () => shapePreview?.resetView());

// ---- chiseled block name search ----

function nameRow(s, hits) {
  const row = document.createElement("tr");
  const nameCell = document.createElement("td");
  nameCell.append(linkEl(`${root.dataset.schematicsUrl}${s.pagePath}/`, s.relPath));
  const counts = new Map();
  for (const h of hits) counts.set(h.name, (counts.get(h.name) || 0) + 1);
  const where = document.createElement("td");
  const details = document.createElement("details");
  details.append(textEl("summary", "", "Show in viewer"));
  const list = document.createElement("ul");
  for (const h of hits.slice(0, MAX_LISTED_CONTAINERS)) {
    const item = document.createElement("li");
    const schematic = encodeURIComponent(`${s.domain}/${s.relPath}`).replace(/%2F/g, "/");
    item.append(linkEl(`${root.dataset.viewerUrl}?schematic=${schematic}&select=${h.x},${h.y},${h.z}`, `X:${h.x} Y:${h.y} Z:${h.z}`), " (", nameLink(h.name), ")");
    list.append(item);
  }
  if (hits.length > MAX_LISTED_CONTAINERS) list.append(textEl("li", "muted", `... and ${hits.length - MAX_LISTED_CONTAINERS} more`));
  details.append(list);
  where.append(details);
  const names = document.createElement("td");
  [...counts].forEach(([n, c], i) => names.append(...(i ? ["; "] : []), nameLink(n), ` x${c}`));
  row.append(nameCell, textEl("td", "", String(hits.length)), names, where);
  return row;
}

function searchName(pattern) {
  hideShapePanel();
  currentShape = null;
  return runScan({
    params: { chiselname: pattern },
    prefilter: (s) => mayContainChiseled(s.blockCodes),
    table: tableWithHeaders(["Schematic", "Matching blocks", "Names", "Where"]),
    scan: (s, schematic) => {
      const { hits, skippedEntities } = scanSchematicForName(schematic, pattern);
      return { row: hits.length ? nameRow(s, hits) : null, skippedEntities };
    },
    describeNone: "No schematic places chiseled blocks.",
  });
}

$("ssNameForm").addEventListener("submit", () => {
  const pattern = $("ssChiselName").value.trim();
  if (pattern) searchName(pattern);
});

$("ssShapeFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const { name, shape } = parsePortfolioXml(await file.text());
    searchShape(shape, name || file.name, null);
  } catch (err) {
    els.error.textContent = `Couldn't read ${file.name}: ${err.message}`;
    els.error.hidden = false;
  }
});

els.form.addEventListener("submit", () => {
  const code = els.code.value.trim();
  if (code) search(code, els.kind.value);
});
els.cancel.addEventListener("click", () => {
  run++;
  els.go.disabled = false;
  els.cancel.hidden = true;
  els.status.textContent += " Cancelled.";
});

const params = new URLSearchParams(location.search);
if (params.get("shape")) {
  $("ssSameMaterials").checked = !params.get("anymat");
  $("ssSymmetries").checked = !params.get("nosym");
  try {
    const shape = shapeFromParams(params.get("shape"), params.get("mats") || "");
    shape.name = params.get("name") || undefined;
    const schematic = params.get("schematic");
    const validSchematic = schematic && /^[\w.-]+(\/[\w. +()-]+)+$/.test(schematic) && !schematic.includes("..") ? schematic : null;
    searchShape(shape, shape.name || "from the schematic viewer", { block: params.get("block"), at: /^\d+,\d+,\d+$/.test(params.get("at") || "") ? params.get("at") : null, schematic: validSchematic });
  } catch (err) {
    els.error.textContent = `Couldn't read the shape in the link: ${err.message}`;
    els.error.hidden = false;
  }
} else if (params.get("chiselname")) {
  $("ssChiselName").value = params.get("chiselname");
  searchName(params.get("chiselname"));
} else if (params.get("code")) {
  els.code.value = params.get("code");
  els.kind.value = ["block", "item", "any"].includes(params.get("kind")) ? params.get("kind") : "any";
  search(els.code.value.trim(), els.kind.value);
}

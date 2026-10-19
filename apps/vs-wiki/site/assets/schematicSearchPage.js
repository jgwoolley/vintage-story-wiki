// Page script for /tools/schematic-search/ (site/tools/schematic-search/index.njk). The scan itself is
// libs/vs-schematic/src/schematicSearch.ts; this file is the URL params, fetching and results table.
//
// URL params (the item page links here): `code` (bare code, `*` wildcards), `kind` (block|item|any),
// and the search starts on load when `code` is present.
import { fetchGzipText } from "./schematicVoxels.js";
import { hasMatch, matchingRandomizers, mayContain, scanSchematic } from "./schematicSearch.js";

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

function resultTable() {
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const h of ["Schematic", "Placed", "Chiseled from", "In containers", "Possible (random)"]) head.append(textEl("th", "", h));
  table.append(document.createElement("thead")).append(head);
  table.append(document.createElement("tbody"));
  return table;
}

async function search(code, kind) {
  const mine = ++run;
  els.error.hidden = true;
  els.results.replaceChildren();
  els.go.disabled = true;
  els.cancel.hidden = false;
  const target = { code, kind };
  const history = new URLSearchParams({ code, kind });
  window.history.replaceState(null, "", `${location.pathname}?${history}`);
  try {
    els.status.textContent = "Loading the schematic index...";
    indexPromise ??= json(root.dataset.indexUrl);
    poolsPromise ??= json(root.dataset.poolsUrl);
    const [index, pools] = await Promise.all([indexPromise, poolsPromise]);
    if (mine !== run) return;
    const randomizers = matchingRandomizers(target, pools);
    // The code lists are exact as a prefilter, so only these files need downloading.
    const candidates = index.filter((s) => mayContain(s.blockCodes, s.itemCodes, target, randomizers)).sort((a, b) => a.gzBytes - b.gzBytes);
    const bytes = candidates.reduce((a, s) => a + s.gzBytes, 0);
    if (!candidates.length) {
      els.status.textContent = `No schematic's block or item list mentions "${code}"${randomizers.size ? "" : " or a random placeholder that can produce it"}.`;
      return;
    }
    const table = resultTable();
    const tbody = table.tBodies[0];
    els.results.append(table);
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
          const match = scanSchematic(schematic, target, randomizers);
          skipped += match.skippedEntities;
          if (hasMatch(match)) {
            found++;
            tbody.append(resultRow(s, match));
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
if (params.get("code")) {
  els.code.value = params.get("code");
  els.kind.value = ["block", "item", "any"].includes(params.get("kind")) ? params.get("kind") : "any";
  search(els.code.value.trim(), els.kind.value);
}

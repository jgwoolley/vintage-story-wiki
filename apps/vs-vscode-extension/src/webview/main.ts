// The preview webview: a VS Code-flavoured counterpart of the wiki's schematic viewer
// (apps/vs-wiki/site/assets/schematicViewer.js), built on the same vs-schematic package. The host
// (src/extension.ts) sends the schematic's JSON text; everything else happens here.
import { decodeBlockEntity } from "vs-schematic/schematicDecode.js";
import {
  assertSchematic,
  isHiddenByDefault,
  stringToColor,
  toVoxels,
  type SchematicJson,
  type Voxel,
} from "vs-schematic/schematicVoxels.js";
import { createVoxelViewer, type VoxelViewer } from "vs-schematic/voxelViewer.js";
import { materialVolumes, type ChiselShape } from "vs-schematic/chisel.js";
import { looksLikePortfolio, parsePortfolioXml } from "vs-schematic/chiselExport.js";
import { createChiselPreview } from "vs-schematic/chiselPreview.js";
import type { HostMessage, WebviewMessage } from "../protocol.js";
import "./style.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const els = {
  viewport: $("viewport"),
  legend: $("legend"),
  summary: $("summary"),
  error: $("error"),
  search: $<HTMLInputElement>("search"),
  showFiller: $<HTMLInputElement>("showFiller"),
  maxY: $<HTMLInputElement>("maxY"),
  maxYValue: $("maxYValue"),
  inspector: $("inspector"),
  traits: $("traits"),
};

interface BlockMeta {
  color: string;
  visible: boolean;
  count: number;
}

const HIGHLIGHT = "#00ffff";

// Either the schematic voxel viewer or a chiseled shape preview (a ChiselTools shape file); both only need dispose/resetView.
let viewer: VoxelViewer<Voxel> | null = null;
let shapeViewer: { dispose(): void; resetView(): void } | null = null;
let data: SchematicJson | null = null;
let voxels: Voxel[] = [];
let blockMeta = new Map<string, BlockMeta>();
let selectedIndex = -1;
let searchQuery = "";

function showError(message: string): void {
  els.error.textContent = message;
  els.error.hidden = !message;
}

/** `game:rock-granite` -> `rock granite`: the code minus its domain, hyphens as spaces. */
function displayName(code: string): string {
  return code.replace(/^[^:]+:/, "").replace(/-/g, " ");
}

function restyle(): void {
  const maxY = Number(els.maxY.value);
  viewer?.setStyle((voxel, index) => {
    const meta = blockMeta.get(voxel.code)!;
    if (!meta.visible || voxel.y > maxY) return null;
    return index === selectedIndex ? { color: HIGHLIGHT } : { color: meta.color };
  });
}

function textEl(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function renderLegend(): void {
  els.legend.replaceChildren();
  const entries = [...blockMeta.entries()]
    .filter(([code]) => code.toLowerCase().includes(searchQuery) || displayName(code).toLowerCase().includes(searchQuery))
    .sort((a, b) => b[1].count - a[1].count);
  for (const [code, meta] of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `legend-item${meta.visible ? "" : " hidden-block"}`;
    item.setAttribute("aria-pressed", String(meta.visible));
    item.title = code;
    const swatch = textEl("span", "color-box", "");
    swatch.style.background = meta.color;
    item.append(swatch, textEl("span", "block-name", displayName(code)), textEl("span", "block-count", `x${meta.count}`));
    item.addEventListener("click", () => {
      meta.visible = !meta.visible;
      restyle();
      renderLegend();
    });
    els.legend.append(item);
  }
}

function setAllVisible(visible: boolean): void {
  blockMeta.forEach((meta) => (meta.visible = visible));
  restyle();
  renderLegend();
}

function closeInspector(): void {
  els.inspector.hidden = true;
  selectedIndex = -1;
  restyle();
}

function showInspector(voxel: Voxel): void {
  els.traits.replaceChildren();
  const trait = (label: string, value: string) => {
    const row = textEl("div", "trait", "");
    row.append(textEl("b", "", label), document.createElement("br"), value);
    els.traits.append(row);
  };
  trait("Block:", displayName(voxel.code));
  trait("Code:", voxel.code);
  trait("Position:", `X:${voxel.x}, Y:${voxel.y}, Z:${voxel.z}`);
  // BlockEntities values are Ascii85 TreeAttribute blobs keyed by the voxel's packed index.
  const entity: unknown = data?.BlockEntities?.[voxel.packed];
  const ascii = typeof entity === "string" ? entity : undefined;
  if (ascii) {
    try {
      els.traits.append(textEl("div", "trait", "Entity data:"), textEl("pre", "", JSON.stringify(decodeBlockEntity(ascii), null, 2)));
    } catch (err) {
      els.traits.append(textEl("div", "trait", `Error parsing entity data: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  els.inspector.hidden = false;
}

/** A ChiselTools shape file (`.pf save`): draw the chiseled block's boxes, and list its materials with their share of the 4096 voxels. */
function loadShape(name: string, shape: ChiselShape): void {
  showError("");
  data = null;
  voxels = [];
  blockMeta = new Map();
  selectedIndex = -1;
  els.inspector.hidden = true;
  els.maxY.disabled = true;
  els.maxYValue.textContent = "";
  els.showFiller.checked = false;
  const volumes = materialVolumes(shape);
  els.summary.textContent = `${name}: chiseled block, ${shape.cuboids.length} boxes, ${volumes.reduce((a, b) => a + b, 0)} of 4096 voxels`;
  els.legend.replaceChildren();
  shape.materials.forEach((code, i) => {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.title = code;
    const swatch = textEl("span", "color-box", "");
    swatch.style.background = stringToColor(code);
    row.append(swatch, textEl("span", "block-name", displayName(code)), textEl("span", "block-count", `${volumes[i]} voxels`));
    els.legend.append(row);
  });
  viewer?.dispose();
  viewer = null;
  shapeViewer?.dispose();
  shapeViewer = createChiselPreview(els.viewport, shape, stringToColor);
  if (!shapeViewer) showError("WebGL isn't available in this webview, so the 3D view can't be shown.");
}

function load(name: string, text: string): void {
  if (looksLikePortfolio(text)) {
    try {
      loadShape(name, parsePortfolioXml(text).shape);
    } catch (err) {
      showError(`${name} isn't a readable ChiselTools shape file: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  shapeViewer?.dispose();
  shapeViewer = null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    assertSchematic(parsed);
  } catch (err) {
    showError(`${name} isn't a Vintage Story schematic: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  showError("");
  data = parsed;
  voxels = toVoxels(parsed);
  blockMeta = new Map();
  for (const voxel of voxels) {
    let meta = blockMeta.get(voxel.code);
    if (!meta) blockMeta.set(voxel.code, (meta = { color: stringToColor(voxel.code), visible: !isHiddenByDefault(voxel.code), count: 0 }));
    meta.count++;
  }
  els.showFiller.checked = [...blockMeta].some(([code, meta]) => isHiddenByDefault(code) && meta.visible);
  const maxY = voxels.reduce((max, v) => Math.max(max, v.y), 0);
  // max before value: a range input clamps a value set above its current max (it starts at 0).
  els.maxY.max = String(maxY);
  els.maxY.value = String(maxY);
  els.maxY.disabled = !voxels.length;
  els.maxYValue.textContent = String(maxY);
  selectedIndex = -1;
  els.inspector.hidden = true;
  els.summary.textContent = `${name}: ${voxels.length.toLocaleString()} blocks, ${blockMeta.size} kinds`;

  viewer?.dispose();
  viewer = createVoxelViewer(els.viewport, { voxels, label: `3D view of ${name}` });
  if (!viewer) showError("WebGL isn't available in this webview, so the 3D view can't be shown.");
  restyle();
  renderLegend();
}

$("resetView").addEventListener("click", () => (shapeViewer ?? viewer)?.resetView());
$("showAll").addEventListener("click", () => setAllVisible(true));
$("hideAll").addEventListener("click", () => setAllVisible(false));
$("closeInspector").addEventListener("click", closeInspector);
els.search.addEventListener("input", () => {
  searchQuery = els.search.value.trim().toLowerCase();
  renderLegend();
});
els.showFiller.addEventListener("change", () => {
  for (const [code, meta] of blockMeta) if (isHiddenByDefault(code)) meta.visible = els.showFiller.checked;
  restyle();
  renderLegend();
});
els.maxY.addEventListener("input", () => {
  els.maxYValue.textContent = els.maxY.value;
  restyle();
});

// A click that isn't a drag: OrbitControls doesn't stop the click, so tell the two apart by distance.
let down: [number, number] | null = null;
els.viewport.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
els.viewport.addEventListener("pointerup", (e) => {
  if (!viewer || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const hit = viewer.pick(e.clientX, e.clientY);
  if (!hit) return closeInspector();
  selectedIndex = hit.index;
  restyle();
  showInspector(hit.voxel);
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "schematic") load(message.name, message.text);
  else if (message.type === "error") showError(message.message);
});

vscode.postMessage({ type: "ready" });

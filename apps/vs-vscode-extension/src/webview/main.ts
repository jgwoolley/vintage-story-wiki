// The preview webview: a VS Code-flavoured counterpart of the wiki's schematic viewer
// (apps/vs-wiki/site/assets/schematicViewer.js), built on the same vs-schematic package. The host
// (src/extension.ts) sends the schematic's JSON text; everything else happens here.
import { decodeBlockEntity } from "@nf3t/vs-schematic/schematicDecode.js";
import {
  assertSchematic,
  isHiddenByDefault,
  stringToColor,
  toVoxels,
  type SchematicJson,
  type Voxel,
} from "@nf3t/vs-schematic/schematicVoxels.js";
import { createVoxelViewer, type VoxelViewer } from "@nf3t/vs-schematic/voxelViewer.js";
import { materialVolumes, type ChiselShape } from "@nf3t/vs-schematic/chisel.js";
import { looksLikePortfolio, parsePortfolioXml } from "@nf3t/vs-schematic/chiselExport.js";
import { createChiselPreview } from "@nf3t/vs-schematic/chiselPreview.js";
import { createModelPreview, type ModelPreview } from "@nf3t/vs-schematic/modelPreview.js";
import { attachToBase, compactShape, looksLikeShape, shapeToBoxes } from "@nf3t/vs-schematic/shapeBoxes.js";
import type { HostMessage, ModelTextures, WebviewMessage } from "../protocol.js";
import type { ViewerSettings } from "@nf3t/vs-schematic/viewerSettings.js";
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
  fillerBox: $("fillerBox"),
  maxYBox: $("maxYBox"),
  sideActions: $("sideActions"),
  maxY: $<HTMLInputElement>("maxY"),
  maxYValue: $("maxYValue"),
  inspector: $("inspector"),
  traits: $("traits"),
  floorBox: $("floorBox"),
  floor: $<HTMLInputElement>("floor"),
  animBox: $("animBox"),
  anim: $<HTMLSelectElement>("anim"),
};

interface BlockMeta {
  color: string;
  visible: boolean;
  count: number;
}

const HIGHLIGHT = "#00ffff";

// The vsSchematic.showCenterMarker / showGrid settings, pushed by the host (src/extension.ts).
let settings: ViewerSettings = { centerMarker: false, grid: false };

// Either the schematic voxel viewer or a chiseled shape preview (a ChiselTools shape file); both only need dispose/resetView.
let viewer: VoxelViewer<Voxel> | null = null;
let shapeViewer: { dispose(): void; resetView(): void; setSettings(settings: ViewerSettings): void } | null = null;
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

/** What the open file is; each kind shows only the controls that mean something for it. */
type Mode = "schematic" | "model" | "chisel";

/**
 * Shows the toolbar and side-panel controls of one kind of file and hides the rest: meta-filler, the Y slider, and the block filter and
 * show/hide buttons are for a schematic's many block kinds (a model's textures and a chiseled block's materials are only listed, and
 * hiding one makes no sense); the animation picker and floor switch are a model's (shown by `loadModel` once it knows it has them).
 */
function setMode(mode: Mode): void {
  const schematic = mode === "schematic";
  els.fillerBox.hidden = els.maxYBox.hidden = els.search.hidden = els.sideActions.hidden = !schematic;
  els.animBox.hidden = els.floorBox.hidden = true;
}

/** Forgets the loaded schematic and disables its controls, for the previews that aren't one (chisel shapes, models). */
function clearSchematicState(mode: Mode): void {
  setMode(mode);
  showError("");
  data = null;
  voxels = [];
  blockMeta = new Map();
  selectedIndex = -1;
  els.inspector.hidden = true;
  els.maxY.disabled = true;
  els.maxYValue.textContent = "";
  els.showFiller.checked = false;
}

/** Decodes a texture PNG (a data: URL from the host) for the 3D view. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable texture"));
    image.src = url;
  });
}

/**
 * A Vintage Story model (shape) file: an item, creature or block model. Faces are drawn with their real textures when the host found
 * them (the model's own assets tree or the game folder); a texture key without one is drawn in a color. The legend lists the texture keys.
 */
async function loadModel(name: string, raw: unknown, bodyText: string | undefined, textures: ModelTextures | undefined, current: () => boolean): Promise<void> {
  const images: Record<string, HTMLImageElement> = {};
  await Promise.all(Object.entries(textures?.images ?? {}).map(async ([key, url]) => {
    try {
      images[key] = await loadImage(url);
    } catch {
      // an unreadable PNG: that key stays colored
    }
  }));
  if (!current()) return; // the file was reloaded while the images decoded
  const textured = Object.keys(images).length > 0;
  clearSchematicState("model");
  let shape = compactShape(raw, { faces: textured });
  let placed = "";
  if (shape.elements.some((e) => e.stepParent)) {
    // A worn item: its pieces name a bone of the player body, so they need the body file to be placed.
    if (bodyText) {
      try {
        shape = attachToBase(shape, compactShape(JSON.parse(bodyText)));
        placed = ", placed on the player body";
      } catch {
        placed = ", the player body file couldn't be read so pieces are unplaced";
      }
    } else {
      placed = ", pieces unplaced (the player body model seraph-faceless.json wasn't found under a shapes folder)";
    }
  }
  const boxes = shapeToBoxes(shape);
  els.summary.textContent = `${name}: model, ${boxes.length} boxes${placed}`;
  els.legend.replaceChildren();
  const perTexture = new Map<string, number>();
  for (const box of boxes) perTexture.set(box.texture ?? "", (perTexture.get(box.texture ?? "") ?? 0) + 1);
  for (const [texture, count] of [...perTexture].sort((a, b) => b[1] - a[1])) {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.title = `texture #${texture}`;
    const swatch = textEl("span", "color-box", "");
    swatch.style.background = stringToColor(texture);
    const image = images[texture] ? textures?.images[texture] : undefined;
    if (image) {
      // The real texture as the swatch, as it is drawn on the model.
      swatch.classList.add("texture-box");
      swatch.style.backgroundImage = `url("${image}")`;
    }
    row.append(swatch, textEl("span", "block-name", texture || "(none)"), textEl("span", "block-count", `${count} boxes`));
    els.legend.append(row);
  }
  els.legend.append(textureStatus(textures));
  viewer?.dispose();
  viewer = null;
  shapeViewer?.dispose();
  const model: ModelPreview | null = createModelPreview(els.viewport, shape, `3D view of ${name}`, settings, textured ? { textures: images } : {});
  shapeViewer = model;
  if (model?.animations.length) {
    // "Rest pose" plus each animation of the model, played in a loop.
    els.anim.replaceChildren(new Option("Rest pose", ""), ...model.animations.map((a) => new Option(a.name, a.code)));
    els.anim.onchange = () => model.playAnimation(els.anim.value || null);
    els.animBox.hidden = false;
  }
  if (model) {
    // The floor (a one-block grid at ground level) helps judge where a model sits.
    els.floor.checked = false;
    els.floor.onchange = () => model.setFloor(els.floor.checked);
    els.floorBox.hidden = false;
  }
  if (!shapeViewer) showError(boxes.length ? "WebGL isn't available in this webview, so the 3D view can't be shown." : `${name} has no boxes to draw.`);
}

/** A line under a model's legend: where its textures came from, or why some are missing, with a button to choose the game folder. */
function textureStatus(textures: ModelTextures | undefined): HTMLElement {
  const box = textEl("div", "texture-status", "");
  if (!textures) return box;
  const found = Object.keys(textures.images).length;
  const total = found + textures.missing.length;
  if (!total) {
    box.textContent = "The model lists no textures (its item or block type supplies them).";
    return box;
  }
  const where = textures.gameFolder ? ` (game folder: ${textures.gameFolder})` : "";
  box.append(textEl("div", "", `Textures: ${found} of ${total} found${where}.`));
  if (textures.missing.length) {
    box.title = textures.missing.map((m) => `#${m.key}: ${m.ref}`).join("\n");
    box.append(textEl("div", "", `Missing: ${textures.missing.map((m) => m.ref).join(", ")}`));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = textures.gameFolder ? "Choose another game folder" : "Choose game folder";
    button.addEventListener("click", () => vscode.postMessage({ type: "selectGameFolder" }));
    box.append(button);
  }
  return box;
}

/** A ChiselTools shape file (`.pf save`): draw the chiseled block's boxes, and list its materials with their share of the 4096 voxels. */
function loadShape(name: string, shape: ChiselShape): void {
  clearSchematicState("chisel");
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
  shapeViewer = createChiselPreview(els.viewport, shape, stringToColor, settings);
  if (!shapeViewer) showError("WebGL isn't available in this webview, so the 3D view can't be shown.");
}

/** Counts loads, so a model still decoding its textures gives way to a newer load of the file. */
let loadId = 0;

function load(name: string, text: string, body?: string, textures?: ModelTextures): void {
  const id = ++loadId;
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
    if (looksLikeShape(parsed)) {
      void loadModel(name, parsed, body, textures, () => id === loadId).catch((err) => showError(`${name} couldn't be shown: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    assertSchematic(parsed);
  } catch (err) {
    showError(`${name} isn't a Vintage Story schematic or model: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  setMode("schematic");
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
  viewer = createVoxelViewer(els.viewport, { voxels, label: `3D view of ${name}`, settings });
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
  // The extension host's messages are relayed by VS Code's own webview frame, which shares this page's
  // vscode-webview:// origin; anything else (e.g. a frame the previewed content could open) is ignored.
  if (event.origin !== window.origin) return;
  const message = event.data;
  if (message.type === "schematic") load(message.name, message.text, message.body, message.textures);
  else if (message.type === "error") showError(message.message);
  else if (message.type === "settings") {
    settings = { centerMarker: message.centerMarker, grid: message.grid };
    viewer?.setSettings(settings);
    shapeViewer?.setSettings(settings);
  }
});

vscode.postMessage({ type: "ready" });

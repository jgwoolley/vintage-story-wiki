// The browser half of the renderer: the CLI loads dist/page.js into a blank headless page, calls one of the window.load* functions
// per file and view, and screenshots the result. Each is a thin adapter on the shared viewers, exactly as the wiki and the VS Code
// extension draw: models through createModelPreview (textured when the CLI found the images, with showFrame for animation stills),
// schematics through createVoxelViewer (boxes prepared by the CLI's src/inputs.ts, chiseled blocks already cut into cuboids) and
// ChiselTools shapes through createChiselPreview. Plus a title and a legend.
import { createChiselPreview } from "vs-schematic/chiselPreview.js";
import { createModelPreview, type ModelPreview } from "vs-schematic/modelPreview.js";
import { stringToColor } from "vs-schematic/schematicVoxels.js";
import { attachToBase, compactShape, shapeToBoxes } from "vs-schematic/shapeBoxes.js";
import { createVoxelViewer, type VoxelViewer } from "vs-schematic/voxelViewer.js";
import type { PageApi } from "../protocol.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Window extends PageApi {}
}

type Drawn = { render(): void; dispose(): void; setFloor(visible: boolean, cell?: number): void };
let current: Drawn | null = null;
let model: ModelPreview | null = null;
let baseTitle = "";
const imageCache = new Map<string, HTMLImageElement>();

async function loadImage(url: string): Promise<HTMLImageElement> {
  let image = imageCache.get(url);
  if (!image) {
    image = new Image();
    image.src = url;
    await image.decode();
    imageCache.set(url, image);
  }
  return image;
}

/** Clears the page and lays out the title, the viewport and an empty legend. */
function reset(title: string): { viewport: HTMLElement; legend: HTMLElement } {
  current?.dispose();
  current = null;
  model = null;
  baseTitle = title;
  document.body.innerHTML = "";
  const heading = document.createElement("div");
  heading.id = "title";
  heading.textContent = title;
  const viewport = document.createElement("div");
  viewport.id = "viewport";
  const legend = document.createElement("ul");
  legend.id = "legend";
  document.body.append(heading, viewport, legend);
  return { viewport, legend };
}

function legendRow(legend: HTMLElement, label: string, color: string, image?: string, note = ""): void {
  const item = document.createElement("li");
  const swatch = document.createElement("span");
  if (image) {
    swatch.style.backgroundImage = `url("${image}")`;
    swatch.className = "texture";
  } else {
    swatch.style.background = color;
  }
  item.append(swatch, label, note);
  legend.append(item);
}

window.loadModel = async (raw, viewDirection, { floor, title, textures, body }) => {
  const { viewport, legend } = reset(title);
  const textured = Object.keys(textures).length > 0;
  let shape = compactShape(raw, { faces: textured });
  let placedOnBody = false;
  if (body && shape.elements.some((e) => e.stepParent)) {
    shape = attachToBase(shape, compactShape(body));
    placedOnBody = true;
  }
  const boxes = shapeToBoxes(shape);
  const keys = [...new Set(boxes.map((b) => b.texture ?? ""))].sort();
  const images: Record<string, HTMLImageElement> = {};
  for (const [key, url] of Object.entries(textures)) {
    try {
      images[key] = await loadImage(url);
    } catch {
      // an unreadable PNG: that key stays colored
    }
  }
  const drawnTextured = keys.filter((k) => images[k]);
  const animations = (shape.animations ?? []).map((a) => ({ code: a.code, name: a.name ?? a.code, frames: a.frames }));
  const result = { boxes: boxes.length, textures: keys, textured: drawnTextured, animations, placedOnBody };
  if (!boxes.length) return { error: "the shape has no boxes to draw", ...result };

  model = createModelPreview(viewport, shape, title, { centerMarker: false, grid: false }, { viewDirection, textures: textured ? images : undefined });
  if (!model) return { error: "WebGL is unavailable", ...result };
  current = model;
  model.setFloor(floor);
  for (const key of keys) {
    legendRow(legend, key || "(no texture)", stringToColor(key), images[key] ? textures[key] : undefined, textured && !images[key] ? " (no texture found)" : "");
  }
  return { error: null, ...result };
};

window.loadSchematic = ({ boxes, colors, legend: rows }, viewDirection, { floor, title }) => {
  const { viewport, legend } = reset(title);
  if (!boxes.length) return { error: "the schematic has no blocks to draw" };
  const voxels = boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, sx: b.sx, sy: b.sy, sz: b.sz, color: colors[b.code] }));
  const viewer: VoxelViewer<(typeof voxels)[number]> | null = createVoxelViewer(viewport, { voxels, label: title, viewDirection, settings: { centerMarker: false, grid: false } });
  if (!viewer) return { error: "WebGL is unavailable" };
  current = viewer;
  viewer.setFloor(floor, 1);
  for (const row of rows) legendRow(legend, row.label, row.color);
  return { error: null };
};

window.loadChisel = ({ shape, colors, legend: rows }, viewDirection, { floor, title }) => {
  const { viewport, legend } = reset(title);
  if (!shape.cuboids.length) return { error: "the shape has no cuboids to draw" };
  const byCode = new Map(shape.materials.map((code, i) => [code, colors[i]]));
  const viewer = createChiselPreview(viewport, shape, (code) => byCode.get(code) ?? stringToColor(code), { centerMarker: false, grid: false }, viewDirection);
  if (!viewer) return { error: "WebGL is unavailable" };
  current = viewer;
  // A chiseled block's units are sixteenths: one floor cell is the whole block.
  viewer.setFloor(floor, 16);
  for (const row of rows) legendRow(legend, row.label, row.color);
  return { error: null };
};

window.showFrame = (code, frame, note) => {
  if (!model) throw new Error("no model loaded");
  model.showFrame(code, frame);
  document.getElementById("title")!.textContent = note ? `${baseTitle} - ${note}` : baseTitle;
};

window.contactSheet = (code, frames, labels, columns) => {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport canvas");
  if (!canvas || !model) throw new Error("no model loaded");
  const cols = Math.max(1, Math.min(columns, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const cell = { w: canvas.width, h: canvas.height };
  const header = 28;
  const sheet = document.createElement("canvas");
  sheet.width = cell.w * cols;
  sheet.height = cell.h * rows + header;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#2b2d31";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = "#e8e6e3";
  ctx.font = "15px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(`${baseTitle} - ${code}`, 10, header / 2);
  ctx.font = "13px system-ui, sans-serif";
  ctx.textBaseline = "top";
  frames.forEach((frame, i) => {
    const x = (i % cols) * cell.w, y = header + Math.floor(i / cols) * cell.h;
    // WebGL clears its buffer once composited, so pose, render and copy in the same task.
    model!.showFrame(code, frame);
    model!.render();
    ctx.drawImage(canvas, x, y);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.strokeRect(x + 0.5, y + 0.5, cell.w - 1, cell.h - 1);
    ctx.fillStyle = "#e8e6e3";
    ctx.fillText(labels[i] ?? String(frame), x + 8, y + 6);
  });
  return sheet.toDataURL("image/png");
};

window.samplePixel = (x, y) => {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport canvas");
  if (!canvas || !current) throw new Error("nothing rendered");
  // WebGL clears its buffer once composited, so render and copy in the same task.
  current.render();
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext("2d")!;
  // The WebGL canvas is transparent; composite it on the page background, as the screenshot and the contact sheet show it.
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
  ctx.fillRect(0, 0, copy.width, copy.height);
  ctx.drawImage(canvas, 0, 0);
  const scale = canvas.width / canvas.clientWidth;
  const [r, g, b] = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
  return [r, g, b];
};

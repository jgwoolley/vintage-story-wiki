// The browser half of the renderer: the CLI loads dist/page.js into a blank headless page, calls one of the window.load* functions
// per file and view, and screenshots the result. Each is a thin adapter on the shared viewers, exactly as the wiki and the VS Code
// extension draw: models through createModelPreview (textured when the CLI found the images, with showFrame for animation stills),
// schematics through createVoxelViewer (boxes prepared by the CLI's src/inputs.ts, chiseled blocks already cut into cuboids) and
// ChiselTools shapes through createChiselPreview. Plus a title and a legend.
import { createChiselPreview } from "@nf3t/vs-schematic/chiselPreview.js";
import { createModelPreview, type ModelPreview } from "@nf3t/vs-schematic/modelPreview.js";
import { stringToColor } from "@nf3t/vs-schematic/schematicVoxels.js";
import { attachToBase, compactShape, shapeToBoxes } from "@nf3t/vs-schematic/shapeBoxes.js";
import type { EnvironmentImages, ViewerEnvironment } from "@nf3t/vs-schematic/environment.js";
import { createVoxelViewer, type VoxelViewer } from "@nf3t/vs-schematic/voxelViewer.js";
import { AXIS_LABELS, elementColor, GUIDE_COLORS, guideBoxes, matchesElement } from "../aids.js";
import type { PageApi, PageEnvironment, PageOptions } from "../protocol.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Window extends PageApi {}
}

type Drawn = {
  render(): void;
  dispose(): void;
  setFloor(visible: boolean, cell?: number): void;
  setEnvironment(environment: ViewerEnvironment | null, cell?: number): void;
};
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

/** The page environment with its images decoded (an unreadable one is left out, so it is drawn from built-in colours). */
async function environmentOf(env: PageEnvironment): Promise<ViewerEnvironment> {
  const images: EnvironmentImages = {};
  for (const [key, url] of Object.entries(env.images)) {
    try {
      images[key as keyof EnvironmentImages] = await loadImage(url);
    } catch {
      // drawn from built-in colours
    }
  }
  return { grass: env.grass, sky: env.sky, images };
}

/** The floor grid, or the outdoor environment (whose grass replaces the grid); `cell` is data units per block. */
async function ground(drawn: Drawn, { floor, environment }: PageOptions, cell: number): Promise<void> {
  if (environment && (environment.grass || environment.sky)) drawn.setEnvironment(await environmentOf(environment), cell);
  drawn.setFloor(floor && !environment?.grass, cell);
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

window.loadModel = async (raw, viewDirection, options) => {
  const { title, textures, body, aids = {} } = options;
  const { viewport, legend } = reset(title);
  const byElement = aids.colorBy === "element";
  const textured = Object.keys(textures).length > 0 && !byElement;
  let shape = compactShape(raw, { faces: textured });
  let placedOnBody = false;
  if (body && shape.elements.some((e) => e.stepParent)) {
    shape = attachToBase(shape, compactShape(body));
    placedOnBody = true;
  }
  const boxes = shapeToBoxes(shape);
  const keys = [...new Set(boxes.map((b) => b.texture ?? ""))].sort((a, b) => Number(a > b) - Number(a < b));
  const images: Record<string, HTMLImageElement> = {};
  for (const [key, url] of Object.entries(textures)) {
    try {
      images[key] = await loadImage(url);
    } catch {
      // an unreadable PNG: that key stays colored
    }
  }
  const drawnTextured = textured ? keys.filter((k) => images[k]) : [];
  const animations = (shape.animations ?? []).map((a) => ({ code: a.code, name: a.name ?? a.code, frames: a.frames }));
  const result = { boxes: boxes.length, textures: keys, textured: drawnTextured, animations, placedOnBody };
  if (!boxes.length) return { error: "the shape has no boxes to draw", ...result };

  const named = byElement || !!aids.highlight?.length || !!aids.hide?.length;
  model = createModelPreview(viewport, shape, title, { centerMarker: false, grid: false }, {
    viewDirection, textures: textured ? images : undefined, names: named, extraBoxes: aids.grid ? guideBoxes() : [],
    // A field of view this narrow is an orthographic view to the eye (the camera backs off to keep the framing).
    ...(aids.ortho ? { fov: 2 } : {}),
  });
  if (!model) return { error: "WebGL is unavailable", ...result };
  current = model;
  // Colors by element name, in the order the elements are written (the order of the legend).
  const names = [...new Set(shapeToBoxes(shape, undefined, { names: true }).map((b) => b.name ?? ""))];
  const colorOf = new Map(names.map((n, i) => [n, elementColor(i)]));
  if (named || aids.grid) {
    model.setStyle((box) => {
      const guide = GUIDE_COLORS[box.texture ?? ""];
      if (guide) return { color: guide, opacity: box.texture === "guide:block" ? 0.6 : 1 };
      if (aids.hide?.length && matchesElement(box.path ?? "", aids.hide)) return null;
      const color = byElement ? colorOf.get(box.name ?? "") : stringToColor(box.texture ?? "");
      return aids.highlight?.length && !matchesElement(box.path ?? "", aids.highlight) ? { color, opacity: 0.12 } : { color };
    });
  }
  // From underneath the floor would be in the way.
  await ground(model, aids.grid ? { ...options, floor: viewDirection[1] >= 0 } : options, 16);
  if (aids.grid) await axisLabels(model);
  if (aids.noLegend) return { error: null, ...result };
  if (byElement) {
    const shown = names.filter((n) => !aids.hide?.length || !matchesElement(n, aids.hide));
    for (const name of shown.slice(0, ELEMENT_LEGEND_ROWS)) legendRow(legend, name || "(unnamed)", colorOf.get(name)!);
    if (shown.length > ELEMENT_LEGEND_ROWS) legendRow(legend, `+${shown.length - ELEMENT_LEGEND_ROWS} more elements (--highlight <name> finds one)`, "transparent");
    return { error: null, ...result };
  }
  for (const key of keys) {
    legendRow(legend, key || "(no texture)", stringToColor(key), images[key] ? textures[key] : undefined, textured && !images[key] ? " (no texture found)" : "");
  }
  return { error: null, ...result };
};

const ELEMENT_LEGEND_ROWS = 30;

/** Puts each axis's name where it ends on screen (HTML over the canvas, so it stays readable at any size). */
async function axisLabels(viewer: ModelPreview): Promise<void> {
  // The viewer sizes its canvas on the next frame; the positions are only right after that.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const viewport = document.getElementById("viewport")!;
  const box = viewport.getBoundingClientRect();
  const origin = viewer.project(0, 0, 0);
  for (const label of AXIS_LABELS) {
    const p = viewer.project(...label.at);
    if (!p) continue;
    // An axis pointing at the camera ends on the origin: its name would only cover the origin's.
    if (origin && label.text.startsWith("+") && Math.hypot(p.x - origin.x, p.y - origin.y) < 24) continue;
    const tag = document.createElement("div");
    tag.className = "axis-label";
    tag.textContent = label.text;
    tag.style.color = label.color;
    tag.style.left = `${Math.max(4, Math.min(box.width - 60, box.left + p.x + 4))}px`;
    tag.style.top = `${Math.max(4, Math.min(box.height - 18, box.top + p.y - 8))}px`;
    document.body.append(tag);
  }
}

window.composeSheet = async (cells, columns, cell, title, rows) => {
  const images = await Promise.all(cells.map(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  }));
  const cols = Math.max(1, Math.min(columns, cells.length));
  const lines = Math.ceil(cells.length / cols);
  const height = Math.round((cell * images[0].height) / images[0].width);
  const header = 30, gutter = rows?.length ? 26 : 0;
  const sheet = document.createElement("canvas");
  sheet.width = gutter + cell * cols;
  sheet.height = header + height * lines;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = "#e8e6e3";
  ctx.font = "15px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 10, header / 2);
  ctx.imageSmoothingQuality = "high";
  images.forEach((image, i) => {
    const x = gutter + (i % cols) * cell, y = header + Math.floor(i / cols) * height;
    ctx.drawImage(image, x, y, cell, height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, height - 1);
  });
  // Row names (before / after) run up the left edge.
  (rows ?? []).slice(0, lines).forEach((name, r) => {
    ctx.save();
    ctx.translate(gutter / 2, header + r * height + height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText(name, 0, 0);
    ctx.restore();
  });
  return sheet.toDataURL("image/png");
};

window.loadSchematic = async ({ boxes, colors, legend: rows }, viewDirection, options) => {
  const { title } = options;
  const { viewport, legend } = reset(title);
  if (!boxes.length) return { error: "the schematic has no blocks to draw" };
  const voxels = boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, sx: b.sx, sy: b.sy, sz: b.sz, quaternion: b.quaternion, color: colors[b.code] }));
  const viewer: VoxelViewer<(typeof voxels)[number]> | null = createVoxelViewer(viewport, { voxels, label: title, viewDirection, settings: { centerMarker: false, grid: false } });
  if (!viewer) return { error: "WebGL is unavailable" };
  current = viewer;
  await ground(viewer, options, 1);
  for (const row of rows) legendRow(legend, row.label, row.color);
  return { error: null };
};

window.loadScene = async ({ boxes, textures }, viewDirection, options) => {
  const { title } = options;
  const { viewport } = reset(title);
  if (!boxes.length) return { error: "the scene has no boxes to draw" };
  const images: Record<string, HTMLImageElement> = {};
  for (const [key, url] of Object.entries(textures)) {
    try {
      images[key] = await loadImage(url);
    } catch {
      // an unreadable PNG: that key stays colored
    }
  }
  const viewer = createVoxelViewer(viewport, { voxels: boxes, label: title, viewDirection, cellsCenteredOnIntegers: false, settings: { centerMarker: false, grid: false }, textures: images });
  if (!viewer) return { error: "WebGL is unavailable" };
  viewer.setStyle((box) => ({ color: stringToColor(box.texture ?? "") }));
  current = viewer;
  await ground(viewer, options, 16);
  return { error: null };
};

window.loadChisel = async ({ shape, colors, legend: rows }, viewDirection, options) => {
  const { title } = options;
  const { viewport, legend } = reset(title);
  if (!shape.cuboids.length) return { error: "the shape has no cuboids to draw" };
  const byCode = new Map(shape.materials.map((code, i) => [code, colors[i]]));
  const viewer = createChiselPreview(viewport, shape, (code) => byCode.get(code) ?? stringToColor(code), { centerMarker: false, grid: false }, viewDirection);
  if (!viewer) return { error: "WebGL is unavailable" };
  current = viewer;
  // A chiseled block's units are sixteenths: one floor cell is the whole block.
  await ground(viewer, options, 16);
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

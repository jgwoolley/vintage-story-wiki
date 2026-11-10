// The Node half of the renderer: reads each file (src/inputs.ts works out what it is), launches Playwright's headless Chromium
// (software WebGL, no X server), loads the bundled page (dist/page.js, built by esbuild.mjs) into a blank page and screenshots one
// view (or animation frame) at a time. Contact sheets are composed in the page and written from here.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import type { BlockColors } from "@nf3t/vs-schematic/blockColors.js";
import { attachToBase, compactShape, shapeToBoxes } from "@nf3t/vs-schematic/shapeBoxes.js";
import { gameAssetsCandidates, resolveTextures, TEXTURE_PROBE, type ResolvedTextures } from "@nf3t/vs-schematic/textureFiles.js";
import { defaultLocationEnv, resolveGameDir } from "../locations.js";
import { appDir } from "../paths.js";
import { baseName, frameLabel, outputName, sampleFrames, SCHEMATIC_VIEWS, type Overlay, type RenderOptions } from "./args.js";
import { InputError, loadBlockColors, loadInput, type ChiselInput, type LoadedInput, type SchematicInput, type SchematicSummary } from "./inputs.js";
import { checkShape, type CheckElement, type ShapeCheck } from "../shape/check.js";
import { unmatchedPatterns, elementPaths } from "./aids.js";
import type { ChiselPayload, ModelAids, ModelOptions, PageApi, PageEnvironment, PageOptions, SchematicPayload, ScenePayload } from "./protocol.js";
import { DEFAULT_VIEWS, SHEET_VIEWS, SIDE_VIEWS, VIEW_NOTES, VIEWS, viewVector } from "./views.js";

/** `file`'s real spelling when only its case differs (the game reads asset paths case-insensitively; a shape says `gearboxA`, the file is `gearboxa.png`). */
async function matchCase(file: string): Promise<string | undefined> {
  const parts = path.resolve(file).split(path.sep);
  let dir = parts[0] || path.sep;
  for (const part of parts.slice(1)) {
    const names = await readdir(dir).catch(() => [] as string[]);
    const name = names.includes(part) ? part : names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!name) return undefined;
    dir = path.join(dir, name);
  }
  return dir;
}

export const readOptional = async (file: string): Promise<Uint8Array | undefined> => {
  const read = (f: string) => readFile(f).then((b) => new Uint8Array(b), () => undefined);
  return (await read(file)) ?? (await matchCase(file).then((f) => (f ? read(f) : undefined)));
};

/**
 * The game assets to take textures from, by the location rule (src/locations.ts): --game-dir, $VINTAGE_STORY, vs-manifest.json gameDir,
 * ./vintagestory (or an old ./vs_server), then a real client install. Local and installed candidates without textures (a dedicated server) are
 * skipped; an explicit one without textures is an error. Undefined when no client is found (models are then drawn in key colors).
 */
export async function gameAssetsFor(given: string | undefined, cwd = process.cwd()): Promise<string | undefined> {
  const found = resolveGameDir({ flag: given, mode: "read", needClient: true }, defaultLocationEnv(cwd));
  if (!found.path) return undefined;
  try {
    return await findGameAssets(found.path);
  } catch (err) {
    throw new RenderError(`${(err as Error).message} (${found.label})`);
  }
}

/** The assets folder of a game install, checked to have the client's textures (the dedicated server has almost none). */
export async function findGameAssets(folder: string): Promise<string> {
  const absolute = path.resolve(folder).split(path.sep).join("/");
  for (const candidate of gameAssetsCandidates(absolute)) {
    if (await readOptional(`${candidate}/${TEXTURE_PROBE}`)) return candidate;
  }
  throw new RenderError(`${folder} has no textures (no assets/${TEXTURE_PROBE}); point it at the game client's install, not the dedicated server`);
}

/** The game images the outdoor environment (--grass, --sky) draws with, by key of the page's EnvironmentImages, under a client's assets/. */
export const ENVIRONMENT_FILES: Record<string, string> = {
  grass: "survival/textures/block/plant/grasscoverage/normal-top.png",
  plantTint: "game/textures/environment/planttint.png",
  sky: "game/textures/environment/sky.png",
  sunlight: "game/textures/environment/sunlight.png",
};

/**
 * The page environment for `grass`/`sky`, with whichever ENVIRONMENT_FILES `gameAssets` (a client's assets folder) has; undefined when
 * neither is asked for. Without a client every image is missing and the page draws built-in colours.
 */
export async function pageEnvironment(o: { grass?: boolean; sky?: boolean }, gameAssets: string | undefined): Promise<PageEnvironment | undefined> {
  if (!o.grass && !o.sky) return undefined;
  const images: Record<string, string> = {};
  if (gameAssets) {
    for (const [key, file] of Object.entries(ENVIRONMENT_FILES)) {
      const png = await readOptional(`${gameAssets}/${file}`);
      if (png) images[key] = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    }
  }
  return { grass: !!o.grass, sky: !!o.sky, images };
}

/**
 * The block colors (BlockColorMod output, the wiki's copy) for schematics and chisel shapes unless --block-colors is given. esbuild.mjs
 * copies them into dist/ so a global install has them.
 */
export const DEFAULT_BLOCK_COLORS = path.join(appDir, "dist/blockColors.json");

const PAGE_CSS = `
  html, body { margin: 0; background: #2b2d31; color: #e8e6e3; font: 13px system-ui, sans-serif; }
  #title { position: absolute; top: 8px; left: 10px; opacity: 0.8; }
  #viewport { width: 100vw; height: 100vh; }
  #legend { position: absolute; bottom: 8px; left: 10px; margin: 0; padding: 0; list-style: none; }
  #legend li { display: flex; align-items: center; gap: 6px; margin-top: 3px; text-shadow: 0 0 3px #000; }
  #legend span { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
  #legend span.texture { width: 16px; height: 16px; border-radius: 0; background-size: cover; image-rendering: pixelated; }
  .axis-label { position: absolute; font-weight: 600; text-shadow: 0 0 3px #000, 0 0 3px #000; white-space: nowrap; }
`;

export interface ModelSummary {
  boxes: number;
  /** Texture keys used by the boxes (without "#"), sorted. */
  textures: string[];
  /** Keys drawn with their real texture (empty with --no-textures or --list). */
  textured: string[];
  /** Keys whose texture wasn't found, with the path the shape names. */
  missing: ResolvedTextures["missing"];
  /** The shape's animations; `frames` at 30 per second. */
  animations: { code: string; name: string; frames: number }[];
  /** A worn item (pieces hang on player body bones), and whether the body was found to place them on. */
  wornItem: boolean;
  placedOnBody: boolean;
}

export interface ChiselSummary {
  name?: string;
  cuboids: number;
  /** Voxels filled, of 4096. */
  voxels: number;
  materials: { code: string; voxels: number }[];
}

/** What --compare found between the old file and the new one, element by element (by path; boxes after every turn). */
export interface CompareSummary {
  /** The old file. */
  old: string;
  added: string[];
  removed: string[];
  /** Elements whose box moved or changed size. */
  moved: { path: string; was: Pick<CheckElement, "min" | "max">; now: Pick<CheckElement, "min" | "max"> }[];
  unchanged: number;
}

/** The views of a --compare image when --views isn't given. */
export const COMPARE_VIEWS = ["default", "south", "east", "top"];

export type RenderedInput =
  | { file: string; kind: "model"; summary: ModelSummary; images: string[]; centerPixels: Rgb[]; check?: ShapeCheck; compare?: CompareSummary }
  | { file: string; kind: "schematic"; summary: SchematicSummary; images: string[]; centerPixels: Rgb[] }
  | { file: string; kind: "chisel"; summary: ChiselSummary; images: string[]; centerPixels: Rgb[] };

/** RGB at the middle of an image (a cheap check that something was drawn, and what color). */
export type Rgb = [number, number, number];

export class RenderError extends Error {}

const LEGEND_ROWS = 12;

function schematicPayload(input: SchematicInput): SchematicPayload {
  const color = new Map(input.codes.map((c, i) => [c, input.colors[i]]));
  const legend = input.drawnCounts.slice(0, LEGEND_ROWS).map(({ code, count }) => ({ label: `${code} x${count}`, color: color.get(code) ?? "#888" }));
  const more = input.drawnCounts.length - legend.length;
  if (more > 0) legend.push({ label: `+${more} more kinds`, color: "transparent" });
  return { boxes: input.boxes, codes: input.codes, colors: input.colors, legend };
}

function chiselPayload(input: ChiselInput): ChiselPayload {
  const legend = input.shape.materials.map((code, i) => ({ label: `${code} (${input.volumes[i]} voxels)`, color: input.colors[i] }));
  return { shape: input.shape, colors: input.colors, legend };
}

function chiselSummary(input: ChiselInput): ChiselSummary {
  return {
    name: input.shape.name,
    cuboids: input.shape.cuboids.length,
    voxels: input.volumes.reduce((a, b) => a + b, 0),
    materials: input.shape.materials.map((code, i) => ({ code, voxels: input.volumes[i] })),
  };
}

/** A model's summary worked out in Node (the same compactShape/shapeToBoxes the page draws with), so --list needs no browser. */
function modelSummary(raw: unknown, body: unknown, missing: ResolvedTextures["missing"]): ModelSummary {
  let shape = compactShape(raw);
  const wornItem = shape.elements.some((e) => e.stepParent);
  if (wornItem && body) shape = attachToBase(shape, compactShape(body));
  const boxes = shapeToBoxes(shape);
  return {
    boxes: boxes.length,
    textures: [...new Set(boxes.map((b) => b.texture ?? ""))].sort((a, b) => Number(a > b) - Number(a < b)),
    textured: [],
    missing,
    animations: (shape.animations ?? []).map((a) => ({ code: a.code, name: a.name ?? a.code, frames: a.frames })),
    wornItem,
    placedOnBody: wornItem && !!body,
  };
}

/** Renders every file in `options` and returns what was written. Throws RenderError for a file that can't be drawn. */
export async function renderFiles(options: RenderOptions): Promise<RenderedInput[]> {
  const gameAssets = options.noTextures ? undefined : await gameAssetsFor(options.game, options.cwd);
  // The backdrop takes the client's images even for untextured drawing (schematics); no client just means built-in colours.
  const environment = await pageEnvironment(options, gameAssets ?? (options.grass || options.sky ? await gameAssetsFor(options.game, options.cwd).catch(() => undefined) : undefined));
  let colors: BlockColors | null | undefined;

  // Read every file first, so a bad one fails before Chromium starts.
  const inputs: { file: string; input: LoadedInput; textures: ResolvedTextures }[] = [];
  for (const file of options.files) {
    try {
      // Block colors are only used by schematics and chisel shapes, but they're needed while reading the file; loaded once.
      colors ??= await loadBlockColors(options.blockColors, DEFAULT_BLOCK_COLORS);
      const input = await loadInput(file, { showFiller: options.showFiller, maxY: options.maxY, chisel: !options.noChisel, colors, gameAssets, statueIo: options.statueIo });
      const posix = path.resolve(file).split(path.sep).join("/");
      const textures: ResolvedTextures = input.kind === "model" && !options.noTextures
        ? await resolveTextures(input.raw, posix, gameAssets, readOptional)
        : { images: {}, missing: [] };
      inputs.push({ file, input, textures });
    } catch (err) {
      if (err instanceof InputError) throw new RenderError(err.message);
      throw err;
    }
  }

  const summaries = inputs.map(({ file, input, textures }): RenderedInput => {
    if (input.kind === "model") return { file, kind: "model", summary: modelSummary(input.raw, input.body, textures.missing), images: [], centerPixels: [] };
    if (input.kind === "schematic") return { file, kind: "schematic", summary: input.summary, images: [], centerPixels: [] };
    return { file, kind: "chisel", summary: chiselSummary(input), images: [], centerPixels: [] };
  });
  // Unknown animation codes are an error before anything is drawn, listing the ones the model has.
  for (const result of summaries) {
    if (result.kind !== "model" || options.animations === "all") continue;
    const known = result.summary.animations.map((a) => a.code);
    const unknown = options.animations.filter((c) => !known.includes(c));
    if (unknown.length) throw new RenderError(`${result.file}: no animation ${unknown.join(", ")}; it has ${known.join(", ") || "none"}`);
  }
  if (options.list) return summaries;

  // The model aids: refused for other kinds rather than silently ignored, and an element name that matches nothing is a mistake.
  const aidFlags = [options.check && "--check", options.grid && "--grid", options.ortho && "--ortho", options.colorBy && "--color-by", options.highlight && "--highlight", options.hide && "--hide", options.sheet && "--sheet", options.compare && "--compare"].filter(Boolean);
  for (const { file, input } of inputs) {
    if (input.kind !== "model") {
      if (aidFlags.length) throw new RenderError(`${file}: ${aidFlags.join(", ")} ${aidFlags.length === 1 ? "is" : "are"} for model (shape) files; this is a ${input.kind === "chisel" ? "ChiselTools shape" : "schematic"}`);
      continue;
    }
    const unknown = unmatchedPatterns(input.raw, [...(options.highlight ?? []), ...(options.hide ?? [])]);
    if (unknown.length) {
      const names = [...new Set(elementPaths(input.raw).map((p) => p.split("/").pop()!))];
      throw new RenderError(`${file}: no element named ${unknown.join(", ")}; it has ${names.slice(0, 60).join(", ")}${names.length > 60 ? `, ... (${names.length} in all; --check lists them)` : ""}`);
    }
  }
  let old: { input: Extract<LoadedInput, { kind: "model" }>; textures: ResolvedTextures } | undefined;
  if (options.compare) {
    try {
      const input = await loadInput(options.compare, { showFiller: false, chisel: true, colors: colors ?? null, gameAssets });
      if (input.kind !== "model") throw new RenderError(`${options.compare}: --compare needs a model (shape) file`);
      const posix = path.resolve(options.compare).split(path.sep).join("/");
      old = { input, textures: options.noTextures ? { images: {}, missing: [] } : await resolveTextures(input.raw, posix, gameAssets, readOptional) };
    } catch (err) {
      if (err instanceof InputError) throw new RenderError(err.message);
      throw err;
    }
  }
  for (const [n, { input }] of inputs.entries()) {
    const result = summaries[n];
    if (input.kind !== "model" || result.kind !== "model") continue;
    if (options.check) result.check = checkShape(input.raw);
    if (old) result.compare = compareShapes(options.compare!, old.input.raw, input.raw);
  }
  if (options.check && !options.sheet && !options.compare) return summaries;

  const bundle = await readFile(path.join(appDir, "dist/page.js"), "utf8").catch(() => {
    throw new RenderError("dist/page.js is missing: run `npm run build -w @nf3t/vsdev` first (npm run render does it)");
  });
  await mkdir(options.out, { recursive: true });
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  } catch (err) {
    throw new RenderError(`could not start Chromium (install it with \`npx playwright-core install chromium\`): ${(err as Error).message.split("\n")[0]}`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: options.size, height: options.height ?? options.size } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.setContent(`<!doctype html><html><head><style>${PAGE_CSS}${options.bare || options.overlay ? " #title, #legend { display: none; }" : ""}${options.overlay?.background ? ` html, body { background: ${options.overlay.background.replace(/[;{}<>]/g, "")}; }` : ""}${safeCss(options.overlay?.frame ?? options.overlay?.safe)}</style></head><body></body></html>`);
    await page.addScriptTag({ content: bundle });
    // Each page.evaluate callback is serialized and runs in the page, where globalThis is the window with the PageApi functions
    // (src/page/main.ts); it can't use anything from this file's scope.
    const check = (file: string, error: string | null) => {
      if (errors.length) throw new RenderError(`${file}: the page failed: ${errors.join("; ")}`);
      if (error) throw new RenderError(`${file}: ${error}`);
    };

    const viewDirection = (view: string, flat = !!options.ortho) => options.viewVectors?.[view] ?? viewVector(view, flat);
    const aids: ModelAids | undefined = options.grid || options.ortho || options.colorBy || options.highlight || options.hide
      ? { grid: options.grid, ortho: options.ortho, colorBy: options.colorBy, highlight: options.highlight, hide: options.hide }
      : undefined;
    for (const [n, { file, input, textures }] of inputs.entries()) {
      const result = summaries[n];
      const name = path.basename(file);
      const shoot = async (image: string) => {
        await settle(page);
        if (options.overlay) await page.evaluate(overlayScript(options.overlay, Math.min(options.size, options.height ?? options.size)));
        await page.screenshot({ path: image, omitBackground: options.overlay?.background === "transparent" });
        result.images.push(image);
        result.centerPixels.push(await page.evaluate(`window.samplePixel(${options.size / 2}, ${(options.height ?? options.size) / 2})`));
      };

      if (input.kind !== "model") {
        for (const view of options.views ?? SCHEMATIC_VIEWS) {
          const opts: PageOptions = { floor: options.floor, title: `${name} - ${view}`, environment };
          const res = input.kind === "schematic"
            ? await page.evaluate(([p, d, o]) => (globalThis as unknown as PageApi).loadSchematic(p, d, o), [schematicPayload(input), viewDirection(view), opts] as const)
            : await page.evaluate(([p, d, o]) => (globalThis as unknown as PageApi).loadChisel(p, d, o), [chiselPayload(input), viewDirection(view), opts] as const);
          check(file, res.error);
          await shoot(path.join(options.out, options.fileName ?? outputName(file, view)));
        }
        continue;
      }

      const summary = result.summary as ModelSummary;
      const load = async (view: string) => {
        const opts: ModelOptions = { floor: options.floor, title: `${name} - ${view}`, textures: textures.images, body: input.body, environment, ...(aids ? { aids } : {}) };
        const res = await page.evaluate(([r, d, o]) => (globalThis as unknown as PageApi).loadModel(r, d, o), [input.raw, viewDirection(view), opts] as const);
        check(file, res.error);
        summary.textured = res.textured;
      };
      const animations = options.animations === "all" ? summary.animations : summary.animations.filter((a) => (options.animations as string[]).includes(a.code));

      if (options.sheet || options.compare) {
        // One image of many views: each cell is the page at 3/4 of --size, the side views flat and square on, titled with what it
        // shows; the legend only in the first cell.
        const cell = Math.round(options.size * 0.75);
        const full = { width: options.size, height: options.height ?? options.size };
        await page.setViewportSize({ width: cell, height: Math.round((cell * full.height) / full.width) });
        const capture = async (source: { raw: unknown; body?: unknown; textures: ResolvedTextures }, view: string, first: boolean) => {
          const side = SIDE_VIEWS.includes(view);
          const opts: ModelOptions = {
            floor: options.floor, title: `${view}${VIEW_NOTES[view] ? ` - ${VIEW_NOTES[view]}` : ""}`, textures: source.textures.images, body: source.body, environment,
            aids: { ...aids, ortho: !!options.ortho || side, noLegend: !first },
          };
          const res = await page.evaluate(([r, d, o]) => (globalThis as unknown as PageApi).loadModel(r, d, o), [source.raw, viewDirection(view, !!options.ortho || side), opts] as const);
          check(file, res.error);
          if (source.raw === input.raw) summary.textured = res.textured;
          await settle(page);
          return `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
        };
        const write = async (suffix: string, cells: string[], columns: number, title: string, rows?: string[]) => {
          const dataUrl = await page.evaluate(([c, k, w, t, r]) => (globalThis as unknown as PageApi).composeSheet(c, k, w, t, r), [cells, columns, cell, title, rows] as const);
          check(file, null);
          const image = path.join(options.out, `${baseName(file)}-${suffix}.png`);
          await writeFile(image, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
          result.images.push(image);
        };
        const now = { raw: input.raw, body: input.body, textures };
        if (options.sheet) {
          const views = options.views ?? SHEET_VIEWS;
          const cells: string[] = [];
          for (const [i, view] of views.entries()) cells.push(await capture(now, view, i === 0));
          await write("sheet", cells, options.columns ?? Math.min(4, views.length), `${name} - 16 units = 1 block; x east, y up, z south`);
        }
        if (options.compare && old) {
          const views = options.views ?? COMPARE_VIEWS;
          const cells: string[] = [];
          for (const source of [{ raw: old.input.raw, body: old.input.body, textures: old.textures }, now]) {
            for (const [i, view] of views.entries()) cells.push(await capture(source, view, i === 0));
          }
          await write("compare", cells, views.length, `${path.basename(options.compare)} (before, top row) and ${name} (after)`, ["before", "after"]);
        }
        await page.setViewportSize(full);
      } else if (!animations.length) {
        if (options.animations === "all") console.warn(`${file}: has no animations; rendering the rest pose`);
        for (const view of options.views ?? DEFAULT_VIEWS) {
          await load(view);
          await shoot(path.join(options.out, options.fileName ?? outputName(file, view)));
        }
      } else if (options.frame !== undefined) {
        const animation = animations[0];
        for (const view of options.views ?? DEFAULT_VIEWS) {
          await load(view);
          await page.evaluate(([c, f, t]) => (globalThis as unknown as PageApi).showFrame(c, f, t), [animation.code, options.frame, `${animation.code} frame ${options.frame}`] as const);
          await shoot(path.join(options.out, outputName(file, view, { code: animation.code, part: options.frame })));
        }
      } else {
        // Animations: frames in the first view only (or the --views given), plus a contact sheet per animation and view.
        for (const view of options.views ?? [DEFAULT_VIEWS[0]]) {
          await load(view);
          for (const animation of animations) {
            const frames = sampleFrames(animation.frames, options.frames);
            for (const frame of frames) {
              await page.evaluate(([c, f, t]) => (globalThis as unknown as PageApi).showFrame(c, f, t), [animation.code, frame, `${animation.code} frame ${frameLabel(frame)} of ${animation.frames}`] as const);
              await shoot(path.join(options.out, outputName(file, view, { code: animation.code, part: frame })));
            }
            const labels = frames.map((f) => `f${frameLabel(f)}`);
            const columns = options.columns ?? Math.min(4, frames.length);
            const dataUrl = await page.evaluate(([c, f, l, k]) => (globalThis as unknown as PageApi).contactSheet(c, f, l, k), [animation.code, frames, labels, columns] as const);
            check(file, null);
            const sheet = path.join(options.out, outputName(file, view, { code: animation.code, part: "sheet" }));
            await writeFile(sheet, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
            result.images.push(sheet);
          }
        }
      }
    }
    return summaries;
  } finally {
    await browser.close();
  }
}

/** Which elements differ between two versions of a shape, by path (a repeated path is told apart by its order). */
export function compareShapes(oldFile: string, before: unknown, after: unknown): CompareSummary {
  const keyed = (raw: unknown) => {
    const seen = new Map<string, number>();
    return new Map(checkShape(raw).elements.map((e) => {
      const n = seen.get(e.path) ?? 0;
      seen.set(e.path, n + 1);
      return [n ? `${e.path} (${n + 1})` : e.path, e] as const;
    }));
  };
  const a = keyed(before), b = keyed(after);
  const same = (x: number[], y: number[]) => x.every((v, i) => Math.abs(v - y[i]) < 0.005);
  const moved: CompareSummary["moved"] = [];
  let unchanged = 0;
  for (const [key, now] of b) {
    const was = a.get(key);
    if (!was) continue;
    if (same(was.min, now.min) && same(was.max, now.max)) unchanged++;
    else moved.push({ path: key, was: { min: was.min, max: was.max }, now: { min: now.min, max: now.max } });
  }
  return { old: oldFile, added: [...b.keys()].filter((k) => !a.has(k)), removed: [...a.keys()].filter((k) => !b.has(k)), moved, unchanged };
}

/** CSS that frames the viewport inside the margins `safe` leaves (fractions of the image), so the model avoids what a ModDB card covers. */
function safeCss(safe: Overlay["safe"]): string {
  if (!safe) return "";
  const pct = (k: "top" | "right" | "bottom" | "left") => `${Math.max(0, Math.min(0.9, safe[k] ?? 0)) * 100}%`;
  return ` #viewport { position: absolute; width: auto; height: auto; top: ${pct("top")}; right: ${pct("right")}; bottom: ${pct("bottom")}; left: ${pct("left")}; }`;
}

/**
 * A script that (re)draws the overlay: the text block and logo sized from the image size, over the canvas. The page's own background
 * (a CSS color, from the overlay) is set in the page's stylesheet. Everything goes in as data (JSON), never as markup.
 */
function overlayScript(o: Overlay, size: number): string {
  return `(() => {
    const o = ${JSON.stringify(o)}, size = ${size};
    document.getElementById("shot-overlay")?.remove();
    const root = document.createElement("div");
    root.id = "shot-overlay";
    root.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff";
    const pad = size * 0.04;
    const safe = o.safe || {};
    const place = (el, corner) => {
      const [v, h] = corner.split("-");
      el.style.position = "absolute";
      el.style[v] = "calc(" + (safe[v] || 0) * 100 + "% + " + pad + "px)";
      el.style[h] = "calc(" + (safe[h] || 0) * 100 + "% + " + pad + "px)";
      if (h === "right") el.style.textAlign = "right";
    };
    if (o.title || o.subtitle) {
      const box = document.createElement("div");
      box.style.cssText = "max-width:" + (o.safe ? "calc(100% - " + 2 * pad + "px)" : size * 0.7 + "px") + ";text-shadow:0 0 " + size * 0.012 + "px #000,0 " + size * 0.004 + "px " + size * 0.01 + "px #000";
      if (o.title) {
        const t = document.createElement("div");
        t.textContent = o.title;
        t.style.cssText = "font-weight:700;font-style:italic;line-height:1.05;font-size:" + size * (o.titleSize || 0.075) + "px";
        box.append(t);
      }
      if (o.subtitle) {
        const t = document.createElement("div");
        t.textContent = o.subtitle;
        t.style.cssText = "margin-top:" + size * 0.01 + "px;font-weight:600;font-style:italic;font-size:" + size * (o.titleSize || 0.075) * 0.6 + "px";
        box.append(t);
      }
      place(box, o.textAt || "top-left");
      root.append(box);
    }
    if (o.guides) {
      const shade = (css) => { const d = document.createElement("div"); d.style.cssText = "position:absolute;background:rgba(220,40,40,.35);" + css; root.append(d); };
      const s = o.safe || {};
      if (s.bottom) shade("left:0;right:0;bottom:0;height:" + s.bottom * 100 + "%");
      if (s.top) shade("left:0;right:0;top:0;height:" + s.top * 100 + "%");
      if (s.left) shade("top:0;bottom:0;left:0;width:" + s.left * 100 + "%");
      if (s.right) shade("top:0;bottom:0;right:0;width:" + s.right * 100 + "%");
      const ribbon = size * 0.3;
      shade("top:0;right:0;width:" + ribbon + "px;height:" + ribbon + "px;clip-path:polygon(0 0,100% 0,100% 100%)");
    }
    if (o.logo && o.logoFill) {
      const img = document.createElement("img");
      img.src = o.logo;
      const s = o.safe || {};
      img.style.cssText = "position:absolute;object-fit:contain;top:" + (s.top || 0) * 100 + "%;bottom:" + (s.bottom || 0) * 100 + "%;left:" + (s.left || 0) * 100 + "%;right:" + (s.right || 0) * 100 + "%;width:" + (1 - (s.left || 0) - (s.right || 0)) * 100 + "%;height:" + (1 - (s.top || 0) - (s.bottom || 0)) * 100 + "%";
      root.append(img);
    } else if (o.logo) {
      const img = document.createElement("img");
      img.src = o.logo;
      img.style.cssText = "width:" + size * 0.2 + "px;height:auto;filter:drop-shadow(0 0 " + size * 0.01 + "px rgba(0,0,0,.6))";
      place(img, o.logoAt || "top-right");
      root.append(img);
    }
    document.body.append(root);
    return Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  })()`;
}

/** Waits two animation frames: the viewer draws on resize, and its ResizeObserver needs a frame to fire before a screenshot. */
async function settle(page: Page): Promise<void> {
  // A string, because this file has no DOM lib to type requestAnimationFrame.
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

/** Renders an image-only card (an icon: just `overlay.logo` filling the safe area, `overlay.background`, no model) to `file`. */
export async function renderLogoCard(file: string, size: number, height: number, overlay: Overlay): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new RenderError(`could not start Chromium (install it with \`npx playwright-core install chromium\`): ${(err as Error).message.split("\n")[0]}`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: size, height } });
    const background = (overlay.background ?? "transparent").replace(/[;{}<>]/g, "");
    await page.setContent(`<!doctype html><html><head><style>html, body { margin: 0; background: ${background}; width: 100vw; height: 100vh; overflow: hidden; }</style></head><body></body></html>`);
    await page.evaluate(overlayScript({ ...overlay, logoFill: true }, Math.min(size, height)));
    await page.screenshot({ path: file, omitBackground: background === "transparent" });
  } finally {
    await browser.close();
  }
}

/**
 * Adds a faded, flipped reflection under whatever `file` (a PNG rendered on a transparent background) shows, then puts it on `background`
 * (a CSS color; "transparent" keeps it transparent). The reflection starts at the lowest drawn row and is cut off where the image ends,
 * so a subject framed above the bottom margin of a ModDB card reflects into the part the card's text covers.
 */
export async function addReflection(file: string, background: string): Promise<void> {
  const png = await readFile(file);
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new RenderError(`could not start Chromium (install it with \`npx playwright-core install chromium\`): ${(err as Error).message.split("\n")[0]}`);
  }
  try {
    const page = await browser.newPage();
    const script = `(async () => {
      const bg = ${JSON.stringify(background.replace(/[;{}<>]/g, ""))};
      const img = new Image();
      img.src = ${JSON.stringify(`data:image/png;base64,${png.toString("base64")}`)};
      await img.decode();
      const w = img.width, h = img.height;
      const probe = document.createElement("canvas");
      probe.width = w; probe.height = h;
      const px = probe.getContext("2d");
      px.drawImage(img, 0, 0);
      const data = px.getImageData(0, 0, w, h).data;
      let top = h, bottom = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 10) { if (y < top) top = y; bottom = y; break; }
      const out = document.createElement("canvas");
      out.width = w; out.height = h;
      const o = out.getContext("2d");
      if (bg !== "transparent") { o.fillStyle = bg; o.fillRect(0, 0, w, h); }
      o.drawImage(img, 0, 0);
      const rh = Math.min(Math.round((bottom - top + 1) * 0.7), h - bottom - 1);
      if (bottom >= 0 && rh > 0) {
        const r = document.createElement("canvas");
        r.width = w; r.height = rh;
        const rx = r.getContext("2d");
        rx.translate(0, rh); rx.scale(1, -1);
        rx.drawImage(img, 0, bottom + 1 - rh, w, rh, 0, 0, w, rh);
        rx.setTransform(1, 0, 0, 1, 0, 0);
        rx.globalCompositeOperation = "destination-in";
        const g = rx.createLinearGradient(0, 0, 0, rh);
        g.addColorStop(0, "rgba(0,0,0,0.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
        rx.fillStyle = g; rx.fillRect(0, 0, w, rh);
        o.drawImage(r, 0, bottom + 1);
      }
      return out.toDataURL("image/png");
    })()`;
    const url = (await page.evaluate(script)) as string;
    await writeFile(file, Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64"));
  } finally {
    await browser.close();
  }
}

/** Renders a scene (src/scene.ts) to `file`, in the same page, camera and overlay as `renderFiles`. */
export async function renderScene(
  scene: ScenePayload, file: string,
  o: { size: number; height?: number; view: string; viewVectors?: RenderOptions["viewVectors"]; floor: boolean; environment?: PageEnvironment; overlay?: Overlay; title?: string },
): Promise<void> {
  const bundle = await readFile(path.join(appDir, "dist/page.js"), "utf8").catch(() => {
    throw new RenderError("dist/page.js is missing: run `npm run build -w @nf3t/vsdev` first");
  });
  await mkdir(path.dirname(file), { recursive: true });
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  } catch (err) {
    throw new RenderError(`could not start Chromium (install it with \`npx playwright-core install chromium\`): ${(err as Error).message.split("\n")[0]}`);
  }
  try {
    const height = o.height ?? o.size;
    const page = await browser.newPage({ viewport: { width: o.size, height } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const background = o.overlay?.background ? ` html, body { background: ${o.overlay.background.replace(/[;{}<>]/g, "")}; }` : "";
    await page.setContent(`<!doctype html><html><head><style>${PAGE_CSS} #title, #legend { display: none; }${background}${safeCss(o.overlay?.frame ?? o.overlay?.safe)}</style></head><body></body></html>`);
    await page.addScriptTag({ content: bundle });
    const direction = o.viewVectors?.[o.view] ?? VIEWS[o.view];
    const res = await page.evaluate(([p, d, opts]) => (globalThis as unknown as PageApi).loadScene(p, d, opts), [scene, direction, { floor: o.floor, title: o.title ?? "scene", environment: o.environment }] as const);
    if (errors.length) throw new RenderError(`the page failed: ${errors.join("; ")}`);
    if (res.error) throw new RenderError(res.error);
    await settle(page);
    if (o.overlay) await page.evaluate(overlayScript(o.overlay, Math.min(o.size, height)));
    await page.screenshot({ path: file, omitBackground: o.overlay?.background === "transparent" });
  } finally {
    await browser.close();
  }
}

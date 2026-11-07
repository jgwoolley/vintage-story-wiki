// The Node half of the renderer: reads each file (src/inputs.ts works out what it is), launches Playwright's headless Chromium
// (software WebGL, no X server), loads the bundled page (dist/page.js, built by esbuild.mjs) into a blank page and screenshots one
// view (or animation frame) at a time. Contact sheets are composed in the page and written from here.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import type { BlockColors } from "vs-schematic/blockColors.js";
import { attachToBase, compactShape, shapeToBoxes } from "vs-schematic/shapeBoxes.js";
import { gameAssetsCandidates, resolveTextures, TEXTURE_PROBE, type ResolvedTextures } from "vs-schematic/textureFiles.js";
import { defaultLocationEnv, resolveGameDir } from "../locations.js";
import { appDir } from "../paths.js";
import { frameLabel, outputName, sampleFrames, SCHEMATIC_VIEWS, type RenderOptions } from "./args.js";
import { InputError, loadBlockColors, loadInput, type ChiselInput, type LoadedInput, type SchematicInput, type SchematicSummary } from "./inputs.js";
import type { ChiselPayload, ModelOptions, PageApi, PageOptions, SchematicPayload } from "./protocol.js";
import { DEFAULT_VIEWS, VIEWS } from "./views.js";

const readOptional = (path: string) => readFile(path).then((b) => new Uint8Array(b), () => undefined);

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

export type RenderedInput =
  | { file: string; kind: "model"; summary: ModelSummary; images: string[]; centerPixels: Rgb[] }
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
    textures: [...new Set(boxes.map((b) => b.texture ?? ""))].sort(),
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
  let colors: BlockColors | null | undefined;

  // Read every file first, so a bad one fails before Chromium starts.
  const inputs: { file: string; input: LoadedInput; textures: ResolvedTextures }[] = [];
  for (const file of options.files) {
    try {
      // Block colors are only used by schematics and chisel shapes, but they're needed while reading the file; loaded once.
      colors ??= await loadBlockColors(options.blockColors, DEFAULT_BLOCK_COLORS);
      const input = await loadInput(file, { showFiller: options.showFiller, maxY: options.maxY, chisel: !options.noChisel, colors, gameAssets });
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
    const page = await browser.newPage({ viewport: { width: options.size, height: options.size } });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.setContent(`<!doctype html><html><head><style>${PAGE_CSS}</style></head><body></body></html>`);
    await page.addScriptTag({ content: bundle });
    // Each page.evaluate callback is serialized and runs in the page, where globalThis is the window with the PageApi functions
    // (src/page/main.ts); it can't use anything from this file's scope.
    const check = (file: string, error: string | null) => {
      if (errors.length) throw new RenderError(`${file}: the page failed: ${errors.join("; ")}`);
      if (error) throw new RenderError(`${file}: ${error}`);
    };

    for (const [n, { file, input, textures }] of inputs.entries()) {
      const result = summaries[n];
      const name = path.basename(file);
      const shoot = async (image: string) => {
        await settle(page);
        await page.screenshot({ path: image });
        result.images.push(image);
        result.centerPixels.push(await page.evaluate(`window.samplePixel(${options.size / 2}, ${options.size / 2})`));
      };

      if (input.kind !== "model") {
        for (const view of options.views ?? SCHEMATIC_VIEWS) {
          const opts: PageOptions = { floor: options.floor, title: `${name} - ${view}` };
          const res = input.kind === "schematic"
            ? await page.evaluate(([p, d, o]) => (globalThis as unknown as PageApi).loadSchematic(p, d, o), [schematicPayload(input), VIEWS[view], opts] as const)
            : await page.evaluate(([p, d, o]) => (globalThis as unknown as PageApi).loadChisel(p, d, o), [chiselPayload(input), VIEWS[view], opts] as const);
          check(file, res.error);
          await shoot(path.join(options.out, outputName(file, view)));
        }
        continue;
      }

      const summary = result.summary as ModelSummary;
      const load = async (view: string) => {
        const opts: ModelOptions = { floor: options.floor, title: `${name} - ${view}`, textures: textures.images, body: input.body };
        const res = await page.evaluate(([r, d, o]) => (globalThis as unknown as PageApi).loadModel(r, d, o), [input.raw, VIEWS[view], opts] as const);
        check(file, res.error);
        summary.textured = res.textured;
      };
      const animations = options.animations === "all" ? summary.animations : summary.animations.filter((a) => (options.animations as string[]).includes(a.code));

      if (!animations.length) {
        if (options.animations === "all") console.warn(`${file}: has no animations; rendering the rest pose`);
        for (const view of options.views ?? DEFAULT_VIEWS) {
          await load(view);
          await shoot(path.join(options.out, outputName(file, view)));
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

/** Waits two animation frames: the viewer draws on resize, and its ResizeObserver needs a frame to fire before a screenshot. */
async function settle(page: Page): Promise<void> {
  // A string, because this file has no DOM lib to type requestAnimationFrame.
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

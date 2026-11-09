// `vsdev screenshots [name...]`: renders the schematic screenshots listed in vs-manifest.json ("screenshots": name, schematic, camera
// angle...) to PNGs, e.g. for a ModDB page. The game and Mods folders come from the shared location rule (`vsdev paths`), so a project with
// ./vintagestory and ./Mods needs no setup, and vs-manifest.json's gameDir/dataDir override them.
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCommand } from "../args.js";
import { CliError, UsageError } from "../errors.js";
import { defaultLocationEnv, findConfig, resolveGameDir, resolveModsDir, type LocationEnv } from "../locations.js";
import { bold, cyan, dim, green } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";
import type { Corner } from "../render/args.js";
import { buildScene, type ScenePartSpec } from "../render/scene.js";
import { addReflection, gameAssetsFor, readOptional, renderFiles, renderLogoCard, renderScene, RenderError } from "../render/render.js";
import { VIEWS, type Vec3 } from "../render/views.js";

export const SCREENSHOTS_USAGE = `Usage: vsdev screenshots [name...] [--out <dir>] [--manifest <file>] [--list] [--json]

Renders the "screenshots" listed in vs-manifest.json, one PNG each (<out>/<name>.png), headless. With names, only those.

  {
    "screenshotsDir": "screenshots",
    "screenshots": [
      { "name": "ruin-front", "schematic": "betterruins:schematics/ruin.json", "view": "south" },
      { "name": "ruin-corner", "schematic": "schematics/mine.json", "view": [1, 0.6, 1.2], "size": 1600, "maxY": 12 }
    ]
  }

Each entry: name, "schematic" (or "model" for a shape file, drawn textured from the game client), and optionally view (default, south, east, north, top, back, or a direction [x, y, z] from the center:
y up, +z south, +x east), size (width in pixels, default 1280), height (default: same as size; 1920 x 1080 suits ModDB), floor, maxY (cutaway), showFiller.
Presets (preset): modicon (128x128, transparent, the game's icon), moddb-logo (480x480) and moddb-logo-wide (480x320). A ModDB logo is shown on the
mod's card with its text over the bottom part and a New!/Draft ribbon across the top-right corner, so these frame the subject above that;
safe: {"bottom": 0.3} sets your own margins. With only a "logo" (no schematic/model) the image fills the safe area: an icon.
Scenes: "scene" instead of one source places several parts in one image: models ({ "model", "at": [x, y, z] blocks, "rotationY" }) and a player
({ "player": { "wear": ["armor-body-antique-forlorn-pristine", ...], "hold": "rod-cupronickel", "holdScale", "animation": "insertgear", "frame": 30 },
"at", "facing": "west" }). The player is the seraph body in that animation, dressed in the worn items (found by code in the game's
itemtypes) and holding items at the game's hand attachment points; textures need the game client. Its front is west at rotationY 0.
Overlay options: title, subtitle, logo (an image file), textAt / logoAt (top-left, top-right, bottom-left, bottom-right), background (a CSS
color); output is the PNG's path (relative to vs-manifest.json) instead of <screenshotsDir>/<name>.png.
"schematic" and "model" are each a file relative to vs-manifest.json, or domain:path inside the game install's assets/ or a mod in Mods/ (zip or folder).
The game is ./vintagestory and the mods ./Mods unless vs-manifest.json (gameDir, dataDir), $VINTAGE_STORY or $VINTAGE_STORY_DATA say otherwise.
The image is bare (no title or legend). Blocks are drawn in block colors and chiseled blocks as cuboids; entities (players, creatures) in a schematic are not drawn.

  --out <dir>        output folder (default: vs-manifest.json screenshotsDir, else ./screenshots)
  --manifest <file>  the manifest to read (default: the nearest vs-manifest.json)
  --game-dir <dir>   the game install, -p/--data-dir <dir> the data (or Mods) folder, as the other commands
  --guides           also mark what a ModDB card covers (red) and write <name>-guides.png instead, to check a layout
  --list             show what would be rendered and where each schematic is found, render nothing
  --json             machine-readable result`;

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * Size presets. A ModDB logo is one of the mod's screenshots, 480x480 or 480x320, shown on the mod's card with the title, text and
 * download counts over its lower part (about the bottom quarter) and a "New!"/"Draft" ribbon across the top-right corner, so a square
 * logo frames the subject above that. A 480x320 upload needs no margin: BetterRuins' 480x320 art fills its whole height, and ModDB
 * itself makes the 480x480 version by adding the reflection below (the same art, reflection only in the square file). A modicon is the 128x128 icon the game itself shows: no card, so the whole image is used.
 */
export const PRESETS: Record<string, { size: number; height: number; safe?: Record<string, number>; background?: string }> = {
  modicon: { size: 128, height: 128, background: "transparent" },
  "moddb-logo": { size: 480, height: 480, safe: { bottom: 0.28 } },
  "moddb-logo-wide": { size: 480, height: 320 },
};

/** With a title inside a card's safe area, the model is framed above (or below) the title's band so the two don't overlap. */
export function titleBand(safe: ShotEntry["safe"], shot: ShotEntry): ShotEntry["safe"] {
  if (!(shot.title || shot.subtitle)) return undefined;
  const side = (shot.textAt ?? "top-left").startsWith("bottom") ? "bottom" : "top";
  const size = shot.titleSize ?? 0.075;
  const lines = Math.max(1, Math.ceil(((shot.title ?? "").length * 0.6 * size) / 0.9));
  const band = lines * size * 1.1 + (shot.subtitle ? size * 0.7 : 0) + 0.04;
  return { ...safe, [side]: (safe?.[side] ?? 0) + band };
}

export interface ShotEntry {
  /** A size preset: "modicon", "moddb-logo" or "moddb-logo-wide" (see PRESETS); explicit size/height/safe/background still win. */
  preset?: string;
  /** Fractions (0-1) of the image to keep clear on each side; the subject is framed in the rest. */
  safe?: { top?: number; right?: number; bottom?: number; left?: number };
  name: string;
  /** The schematic, or (with `model`) a shape file; one of the two. */
  schematic?: string;
  model?: string;
  /** Instead of one source: several models and a player placed together (see render/scene.ts), e.g. a player in armor beside a block. */
  scene?: ScenePartSpec[];
  /** Where the PNG goes, relative to vs-manifest.json, instead of <screenshotsDir>/<name>.png. */
  output?: string;
  title?: string;
  subtitle?: string;
  /** Title height as a fraction of the shorter side (default 0.075; the subtitle is 0.6 of it); raise it for a small icon. */
  titleSize?: number;
  /** An image (PNG, JPEG, SVG, WebP), relative to vs-manifest.json. */
  logo?: string;
  textAt?: string;
  logoAt?: string;
  background?: string;
  /** Add a faded reflection under the subject (it falls in the bottom part a ModDB card covers); needs a safe area or room below. */
  reflection?: boolean;
  view?: string | number[];
  size?: number;
  /** Height in pixels when not square (`size` is then the width). */
  height?: number;
  floor?: boolean;
  maxY?: number;
  showFiller?: boolean;
}

/** The entries of a parsed vs-manifest.json's "screenshots", checked; throws CliError naming the bad entry. */
export function readShots(manifest: unknown, file: string): ShotEntry[] {
  const list = (manifest as { screenshots?: unknown })?.screenshots;
  if (list === undefined) return [];
  const fail = (msg: string): never => { throw new CliError(`${file}: screenshots ${msg}`); };
  if (!Array.isArray(list)) fail("must be a list");
  const names = new Set<string>();
  return (list as unknown[]).map((raw, i) => {
    const e = raw as Record<string, unknown>;
    const at = `[${i}]${typeof e?.name === "string" ? ` (${e.name})` : ""}`;
    if (!e || typeof e !== "object") return fail(`${at} must be an object`);
    if (typeof e.name !== "string" || !/^[\w.-]+$/.test(e.name)) fail(`${at}: "name" must be a file name of letters, digits, . _ -`);
    if (names.has(e.name as string)) fail(`${at}: the name is used twice`);
    names.add(e.name as string);
    if (e.preset !== undefined && !(typeof e.preset === "string" && e.preset in PRESETS)) fail(`${at}: "preset" must be one of ${Object.keys(PRESETS).join(", ")}`);
    if (e.safe !== undefined && !(e.safe && typeof e.safe === "object" && Object.entries(e.safe).every(([k, v]) => ["top", "right", "bottom", "left"].includes(k) && typeof v === "number" && v >= 0 && v < 0.9))) fail(`${at}: "safe" must be {top,right,bottom,left} fractions from 0 to under 0.9`);
    const sources = ["schematic", "model", "scene"].filter((k) => e[k] !== undefined).length;
    const imageOnly = sources === 0 && typeof e.logo === "string";
    if (!imageOnly && sources !== 1) fail(`${at}: give exactly one of "schematic", "model" or "scene" (or only a "logo", for an icon)`);
    if (e.scene !== undefined) {
      const parts = e.scene;
      if (!Array.isArray(parts) || !parts.length) fail(`${at}: "scene" must be a list of parts`);
      (parts as Record<string, unknown>[]).forEach((p, j) => {
        const isModel = typeof p?.model === "string";
        const isPlayer = !!p?.player && typeof p.player === "object";
        if (isModel === isPlayer) fail(`${at}: scene[${j}] needs exactly one of "model" or "player"`);
        if (p.at !== undefined && !(Array.isArray(p.at) && p.at.length === 3 && p.at.every((n) => typeof n === "number"))) fail(`${at}: scene[${j}].at must be [x, y, z] in blocks`);
        if (p.facing !== undefined && !["north", "east", "south", "west"].includes(p.facing as string)) fail(`${at}: scene[${j}].facing must be north, east, south or west`);
        if (p.rotationY !== undefined && typeof p.rotationY !== "number") fail(`${at}: scene[${j}].rotationY must be degrees`);
      });
    }
    if (e.reflection !== undefined && typeof e.reflection !== "boolean") fail(`${at}: "reflection" must be true or false`);
    for (const k of ["title", "subtitle", "logo", "output", "background"]) if (e[k] !== undefined && (typeof e[k] !== "string" || !e[k])) fail(`${at}: "${k}" must be text`);
    if (e.titleSize !== undefined && !(typeof e.titleSize === "number" && e.titleSize > 0.02 && e.titleSize <= 0.4)) fail(`${at}: "titleSize" must be a fraction from 0.02 to 0.4`);
    for (const k of ["textAt", "logoAt"]) if (e[k] !== undefined && !CORNERS.includes(e[k] as string)) fail(`${at}: "${k}" must be one of ${CORNERS.join(", ")}`);
    const v = e.view;
    if (v !== undefined && !(typeof v === "string" && v in VIEWS) && !(Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && v.some((n) => n !== 0))) {
      fail(`${at}: "view" must be one of ${Object.keys(VIEWS).join(", ")} or [x, y, z]`);
    }
    if (e.size !== undefined && !(Number.isInteger(e.size) && (e.size as number) >= 64 && (e.size as number) <= 4096)) fail(`${at}: "size" must be a whole number from 64 to 4096`);
    if (e.height !== undefined && !(Number.isInteger(e.height) && (e.height as number) >= 64 && (e.height as number) <= 4096)) fail(`${at}: "height" must be a whole number from 64 to 4096`);
    if (e.maxY !== undefined && !(Number.isInteger(e.maxY) && (e.maxY as number) >= 0)) fail(`${at}: "maxY" must be a whole number, 0 or more`);
    return e as unknown as ShotEntry;
  });
}

/** A `domain:path` reference (not a Windows drive like C:\). */
export const isAssetRef = (s: string) => /^[a-z0-9_-]{2,}:[^\\]/i.test(s);

export interface Found {
  /** The file to read (a temp copy when it came out of a zip). */
  file: string;
  /** Where it is, for messages. */
  from: string;
}

const candidates = (rel: string) => (/\.(json|gz)$/i.test(rel) ? [rel] : [rel, `${rel}.json`, `${rel}.json.gz`]);

/** Looks for `domain:path` in the game's assets/, then each mod in `modsDir` (zips and unpacked folders); zip entries are copied into `tmp`. */
export function findAsset(ref: string, gameDir: string | undefined, modsDir: string | undefined, tmp: string): Found | undefined {
  const [domain, ...rest] = ref.split(":");
  const rel = rest.join(":").replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel.split("/").includes("..")) return undefined;
  const inTree = (root: string, from: string) => {
    for (const c of candidates(rel)) {
      const file = path.join(root, "assets", domain, c);
      if (existsSync(file) && statSync(file).isFile()) return { file, from };
    }
  };
  if (gameDir) {
    const hit = inTree(gameDir, `the game (${gameDir})`);
    if (hit) return hit;
  }
  if (modsDir && existsSync(modsDir)) {
    for (const entry of readdirSync(modsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(modsDir, entry.name);
      if (entry.isDirectory()) {
        const hit = inTree(p, `mod folder ${entry.name}`);
        if (hit) return hit;
      } else if (/\.zip$/i.test(entry.name)) {
        let zip: AdmZip;
        try { zip = new AdmZip(p); } catch { continue; }
        for (const c of candidates(rel)) {
          const e = zip.getEntry(`assets/${domain}/${c}`);
          if (!e || e.isDirectory) continue;
          const out = path.join(tmp, `${entry.name}-${path.basename(c)}`);
          writeFileSync(out, e.getData());
          return { file: out, from: `mod ${entry.name}` };
        }
      }
    }
  }
}

export async function runScreenshots(argv: string[], e: LocationEnv = defaultLocationEnv(userCwd())): Promise<number> {
  const { values, positionals } = parseCommand(argv, {
    out: { type: "string" }, manifest: { type: "string" }, "game-dir": { type: "string" }, "data-dir": { type: "string", short: "p" },
    list: { type: "boolean" }, guides: { type: "boolean" }, json: { type: "boolean" },
  });
  if (values.help) {
    console.log(SCREENSHOTS_USAGE);
    return 0;
  }
  const manifestFile = values.manifest ? path.resolve(e.cwd, values.manifest) : findConfig(e.cwd)?.file;
  if (!manifestFile || !existsSync(manifestFile)) throw new CliError("no vs-manifest.json found (here or in a parent folder); add a \"screenshots\" list to one, see `vsdev screenshots --help`");
  const manifestDir = path.dirname(manifestFile);
  let manifest: { screenshotsDir?: string };
  try { manifest = JSON.parse(readFileSync(manifestFile, "utf8")); } catch (err) { throw new CliError(`${manifestFile}: ${(err as Error).message}`); }
  const shots = readShots(manifest, manifestFile);
  if (!shots.length) throw new CliError(`${manifestFile} has no "screenshots"; see \`vsdev screenshots --help\``);
  const unknown = positionals.filter((n) => !shots.some((s) => s.name === n));
  if (unknown.length) throw new UsageError(`no screenshot named ${unknown.join(", ")}; the manifest has ${shots.map((s) => s.name).join(", ")}`);
  const chosen = positionals.length ? shots.filter((s) => positionals.includes(s.name)) : shots;

  const out = path.resolve(values.out ? e.cwd : manifestDir, values.out ?? manifest.screenshotsDir ?? "screenshots");
  const env = { ...e, config: findConfig(path.dirname(manifestFile)) ?? null };
  const gameDir = resolveGameDir({ mode: "read", flag: values["game-dir"] }, env).path;
  const modsDir = resolveModsDir({ mode: "read", flag: values["data-dir"] }, env).path;
  const tmp = mkdtempSync(path.join(tmpdir(), "vsdev-shots-"));
  const results: { name: string; schematic: string; from: string; png?: string }[] = [];
  try {
    // Find every source file and logo first, so a typo fails before the browser starts.
    const located = chosen.map((s) => {
      if (s.scene) return { shot: s, ref: `scene of ${s.scene.length} parts`, what: "scene", found: { file: "", from: "scene" } as Found };
      if (!s.schematic && !s.model) return { shot: s, ref: s.logo!, what: "logo", found: { file: "", from: "logo only" } as Found };
      const ref = (s.schematic ?? s.model)!;
      const what = s.schematic ? "schematic" : "model";
      if (!isAssetRef(ref)) {
        const file = path.resolve(manifestDir, ref);
        if (!existsSync(file)) throw new CliError(`${s.name}: ${what} ${ref} not found (relative to ${manifestDir})`);
        return { shot: s, ref, what, found: { file, from: "file" } as Found };
      }
      const found = findAsset(ref, gameDir, modsDir, tmp);
      if (!found) throw new CliError(`${s.name}: ${what} ${ref} not found in the game (${gameDir ?? "none found"}) or the mods (${modsDir ?? "none found"}); \`vsdev paths\` shows where vsdev looks`);
      return { shot: s, ref, what, found };
    });
    const logos = new Map<string, string>();
    for (const { shot } of located) {
      if (!shot.logo || logos.has(shot.logo)) continue;
      const file = path.resolve(manifestDir, shot.logo);
      const mime = IMAGE_TYPES[path.extname(file).toLowerCase()];
      if (!mime) throw new CliError(`${shot.name}: logo ${shot.logo} must be a ${Object.keys(IMAGE_TYPES).join(", ")} file`);
      if (!existsSync(file)) throw new CliError(`${shot.name}: logo ${shot.logo} not found (relative to ${manifestDir})`);
      logos.set(shot.logo, `data:${mime};base64,${readFileSync(file).toString("base64")}`);
    }
    const target = (shot: ShotEntry) => {
      if (!shot.output) return { dir: out, file: `${shot.name}.png` };
      const full = path.resolve(manifestDir, shot.output);
      return { dir: path.dirname(full), file: path.basename(full) };
    };
    if (values.list) {
      for (const { shot, ref, found } of located) results.push({ name: shot.name, schematic: ref, from: found.from, png: path.join(target(shot).dir, target(shot).file) });
    } else {
      for (const { shot, ref, what, found } of located) {
        const vector = Array.isArray(shot.view) ? (shot.view as Vec3) : undefined;
        const view = vector ? "custom" : (shot.view as string | undefined) ?? "default";
        const preset = shot.preset ? PRESETS[shot.preset] : undefined;
        const { dir, file: plainFile } = target(shot);
        const file = values.guides ? plainFile.replace(/(\.png)?$/, "-guides.png") : plainFile;
        mkdirSync(dir, { recursive: true });
        const safe = shot.safe ?? preset?.safe;
        const background = shot.background ?? preset?.background;
        const overlay = shot.title || shot.subtitle || shot.logo || background || safe || values.guides
          ? { title: shot.title, subtitle: shot.subtitle, titleSize: shot.titleSize, logo: shot.logo ? logos.get(shot.logo) : undefined, textAt: shot.textAt as Corner | undefined, logoAt: shot.logoAt as Corner | undefined, background: shot.reflection ? "transparent" : background, safe, frame: titleBand(safe, shot), guides: !!values.guides }
          : undefined;
        const width = shot.size ?? preset?.size ?? 1280;
        const height = shot.height ?? preset?.height;
        if (what === "scene") {
          const gameAssets = await gameAssetsFor(gameDir, e.cwd).catch(() => undefined);
          const scene = await buildScene(shot.scene!, {
            findFile: (ref) => (isAssetRef(ref) ? findAsset(ref, gameDir, modsDir, tmp)?.file : existsSync(path.resolve(manifestDir, ref)) ? path.resolve(manifestDir, ref) : undefined),
            gameAssets, typesAssets: gameDir ? path.join(gameDir, "assets") : undefined, read: readOptional,
          });
          for (const w of scene.warnings) console.warn(`${shot.name}: ${w}`);
          try {
            await renderScene({ boxes: scene.boxes, textures: scene.textures }, path.join(dir, file), { size: width, height, view, viewVectors: vector ? { custom: vector } : undefined, floor: !!shot.floor, overlay });
          } catch (err) {
            if (err instanceof RenderError) throw new CliError(`${shot.name}: ${err.message}`);
            throw err;
          }
          if (shot.reflection && !values.guides) await addReflection(path.join(dir, file), background ?? "transparent");
          results.push({ name: shot.name, schematic: ref, from: found.from, png: path.join(dir, file) });
          continue;
        }
        if (what === "logo") {
          await renderLogoCard(path.join(dir, file), width, height ?? width, overlay!);
          results.push({ name: shot.name, schematic: ref, from: found.from, png: path.join(dir, file) });
          continue;
        }
        try {
          const [r] = await renderFiles({
            files: [found.file], out: dir, size: width, height, views: [view], viewVectors: vector ? { custom: vector } : undefined,
            fileName: file, bare: true, overlay, floor: !!shot.floor, noTextures: what === "schematic", animations: [], frames: 8, showFiller: !!shot.showFiller,
            maxY: shot.maxY, noChisel: false, list: false, json: false, game: gameDir, cwd: e.cwd,
          });
          if (shot.reflection && !values.guides) await addReflection(path.join(dir, file), background ?? "transparent");
          if ((r.kind === "model") !== (what === "model")) throw new CliError(`${shot.name}: ${ref} is a ${r.kind === "model" ? "model" : r.kind}, not a ${what}; use the "${r.kind === "model" ? "model" : "schematic"}" key`);
          results.push({ name: shot.name, schematic: ref, from: found.from, png: r.images[0] });
        } catch (err) {
          if (err instanceof RenderError) throw new CliError(`${shot.name}: ${err.message}`);
          throw err;
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (values.json) {
    console.log(JSON.stringify({ manifest: manifestFile, out, screenshots: results }, null, 2));
    return 0;
  }
  const rel = (f: string) => path.relative(e.cwd, f) || f;
  for (const r of results) console.log(`${bold(r.name)}  ${dim(r.schematic)} ${dim(`[${r.from}]`)}${r.png ? `\n  ${green("→")} ${cyan(rel(r.png))}` : ""}`);
  return 0;
}

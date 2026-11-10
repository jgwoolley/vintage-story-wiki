// Command-line parsing for the renderer, kept free of I/O so it can be tested on its own.
import { UsageError } from "../errors.js";
import { DEFAULT_VIEWS, SHEET_VIEWS, VIEWS, type Vec3 } from "./views.js";

export { UsageError };

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** What `vsdev screenshots` draws over a render: a title, a smaller line under it, a logo, on a chosen background. */
export interface Overlay {
  title?: string;
  subtitle?: string;
  /** Title text height as a fraction of the image's shorter side; default 0.075 (the subtitle is 0.6 of it). */
  titleSize?: number;
  /** The logo as a data: URL. */
  logo?: string;
  /** Where the text block sits; default top-left. */
  textAt?: Corner;
  /** Where the logo sits; default top-right. */
  logoAt?: Corner;
  /** Page background (a CSS color, or "transparent" for a transparent PNG); default the renderer's dark grey. */
  background?: string;
  /** Fractions (0-1) of the image left free on each side: the model is framed in what remains (e.g. the part of a ModDB card its text doesn't cover). */
  safe?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  /** Insets the model is framed in when they differ from `safe` (e.g. `safe` plus a band for the title); default `safe`. */
  frame?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  /** Dim the parts a ModDB card covers (`safe`'s margins and the corner ribbon), to check a layout. */
  guides?: boolean;
  /** Draw only the logo, filling the safe area, with no model (an icon). */
  logoFill?: boolean;
}

export interface RenderOptions {
  /** Files to render (models, schematics, ChiselTools shapes), as given (resolved against the caller's working directory by the CLI). */
  files: string[];
  /** Output directory. */
  out: string;
  /** Width and height of each PNG, in CSS pixels. */
  size: number;
  /** View names from VIEWS, in order; undefined uses each kind's default (DEFAULT_VIEWS for models, SCHEMATIC_VIEWS otherwise). */
  views?: string[];
  /** Draw the one-block floor grid under the model. */
  floor: boolean;
  /** Draw grass to the horizon at ground level instead of the floor grid (the game's grass texture when a client is found). */
  grass?: boolean;
  /** Draw a sky behind the model (the game's sky colours when a client is found). */
  sky?: boolean;
  /** --game-dir: the game client install (or its assets folder) to read textures from; the model's own assets tree is searched first. */
  game?: string;
  /** Draw untextured (one color per texture key), as the wiki does. */
  noTextures: boolean;
  /** Animation codes to render as frames + a contact sheet, or "all"; empty renders the rest pose. */
  animations: string[] | "all";
  /** Frames sampled evenly over each animation. */
  frames: number;
  /** Render this one frame of the (single) animation for every view, instead of a sheet. */
  frame?: number;
  /** Contact sheet columns (default: up to 4). */
  columns?: number;
  /** BlockColorMod JSON for schematic and chisel colors (default: the wiki's bundled copy). */
  blockColors?: string;
  /** Draw meta-filler blocks, which are hidden by default. */
  showFiller: boolean;
  /** Leave out schematic blocks above this y (a cutaway). */
  maxY?: number;
  /** Draw a schematic's chiseled blocks as whole cubes instead of their cuboids. */
  noChisel: boolean;
  /** Where a schematic's statues (Player Statues mod) find their shapes and item types; without it they are drawn as their block. */
  statueIo?: import("@nf3t/vs-schematic/statue.js").StatueIo;
  /** Print what each file is, render nothing. */
  list: boolean;
  /** Print results as JSON on stdout. */
  json: boolean;
  /** Extra named view directions (beyond VIEWS) a caller supplies, e.g. a screenshot's own camera angle. */
  viewVectors?: Record<string, Vec3>;
  /** Image height when it should differ from `size` (the width), e.g. 1080 for a 1920 x 1080 ModDB image. */
  height?: number;
  /** Text and a logo drawn over the image (implies bare). */
  overlay?: Overlay;
  /** Leave out the title and the legend, for a clean image. */
  bare?: boolean;
  /** With exactly one view: the PNG's file name (instead of <name>-<view>.png). */
  fileName?: string;
  /** The working directory the game location rule starts from (./vintagestory, vs-manifest.json). */
  cwd?: string;
  /** Models: report what is wrong with the shape (src/shape/check.ts) instead of rendering; with --sheet or --compare, as well as. */
  check?: boolean;
  /** With `check`: warnings fail too (the caller exits non-zero). */
  strict?: boolean;
  /** Models: draw the x/y/z axes from the block's origin with their compass names, the outline of the block (0..16) and the floor grid. */
  grid?: boolean;
  /** Models: draw without perspective, the four side views square on (true elevations and plans). */
  ortho?: boolean;
  /** Models: "element" draws untextured, one color per element name, with the names as the legend. */
  colorBy?: "element";
  /** Models: element names (a "*" matches any run of characters) to draw solid while the rest is ghosted. A name also matches its children. */
  highlight?: string[];
  /** Models: element names (as `highlight`) left out, to see what is behind or inside them. */
  hide?: string[];
  /** Models: write one <name>-sheet.png with every view (SHEET_VIEWS, or `views`) instead of a PNG per view. */
  sheet?: boolean;
  /** Models: an older version of the (one) file; writes <name>-compare.png, before over after, and reports which elements changed. */
  compare?: string;
}

/** Views for schematics and chisel shapes, which have no front: three-quarter, plan and two elevations. */
export const SCHEMATIC_VIEWS = ["default", "top", "south", "east"];

export const USAGE = `Usage: vsdev render <file>... [options]   (in the repo: npm run render -w @nf3t/vsdev -- <file>...)

Renders Vintage Story files to <out>/<name>-<view>.png, headless:
  model (shape) files      with their real textures when found (in the model's own assets/<domain>/ tree or the --game install),
                           otherwise one color per texture key; worn items are placed on the player body; animations on request
  schematics (.json/.gz)   one cell per block in its block color; chiseled blocks drawn as their cuboids; meta-filler hidden;
                           Player Statues statues drawn as their figure (shapes from the game and the mod in Mods/)
  ChiselTools shapes (.pf) the chiseled block, in its materials' block colors
The kind is worked out from the file's content.

Options:
  --out <dir>          output directory (default: ./.vsdev/renders)
  --size <px>          image width and height (default: 640)
  --views <a,b,...>    views to render (default: models ${DEFAULT_VIEWS.join(",")}, others ${SCHEMATIC_VIEWS.join(",")}; available: ${Object.keys(VIEWS).join(", ")})
  --floor              draw a one-block grid at ground level
  --grass              draw grass out to the horizon at ground level (instead of --floor)
  --sky                draw a sky behind it
                       (both use the game client's own textures when one is found, built-in colors otherwise; also for schematics)
  --list               print what each file is (boxes, animations, blocks...) without rendering
  --json               print the results as JSON

Models:
  --game-dir <dir>     Vintage Story client install (or its assets folder) to read textures from (--game is the same). Default:
                       $VINTAGE_STORY, vs-manifest.json gameDir, ./vintagestory, then an installed client (vsdev paths)
  --no-textures        draw untextured, one color per texture key
  --animation <a,b>    render these animations (codes, or "all"): for each, --frames frames and a contact sheet of them,
                       in the first view only unless --views is given
  --frames <n>         frames sampled evenly over each animation (default: 8)
  --frame <n>          instead of a sheet, render frame n of the one --animation in every view
  --columns <n>        contact sheet columns (default: up to 4)

Models, to check your own work (see also \`vsdev shape\`, which builds models from a spec):
  --check              no picture: report what a picture hides. Errors: a part that touches nothing and isn't on the ground. Warnings:
                       faces in one plane in different textures (they flicker in game), a flat element lying in a face, UVs outside
                       the texture. Then the bounds in units and blocks, where it leaves the block (0..16), and every element's box
                       by name. Exits 1 on errors (--strict: on warnings too). With --sheet or --compare the picture is made as well
  --sheet              one PNG, <name>-sheet.png, with every view (${SHEET_VIEWS.join(", ")}; or --views), the sides
                       drawn flat and each cell saying which way is right: one image to read instead of five
  --grid               draw the axes from the block's origin (x east red, y up green, z south blue), the outline of the block
                       (0..16, for scale) and the floor grid
  --ortho              no perspective, side views square on (a sheet's side views always are)
  --color-by element   untextured, one color per element name, the names as the legend: which box is which
  --highlight <a,b>    draw these elements (names; "*" allowed; children included) solid and ghost the rest
  --hide <a,b>         leave these elements out (to look inside or behind)
  --compare <old>      <name>-compare.png: the old file above the new one in the same views, and the elements added, removed
                       and moved

Schematics and ChiselTools shapes:
  --block-colors <f>   BlockColorMod JSON with the block colors (default: the wiki's apps/vs-wiki/site/assets/Nf3tBlockColors.json)
  --show-filler        draw meta-filler blocks (hidden by default)
  --max-y <n>          leave out blocks above y = n (a cutaway, to see inside)
  --no-chisel          draw chiseled blocks as whole cubes

  --help               show this text`;


export function parseArgs(argv: string[], defaultOut: string): RenderOptions | "help" {
  const options: RenderOptions = {
    files: [], out: defaultOut, size: 640, floor: false, noTextures: false, animations: [], frames: 8,
    showFiller: false, noChisel: false, list: false, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    const integer = (min: number, max: number) => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${arg} must be a whole number from ${min} to ${max}`);
      return n;
    };
    switch (arg) {
      case "--help":
      case "-h":
        return "help";
      case "--out":
        options.out = value();
        break;
      case "--size":
        options.size = integer(64, 4096);
        break;
      case "--views": {
        const views = value().split(",").map((v) => v.trim()).filter(Boolean);
        const unknown = views.filter((v) => !(v in VIEWS));
        if (unknown.length) throw new UsageError(`unknown view ${unknown.join(", ")}; available: ${Object.keys(VIEWS).join(", ")}`);
        if (!views.length) throw new UsageError("--views needs at least one view");
        options.views = views;
        break;
      }
      case "--floor":
        options.floor = true;
        break;
      case "--grass":
        options.grass = true;
        break;
      case "--sky":
        options.sky = true;
        break;
      case "--game":
      case "--game-dir":
        options.game = value();
        break;
      case "--no-textures":
        options.noTextures = true;
        break;
      case "--animation":
      case "--animations": {
        const codes = value().split(",").map((v) => v.trim()).filter(Boolean);
        options.animations = codes.includes("all") ? "all" : codes;
        break;
      }
      case "--frames":
        options.frames = integer(1, 240);
        break;
      case "--frame": {
        const n = Number(value());
        if (!Number.isFinite(n) || n < 0) throw new UsageError("--frame must be a frame number (0 or more)");
        options.frame = n;
        break;
      }
      case "--columns":
        options.columns = integer(1, 64);
        break;
      case "--block-colors":
        options.blockColors = value();
        break;
      case "--show-filler":
        options.showFiller = true;
        break;
      case "--max-y":
        options.maxY = integer(0, 1023);
        break;
      case "--no-chisel":
        options.noChisel = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--grid":
        options.grid = true;
        break;
      case "--ortho":
        options.ortho = true;
        break;
      case "--sheet":
        options.sheet = true;
        break;
      case "--color-by": {
        const by = value();
        if (by !== "element") throw new UsageError(`--color-by takes "element"`);
        options.colorBy = by;
        break;
      }
      case "--highlight":
      case "--hide": {
        const names = value().split(",").map((v) => v.trim()).filter(Boolean);
        if (!names.length) throw new UsageError(`${arg} needs at least one element name`);
        options[arg === "--hide" ? "hide" : "highlight"] = names;
        break;
      }
      case "--compare":
        options.compare = value();
        break;
      default:
        if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}`);
        options.files.push(arg);
    }
  }
  if (!options.files.length) throw new UsageError("no file given");
  if (options.frame !== undefined && (options.animations === "all" || options.animations.length !== 1)) {
    throw new UsageError("--frame needs exactly one --animation code");
  }
  if (options.strict && !options.check) throw new UsageError("--strict goes with --check");
  if (options.compare && options.files.length !== 1) throw new UsageError("--compare takes one file to compare with the old one");
  const animated = options.animations === "all" || options.animations.length > 0;
  if (animated && (options.sheet || options.compare)) throw new UsageError("--sheet and --compare draw the rest pose; drop --animation");
  return options;
}

/** A file's name without its folder and its `.json`, `.json.gz`, `.gz` or `.pf` extension. */
export function baseName(file: string): string {
  return file.split(/[\\/]/).pop()!.replace(/\.(json\.gz|json|gz|pf)$/i, "");
}

/** The output name for a file and view, plus an animation and frame (`f007`) or `sheet` when rendering one. */
export function outputName(file: string, view: string, animation?: { code: string; part: number | "sheet" }): string {
  const suffix = !animation ? "" : `-${animation.code.replace(/[^\w.-]+/g, "_")}-${animation.part === "sheet" ? "sheet" : `f${frameLabel(animation.part)}`}`;
  return `${baseName(file)}-${view}${suffix}.png`;
}

/** A frame number for file names and sheet labels: whole frames padded to 3 digits, fractions kept (`012`, `7.5`). */
export function frameLabel(frame: number): string {
  return Number.isInteger(frame) ? String(frame).padStart(3, "0") : String(Math.round(frame * 100) / 100);
}

/** `count` frames evenly spaced over [0, length) (the end is the start again for a looping animation). */
export function sampleFrames(length: number, count: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => Math.round(((i * Math.max(1, length)) / n) * 100) / 100);
}

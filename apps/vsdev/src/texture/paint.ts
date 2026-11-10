// `vsdev texture`'s painter: a texture is a size, a seed and a list of layers, painted in order onto an RGBA canvas. Every layer is a
// mask (how much of each pixel it covers, 0..1) and a paint: `color` (mix towards a color) or `shade` (multiply the brightness: 0.6
// darkens, 1.3 lightens). Noise wraps around the edges, so textures tile without seams. Everything random is drawn from a generator
// seeded by the texture's seed and the layer's position, so a run repeats exactly, and changing one layer leaves the others' randomness
// as it was.
import { SpecError } from "../gen/spec.js";
import type { RgbaImage } from "../gen/png.js";

export type ColorValue = string | number[];
type Vec2 = [number, number];

/** One layer; `type` picks what it draws. Fields not used by a type are ignored. */
export interface TextureLayer {
  type: "fill" | "gradient" | "noise" | "grain" | "speckle" | "scratches" | "border" | "bevel" | "circle" | "line" | "bricks" | "pixels" | "custom";
  color?: ColorValue;
  shade?: number;
  /** 0..1, how strongly the layer paints (default 1). */
  opacity?: number;
  /** [x, y, w, h]: the layer only paints inside this rectangle (and border/bevel/gradient/bricks use it as their box). */
  region?: number[];
  /** Mixed into this layer's random seed: change it to reroll one layer. */
  seed?: number;
  /**
   * Where the layer paints, beyond `region`: pixel art ({ rows, at?, scale?, keys? }: the characters in `keys`, default any but "."
   * and " ", count; `invert` swaps), or in a JS spec a function (x, y) => 0..1.
   */
  mask?: MaskSpec | ((x: number, y: number) => number);
  [key: string]: unknown;
}

export interface TextureSpec {
  /** Pixels: one number for a square, or [width, height]. Default 16. */
  size?: number | number[];
  seed?: number;
  layers: TextureLayer[];
}

type Rgba = [number, number, number, number];

export interface MaskSpec { rows: string[]; at?: number[]; scale?: number; keys?: string; invert?: boolean; mirror?: boolean }

/** What a "custom" layer's `draw` gets: the canvas, this layer's random numbers, and the same painting the other layers use. */
export interface CustomContext {
  width: number;
  height: number;
  /** This layer's seeded random numbers (0..1): the same every run. */
  random: () => number;
  /** A color: "#rrggbb", [r, g, b(, a)] or a name from the spec's "colors". */
  color: (c: ColorValue) => Rgba;
  /** The pixel now (RGBA 0..255); off the canvas, undefined. */
  get: (x: number, y: number) => Rgba | undefined;
  /** Sets a pixel outright (no mixing, no region or mask). */
  set: (x: number, y: number, c: ColorValue) => void;
  /** Mixes a color into a pixel by t (0..1), through the layer's region, mask and opacity (default color: the layer's "color"). */
  paint: (x: number, y: number, t: number, c?: ColorValue) => void;
  /** Multiplies a pixel's brightness toward f by t, through the region, mask and opacity. */
  shade: (x: number, y: number, t: number, f: number) => void;
  /** Tiling, equalized value noise over the canvas (0..1 per pixel, row by row), from this layer's random numbers. */
  noise: (scale: number, octaves?: number) => Float32Array;
}

function maskFunction(mask: TextureLayer["mask"], where: string): ((x: number, y: number) => number) | undefined {
  if (mask === undefined) return undefined;
  if (typeof mask === "function") return (x, y) => clamp01(Number(mask(x, y)) || 0);
  if (!mask || typeof mask !== "object" || !Array.isArray(mask.rows) || !mask.rows.every((r) => typeof r === "string")) {
    throw new SpecError(`${where}: "mask" is { "rows": [...] } (pixel art, "at", "scale", "keys") or, in a JS spec, a function (x, y) => 0..1`);
  }
  const rows = mask.mirror ? mirrorRows(mask.rows) : mask.rows;
  const [ax, ay] = Array.isArray(mask.at) && mask.at.length === 2 ? mask.at : [0, 0];
  const scale = typeof mask.scale === "number" && mask.scale >= 1 ? mask.scale : 1;
  const counts = (ch: string | undefined) => ch !== undefined && (mask.keys ? mask.keys.includes(ch) : ch !== "." && ch !== " ");
  return (x, y) => {
    const r = Math.floor((y - ay) / scale), c = Math.floor((x - ax) / scale);
    const on = r >= 0 && c >= 0 && counts(rows[r]?.[c]);
    return on !== !!mask.invert ? 1 : 0;
  };
}

export function parseColor(value: unknown, named: Record<string, ColorValue>, where: string, depth = 0): Rgba {
  if (Array.isArray(value) && (value.length === 3 || value.length === 4) && value.every((v) => typeof v === "number")) {
    return [value[0], value[1], value[2], value[3] ?? 255];
  }
  if (typeof value !== "string") throw new SpecError(`${where}: a color is "#rrggbb", "#rrggbbaa", [r, g, b(, a)], "transparent" or a name from "colors"`);
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4, 6].map((i) => (i < full.length ? parseInt(full.slice(i, i + 2), 16) : 255)) as Rgba;
  }
  if (Object.hasOwn(named, value) && depth < 8) return parseColor(named[value], named, `${where} (color "${value}")`, depth + 1);
  throw new SpecError(`${where}: unknown color "${value}"${Object.keys(named).length ? ` (named colors: ${Object.keys(named).join(", ")})` : ""}`);
}

/** mulberry32: small, fast, and the same sequence in every JS engine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (...n: number[]) => n.reduce((h, v) => Math.imul(h ^ (v | 0), 0x9e3779b1) >>> 0, 0x811c9dc5);

/**
 * Tiling value noise, `octaves` layers each twice as fine, then equalized so the values spread evenly over 0..1: a threshold of
 * 0.8 is then exactly the top 20% of pixels, which is what `coverage` relies on.
 */
export function tilingNoise(w: number, h: number, scale: number, octaves: number, random: () => number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1, cell = Math.max(1, scale);
  for (let o = 0; o < octaves; o++, amp /= 2, cell = Math.max(1, cell / 2)) {
    const gx = Math.max(1, Math.round(w / cell)), gy = Math.max(1, Math.round(h / cell));
    const grid = Float32Array.from({ length: gx * gy }, random);
    for (let y = 0; y < h; y++) {
      const fy = (y * gy) / h, y0 = Math.floor(fy), ty = smooth(fy - y0);
      for (let x = 0; x < w; x++) {
        const fx = (x * gx) / w, x0 = Math.floor(fx), tx = smooth(fx - x0);
        const at = (i: number, j: number) => grid[(j % gy) * gx + (i % gx)];
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx, bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        out[y * w + x] += amp * (top * (1 - ty) + bottom * ty);
      }
    }
  }
  const order = [...out.keys()].sort((a, b) => out[a] - out[b]);
  const n = Math.max(1, order.length - 1);
  order.forEach((i, rank) => (out[i] = rank / n));
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

class Canvas {
  readonly px: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Float32Array(w * h * 4);
  }
}

/** Paints one texture. `named` are the spec's `colors`; `where` prefixes error messages. */
export function paintTexture(spec: TextureSpec, named: Record<string, ColorValue>, where: string): RgbaImage {
  const size = spec.size ?? 16;
  const [w, h] = typeof size === "number" ? [size, size] : size;
  if (![w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= 4096)) throw new SpecError(`${where}: size must be 1..4096 pixels (a number, or [width, height])`);
  if (!Array.isArray(spec.layers) || !spec.layers.length) throw new SpecError(`${where}: needs a "layers" list`);
  const canvas = new Canvas(w, h);
  spec.layers.forEach((layer, i) => paintLayer(canvas, layer, named, rng(hash(spec.seed ?? 0, i, layer.seed ?? 0)), `${where} layer ${i + 1} (${layer?.type})`));
  return { width: w, height: h, data: Uint8Array.from(canvas.px, (v) => Math.round(v < 0 ? 0 : v > 255 ? 255 : v)) };
}

function num(layer: TextureLayer, key: string, fallback: number, where: string, min = -Infinity, max = Infinity): number {
  const v = layer[key] ?? fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new SpecError(`${where}: "${key}" must be a number${min > -Infinity ? ` from ${min}` : ""}${max < Infinity ? ` to ${max}` : ""}`);
  return v;
}

function vec(layer: TextureLayer, key: string, where: string, fallback?: Vec2): Vec2 {
  const v = layer[key] ?? fallback;
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number")) throw new SpecError(`${where}: "${key}" must be [x, y]`);
  return v as Vec2;
}

function paintLayer(c: Canvas, layer: TextureLayer, named: Record<string, ColorValue>, random: () => number, where: string): void {
  if (!layer || typeof layer !== "object") throw new SpecError(`${where}: a layer is an object with a "type"`);
  const { w, h, px } = c;
  const opacity = num(layer, "opacity", 1, where, 0, 1);
  const r = layer.region ?? [0, 0, w, h];
  if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === "number")) throw new SpecError(`${where}: "region" must be [x, y, width, height]`);
  const [rx, ry, rw, rh] = r;
  const inRegion = (x: number, y: number) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  const wrapX = (x: number) => ((x % w) + w) % w, wrapY = (y: number) => ((y % h) + h) % h;

  const color = layer.color !== undefined ? parseColor(layer.color, named, where) : undefined;
  const shade = layer.shade !== undefined ? num(layer, "shade", 1, where, 0) : undefined;
  if (color && shade !== undefined) throw new SpecError(`${where}: give "color" or "shade", not both`);
  /** Paints pixel (x, y) by t (0..1) with this layer's color or shade; off-region and off-canvas pixels are left alone. */
  const mask = maskFunction(layer.mask, where);
  const paint = (x: number, y: number, t: number, col: Rgba | null | undefined = color, sh = shade) => {
    if (x < 0 || y < 0 || x >= w || y >= h || !inRegion(x, y)) return;
    t = clamp01(t) * opacity * (mask ? mask(x, y) : 1);
    if (t <= 0) return;
    const o = (y * w + x) * 4;
    if (col) for (let k = 0; k < 4; k++) px[o + k] += (col[k] - px[o + k]) * t;
    else if (sh !== undefined) for (let k = 0; k < 3; k++) px[o + k] *= 1 + (sh - 1) * t;
  };
  const needsPaint = () => {
    if (!color && shade === undefined) throw new SpecError(`${where}: needs "color" or "shade"`);
  };
  const forRegion = (fn: (x: number, y: number) => void) => {
    for (let y = Math.max(0, ry); y < Math.min(h, ry + rh); y++) for (let x = Math.max(0, rx); x < Math.min(w, rx + rw); x++) fn(x, y);
  };

  switch (layer.type) {
    case "fill":
      needsPaint();
      forRegion((x, y) => paint(x, y, 1));
      return;
    case "gradient": {
      needsPaint();
      const dir = layer.direction ?? "down", power = num(layer, "power", 1, where, 0.01);
      const cx = rx + (rw - 1) / 2, cy = ry + (rh - 1) / 2;
      const f: Record<string, (x: number, y: number) => number> = {
        down: (_x, y) => (y - ry) / Math.max(1, rh - 1), up: (_x, y) => 1 - (y - ry) / Math.max(1, rh - 1),
        right: (x) => (x - rx) / Math.max(1, rw - 1), left: (x) => 1 - (x - rx) / Math.max(1, rw - 1),
        radial: (x, y) => Math.hypot((x - cx) / (rw / 2), (y - cy) / (rh / 2)),
        edges: (x, y) => Math.max(Math.abs(x - cx) / (rw / 2), Math.abs(y - cy) / (rh / 2)),
      };
      if (typeof dir !== "string" || !f[dir]) throw new SpecError(`${where}: "direction" is one of ${Object.keys(f).join(", ")}`);
      forRegion((x, y) => paint(x, y, clamp01(f[dir](x, y)) ** power));
      return;
    }
    case "noise": {
      needsPaint();
      const n = tilingNoise(w, h, num(layer, "scale", Math.max(w, h) / 4, where, 1), num(layer, "octaves", 1, where, 1, 8), random);
      const coverage = layer.coverage === undefined ? undefined : num(layer, "coverage", 0, where, 0, 1);
      const softness = num(layer, "softness", 0.1, where, 0, 1);
      forRegion((x, y) => {
        const v = n[y * w + x];
        paint(x, y, coverage === undefined ? v : coverage <= 0 ? 0 : softness ? (v - (1 - coverage)) / softness : v >= 1 - coverage ? 1 : 0);
      });
      return;
    }
    case "grain": {
      const amount = num(layer, "amount", 0.15, where, 0, 1);
      const n = tilingNoise(w, h, num(layer, "scale", 1, where, 1), num(layer, "octaves", 1, where, 1, 8), random);
      forRegion((x, y) => paint(x, y, 1, undefined, 1 + amount * (2 * n[y * w + x] - 1)));
      return;
    }
    case "speckle": {
      needsPaint();
      const density = num(layer, "density", 0.02, where, 0, 1), size = num(layer, "size", 1, where, 1, 16);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (random() >= density) continue;
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) paint(wrapX(x + dx), wrapY(y + dy), 1);
      }
      return;
    }
    case "scratches": {
      const count = num(layer, "count", 4, where, 0, 10000);
      const len = layer.length ?? [3, 7];
      const [lo, hi] = typeof len === "number" ? [len, len] : (len as number[]);
      if (typeof lo !== "number" || typeof hi !== "number" || lo < 1 || hi < lo) throw new SpecError(`${where}: "length" is a number or [min, max]`);
      const sh = color ? undefined : (shade ?? 1.35);
      const dirs: Vec2[] = [[1, 0], [1, 1], [1, -1], [0, 1]];
      for (let s = 0; s < count; s++) {
        let x = rx + Math.floor(random() * rw), y = ry + Math.floor(random() * rh);
        const [dx, dy] = dirs[Math.floor(random() * dirs.length)], n = lo + Math.floor(random() * (hi - lo + 1));
        for (let i = 0; i < n; i++, x += dx, y += dy) paint(wrapX(x), wrapY(y), 1, color, sh);
      }
      return;
    }
    case "border": {
      needsPaint();
      const width = num(layer, "width", 1, where, 1), inset = num(layer, "inset", 0, where, 0);
      forRegion((x, y) => {
        const edge = Math.min(x - rx, y - ry, rx + rw - 1 - x, ry + rh - 1 - y);
        if (edge >= inset && edge < inset + width) paint(x, y, 1);
      });
      return;
    }
    case "bevel": {
      // A raised (or with "sunken": true, recessed) edge: lit along the top and left, shadowed along the bottom and right.
      const width = num(layer, "width", 1, where, 1), inset = num(layer, "inset", 0, where, 0);
      let light = num(layer, "light", 1.3, where, 0), dark = num(layer, "dark", 0.6, where, 0);
      if (layer.sunken) [light, dark] = [dark, light];
      forRegion((x, y) => {
        const l = x - rx, t = y - ry, rr = rx + rw - 1 - x, b = ry + rh - 1 - y, edge = Math.min(l, t, rr, b);
        if (edge < inset || edge >= inset + width) return;
        paint(x, y, 1, undefined, Math.min(l, t) <= Math.min(rr, b) ? light : dark);
      });
      return;
    }
    case "circle": {
      needsPaint();
      const [cx, cy] = vec(layer, "center", where, [(w - 1) / 2, (h - 1) / 2]), radius = num(layer, "radius", Math.min(w, h) / 4, where, 0);
      const ring = layer.ring === undefined ? undefined : num(layer, "ring", 1, where, 0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= radius + 0.5 && (ring === undefined || d >= radius + 0.5 - ring)) paint(x, y, 1);
      }
      return;
    }
    case "line": {
      needsPaint();
      const [x0, y0] = vec(layer, "from", where), [x1, y1] = vec(layer, "to", where), half = num(layer, "width", 1, where, 0.1) / 2;
      const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = len2 ? clamp01(((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2) : 0;
        if (Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0))) <= half) paint(x, y, 1);
      }
      return;
    }
    case "bricks": {
      // Rows of bricks (or planks: one brick as wide as the texture), each a little lighter or darker, with mortar lines between.
      const [bw, bh] = vec(layer, "size", where, [8, 4]), mw = num(layer, "mortarWidth", 1, where, 0);
      const offset = num(layer, "offset", 0.5, where), variation = num(layer, "variation", 0.1, where, 0, 1);
      const mortar = layer.mortar === undefined ? undefined : parseColor(layer.mortar, named, `${where} "mortar"`);
      const bevel = layer.bevel === undefined ? 0 : num(layer, "bevel", 0.2, where, 0, 1);
      if (bw < 1 || bh < 1) throw new SpecError(`${where}: "size" is [brickWidth, brickHeight], at least 1`);
      const shades = new Map<string, number>();
      forRegion((x, y) => {
        const row = Math.floor((y - ry) / bh), lx = x - rx - Math.round(row * offset * bw), col = Math.floor(lx / bw);
        const u = ((lx % bw) + bw) % bw, v = (y - ry) % bh;
        if (mortar && (u < mw || v < mw)) return paint(x, y, 1, mortar, undefined);
        const key = `${row},${((col % Math.ceil(rw / bw)) + Math.ceil(rw / bw)) % Math.ceil(rw / bw)}`;
        if (!shades.has(key)) shades.set(key, 1 + variation * (2 * random() - 1));
        let f = shades.get(key)!;
        if (bevel) f *= v === (mortar ? mw : 0) || u === (mortar ? mw : 0) ? 1 + bevel : v === bh - 1 || u === bw - 1 ? 1 - bevel : 1;
        paint(x, y, 1, undefined, f);
      });
      return;
    }
    case "pixels": {
      // Pixel art: each character of "rows" is one pixel ("scale" pixels square), colored by "colors"; other characters are left alone.
      const [ax, ay] = vec(layer, "at", where, [0, 0]), scale = num(layer, "scale", 1, where, 1, 64);
      let rows = layer.rows;
      if (!Array.isArray(rows) || !rows.every((s) => typeof s === "string")) throw new SpecError(`${where}: "rows" is a list of strings`);
      if (layer.mirror) rows = mirrorRows(rows as string[]);
      const colors = layer.colors;
      if (!colors || typeof colors !== "object") throw new SpecError(`${where}: "colors" maps characters to colors, e.g. { "#": "dark" }`);
      const pal = new Map(Object.entries(colors).map(([k, v]) => [k, parseColor(v, named, `${where} "colors.${k}"`)]));
      const shadow = layer.shadow === undefined ? undefined : parseColor(layer.shadow, named, `${where} "shadow"`);
      const lines = rows as string[];
      const lit = (r: number, col: number) => r >= 0 && r < lines.length && pal.has(lines[r][col] ?? "");
      const block = (r: number, col: number, c: Rgba) => {
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) paint(ax + col * scale + dx, ay + r * scale + dy, 1, c, undefined);
      };
      if (shadow) lines.forEach((line, r) => [...line].forEach((_, col) => { if (lit(r, col) && !lit(r + 1, col + 1)) block(r + 1, col + 1, shadow); }));
      lines.forEach((line, r) => [...line].forEach((ch, col) => { if (pal.has(ch)) block(r, col, pal.get(ch)!); }));
      return;
    }
    case "custom": {
      // Code in a JS spec: `draw(ctx)` paints however it likes (see CustomContext); everything else about the layer still applies.
      const draw = layer.draw;
      if (typeof draw !== "function") throw new SpecError(`${where}: a "custom" layer needs "draw": a function (ctx) => void (JS specs only)`);
      const toColor = (c: ColorValue) => parseColor(c, named, where);
      const ctx: CustomContext = {
        width: w, height: h, random, color: toColor,
        get: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? undefined : ([0, 1, 2, 3].map((k) => Math.round(px[(y * w + x) * 4 + k])) as Rgba)),
        set: (x, y, c) => {
          if (x < 0 || y < 0 || x >= w || y >= h) return;
          const v = toColor(c);
          for (let k = 0; k < 4; k++) px[(Math.floor(y) * w + Math.floor(x)) * 4 + k] = v[k];
        },
        paint: (x, y, t, c) => paint(Math.floor(x), Math.floor(y), t, c === undefined ? color : toColor(c), undefined),
        shade: (x, y, t, f) => paint(Math.floor(x), Math.floor(y), t, null, f),
        noise: (scale, octaves = 1) => tilingNoise(w, h, Math.max(1, scale), Math.max(1, Math.min(8, octaves)), random),
      };
      if (!color && shade === undefined) ctx.paint = (x, y, t, c) => {
        if (c === undefined) throw new SpecError(`${where}: ctx.paint needs a color (the layer has none)`);
        paint(Math.floor(x), Math.floor(y), t, toColor(c), undefined);
      };
      (draw as (c: CustomContext) => void)(ctx);
      return;
    }
    default:
      throw new SpecError(`${where}: unknown layer type; one of fill, gradient, noise, grain, speckle, scratches, border, bevel, circle, line, bricks, pixels, custom`);
  }
}

/** Symmetric pixel art from its left half: each row followed by itself reversed, without repeating the middle column. */
export function mirrorRows(rows: string[]): string[] {
  return rows.map((r) => r + [...r].slice(0, -1).reverse().join(""));
}

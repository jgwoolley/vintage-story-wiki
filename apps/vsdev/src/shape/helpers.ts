// More helpers a JS shape spec gets, for the things hand-built models keep needing (see the Reliquiarum mod's specs):
// - `bar`: a box from one point to another (cables, rods, a limb between two joints): its turn is worked out for you;
// - `prism`: an n-sided upright section (a pepper-pot body, a ring, a dome step) made of flat panels round a core, so it really is
//   n-sided (a box and its 45 degree copy make an eight-pointed star, not an octagon); the panels can lean in to taper it, and each
//   panel can carry elements (studs on a skirt);
// - `scaled`: a list of spec elements drawn k times bigger (the same statue, small and large);
// - `texturesFor`: of a shared texture map, only the keys some elements use.
// They return spec objects (the same ones a JSON spec would contain), so they mix with box/joint/relief/mirror/repeat.
import { SpecError } from "../gen/spec.js";

type Vec3 = [number, number, number];
type Json = Record<string, unknown>;

const DEG = 180 / Math.PI;
const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/**
 * The rotation [x, y, z] (degrees) that turns +y onto `dir`, for the game's order (Rx * Ry * Rz, see `rotationMatrix`):
 * Rz tips +y over to x, then Rx swings it toward z.
 */
export function aim(dir: Vec3): Vec3 {
  const len = Math.hypot(...dir);
  if (!len) throw new SpecError(`a direction can't be [0, 0, 0]`);
  const [dx, dy, dz] = dir.map((v) => v / len);
  return [round(Math.atan2(dz, dy) * DEG), 0, round(-Math.asin(Math.max(-1, Math.min(1, dx))) * DEG)];
}

/** A box from `from` to `to`, `width` across (a number, or [x, z] of its cross-section), turned to run along the line. */
export function bar(from: Vec3, to: Vec3, width: number | [number, number], tex: string, opts: Json = {}): Json {
  const [wx, wz] = typeof width === "number" ? [width, width] : width;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const rot = aim([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  return {
    box: [[from[0] - wx / 2, from[1], from[2] - wz / 2], [from[0] + wx / 2, from[1] + len, from[2] + wz / 2]],
    tex, name: "bar", ...opts, rot, origin: from,
  };
}

export interface PrismOptions {
  /** [x, z] of the axis (default the block's middle, [8, 8]). */
  center?: [number, number];
  /** Distance from the axis to the middle of each side. */
  apothem: number;
  /** [bottom, top]. */
  y: [number, number];
  /** How many sides (default 8). */
  sides?: number;
  /** Panel thickness (default 1). */
  thickness?: number;
  /** Degrees each panel leans in toward the axis (default 0): a tapering body. Needs a joint per panel. */
  lean?: number;
  /** Fill the middle with an upright box (default true), small enough that its corners stay inside the panels. */
  core?: boolean;
  /** Degrees the first side is turned from facing south (default 0). */
  turn?: number;
  tex: string;
  name?: string;
  /** Elements on the panel at index i (facing angle a): in its frame x runs across, y up its face from the bottom, z out of it. */
  panel?: (i: number, angle: number) => unknown[];
}

/** An n-sided upright section of flat panels (and a core). */
export function prism(o: PrismOptions): Json[] {
  const n = o.sides ?? 8, h = o.apothem, [y0, y1] = o.y, [cx, cz] = o.center ?? [8, 8];
  if (!Number.isInteger(n) || n < 3) throw new SpecError(`prism: "sides" is a whole number, 3 or more`);
  if (!(h > 0) || !(y1 > y0)) throw new SpecError(`prism: needs "apothem" > 0 and "y": [bottom, top] with top above bottom`);
  const t = o.thickness ?? 1, lean = o.lean ?? 0, name = o.name ?? "prism", turn = o.turn ?? 0;
  const half = h * Math.tan(Math.PI / n) + 0.02; // half a side, a hair wider so neighbours meet
  const height = (y1 - y0) / Math.cos(lean / DEG);
  const out: Json[] = [];
  // A square of half-width c reaches c * sqrt(2) at its corners: keep that inside the panels' inner faces.
  if (o.core !== false) {
    const c = Math.max(0.1, (h - t) * Math.cos(Math.PI / n) / Math.SQRT2);
    out.push({ box: [[cx - c, y0, cz - c], [cx + c, y1, cz + c]], tex: o.tex, name: name + "core" });
  }
  for (let i = 0; i < n; i++) {
    const a = turn + (360 / n) * i;
    const kids = o.panel?.(i, a) ?? [];
    if (!lean && !kids.length) {
      out.push({ box: [[cx - half, y0, cz + h - t], [cx + half, y1, cz + h]], tex: o.tex, name, ...(a ? { rot: [0, a, 0], origin: [cx, y0, cz] } : {}) });
      continue;
    }
    out.push({ joint: [cx, y0, cz], name: name + "face", rot: [0, a, 0], children: [{ joint: [0, 0, h], name: name + "lean", rot: [-lean, 0, 0], children: [
      { box: [[-half, 0, -t], [half, height, 0]], tex: o.tex, name },
      ...kids,
    ] }] });
  }
  return out;
}

const scaleVec = (v: unknown, k: number) => (Array.isArray(v) && v.every((n) => typeof n === "number") ? v.map((n) => round(n * k)) : v);

/**
 * Spec elements drawn k times bigger about the origin (0, 0, 0): boxes, joints, origins, reliefs (cell and depth), mirror planes,
 * repeat steps and game JSON. Texture UVs follow the new sizes (as for any box); turns are unchanged.
 */
export function scaled(k: number, items: unknown): unknown[] {
  if (!(k > 0)) throw new SpecError(`scaled: the factor must be above 0`);
  const one = (item: unknown): unknown => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const e = { ...(item as Json) };
    if (Array.isArray(e.box)) e.box = (e.box as unknown[]).map((c) => scaleVec(c, k));
    if (Array.isArray(e.joint)) e.joint = scaleVec(e.joint, k);
    if (Array.isArray(e.taper)) e.taper = (e.taper as unknown[]).map((c) => scaleVec(c, k));
    if (Array.isArray(e.size)) e.size = (e.size as unknown[]).map((v) => (typeof v === "number" ? round(v * k) : v));
    for (const key of ["origin", "at", "from", "to", "rotationOrigin", "step", "center", "base", "offset", "top", "about", "x", "y", "z"]) if (key in e) e[key] = scaleVec(e[key], k);
    for (const key of ["cell", "depth", "about", "sink", "inset", "grow", "out"]) if (typeof e[key] === "number") e[key] = round((e[key] as number) * k);
    for (const key of ["children", "mirror", "of", "corners"]) {
      if (Array.isArray(e[key])) e[key] = (e[key] as unknown[]).map(one);
      else if (e[key] && typeof e[key] === "object") e[key] = one(e[key]);
    }
    return e;
  };
  return (Array.isArray(items) ? items : [items]).map(one);
}

/** Of `textures`, the keys that `elements` use: as a box's "tex", a face's texture, or "#key" in game JSON. */
export function texturesFor(textures: Record<string, string>, elements: unknown): Record<string, string> {
  const used = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Json)) {
      if ((k === "tex" || k === "texture") && typeof x === "string") used.add(x.replace(/^#/, ""));
      else walk(x);
    }
  };
  walk(elements);
  return Object.fromEntries(Object.entries(textures).filter(([k]) => used.has(k)));
}

// Placing a box by what it sits on instead of by coordinates worked out in your head, which is where hand-written models go wrong
// (a part left floating by a slip of arithmetic, a trim piece flush with the face it decorates so the two flicker):
// - `size` + `on` / `under` / `against`: a box of that size put against a face of another element, centered on it unless `align`
//   says which sides to line up; `sink` pushes it in (so they join), `inset` keeps it off the edges it is aligned to;
// - `size` + `center` / `base`: a box around a point, or standing on one;
// - `band`: a strip round another element that stands `out` proud of it (never flush, so it can't flicker);
// - `taper`: stacked steps narrowing (or widening) from a base to a top.
// Each becomes a plain `box` (build.ts), so faces, UVs, `rot` and `children` work as for any box.
import { SpecError } from "../gen/spec.js";

type Vec3 = [number, number, number];
type Json = Record<string, unknown>;

/** An element's own box, in its parent's coordinates. */
export interface Extent { from: Vec3; to: Vec3 }
/** Finds the element a spec names (a sibling built before it, or "parent"); throws SpecError naming the ones there are. */
export type Lookup = (name: unknown, key: string) => Extent;

const FACES: Record<string, [number, number]> = { west: [0, -1], east: [0, 1], down: [1, -1], up: [1, 1], north: [2, -1], south: [2, 1] };
const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const isVec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));
const num = (e: Json, key: string, where: string, fallback = 0): number => {
  if (e[key] === undefined) return fallback;
  if (typeof e[key] !== "number" || !Number.isFinite(e[key])) throw new SpecError(`${where}: "${key}" is a number`);
  return e[key] as number;
};

/** The corners of a `size` element. */
export function placedBox(e: Json, lookup: Lookup, where: string): [Vec3, Vec3] {
  const raw = e.size;
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0))) {
    throw new SpecError(`${where}: "size" is [width (x), height (y), depth (z)]; null for "as big as what it is placed on"`);
  }
  const anchors = ["on", "under", "against", "center", "base"].filter((k) => e[k] !== undefined);
  if (anchors.length !== 1) throw new SpecError(`${where}: a "size" box needs one of "on", "under", "against": [name, face], "center": [x, y, z] or "base": [x, y, z]${anchors.length ? ` (it has ${anchors.join(" and ")})` : ""}`);
  const anchor = anchors[0];
  const offset: Vec3 = e.offset === undefined ? [0, 0, 0] : isVec(e.offset, 3) ? (e.offset as Vec3) : (() => { throw new SpecError(`${where}: "offset" is [dx, dy, dz]`); })();
  const done = (from: number[]): [Vec3, Vec3] => {
    const f = from.map((v, i) => round(v + offset[i])) as Vec3;
    return [f, f.map((v, i) => round(v + (size[i] as number))) as Vec3];
  };
  let size = raw as (number | null)[];

  if (anchor === "center" || anchor === "base") {
    if (size.some((v) => v === null)) throw new SpecError(`${where}: a null "size" needs "on", "under" or "against" to take the size from`);
    if (!isVec(e[anchor], 3)) throw new SpecError(`${where}: "${anchor}" is [x, y, z]`);
    const p = e[anchor] as Vec3, s = size as Vec3;
    return done([p[0] - s[0] / 2, anchor === "base" ? p[1] : p[1] - s[1] / 2, p[2] - s[2] / 2]);
  }

  let name: unknown = e[anchor], face = anchor === "on" ? "up" : "down";
  if (anchor === "against") {
    if (!Array.isArray(name) || name.length !== 2 || !(String(name[1]) in FACES)) throw new SpecError(`${where}: "against" is [name, face], the face one of ${Object.keys(FACES).join(", ")}`);
    [name, face] = name as [unknown, string];
  }
  const target = lookup(name, anchor);
  const [axis, sign] = FACES[face];
  const grow = num(e, "grow", where), sink = num(e, "sink", where), inset = num(e, "inset", where);
  size = size.map((v, i) => v ?? round(target.to[i] - target.from[i] + 2 * grow));
  const s = size as Vec3;
  const from = [0, 1, 2].map((i) => (target.from[i] + target.to[i]) / 2 - s[i] / 2);
  from[axis] = sign > 0 ? target.to[axis] - sink : target.from[axis] + sink - s[axis];
  const align = e.align === undefined ? [] : Array.isArray(e.align) ? e.align : [e.align];
  const taken = new Set<number>();
  for (const side of align) {
    const f = FACES[String(side)];
    if (!f) throw new SpecError(`${where}: "align" names sides to line up with the target's: ${Object.keys(FACES).join(", ")}`);
    if (f[0] === axis) throw new SpecError(`${where}: can't align "${side}": that is the direction it is placed in ("${face}"); use "sink" or "offset"`);
    if (taken.has(f[0])) throw new SpecError(`${where}: "align" has two sides on one axis; give the size instead (null = as big as the target)`);
    taken.add(f[0]);
    from[f[0]] = f[1] < 0 ? target.from[f[0]] + inset : target.to[f[0]] - inset - s[f[0]];
  }
  return done(from);
}

/** The corners of a `band` round a target: the target's box grown by `out`, cut to a span along one axis. */
export function bandBox(e: Json, lookup: Lookup, where: string): [Vec3, Vec3] {
  const target = lookup(e.band, "band");
  const axes = ["x", "y", "z"].filter((k) => e[k] !== undefined);
  if (axes.length !== 1 || !isVec(e[axes[0]], 2)) throw new SpecError(`${where}: a "band" needs one of "x", "y" or "z": [from, to], where along that axis it runs (in the same coordinates as its target)`);
  const out = num(e, "out", where, 0.25);
  if (!(out > 0)) throw new SpecError(`${where}: "out" (how far the band stands proud) must be above 0, or its faces would flicker with the target's`);
  const axis = "xyz".indexOf(axes[0]), span = e[axes[0]] as number[];
  const from = target.from.map((v, i) => round(i === axis ? Math.min(...span) : v - out)) as Vec3;
  const to = target.to.map((v, i) => round(i === axis ? Math.max(...span) : v + out)) as Vec3;
  return [from, to];
}

/** The boxes of a `taper`: `steps` slabs from the base box's footprint to a `top` footprint [width, depth], centered. */
export function taperBoxes(e: Json, where: string): [Vec3, Vec3][] {
  const c = e.taper;
  if (!Array.isArray(c) || c.length !== 2 || !isVec(c[0], 3) || !isVec(c[1], 3)) throw new SpecError(`${where}: "taper" is [[x1, y1, z1], [x2, y2, z2]], the box it fills at its base`);
  if (!isVec(e.top, 2) || (e.top as number[]).some((v) => v < 0)) throw new SpecError(`${where}: a "taper" needs "top": [width, depth], its size at the top`);
  const steps = e.steps === undefined ? 3 : e.steps;
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 2 || steps > 64) throw new SpecError(`${where}: "steps" is how many slabs (2 to 64)`);
  const a = c[0] as Vec3, b = c[1] as Vec3, top = e.top as number[];
  const lo = a.map((v, i) => Math.min(v, b[i])), hi = a.map((v, i) => Math.max(v, b[i]));
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, h = (hi[1] - lo[1]) / steps;
  return Array.from({ length: steps }, (_, k) => {
    const t = k / (steps - 1);
    const w = (hi[0] - lo[0]) * (1 - t) + top[0] * t, d = (hi[2] - lo[2]) * (1 - t) + top[1] * t;
    return [[round(cx - w / 2), round(lo[1] + k * h), round(cz - d / 2)], [round(cx + w / 2), round(lo[1] + (k + 1) * h), round(cz + d / 2)]] as [Vec3, Vec3];
  });
}

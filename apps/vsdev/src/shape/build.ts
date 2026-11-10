// `vsdev shape`'s builder: turns a short element description into the game's shape JSON. Units are the game's: 16 = one block, x east,
// y up, z south. What it adds over writing the JSON by hand:
// - `box`: every face gets a texture and a UV as big as that side (one texel per unit, at most the texture's size), so a texture is
//   never stretched; `faces` overrides single sides;
// - `joint`: an empty element at a pivot; its children are placed relative to it and turn with it (how limbs are posed);
// - `relief`: pixel art as boxes, one per horizontal run;
// - `mirror` / `repeat`: copies, mirrored across a plane or stepped along a line;
// - `corners`: an element copied to the four corners (table legs), named -nw/-ne/-sw/-se;
// - `size` + `on`/`under`/`against`/`center`/`base`, `band`, `taper` (place.ts): boxes placed by what they sit on, so the arithmetic
//   that leaves parts floating or flush isn't done by hand;
// - `poses` on a shape: the same model with named elements turned (a lid open), each written as its own file;
// - `ground`: a top-level element (a loose piece), or the whole shape, is moved up or down until its lowest point is on y = 0, so
//   nothing floats or sinks after a pose change.
// A spec element that already has `from`/`to` is game JSON and is copied as it is (its children are still built).
import { SpecError } from "../gen/spec.js";
import { mirrorRows } from "../texture/paint.js";
import { shapeBounds, type Bounds } from "./bounds.js";
import { bandBox, placedBox, taperBoxes, type Extent, type Lookup } from "./place.js";

type Vec3 = [number, number, number];
type Json = Record<string, unknown>;
const SIDES = ["north", "east", "south", "west", "up", "down"] as const;
type Side = (typeof SIDES)[number];

/** One shape in a spec. */
export interface ShapeSpec {
  /** Texture key -> asset ("mymod:block/bronze"). Every key a face uses must be here. */
  textures: Record<string, string>;
  /** UV space of the shape (default 16 x 16), as in the game's files. */
  textureWidth?: number;
  textureHeight?: number;
  /** Per-key UV space, as the game's `textureSizes`. */
  textureSizes?: Record<string, number[]>;
  elements: unknown[];
  /** Rest the whole model on the ground: move it so its lowest point is y = 0 (after any element's own "ground"). */
  ground?: boolean;
  /** Copied into the shape file as is (e.g. `animations`, `attachmentpoints`). */
  extra?: Json;
  /** Leave the texture keys no face uses out of the file (instead of warning about them): for a texture map shared by many shapes. */
  prune?: boolean;
  /**
   * The same model with some elements turned: pose name -> { element name: [x, y, z] degrees } (replacing that element's own "rot",
   * about its own origin). Each is written as <shape>-<pose>.json: a chest's lid open and closed from one description.
   */
  poses?: Record<string, Record<string, unknown>>;
}

interface Ctx { spec: ShapeSpec; where: string; used: Set<string> }

/**
 * The coordinates a list of elements is written in: the shape's own (the block, 0..16), a box's (from its "from" corner, so 0..size)
 * or a joint's (from its point). `named` is what has been built in it so far, for elements placed against a sibling.
 */
interface Frame { kind: "top" | "box" | "joint"; size: Vec3; named: Map<string, Json> }
const topFrame = (): Frame => ({ kind: "top", size: [16, 16, 16], named: new Map() });
/** Where a mirror plane or the middle of `corners` is when the spec doesn't say: the middle of the block, of the parent box, or the joint. */
const middle = (frame: Frame, axis: number) => (frame.kind === "joint" ? 0 : frame.size[axis] / 2);

/** Marks a built element whose spec said `"ground": true`, until `settle` has moved it; never written to the file. */
const GROUND = "__ground";

/** The shape file, the texture keys no face uses (worth a warning: usually a typo or a forgotten face), and where the model is. */
export function buildShape(spec: ShapeSpec, where: string): { shape: Json; unused: string[]; bounds?: Bounds; poses?: Record<string, Json> } {
  if (!spec || typeof spec !== "object") throw new SpecError(`${where}: a shape is an object with "textures" and "elements"`);
  if (!spec.textures || typeof spec.textures !== "object") throw new SpecError(`${where}: needs "textures" (key -> "domain:path")`);
  if (!Array.isArray(spec.elements)) throw new SpecError(`${where}: needs an "elements" list`);
  const ctx: Ctx = { spec, where, used: new Set() };
  const elements = buildList(spec.elements, ctx, `${where} elements`, topFrame());
  uniqueNames(elements);
  settle(elements, spec.ground === true, where);
  const unused = Object.keys(spec.textures).filter((k) => !ctx.used.has(k));
  const textures = spec.prune ? Object.fromEntries(Object.entries(spec.textures).filter(([k]) => ctx.used.has(k))) : spec.textures;
  const shape: Json = {
    textureWidth: spec.textureWidth ?? 16,
    textureHeight: spec.textureHeight ?? 16,
    ...(spec.textureSizes ? { textureSizes: spec.textureSizes } : {}),
    textures,
    elements,
    ...(spec.extra ?? {}),
  };
  return { shape, unused: spec.prune ? [] : unused, bounds: shapeBounds(elements), ...(spec.poses ? { poses: posed(shape, spec.poses, where) } : {}) };
}

/** The shape once per pose, with the named elements' turns replaced. */
function posed(shape: Json, poses: unknown, where: string): Record<string, Json> {
  if (!poses || typeof poses !== "object" || Array.isArray(poses)) throw new SpecError(`${where}: "poses" is { poseName: { elementName: [x, y, z] degrees } }`);
  const out: Record<string, Json> = {};
  for (const [pose, turns] of Object.entries(poses as Json)) {
    if (!/^[\w.-]+$/.test(pose)) throw new SpecError(`${where}: pose "${pose}" is not a usable file name part (letters, digits, - _ .)`);
    if (!turns || typeof turns !== "object" || Array.isArray(turns)) throw new SpecError(`${where}: pose "${pose}" is { elementName: [x, y, z] degrees }`);
    const copy = structuredClone(shape);
    const all: Json[] = [];
    const walk = (els: unknown) => { for (const el of Array.isArray(els) ? (els as Json[]) : []) { all.push(el); walk(el.children); } };
    walk(copy.elements);
    for (const [name, rot] of Object.entries(turns as Json)) {
      const el = all.find((x) => x.name === name);
      if (!el) throw new SpecError(`${where}: pose "${pose}" turns "${name}", which is not an element (${all.map((x) => x.name).join(", ")})`);
      const turn = vec3(rot, `${where} pose "${pose}"`, name);
      if (!el.rotationOrigin) el.rotationOrigin = (el.from as Vec3).map((v, i) => (v + (el.to as Vec3)[i]) / 2);
      turn.forEach((deg, i) => { if (deg) el["rotation" + "XYZ"[i]] = deg; else delete el["rotation" + "XYZ"[i]]; });
    }
    out[pose] = copy;
  }
  return out;
}

/** Applies "ground": each marked top-level element on its own, then (for the shape's own "ground") everything together. */
function settle(elements: Json[], whole: boolean, where: string): void {
  const drop = (els: Json[]) => {
    const low = shapeBounds(els)?.min[1];
    // Rounded so the file doesn't fill with 17-digit numbers.
    if (low) for (const el of els) translate(el, [0, -Math.round(low * 1e4) / 1e4, 0]);
  };
  const nested = (els: unknown): void => {
    for (const el of Array.isArray(els) ? (els as Json[]) : []) {
      if (el[GROUND]) throw new SpecError(`${where}: "ground" on "${el.name}" does nothing: it is a child, placed by its parent. Put it on a top-level element, or on the shape`);
      nested(el.children);
    }
  };
  for (const el of elements) {
    nested(el.children);
    if (!el[GROUND]) continue;
    delete el[GROUND];
    drop([el]);
  }
  if (whole) drop(elements);
}

function buildList(items: unknown, ctx: Ctx, where: string, frame: Frame): Json[] {
  if (!Array.isArray(items)) throw new SpecError(`${where}: must be a list`);
  return items.flatMap((item, i) => {
    const built = build(item, ctx, `${where}[${i}]`, frame);
    // By the name the spec gave (repeats are numbered only at the end); the first of a name is the one a later element finds.
    for (const el of built) if (typeof el.name === "string" && !frame.named.has(el.name)) frame.named.set(el.name, el);
    return built;
  });
}

/** Finds the element a placed box names: a sibling built before it, "parent" (the box or joint it is a child of), or "block". */
const lookupIn = (frame: Frame, where: string): Lookup => (name, key) => {
  if (name === "parent" && frame.kind !== "top") return { from: [0, 0, 0], to: frame.kind === "joint" ? [0, 0, 0] : frame.size };
  if (name === "block" && frame.kind === "top") return { from: [0, 0, 0], to: [16, 16, 16] };
  const el = typeof name === "string" ? frame.named.get(name) : undefined;
  if (!el) {
    const known = [...frame.named.keys(), frame.kind === "top" ? "block" : "parent"];
    throw new SpecError(`${where}: "${key}" names "${String(name)}", which isn't an element written before this one in the same list (${known.join(", ")})`);
  }
  if (["rotationX", "rotationY", "rotationZ"].some((r) => el[r])) throw new SpecError(`${where}: "${String(name)}" is turned, so its sides aren't where its box says; make this a child of it (placed on "parent") instead`);
  return { from: el.from as Vec3, to: el.to as Vec3 } satisfies Extent;
};

/** Gives a built element (and its children) the names of `original` plus `suffix`. */
function renameTree(el: Json, original: Json, suffix: string): void {
  el.name = `${String(original.name ?? "element")}${suffix}`;
  const kids = el.children as Json[] | undefined, from = original.children as Json[] | undefined;
  kids?.forEach((kid, i) => renameTree(kid, from![i], suffix));
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

function vec3(v: unknown, where: string, key: string): Vec3 {
  if (!isVec3(v)) throw new SpecError(`${where}: "${key}" must be [x, y, z]`);
  return [...v];
}

function build(item: unknown, ctx: Ctx, where: string, frame: Frame): Json[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new SpecError(`${where}: an element is an object (box, joint, relief, mirror, corners, repeat, a placed "size" box, band, taper, or game JSON with from/to)`);
  const e = item as Json;
  if ("box" in e) return [box(e, ctx, where)];
  if ("size" in e) return [box({ ...e, box: placedBox(e, lookupIn(frame, where), where) }, ctx, where)];
  if ("band" in e) {
    const corners = bandBox(e, lookupIn(frame, where), where);
    // A band round something standing on the floor stops at the floor (with no underside) instead of poking through it.
    const grounded = frame.kind === "top" && corners[0][1] < 0 && lookupIn(frame, where)(e.band, "band").from[1] >= 0 && e.y === undefined;
    if (grounded) corners[0][1] = 0;
    return [box({ name: "band", ...e, box: corners, ...(grounded ? { faces: { down: false, ...((e.faces as Json | undefined) ?? {}) } } : {}) }, ctx, where)];
  }
  if ("taper" in e) {
    const steps = taperBoxes(e, where);
    return steps.map((corners, k) => box({ ...e, box: corners, name: `${e.name ?? "taper"}-${k + 1}`, ...(k < steps.length - 1 ? { children: undefined } : {}), ground: undefined }, ctx, where));
  }
  if ("joint" in e) {
    const at = vec3(e.joint, where, "joint");
    return [pose({ name: e.name ?? "joint", from: at, to: at, faces: {} }, e, at, ctx, where)];
  }
  if ("relief" in e) return relief(e, ctx, where);
  if ("mirror" in e) {
    const originals = buildList(Array.isArray(e.mirror) ? e.mirror : [e.mirror], ctx, `${where}.mirror`, frame);
    const axis = e.axis ?? "x";
    if (axis !== "x" && axis !== "z") throw new SpecError(`${where}: "axis" is "x" (mirror east-west) or "z" (north-south)`);
    // The middle of whatever these coordinates are in: x = 8 in the block, 0 inside a joint, half the parent box inside a box.
    const about = typeof e.about === "number" ? e.about : middle(frame, axis === "x" ? 0 : 2);
    return [...originals, ...originals.map((el) => mirrorElement(el, axis, about))];
  }
  if ("corners" in e) {
    const originals = buildList(Array.isArray(e.corners) ? e.corners : [e.corners], ctx, `${where}.corners`, frame);
    const about = e.about === undefined ? [middle(frame, 0), middle(frame, 2)] : e.about;
    if (!Array.isArray(about) || about.length !== 2 || !about.every((v) => typeof v === "number")) throw new SpecError(`${where}: "about" is [x, z], the point the four corners are around`);
    return originals.flatMap((el) => {
      const acrossX = mirrorElement(el, "x", about[0]);
      const copies = [el, acrossX, mirrorElement(el, "z", about[1]), mirrorElement(acrossX, "z", about[1])].map((c) => structuredClone(c));
      const original = structuredClone(el);
      for (const copy of copies) {
        const f = copy.from as Vec3, t = copy.to as Vec3;
        const cx = (f[0] + t[0]) / 2 - about[0], cz = (f[2] + t[2]) / 2 - about[1];
        if (Math.abs(cx) < 1e-9 || Math.abs(cz) < 1e-9) throw new SpecError(`${where}: "${String(original.name)}" is centered on x = ${about[0]} or z = ${about[1]}, so its corner copies would land on each other; use "mirror", or set "about": [x, z]`);
        renameTree(copy, original, `-${cz < 0 ? "n" : "s"}${cx < 0 ? "w" : "e"}`);
      }
      return copies;
    });
  }
  if ("repeat" in e) {
    const count = e.repeat;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) throw new SpecError(`${where}: "repeat" is how many copies (1 or more)`);
    const step = vec3(e.step, where, "step");
    const of = buildList(Array.isArray(e.of) ? e.of : [e.of], ctx, `${where}.of`, frame);
    return Array.from({ length: count }, (_, i) => of.map((el) => translate(structuredClone(el), step.map((s) => s * i) as Vec3))).flat();
  }
  if ("from" in e && "to" in e) {
    const el = structuredClone(e);
    for (const f of Object.values((el.faces as Record<string, Json>) ?? {})) if (typeof f?.texture === "string") useKey(f.texture.replace(/^#/, ""), ctx, where);
    if (el.children) el.children = buildList(el.children, ctx, `${where}.children`, childFrame(el));
    return [el];
  }
  throw new SpecError(`${where}: unknown element; use one of "box", "joint", "relief", "mirror", "corners", "repeat", "size" (with "on", "under", "against", "center" or "base"), "band", "taper", or game JSON with "from" and "to"`);
}

function useKey(key: string, ctx: Ctx, where: string): void {
  if (!Object.hasOwn(ctx.spec.textures, key)) throw new SpecError(`${where}: texture "${key}" is not in "textures" (${Object.keys(ctx.spec.textures).join(", ") || "none"})`);
  ctx.used.add(key);
}

function box(e: Json, ctx: Ctx, where: string): Json {
  const corners = e.box;
  if (!Array.isArray(corners) || corners.length !== 2) throw new SpecError(`${where}: "box" is [[x1, y1, z1], [x2, y2, z2]]`);
  const f = vec3(corners[0], where, "box[0]"), t = vec3(corners[1], where, "box[1]");
  const from = f.map((v, i) => Math.min(v, t[i])) as Vec3, to = f.map((v, i) => Math.max(v, t[i])) as Vec3;
  const [sx, sy, sz] = to.map((v, i) => v - from[i]);
  const dims: Record<Side, [number, number]> = { north: [sx, sy], south: [sx, sy], east: [sz, sy], west: [sz, sy], up: [sx, sz], down: [sx, sz] };
  const offset = e.uv === undefined ? [0, 0] : e.uv;
  if (!Array.isArray(offset) || offset.length !== 2) throw new SpecError(`${where}: "uv" is the [u, v] corner the faces start at`);
  const overrides = (e.faces ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(overrides)) if (!(SIDES as readonly string[]).includes(k)) throw new SpecError(`${where}: unknown face "${k}" (${SIDES.join(", ")})`);
  const faces: Json = {};
  for (const side of SIDES) {
    const o = overrides[side];
    if (o === false || o === null) continue;
    const spec = (typeof o === "string" ? { texture: o } : (o ?? {})) as Json;
    const key = (spec.texture ?? e.tex) as string | undefined;
    if (typeof key !== "string") throw new SpecError(`${where}: needs "tex" (a texture key) or a texture for the ${side} face`);
    useKey(key.replace(/^#/, ""), ctx, where);
    const [tw, th] = ctx.spec.textureSizes?.[key] ?? [ctx.spec.textureWidth ?? 16, ctx.spec.textureHeight ?? 16];
    let uv: unknown = spec.uv;
    if (uv === "full") uv = [0, 0, tw, th];
    if (uv === undefined) {
      const [w, h] = dims[side];
      const fit = (v: number, max: number) => Math.min(Math.max(v, 0.5), max);
      uv = [offset[0], offset[1], offset[0] + fit(w, tw), offset[1] + fit(h, th)];
    }
    if (!Array.isArray(uv) || uv.length !== 4) throw new SpecError(`${where}: the ${side} face's "uv" is [u1, v1, u2, v2] or "full"`);
    faces[side] = { texture: "#" + key.replace(/^#/, ""), uv, ...(spec.rotation ? { rotation: spec.rotation } : {}) };
  }
  const center = from.map((v, i) => (v + to[i]) / 2) as Vec3;
  return pose({ name: e.name ?? "box", from, to, faces }, e, center, ctx, where);
}

/** The frame an element's children are written in: from its "from" corner; a joint (no size) is just its point. */
function childFrame(el: Json): Frame {
  const size = (el.to as Vec3).map((v, i) => v - (el.from as Vec3)[i]) as Vec3;
  return { kind: size.some((v) => v) ? "box" : "joint", size, named: new Map() };
}

/** Rotation (`rot`: degrees about x, y, z; around `origin`, default `fallbackOrigin`), children, and `extra` keys. */
function pose(el: Json, e: Json, fallbackOrigin: Vec3, ctx: Ctx, where: string): Json {
  if (e.rot !== undefined) {
    const rot = vec3(e.rot, where, "rot");
    if (rot.some((d) => d)) {
      el.rotationOrigin = e.origin === undefined ? fallbackOrigin : vec3(e.origin, where, "origin");
      rot.forEach((deg, i) => { if (deg) el["rotation" + "XYZ"[i]] = deg; });
    }
  }
  if (e.children !== undefined) el.children = buildList(e.children, ctx, `${where}.children`, childFrame(el));
  if (e.extra && typeof e.extra === "object") Object.assign(el, e.extra);
  if (e.ground === true) el[GROUND] = true;
  return el;
}

/** Pixel art as a relief facing south (+z): `at` is the top-left front corner, rows grow down (-y) and east (+x). */
function relief(e: Json, ctx: Ctx, where: string): Json[] {
  let rows = e.relief;
  if (!Array.isArray(rows) || !rows.every((r) => typeof r === "string")) throw new SpecError(`${where}: "relief" is a list of strings ("#" filled, "." empty)`);
  if (e.mirror) rows = mirrorRows(rows as string[]);
  const at = vec3(e.at, where, "at");
  const cell = typeof e.cell === "number" ? e.cell : 1, depth = typeof e.depth === "number" ? e.depth : 1;
  const fill = typeof e.fill === "string" ? e.fill : "#";
  const out: Json[] = [];
  (rows as string[]).forEach((line, r) => {
    for (const m of line.matchAll(new RegExp(`${fill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`, "g"))) {
      const x0 = at[0] + m.index * cell, y1 = at[1] - r * cell;
      out.push(box({ ...e, box: [[x0, y1 - cell, at[2] - depth], [x0 + m[0].length * cell, y1, at[2]]], name: `${e.name ?? "relief"}-r${r}`, rot: undefined, children: undefined, ground: undefined }, ctx, where));
    }
  });
  return out;
}

const SWAP: Record<string, string> = { left: "right", right: "left", Left: "Right", Right: "Left", LEFT: "RIGHT", RIGHT: "LEFT" };

/** The element mirrored across the plane axis = about (in its parent's coordinates); children are mirrored across the element's middle. */
export function mirrorElement(src: Json, axis: "x" | "z", about: number): Json {
  const el = structuredClone(src);
  const i = axis === "x" ? 0 : 2;
  const f = el.from as Vec3, t = el.to as Vec3;
  [f[i], t[i]] = [2 * about - t[i], 2 * about - f[i]];
  if (el.rotationOrigin) (el.rotationOrigin as Vec3)[i] = 2 * about - (el.rotationOrigin as Vec3)[i];
  // Mirroring across x flips turns about y and z; across z, turns about x and y.
  for (const r of axis === "x" ? ["rotationY", "rotationZ"] : ["rotationX", "rotationY"]) if (typeof el[r] === "number") el[r] = -(el[r] as number);
  const faces = el.faces as Record<string, unknown> | undefined;
  if (faces) {
    const [a, b] = axis === "x" ? ["east", "west"] : ["north", "south"];
    [faces[a], faces[b]] = [faces[b], faces[a]];
    for (const k of [a, b]) if (faces[k] === undefined) delete faces[k];
  }
  if (typeof el.name === "string") {
    const swapped = el.name.replace(/left|right/gi, (m) => SWAP[m] ?? m);
    el.name = swapped === el.name ? `${el.name}-mirrored` : swapped;
  }
  if (Array.isArray(el.children)) el.children = el.children.map((c: Json) => mirrorElement(c, axis, (t[i] - f[i]) / 2));
  return el;
}

function translate(el: Json, d: Vec3): Json {
  for (const k of ["from", "to", "rotationOrigin"]) if (isVec3(el[k])) el[k] = (el[k] as Vec3).map((v, i) => v + d[i]);
  return el;
}

/** The game wants element names unique within a shape (animations address them by name): repeats get "-2", "-3"... */
function uniqueNames(elements: Json[]): void {
  const seen = new Map<string, number>();
  const walk = (els: Json[]) => {
    for (const el of els) {
      const base = String(el.name ?? "element"), n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      if (n > 1) el.name = `${base}-${n}`;
      if (Array.isArray(el.children)) walk(el.children as Json[]);
    }
  };
  walk(elements);
}

/** The helpers a JS spec module gets: each returns the same objects a JSON spec would contain. */
export const shapeHelpers = {
  box: (from: Vec3, to: Vec3, tex: string, opts: Json = {}) => ({ box: [from, to], tex, ...opts }),
  joint: (at: Vec3, opts: Json | unknown[] = {}) => (Array.isArray(opts) ? { joint: at, children: opts } : { joint: at, ...opts }),
  relief: (rows: string[], opts: Json) => ({ relief: rows, ...opts }),
  mirror: (els: unknown, opts: Json = {}) => ({ mirror: els, ...opts }),
  /** `els` at all four corners round `about` ([x, z]; default the middle), named -nw/-ne/-sw/-se. */
  corners: (els: unknown, opts: Json = {}) => ({ corners: els, ...opts }),
  /** A box of `size` placed by `opts`: { on | under: name } | { against: [name, face] } | { center | base: [x, y, z] }, plus align, inset, sink, grow, offset. */
  place: (size: (number | null)[], tex: string, opts: Json) => ({ size, tex, ...opts }),
  /** A strip round `target` standing `out` proud: opts has one of x/y/z: [from, to]. */
  band: (target: string, tex: string, opts: Json) => ({ band: target, tex, ...opts }),
  /** Steps from the box [from, to] at the base to `top` ([width, depth]). */
  taper: (from: Vec3, to: Vec3, top: [number, number], tex: string, opts: Json = {}) => ({ taper: [from, to], top, tex, ...opts }),
  repeat: (count: number, step: Vec3, of: unknown) => ({ repeat: count, step, of }),
};

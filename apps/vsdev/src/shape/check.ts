// `vsdev render --check` / `vsdev shape`: what is wrong with a shape that a picture hides. Works on the shape JSON alone (no browser),
// with every element as a box in the shape's own space (the frames of bounds.ts, i.e. the game's GetLocalTransformMatrix):
// - floating: a group of elements that touches nothing else and doesn't rest on the ground (an error: a wrong frame, a wrong mirror
//   plane or a gap left by a rounding slip);
// - coplanar: two faces in the same plane, facing the same way, overlapping, in different textures: they flicker in game
//   (z-fighting) and look like texture detail in a still render;
// - flat-in-face: a zero-thickness element lying in another element's face (the same flicker); a flat element on its own is fine
//   (cloth, leaves), one flat on two axes can't be seen at all;
// - uv: a face's UV outside its texture; inside: an element wholly inside another; texture: a key the shape doesn't define;
// - outside: where the model leaves the block (0..16), which is often meant, so only a note.
// Calibrated on 597 vanilla block shapes and 69 agent-made ones: 2% of vanilla shapes have a floating group against 28% of the
// agent-made ones, 7% against 52% for coplanar faces in different textures.
import { elementFrames, frameApply } from "./bounds.js";

type Vec3 = [number, number, number];
type Json = Record<string, unknown>;

export type CheckLevel = "error" | "warning" | "note";

export interface CheckFinding {
  level: CheckLevel;
  /** floating, coplanar, flat-in-face, no-size, uv, inside, texture, outside, same-texture, worn. */
  code: string;
  message: string;
  /** Names of the elements it is about. */
  elements: string[];
}

/** One element that draws something, in the shape's own space. */
export interface CheckElement {
  name: string;
  /** Names from the top-level ancestor down to it, joined with "/". */
  path: string;
  /** The axis-aligned box around it after every turn (its own and its parents'). */
  min: Vec3;
  max: Vec3;
  /** Its own size (to - from). */
  size: Vec3;
  /** Whether it, or a parent, is turned. */
  turned: boolean;
  /** Texture keys of its faces, without "#". */
  textures: string[];
}

export interface ShapeCheck {
  elements: CheckElement[];
  /** The box around everything drawn (1/16 block units); absent for a shape with nothing to draw. */
  bounds?: { min: Vec3; max: Vec3 };
  /** The model's size in blocks (x, y, z). */
  blocks?: Vec3;
  findings: CheckFinding[];
  errors: number;
  warnings: number;
  notes: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits + 0;

/** Axis index and sign of each face's normal in the element's own frame. */
const SIDES = { north: [2, -1], south: [2, 1], west: [0, -1], east: [0, 1], down: [1, -1], up: [1, 1] } as const;
type Side = keyof typeof SIDES;

/** How far apart two elements may be and still count as touching (a rounding slip, not a gap you can see). */
export const TOUCH = 0.05;
/** How far apart two parallel faces may be and still be one plane. */
const PLANE = 0.005;
/** The least overlap (square units) of two coplanar faces worth reporting. */
const OVERLAP = 0.05;

interface Obb {
  name: string;
  path: string;
  /** Center, the three axes (unit vectors) and the half sizes along them. */
  c: Vec3;
  ax: Vec3[];
  h: Vec3;
  /** Enabled, textured faces: side -> texture key. */
  faces: Partial<Record<Side, string>>;
  /** How many axes it has no size on. */
  flat: number;
  el: Json;
  turned: boolean;
}

function obbs(elements: Json[]): Obb[] {
  const paths = new Map<Json, string>();
  const walk = (els: Json[], parent: string) => {
    for (const el of els) {
      const p = parent ? `${parent}/${String(el.name ?? "")}` : String(el.name ?? "");
      paths.set(el, p);
      if (Array.isArray(el.children)) walk(el.children as Json[], p);
    }
  };
  walk(elements, "");
  const out: Obb[] = [];
  for (const { el, r, t } of elementFrames(elements)) {
    const faces: Obb["faces"] = {};
    for (const [side, f] of Object.entries((el.faces as Record<string, Json | undefined> | undefined) ?? {})) {
      if (side in SIDES && f && f.enabled !== false && typeof f.texture === "string") faces[side as Side] = f.texture.replace(/^#/, "");
    }
    if (!Object.keys(faces).length) continue;
    const span = sub(el.to as Vec3, el.from as Vec3).map(Math.abs) as Vec3;
    const ax: Vec3[] = [[r[0], r[3], r[6]], [r[1], r[4], r[7]], [r[2], r[5], r[8]]];
    const turned = r.some((n, i) => Math.abs(n - (i % 4 === 0 ? 1 : 0)) > 1e-9);
    out.push({ name: String(el.name ?? ""), path: paths.get(el) ?? "", c: add(t, frameApply(r, scale(span, 0.5))), ax, h: scale(span, 0.5), faces, flat: span.filter((s) => s === 0).length, el, turned });
  }
  return out;
}

/** How far an element reaches from its center along `n`. */
const reach = (o: Obb, n: Vec3) => o.ax.reduce((s, x, i) => s + Math.abs(dot(x, n)) * o.h[i], 0);

/** Distance apart along the best separating axis: above 0 apart, otherwise touching or overlapping (minus how deep). */
function gap(a: Obb, b: Obb): number {
  const axes: Vec3[] = [...a.ax, ...b.ax];
  for (const x of a.ax) for (const y of b.ax) {
    const k = cross(x, y), l = Math.hypot(...k);
    if (l > 1e-6) axes.push(scale(k, 1 / l));
  }
  const d = sub(b.c, a.c);
  let best = -Infinity;
  for (const n of axes) best = Math.max(best, Math.abs(dot(d, n)) - reach(a, n) - reach(b, n));
  return best;
}

function faceQuad(o: Obb, side: Side): { n: Vec3; pts: Vec3[] } {
  const [i, s] = SIDES[side];
  const n = scale(o.ax[i], s), [j, k] = [0, 1, 2].filter((x) => x !== i);
  const base = add(o.c, scale(n, o.h[i]));
  return { n, pts: [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([p, q]) => add(base, add(scale(o.ax[j], p * o.h[j]), scale(o.ax[k], q * o.h[k])))) };
}

type P2 = [number, number];
const area2 = (p: P2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;

/** The part of `subject` inside the convex polygon `clip` (Sutherland-Hodgman). */
function clip(subject: P2[], clipper: P2[]): P2[] {
  let out = subject;
  if (area2(clipper) < 0) clipper = [...clipper].reverse();
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length];
    const inside = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) {
        const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [b[0] - a[0], b[1] - a[1]];
        const t = ((a[0] - p[0]) * d2[1] - (a[1] - p[1]) * d2[0]) / (d1[0] * d2[1] - d1[1] * d2[0]);
        out.push([p[0] + d1[0] * t, p[1] + d1[1] * t]);
      }
    }
  }
  return out;
}

/** Whether a point is inside an element (grown by `slack`). */
const contains = (o: Obb, p: Vec3, slack = 0) => o.ax.every((x, i) => Math.abs(dot(sub(p, o.c), x)) <= o.h[i] + slack);

const corners = (o: Obb): Vec3[] => Array.from({ length: 8 }, (_, n) => o.ax.reduce((p, x, i) => add(p, scale(x, (n >> i) & 1 ? o.h[i] : -o.h[i])), o.c));

const quote = (names: string[], max = 4) => {
  const unique = [...new Set(names)];
  return unique.slice(0, max).map((n) => `"${n}"`).join(", ") + (unique.length > max ? ` and ${unique.length - max} more` : "");
};

/** Checks a shape (the game's shape JSON, parsed). */
export function checkShape(raw: unknown): ShapeCheck {
  const shape = (raw ?? {}) as Json;
  const top = (Array.isArray(shape.elements) ? shape.elements : []) as Json[];
  const valid = (els: Json[]): Json[] => els.filter((e) => e && Array.isArray(e.from) && Array.isArray(e.to)).map((e) => (Array.isArray(e.children) ? { ...e, children: valid(e.children as Json[]) } : e));
  const os = obbs(valid(top));
  const findings: CheckFinding[] = [];
  const say = (level: CheckLevel, code: string, message: string, elements: string[]) => findings.push({ level, code, message, elements: [...new Set(elements)] });
  const extent = (o: Obb, i: number) => reach(o, [0, 1, 2].map((k) => (k === i ? 1 : 0)) as Vec3);

  const elements: CheckElement[] = os.map((o) => ({
    name: o.name, path: o.path,
    min: o.c.map((v, i) => round(v - extent(o, i))) as Vec3, max: o.c.map((v, i) => round(v + extent(o, i))) as Vec3,
    size: scale(o.h, 2).map((v) => round(v)) as Vec3, turned: o.turned, textures: [...new Set(Object.values(o.faces))],
  }));
  const result = (bounds?: ShapeCheck["bounds"]): ShapeCheck => ({
    elements, ...(bounds ? { bounds, blocks: bounds.max.map((v, i) => round((v - bounds.min[i]) / 16)) as Vec3 } : {}), findings,
    errors: findings.filter((f) => f.level === "error").length, warnings: findings.filter((f) => f.level === "warning").length, notes: findings.filter((f) => f.level === "note").length,
  });
  if (!os.length) {
    say("error", "empty", "nothing to draw: no element has a textured face", []);
    return result();
  }
  const bounds = { min: [0, 1, 2].map((i) => round(Math.min(...elements.map((e) => e.min[i])))) as Vec3, max: [0, 1, 2].map((i) => round(Math.max(...elements.map((e) => e.max[i])))) as Vec3 };
  const worn = top.some((e) => typeof e?.stepParentName === "string" && e.stepParentName);

  // Elements with no size on two or three axes are a line or a point: never drawn.
  for (const o of os) if (o.flat >= 2) say("warning", "no-size", `"${o.name}" has no size on ${o.flat} axes (${scale(o.h, 2).map((v) => round(v)).join(" x ")}): it can't be seen`, [o.name]);

  // Every pair's distance, once.
  const gaps = os.map(() => new Array<number>(os.length).fill(0));
  for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) gaps[i][j] = gaps[j][i] = gap(os[i], os[j]);

  // Coplanar faces.
  let sameTexture = 0;
  for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) {
    if (gaps[i][j] > PLANE * 2) continue;
    const a = os[i], b = os[j];
    const clash: string[] = [];
    let flat = false, worst = 0;
    for (const sa of Object.keys(a.faces) as Side[]) for (const sb of Object.keys(b.faces) as Side[]) {
      const fa = faceQuad(a, sa), fb = faceQuad(b, sb);
      if (dot(fa.n, fb.n) < 0.9999 || Math.abs(dot(sub(fb.pts[0], fa.pts[0]), fa.n)) > PLANE) continue;
      const u = sub(fa.pts[1], fa.pts[0]), un = scale(u, 1 / (Math.hypot(...u) || 1)), vn = cross(fa.n, un);
      const to2 = (p: Vec3): P2 => [dot(sub(p, fa.pts[0]), un), dot(sub(p, fa.pts[0]), vn)];
      const shared = clip(fa.pts.map(to2), fb.pts.map(to2));
      const area = Math.abs(area2(shared));
      if (area <= OVERLAP) continue;
      // Not seen when a third element covers the shared part.
      const mid = shared.reduce((s, p) => [s[0] + p[0] / shared.length, s[1] + p[1] / shared.length] as P2, [0, 0] as P2);
      const probes = [mid, ...shared.map((p): P2 => [p[0] * 0.85 + mid[0] * 0.15, p[1] * 0.85 + mid[1] * 0.15])].map((p) => add(add(fa.pts[0], add(scale(un, p[0]), scale(vn, p[1]))), scale(fa.n, 0.02)));
      if (probes.every((probe) => os.some((o, k) => k !== i && k !== j && !o.flat && contains(o, probe)))) continue;
      const isFlat = SIDES[sa][0] === [0, 1, 2].find((k) => a.h[k] === 0) || SIDES[sb][0] === [0, 1, 2].find((k) => b.h[k] === 0);
      if (!isFlat && a.faces[sa] === b.faces[sb]) {
        sameTexture++;
        continue;
      }
      flat ||= isFlat;
      worst = Math.max(worst, area);
      clash.push(sa === sb ? sa : `${sa}/${sb}`);
    }
    if (!clash.length) continue;
    const sides = [...new Set(clash)].join(", ");
    if (flat) say("warning", "flat-in-face", `"${a.flat ? a.name : b.name}" is flat and lies in a face of "${a.flat ? b.name : a.name}" (${sides}; ${round(worst, 1)} square units): it will flicker. Move it 0.05 out, or give it thickness`, [a.name, b.name]);
    else say("warning", "coplanar", `"${a.name}" and "${b.name}" have faces in the same plane in different textures (${sides}; ${round(worst, 1)} square units shared): they will flicker. Make one stand 0.1 proud of the other, or stop it at the other's edge`, [a.name, b.name]);
  }
  if (sameTexture) say("note", "same-texture", `${sameTexture} pair${sameTexture === 1 ? "" : "s"} of faces share a plane in the same texture (usually harmless)`, []);

  // Groups of touching elements; every group but the biggest must rest on the ground (or reach the block's side, for a wall piece).
  if (worn) say("note", "worn", "a worn item (its pieces hang on body bones): floating and block-range checks skipped", []);
  else {
    const parent = os.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) if (gaps[i][j] <= TOUCH) parent[find(i)] = find(j);
    const groups = new Map<number, number[]>();
    os.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
    const volume = (g: number[]) => g.reduce((s, i) => s + os[i].h.reduce((v, h) => v * Math.max(h * 2, 0.1), 1), 0);
    const sorted = [...groups.values()].sort((a, b) => volume(b) - volume(a));
    for (const g of sorted.slice(1)) {
      const low = Math.min(...g.map((i) => elements[i].min[1]));
      if (low <= TOUCH) continue; // a loose piece lying on (or set into) the ground
      if (g.every((i) => os[i].flat >= 2)) continue; // can't be seen (reported as no-size)
      let near = Infinity, nearName = "";
      for (const i of g) for (let k = 0; k < os.length; k++) if (!g.includes(k) && gaps[i][k] < near) [near, nearName] = [gaps[i][k], os[k].name];
      const names = g.map((i) => os[i].name);
      const edge = g.some((i) => [0, 2].some((a) => Math.abs(elements[i].min[a]) <= TOUCH || Math.abs(elements[i].max[a] - 16) <= TOUCH) || Math.abs(elements[i].max[1] - 16) <= TOUCH);
      const what = `${quote(names)} ${g.length === 1 ? "touches" : `(${g.length} elements) touch`} nothing else: ${round(near)} from "${nearName}", lowest point y ${round(low)}`;
      if (edge) say("note", "floating", `${what}; it reaches the block's edge, so it may hang on a neighbouring block`, names);
      else say("error", "floating", `${what}. ${near < 1 ? "Close the gap" : "Check its coordinates' frame (a child is placed from its parent's \"from\") and any mirror plane"}`, names);
    }
  }

  // An element wholly inside another closed one.
  for (let i = 0; i < os.length; i++) {
    if (os[i].flat) continue;
    const pts = corners(os[i]);
    const j = os.findIndex((o, k) => k !== i && !o.flat && Object.keys(o.faces).length === 6 && gaps[i][k] < 0 && pts.every((p) => contains(o, p, 1e-6)) && !corners(o).every((p) => contains(os[i], p, 1e-6)));
    if (j >= 0) say("note", "inside", `"${os[i].name}" is wholly inside "${os[j].name}": hidden unless that is see-through`, [os[i].name, os[j].name]);
  }

  // UVs and texture keys.
  const textures = shape.textures && typeof shape.textures === "object" ? (shape.textures as Json) : undefined;
  const sizes = (shape.textureSizes ?? {}) as Record<string, unknown>;
  const missing = new Map<string, string[]>();
  for (const o of os) {
    const bad: string[] = [];
    for (const [side, key] of Object.entries(o.faces)) {
      if (textures && Object.keys(textures).length && !Object.hasOwn(textures, key)) missing.set(key, [...(missing.get(key) ?? []), o.name]);
      const uv = ((o.el.faces as Record<string, Json>)[side] ?? {}).uv;
      if (!Array.isArray(uv) || uv.length !== 4) continue;
      const own = sizes[key];
      const [tw, th] = Array.isArray(own) && own.length === 2 ? (own as number[]) : [typeof shape.textureWidth === "number" ? shape.textureWidth : 16, typeof shape.textureHeight === "number" ? shape.textureHeight : 16];
      if ((uv as number[]).some((v, k) => typeof v !== "number" || v < -1e-6 || v > (k % 2 ? th : tw) + 1e-6)) bad.push(`${side} [${(uv as number[]).join(", ")}] of ${tw} x ${th}`);
    }
    if (bad.length) say("warning", "uv", `"${o.name}" has UVs outside its texture: ${bad.join("; ")}`, [o.name]);
  }
  for (const [key, names] of missing) say("note", "texture", `texture key "${key}" (on ${quote(names)}) is not in the shape's "textures"; fine when the block or item type supplies it`, names);

  // Where it leaves the block.
  if (!worn) {
    const sides = [["west", "east"], ["below the floor", "up"], ["north", "south"]].flatMap(([lo, hi], i) => [...(bounds.min[i] < -0.01 ? [`${lo} (${"xyz"[i]} ${bounds.min[i]})`] : []), ...(bounds.max[i] > 16.01 ? [`${hi} (${"xyz"[i]} ${bounds.max[i]})`] : [])]);
    if (sides.length) {
      const out = elements.filter((e) => e.min.some((v) => v < -0.01) || e.max.some((v) => v > 16.01)).map((e) => e.name);
      say("note", "outside", `leaves the block (0..16) to the ${sides.join(", ")}: ${quote(out)}. Fine if meant; the block's selection and collision boxes should follow`, out);
    }
  }
  const order = { error: 0, warning: 1, note: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return result(bounds);
}

/** The report as text lines: bounds, findings (worst first) and, with `elements`, every element's box. */
export function formatCheck(check: ShapeCheck, options: { elements?: boolean; maxPerCode?: number } = {}): string[] {
  const lines: string[] = [];
  if (check.bounds) {
    const { min, max } = check.bounds;
    lines.push(`bounds: ${"xyz".split("").map((a, i) => `${a} ${min[i]}..${max[i]}`).join(", ")} (${check.blocks!.join(" x ")} blocks; 16 units = 1 block)`);
  }
  const max = options.maxPerCode ?? 12;
  const seen = new Map<string, number>();
  for (const f of check.findings) {
    const n = (seen.get(f.code) ?? 0) + 1;
    seen.set(f.code, n);
    if (n <= max) lines.push(`${f.level}: ${f.message}`);
  }
  for (const [code, n] of seen) if (n > max) lines.push(`... and ${n - max} more ${code} findings (--json lists all)`);
  if (options.elements) {
    lines.push(`elements (x, y, z of the box around each, after turns):`);
    const width = Math.min(28, Math.max(...check.elements.map((e) => e.path.length), 4));
    const shown = check.elements.slice(0, 80);
    for (const e of shown) lines.push(`  ${e.path.padEnd(width)}  ${e.min.map((v, i) => `${v}..${e.max[i]}`).join("  ")}${e.turned ? "  turned" : ""}  [${e.textures.join(", ")}]`);
    if (check.elements.length > shown.length) lines.push(`  ... and ${check.elements.length - shown.length} more (--json lists all)`);
  }
  lines.push(check.errors || check.warnings ? `check: ${check.errors} error${check.errors === 1 ? "" : "s"}, ${check.warnings} warning${check.warnings === 1 ? "" : "s"}${check.notes ? `, ${check.notes} note${check.notes === 1 ? "" : "s"}` : ""}` : `check: ok${check.notes ? ` (${check.notes} note${check.notes === 1 ? "" : "s"})` : ""}`);
  return lines;
}

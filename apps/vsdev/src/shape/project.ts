// A model seen straight on, as a picture: for a texture made from a model (an emblem embroidered from a statue, a stamp, a
// silhouette). `project(shape, { width, side })` builds the shape and, for each pixel, finds the nearest face turned toward the viewer:
// which texture key, which element and face, and where on the face (u across it, v up it, 0..1). `rows(classify)` turns that into pixel-art rows for
// a texture's "pixels" layer or a "mask".
import { SpecError } from "../gen/spec.js";
import { elementFrames, frameApply } from "./bounds.js";
import { buildShape, type ShapeSpec } from "./build.js";

type Json = Record<string, unknown>;
type Vec3 = [number, number, number];

export interface Hit {
  /** The face's texture key (without "#"). */
  texture: string;
  /** The element's name. */
  name: string;
  /** 0..1 across the face (the element's x for south) and up it (its y). */
  u: number;
  v: number;
  /** Which of the element's faces (north, east, south, west, up, down). */
  side: string;
  /** The face as written in the shape (texture, uv, rotation). */
  face: Json;
}

export interface Projection {
  width: number;
  height: number;
  /** Shape units per pixel. */
  unitsPerPixel: number;
  /** The nearest face under the middle of pixel (x, y) (y down), or undefined. */
  at: (x: number, y: number) => Hit | undefined;
  /** Pixel-art rows: each pixel's character from classify (one character; "" or undefined for "."), the most common over fine x fine samples. */
  rows: (classify: (hit: Hit | undefined) => string | undefined, fine?: number) => string[];
}

type Side = "south" | "north" | "east" | "west" | "up";
// Turns that bring each side to face south (+z), and the element face looked at.
const TURN: Record<Side, Vec3> = { south: [0, 0, 0], north: [0, 180, 0], east: [0, -90, 0], west: [0, 90, 0], up: [90, 0, 0] };

/** The shape seen from `side` (default south), `width` pixels across (height follows). */
export function project(spec: ShapeSpec, o: { width: number; side?: Side }): Projection {
  const side = o.side ?? "south";
  if (!TURN[side]) throw new SpecError(`project: "side" is one of ${Object.keys(TURN).join(", ")}`);
  if (!Number.isInteger(o.width) || o.width < 1 || o.width > 4096) throw new SpecError(`project: "width" is 1..4096 pixels`);
  const [rx, ry, rz] = TURN[side];
  const turned: ShapeSpec = { ...spec, ground: false, elements: [{ joint: [0, 0, 0], name: "view", rot: [rx, ry, rz], origin: [0, 0, 0], children: (spec.elements as unknown[]).map((e) => (e && typeof e === "object" && !Array.isArray(e) ? { ...(e as Json), ground: undefined } : e)) }] };
  const { shape } = buildShape(turned, "project");
  // Every face that faces the viewer (its turned normal points to +z): a parallelogram A + u U + v V, u across it, v up it (for
  // up and down, v runs from its south edge to its north edge).
  type Local = [Vec3, Vec3, Vec3];
  const local = (s: number[]): Record<string, Local> => ({
    south: [[0, 0, s[2]], [s[0], 0, 0], [0, s[1], 0]],
    north: [[s[0], 0, 0], [-s[0], 0, 0], [0, s[1], 0]],
    east: [[s[0], 0, s[2]], [0, 0, -s[2]], [0, s[1], 0]],
    west: [[0, 0, 0], [0, 0, s[2]], [0, s[1], 0]],
    up: [[0, s[1], s[2]], [s[0], 0, 0], [0, 0, -s[2]]],
    down: [[0, 0, 0], [s[0], 0, 0], [0, 0, s[2]]],
  });
  const faces: { a: Vec3; u: Vec3; v: Vec3; depth: number; hit: Omit<Hit, "u" | "v"> }[] = [];
  for (const { el, r, t } of elementFrames(shape.elements as Json[])) {
    const from = el.from as Vec3, to = el.to as Vec3, s = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    for (const [sideName, [o0, u0, v0]] of Object.entries(local(s))) {
      const f = (el.faces as Record<string, Json> | undefined)?.[sideName];
      if (!f) continue;
      const a = frameApply(r, o0).map((x, i) => x + t[i]) as Vec3;
      const u = frameApply(r, u0), v = frameApply(r, v0);
      if (u[0] * v[1] - u[1] * v[0] <= 1e-9) continue; // edge-on, or facing away (the normal's z is the 2D cross product)
      faces.push({ a, u, v, depth: a[2] + (u[2] + v[2]) / 2, hit: { texture: String(f.texture ?? "").replace(/^#/, ""), name: String(el.name ?? ""), side: sideName, face: f } });
    }
  }
  faces.sort((p, q) => q.depth - p.depth);
  const xs = faces.flatMap((f) => [f.a[0], f.a[0] + f.u[0], f.a[0] + f.v[0], f.a[0] + f.u[0] + f.v[0]]);
  const ys = faces.flatMap((f) => [f.a[1], f.a[1] + f.u[1], f.a[1] + f.v[1], f.a[1] + f.u[1] + f.v[1]]);
  if (!faces.length) throw new SpecError(`project: nothing faces ${side}`);
  const left = Math.min(...xs), top = Math.max(...ys);
  const unitsPerPixel = (Math.max(...xs) - left) / o.width || 1;
  const height = Math.max(1, Math.ceil((top - Math.min(...ys)) / unitsPerPixel - 1e-9));

  const sample = (x: number, y: number): Hit | undefined => {
    for (const f of faces) {
      const dx = x - f.a[0], dy = y - f.a[1];
      const det = f.u[0] * f.v[1] - f.u[1] * f.v[0];
      if (Math.abs(det) < 1e-12) continue;
      const u = (dx * f.v[1] - dy * f.v[0]) / det, v = (f.u[0] * dy - f.u[1] * dx) / det;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { ...f.hit, u, v };
    }
    return undefined;
  };
  const at = (px: number, py: number) => sample(left + (px + 0.5) * unitsPerPixel, top - (py + 0.5) * unitsPerPixel);
  const rows = (classify: (hit: Hit | undefined) => string | undefined, fine = 1) => {
    const out: string[] = [];
    for (let py = 0; py < height; py++) {
      let line = "";
      for (let px = 0; px < o.width; px++) {
        const votes = new Map<string, number>();
        for (let j = 0; j < fine; j++) for (let i = 0; i < fine; i++) {
          const ch = classify(sample(left + (px + (i + 0.5) / fine) * unitsPerPixel, top - (py + (j + 0.5) / fine) * unitsPerPixel)) || ".";
          votes.set(ch, (votes.get(ch) ?? 0) + 1);
        }
        line += [...votes].sort((p, q) => q[1] - p[1])[0][0][0];
      }
      out.push(line);
    }
    return out;
  };
  return { width: o.width, height, unitsPerPixel, at, rows };
}

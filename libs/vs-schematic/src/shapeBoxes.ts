// Vintage Story shape files (`shapes/item/**`, `shapes/entity/**`) as boxes for the voxel viewer.
// A shape is a tree of cuboids on a 16-units-per-block grid; each element may rotate about its own
// `rotationOrigin`, and its children are positioned relative to it (see shapeToBoxes). This module only does the geometry (no Three.js, no DOM, so
// Node tests can import it): `compactShape` trims a raw shape file to what is drawn (ingest writes that), `shapeToBoxes`
// flattens the tree into world-space boxes. Untextured by design: each box only remembers which texture key its
// faces use, so the page can give every key its own stable color. Animations are ignored (the static rest pose).

/** One element of a compacted shape: faces and UVs are gone, the texture key it uses is kept. */
export interface ShapeElement {
  from: [number, number, number];
  to: [number, number, number];
  /** Pivot of this element's rotation, in the same absolute shape space as `from`/`to` (default 0,0,0). */
  rotationOrigin?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  /** Texture key of the element's first textured face, without the leading "#" (e.g. "metal"). */
  texture?: string;
  children?: ShapeElement[];
}

export interface CompactShape {
  elements: ShapeElement[];
}

/** A box ready for `createVoxelViewer` (centers and sizes in 1/16 block units), with an optional rotation about its own center. */
export interface ShapeBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Rotation (x, y, z, w) about the box center; absent for an axis-aligned box. */
  quaternion?: [number, number, number, number];
  texture?: string;
}

type Vec = [number, number, number];
/** Row-major 3x3 rotation matrix. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Thickness, in 1/16 block units, given to a zero-thickness element. */
const MIN_THICKNESS = 0.1;
const FACE_ORDER = ["north", "east", "south", "west", "up", "down"];

const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Trims a raw shape file (as parsed from JSON) to a `CompactShape`: drops animations, faces, UVs and everything else
 * that isn't geometry. Elements with a malformed `from`/`to` are dropped (with their children), and a face-less
 * element (the game's "empty" bone-like groups) is kept so its rotation still reaches its children.
 */
export function compactShape(raw: unknown): CompactShape {
  const compactElement = (e: unknown): ShapeElement | undefined => {
    const el = e as Record<string, unknown> | null;
    if (!el || !isVec(el.from) || !isVec(el.to)) return undefined;
    const out: ShapeElement = { from: el.from, to: el.to };
    if (isVec(el.rotationOrigin) && el.rotationOrigin.some((n) => n !== 0)) out.rotationOrigin = el.rotationOrigin;
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const angle = el[axis];
      if (typeof angle === "number" && angle !== 0) out[axis] = angle;
    }
    const faces = el.faces as Record<string, { texture?: unknown; enabled?: unknown }> | undefined;
    if (faces && typeof faces === "object") {
      for (const side of FACE_ORDER) {
        const face = faces[side];
        if (face && face.enabled !== false && typeof face.texture === "string") {
          out.texture = face.texture.replace(/^#/, "");
          break;
        }
      }
    }
    if (Array.isArray(el.children)) {
      const children = el.children.map(compactElement).filter((c): c is ShapeElement => !!c);
      if (children.length) out.children = children;
    }
    return out;
  };
  const elements = (raw as { elements?: unknown } | null)?.elements;
  return { elements: Array.isArray(elements) ? elements.map(compactElement).filter((e): e is ShapeElement => !!e) : [] };
}

function rotation(rx: number, ry: number, rz: number): Mat3 {
  const [ax, ay, az] = [rx, ry, rz].map((d) => (d * Math.PI) / 180);
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const X: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Y: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Z: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(mul(X, Y), Z); // the game applies X, then Y, then Z to the matrix: M = Rx * Ry * Rz
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

function apply(m: Mat3, v: Vec): Vec {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function isIdentity(m: Mat3): boolean {
  return m.every((n, i) => Math.abs(n - IDENTITY[i]) < 1e-9);
}

/** Unit quaternion (x, y, z, w) of a rotation matrix. */
function toQuaternion(m: Mat3): [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s];
  }
  return q;
}

/**
 * Flattens a shape's element tree into boxes, following the game's `ShapeElement.GetLocalTransformMatrix`: an element's
 * matrix is `parent * translate(origin) * Rx * Ry * Rz * translate(from - origin)`, and its box is drawn from 0 to
 * `to - from` in that frame. So a child's `from` and `rotationOrigin` are relative to its parent's `from` (not absolute
 * shape coordinates), and it inherits the parent's rotation. Tracked here as a rotation plus an offset.
 */
export function shapeToBoxes(shape: CompactShape): ShapeBox[] {
  const boxes: ShapeBox[] = [];
  const visit = (el: ShapeElement, parentR: Mat3, parentT: Vec): void => {
    const origin = el.rotationOrigin ?? [0, 0, 0];
    const local = rotation(el.rotationX ?? 0, el.rotationY ?? 0, el.rotationZ ?? 0);
    // translate(origin) * R * translate(from - origin) maps a point p of the element's own frame to R*p + (origin + R*(from - origin)).
    const shift = apply(local, [el.from[0] - origin[0], el.from[1] - origin[1], el.from[2] - origin[2]]);
    const localT: Vec = [origin[0] + shift[0], origin[1] + shift[1], origin[2] + shift[2]];
    const r = mul(parentR, local);
    const rt = apply(parentR, localT);
    const t: Vec = [rt[0] + parentT[0], rt[1] + parentT[1], rt[2] + parentT[2]];

    const span: Vec = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
    // Flat planes (zero thickness on one axis: cloth, leaves, fins) get a sliver so they are visible.
    const size = span.map((n) => (n === 0 ? MIN_THICKNESS : n)) as Vec;
    // Elements that name no texture are pure groups (a pivot for their children): nothing to draw.
    if (el.texture !== undefined && size.every((n) => n > 0)) {
      const center = apply(r, [size[0] / 2, size[1] / 2, size[2] / 2]);
      boxes.push({
        x: center[0] + t[0], y: center[1] + t[1], z: center[2] + t[2],
        sx: size[0], sy: size[1], sz: size[2],
        ...(isIdentity(r) ? {} : { quaternion: toQuaternion(r) }),
        texture: el.texture,
      });
    }
    for (const child of el.children ?? []) visit(child, r, t);
  };
  for (const el of shape.elements) visit(el, IDENTITY, [0, 0, 0]);
  return boxes;
}

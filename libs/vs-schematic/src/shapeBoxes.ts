// Vintage Story shape files (`shapes/item/**`, `shapes/entity/**`) as boxes for the voxel viewer.
// A shape is a tree of cuboids on a 16-units-per-block grid; each element may rotate about its own
// `rotationOrigin`, and its children are positioned relative to it (see shapeToBoxes). This module only does the geometry (no Three.js, no DOM, so
// Node tests can import it): `compactShape` trims a raw shape file to what is drawn (ingest writes that), `shapeToBoxes`
// flattens the tree into world-space boxes. Untextured by design: each box only remembers which texture key its
// faces use, so the page can give every key its own stable color. Animations are kept as keyframes (`CompactAnimation`) and applied by passing a sampled pose to `shapeToBoxes`; without one it is the rest pose.

/** One element of a compacted shape: faces and UVs are gone, the texture key it uses is kept. */
export interface ShapeElement {
  from: [number, number, number];
  to: [number, number, number];
  /** Pivot of this element's rotation, in the same absolute shape space as `from`/`to` (default 0,0,0). */
  rotationOrigin?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  /** The element's own name; only used to find it as a `stepParent`. */
  name?: string;
  /** Name of the element of another shape (the player body) this element is attached to; see `attachToBase`. */
  stepParent?: string;
  /** Texture key of the element's first textured face, without the leading "#" (e.g. "metal"). */
  texture?: string;
  children?: ShapeElement[];
}

/** How an animation moves one element at one moment, added to the element's own placement: rotations in degrees, offsets in the shape's 1/16-block units. Missing values are 0. */
export interface ElementPose {
  ox?: number;
  oy?: number;
  oz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface CompactKeyframe {
  frame: number;
  /** Element name -> its pose at this frame; an element is only listed in the keyframes where the animation moves it. */
  elements: Record<string, ElementPose>;
}

/** One animation of a shape (`walk`, `idle`...), at the game's 30 frames per second. */
export interface CompactAnimation {
  code: string;
  name?: string;
  /** Length in frames (`quantityframes`). */
  frames: number;
  /** `onAnimationEnd: "Repeat"`: wraps from the last keyframe back to the first; otherwise it holds its last pose. */
  loop: boolean;
  keyframes: CompactKeyframe[];
}

export interface CompactShape {
  elements: ShapeElement[];
  animations?: CompactAnimation[];
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

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const POSE_FIELDS: [keyof ElementPose, string][] = [["ox", "offsetX"], ["oy", "offsetY"], ["oz", "offsetZ"], ["rx", "rotationX"], ["ry", "rotationY"], ["rz", "rotationZ"]];

/** Trims a shape file's `animations` to what `samplePose` needs: numbers rounded, zeros dropped, unknown fields ignored. Animations of the newer matrix `version` are skipped. */
function compactAnimations(raw: unknown): CompactAnimation[] {
  if (!Array.isArray(raw)) return [];
  const out: CompactAnimation[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a.code !== "string" || typeof a.quantityframes !== "number" || !Array.isArray(a.keyframes) || (a.version ?? 0) !== 0) continue;
    const keyframes: CompactKeyframe[] = [];
    for (const k of a.keyframes as Record<string, unknown>[]) {
      if (typeof k?.frame !== "number" || !k.elements || typeof k.elements !== "object") continue;
      const elements: Record<string, ElementPose> = {};
      for (const [name, value] of Object.entries(k.elements as Record<string, Record<string, unknown>>)) {
        const pose: ElementPose = {};
        for (const [short, long] of POSE_FIELDS) {
          const n = value?.[long];
          if (typeof n === "number" && round(n) !== 0) pose[short] = round(n);
        }
        elements[name] = pose;
      }
      keyframes.push({ frame: k.frame, elements });
    }
    if (!keyframes.length) continue;
    keyframes.sort((x, y) => x.frame - y.frame);
    out.push({ code: a.code, ...(typeof a.name === "string" && a.name !== a.code ? { name: a.name } : {}), frames: a.quantityframes, loop: a.onAnimationEnd === "Repeat", keyframes });
  }
  return out;
}

/** The game's animation speed: frames per second. */
export const ANIMATION_FPS = 30;

const tracks = new WeakMap<CompactAnimation, Map<string, { frame: number; pose: ElementPose }[]>>();

/** Every element's own keyframes of an animation, in frame order. */
function tracksOf(animation: CompactAnimation): Map<string, { frame: number; pose: ElementPose }[]> {
  let map = tracks.get(animation);
  if (!map) {
    map = new Map();
    for (const k of animation.keyframes) for (const [name, pose] of Object.entries(k.elements)) (map.get(name) ?? map.set(name, []).get(name)!).push({ frame: k.frame, pose });
    tracks.set(animation, map);
  }
  return map;
}

/**
 * The pose of every animated element at `frame` (any real number; a looping animation wraps, others hold their last pose): each element is
 * interpolated linearly between the keyframes that name it, wrapping from its last keyframe round to its first when the animation loops.
 */
export function samplePose(animation: CompactAnimation, frame: number): Record<string, ElementPose> {
  const t = animation.loop && animation.frames > 0 ? ((frame % animation.frames) + animation.frames) % animation.frames : Math.min(Math.max(frame, 0), animation.frames);
  const out: Record<string, ElementPose> = {};
  for (const [name, keys] of tracksOf(animation)) {
    let before = keys[0], after = keys[0], beforeFrame = keys[0].frame, afterFrame = keys[0].frame;
    if (keys.length > 1) {
      const next = keys.findIndex((k) => k.frame > t);
      if (next === -1) {
        before = keys[keys.length - 1];
        beforeFrame = before.frame;
        after = animation.loop ? keys[0] : before;
        afterFrame = animation.loop ? keys[0].frame + animation.frames : beforeFrame;
      } else if (next === 0) {
        after = keys[0];
        afterFrame = after.frame;
        before = animation.loop ? keys[keys.length - 1] : after;
        beforeFrame = animation.loop ? before.frame - animation.frames : afterFrame;
      } else {
        before = keys[next - 1];
        after = keys[next];
        beforeFrame = before.frame;
        afterFrame = after.frame;
      }
    }
    const span = afterFrame - beforeFrame;
    const f = span > 0 ? (t - beforeFrame) / span : 0;
    const pose: ElementPose = {};
    for (const [field] of POSE_FIELDS) {
      const a = before.pose[field] ?? 0, b = after.pose[field] ?? 0;
      const v = a + (b - a) * f;
      if (v !== 0) pose[field] = v;
    }
    out[name] = pose;
  }
  return out;
}

/** Whether parsed JSON is a model (shape) file -- an `elements` tree of boxes -- rather than a schematic, which has `Indices`/`BlockIds` instead. */
export function looksLikeShape(parsed: unknown): boolean {
  const p = parsed as { elements?: unknown; Indices?: unknown } | null;
  return !!p && typeof p === "object" && !p.Indices && Array.isArray(p.elements) && p.elements.some((e) => e && typeof e === "object" && "from" in e && "to" in e);
}

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
    if (typeof el.name === "string" && el.name) out.name = el.name;
    if (isVec(el.rotationOrigin) && el.rotationOrigin.some((n) => n !== 0)) out.rotationOrigin = el.rotationOrigin;
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const angle = el[axis];
      if (typeof angle === "number" && angle !== 0) out[axis] = angle;
    }
    if (typeof el.stepParentName === "string" && el.stepParentName) out.stepParent = el.stepParentName;
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
  const compact: CompactShape = { elements: Array.isArray(elements) ? elements.map(compactElement).filter((e): e is ShapeElement => !!e) : [] };
  const animations = compactAnimations((raw as { animations?: unknown } | null)?.animations);
  if (animations.length) compact.animations = animations;
  return compact;
}

/**
 * Worn items (armor, clothes) are shapes whose top-level elements name a `stepParentName`: a bone of the player body they hang on
 * (`UpperTorso`, `UpperArmR`...). On their own they have no place to be, so they would all pile up at the origin. This hangs each such
 * element under the named element of `base` (the body shape) as a child, which is what the game does when it dresses the model, and strips
 * the body's own textures so only the worn pieces draw while the body still supplies every pivot and pose. Elements whose parent isn't
 * found stay top-level. A shape with no `stepParent` elements is returned unchanged.
 */
export function attachToBase(shape: CompactShape, base: CompactShape): CompactShape {
  if (!shape.elements.some((e) => e.stepParent)) return shape;
  const hidden = (el: ShapeElement): ShapeElement => {
    const { texture: _texture, ...rest } = el;
    return { ...rest, ...(el.children ? { children: el.children.map(hidden) } : {}) };
  };
  const body = base.elements.map(hidden);
  const find = (els: ShapeElement[], name: string): ShapeElement | undefined => {
    for (const el of els) {
      if (el.name === name) return el;
      const inChild = el.children && find(el.children, name);
      if (inChild) return inChild;
    }
    return undefined;
  };
  const loose: ShapeElement[] = [];
  for (const el of shape.elements) {
    const parent = el.stepParent ? find(body, el.stepParent) : undefined;
    if (parent) (parent.children ??= []).push(el);
    else loose.push(el);
  }
  return { elements: [...body, ...loose] };
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
export function shapeToBoxes(shape: CompactShape, pose?: Record<string, ElementPose>): ShapeBox[] {
  const boxes: ShapeBox[] = [];
  const visit = (el: ShapeElement, parentR: Mat3, parentT: Vec): void => {
    const origin = el.rotationOrigin ?? [0, 0, 0];
    // An animation adds to the element's own rotation and moves it inside its rotated frame (the game's GetLocalTransformMatrix, version 0).
    const p = (el.name && pose?.[el.name]) || undefined;
    const local = rotation((el.rotationX ?? 0) + (p?.rx ?? 0), (el.rotationY ?? 0) + (p?.ry ?? 0), (el.rotationZ ?? 0) + (p?.rz ?? 0));
    // translate(origin) * R * translate(from - origin) maps a point p of the element's own frame to R*p + (origin + R*(from - origin)).
    const shift = apply(local, [el.from[0] + (p?.ox ?? 0) - origin[0], el.from[1] + (p?.oy ?? 0) - origin[1], el.from[2] + (p?.oz ?? 0) - origin[2]]);
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
